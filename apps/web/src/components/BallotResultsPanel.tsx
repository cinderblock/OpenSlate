import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { rankingKeyFor, useBallotDraft, useRankings } from "../lib/ballotDraft";
import {
  CLOSE_POINTS,
  hasMarks,
  type MyMarks,
  myMarks,
  type Outcome,
  type RaceOutcome,
  raceOutcome,
  type Standing,
} from "../lib/ballotOutcome";
import { type RaceCount, useBallotCounts } from "../lib/ballotResults";
import { compareBallotOrder } from "../lib/ballotSequence";
import { raceHeading } from "../lib/ballotView";
import { collateRaces, defaultElection, electionsOf, type Race } from "../lib/collate";
import { formatElectionDate } from "../lib/dates";
import { isAreaSet } from "../lib/jurisdictions";
import { useLocalStore } from "../lib/localStore";
import {
  localToday,
  useArea,
  useDecodedSlates,
  useDisagreeMode,
  useFollows,
  useMyElection,
} from "../lib/myVote";
import { orderOverrideStore } from "../lib/orderOverrides";
import { describeArea } from "./AreaPicker";
import { electionOptions } from "./electionOptions";
import { RaceLink } from "./RaceLink";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";

/**
 * How my ballot is doing: every race the voter marked on My ballot, next to
 * the count so far, grouped by whether it's going the way they voted. Reads
 * the draft directly (nothing to sign). Counts come from `useBallotCounts`;
 * the scoring is `lib/ballotOutcome.ts`. Nothing here calls a race: the state
 * and counties don't, so a race is "leading" until a source says it's won.
 */

type Group = Outcome | "loading" | "none";
type Filter = "all" | Group;
type Sort = "ballot" | "closest";

const GROUPS: { id: Group; label: string; hint?: string }[] = [
  { id: "your-way", label: "Going your way" },
  {
    id: "mixed",
    label: "Partly your way",
    hint: "Some of your picks are winning, some aren't.",
  },
  { id: "not-your-way", label: "Not going your way" },
  { id: "no-votes", label: "No votes counted yet" },
  { id: "loading", label: "Checking the count…" },
  { id: "none", label: "No count found", hint: "No source OpenSlate reads reports these races." },
];

interface Row {
  race: Race;
  marks: MyMarks;
  count: RaceCount;
  outcome?: RaceOutcome;
  group: Group;
}

function groupOf(count: RaceCount, outcome: RaceOutcome | undefined): Group {
  if (count.status === "loading") return "loading";
  if (count.status !== "found" || !outcome) return "none";
  return outcome.outcome;
}

export function BallotResultsPanel() {
  const { slates, isReady } = useDecodedSlates();
  const [follows] = useFollows();
  const [disagree] = useDisagreeMode();
  const [area] = useArea();
  const [chosenElection, setChosenElection] = useMyElection();
  const { rows } = useBallotDraft();
  const rankings = useRankings();
  const [orderOverrides] = useLocalStore(orderOverrideStore);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("ballot");

  const today = localToday();
  const elections = useMemo(() => electionsOf(slates, follows), [slates, follows]);
  const election = elections.some((e) => e.date === chosenElection)
    ? chosenElection
    : defaultElection(elections, today);

  // Every race the voter could have marked, then only those they did: only
  // those are looked up.
  const collated = useMemo(
    () =>
      election
        ? collateRaces(slates, {
            follows,
            disagree,
            election,
            area,
            includeUnfollowed: true,
            orderOverrides,
          })
        : [],
    [slates, follows, disagree, election, area, orderOverrides],
  );
  const marked = useMemo(() => {
    const out: { race: Race; marks: MyMarks }[] = [];
    for (const race of collated) {
      const marks = myMarks(
        race,
        rows,
        election ?? "",
        rankings[rankingKeyFor(election ?? "", race.subject)],
      );
      if (hasMarks(marks)) out.push({ race, marks });
    }
    return out.sort((a, b) => compareBallotOrder(a.race, b.race, area));
  }, [collated, rows, rankings, election, area]);
  const unmarked =
    collated.filter((r) => !r.maybe).length - marked.filter((m) => !m.race.maybe).length;

  const markedRaces = useMemo(() => marked.map((m) => m.race), [marked]);
  const counts = useBallotCounts(markedRaces, area);

  const all = useMemo((): Row[] => {
    return marked.map(({ race, marks }) => {
      const count = counts.get(race.key) ?? { status: "loading" as const };
      const outcome = count.status === "found" ? raceOutcome(marks, count.standing) : undefined;
      return {
        race,
        marks,
        count,
        ...(outcome ? { outcome } : {}),
        group: groupOf(count, outcome),
      };
    });
  }, [marked, counts]);

  const tally = useMemo(() => {
    const out = new Map<Group, number>();
    for (const row of all) out.set(row.group, (out.get(row.group) ?? 0) + 1);
    return out;
  }, [all]);

  const sections = useMemo(() => {
    const ordered = (list: Row[]) =>
      sort === "closest"
        ? [...list].sort(
            (a, b) =>
              (a.outcome?.marginPoints ?? Number.POSITIVE_INFINITY) -
              (b.outcome?.marginPoints ?? Number.POSITIVE_INFINITY),
          )
        : list;
    return GROUPS.filter((g) => filter === "all" || filter === g.id)
      .map((g) => ({ ...g, rows: ordered(all.filter((row) => row.group === g.id)) }))
      .filter((g) => g.rows.length > 0);
  }, [all, filter, sort]);

  if (!isReady) {
    return (
      <section className="panel">
        <p className="hint">Loading your ballot…</p>
      </section>
    );
  }

  const decided =
    (tally.get("your-way") ?? 0) + (tally.get("not-your-way") ?? 0) + (tally.get("mixed") ?? 0);

  return (
    <section className="panel ballot-results">
      <p className="no-print">
        <Link to="/results">← Results</Link>
      </p>
      <h2>How my ballot is doing</h2>
      <div className="ballot-toolbar no-print">
        <Select
          className="ballot-election"
          label="Election"
          value={election}
          onChange={setChosenElection}
          options={electionOptions(elections, today)}
        />
        {isAreaSet(area) && <span className="hint">Where you vote: {describeArea(area)}</span>}
      </div>
      <p className="hint">
        Each race you marked on <Link to="/">My ballot</Link>
        {election ? ` for ${formatElectionDate(election)}` : ""}, next to the count so far: the
        California Secretary of State's for state races, your county's own for local ones,
        civicAPI's for the rest. Nobody here calls a race: "going your way" means your vote is on
        the winning side of the count so far. California counts for weeks after Election Day.
      </p>

      {marked.length === 0 ? (
        <div className="card">
          <p>
            You haven't marked any races for this election yet. Mark your picks on{" "}
            <Link to="/">My ballot</Link> and they show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="card slate-summary">
            <div className="card-title">
              <strong>
                {decided > 0
                  ? `${tally.get("your-way") ?? 0} of ${decided} counted races are going your way.`
                  : `${marked.length} race${marked.length === 1 ? "" : "s"} you marked.`}
              </strong>
            </div>
            <div className="filter-chips no-print">
              <FilterChip
                label={`All (${all.length})`}
                active={filter === "all"}
                onClick={() => setFilter("all")}
              />
              {GROUPS.map((g) => {
                const n = tally.get(g.id) ?? 0;
                if (n === 0) return null;
                return (
                  <FilterChip
                    key={g.id}
                    label={`${g.label.replace("…", "")} (${n})`}
                    active={filter === g.id}
                    onClick={() => setFilter(filter === g.id ? "all" : g.id)}
                    {...(g.id === "your-way"
                      ? { tone: "ok" as const }
                      : g.id === "not-your-way"
                        ? { tone: "bad" as const }
                        : {})}
                  />
                );
              })}
            </div>
            {unmarked > 0 && (
              <p className="hint">
                {unmarked} race{unmarked === 1 ? "" : "s"} on your ballot you didn't mark{" "}
                {unmarked === 1 ? "isn't" : "aren't"} listed.
              </p>
            )}
          </div>

          <Segmented
            className="no-print"
            label="Order"
            value={sort}
            onChange={setSort}
            options={[
              { id: "ballot", label: "Ballot order" },
              { id: "closest", label: "Closest first" },
            ]}
          />

          {sections.map((section) => (
            <section key={section.id} className={`outcome-group outcome-${section.id}`}>
              <h3>
                {section.label} <span className="hint">({section.rows.length})</span>
              </h3>
              {section.hint && <p className="hint">{section.hint}</p>}
              <ul className="outcome-list">
                {section.rows.map((row) => (
                  <OutcomeRace key={row.race.key} row={row} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "ok" | "bad";
}) {
  return (
    <button
      type="button"
      className={`tag filter-chip${active ? " active" : ""}${tone ? ` ${tone}` : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// ---- One race ----------------------------------------------------------------

const pct = (n: number) => `${n.toFixed(1)}%`;
const points = (n: number) => `${n.toFixed(1)} point${n.toFixed(1) === "1.0" ? "" : "s"}`;
const fmt = new Intl.NumberFormat("en-US");

const NEED: Record<string, string> = { "55%": "needs 55%", "2/3": "needs two-thirds" };

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What the voter marked, in a line. */
function yourVote(marks: MyMarks): string {
  if (marks.measure) return `You voted ${marks.measure === "yes" ? "Yes" : "No"}.`;
  const parts: string[] = [];
  if (marks.picks.length > 0) {
    const who = joinNames(marks.picks);
    parts.push(
      marks.ranked
        ? `Your first choice: ${who}${marks.leaning ? " (a Maybe)" : ""}.`
        : marks.leaning
          ? `You were leaning to ${who} (Maybe).`
          : `You picked ${who}.`,
    );
  }
  if (marks.against.length > 0) parts.push(`Against: ${joinNames(marks.against)}.`);
  return parts.join(" ");
}

/** Where the count stands, in a sentence. */
function countLine(outcome: RaceOutcome, standing: Standing): string {
  if (outcome.outcome === "no-votes") return "No votes counted yet.";
  if (standing.kind === "measure" && outcome.measure) {
    const m = outcome.measure;
    const need = standing.threshold ? ` (${NEED[standing.threshold]})` : "";
    if (outcome.called)
      return `${m.passing ? "Passed" : "Failed"}: ${pct(m.yesPercent)} Yes${need}.`;
    return `${m.passing ? "Passing" : "Failing"} with ${pct(m.yesPercent)} Yes${need}${
      outcome.marginPoints !== undefined ? `, ${points(outcome.marginPoints)} from the line` : ""
    }.`;
  }
  const inSeat = outcome.choices.filter((c) => c.in).map((c) => c.name);
  if (outcome.called) return `Won: ${joinNames(inSeat)}.`;
  const seats = standing.kind === "candidates" ? standing.seats : 1;
  const margin = outcome.marginPoints;
  if (seats <= 1) {
    const [first, second] = outcome.choices;
    if (!first) return "";
    if (!second) return `${first.name} is unopposed on the count.`;
    if (margin === 0) return `${first.name} and ${second.name} are tied.`;
    return `${first.name} leads ${second.name} by ${points(margin ?? 0)}.`;
  }
  return `Electing ${seats}: ${joinNames(inSeat)} ${inSeat.length === 1 ? "is" : "are"} in so far${
    margin !== undefined ? `; the last seat is ${points(margin)} ahead of the next` : ""
  }.`;
}

function OutcomeRace({ row }: { row: Row }) {
  const { race, marks, count, outcome } = row;
  const { heading, label } = raceHeading(race);
  const standing = count.status === "found" ? count.standing : undefined;
  const close =
    outcome !== undefined &&
    !outcome.called &&
    outcome.outcome !== "no-votes" &&
    outcome.marginPoints !== undefined &&
    outcome.marginPoints < CLOSE_POINTS;
  // Your picks and the seats, then the next one out: enough to see the line.
  const shown = outcome
    ? outcome.choices.filter(
        (c, i) => c.mine !== undefined || c.in || i === outcome.choices.findIndex((x) => !x.in),
      )
    : [];
  return (
    <li className="card outcome-race">
      <div className="outcome-race-head">
        <RaceLink raceKey={race.key} className="outcome-race-title">
          {heading}
          {label ? ` · ${label}` : ""}
        </RaceLink>
        {close && <span className="tag warning">Close</span>}
        {outcome?.called && <span className="tag">Called by {standing?.sourceName}</span>}
      </div>
      <p className="outcome-mine">{yourVote(marks)}</p>
      {outcome && standing && <p className="outcome-count">{countLine(outcome, standing)}</p>}
      {shown.length > 0 && outcome?.outcome !== "no-votes" && (
        <ul className="outcome-choices">
          {shown.map((c) => (
            <li key={c.name} className={c.in ? "in" : "out"}>
              <span className="outcome-choice-name">
                {c.name}
                {c.mine === "pick" && <span className="tag ok">Your pick</span>}
                {c.mine === "against" && <span className="tag bad">You're against</span>}
              </span>
              <span className="outcome-choice-votes">
                {pct(c.percent)} · {fmt.format(c.votes)}
                <span className="outcome-choice-seat">
                  {c.in ? (outcome?.called ? "won" : "in") : "out"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {marks.ranked && standing && (
        <p className="hint">
          Ranked-choice: this is the first-round count. Later rounds can change who wins.
        </p>
      )}
      {count.status === "found" && standing && <SourceLine standing={standing} />}
      {(count.status === "none" || count.status === "error") && (
        <p className="hint">
          {count.status === "error" ? `Couldn't read the count: ${count.why}` : count.why}
        </p>
      )}
    </li>
  );
}

const clockFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function SourceLine({ standing }: { standing: Standing }) {
  const at = standing.changedAt;
  const d = at !== undefined ? new Date(at) : undefined;
  return (
    <p className="hint">
      {standing.sourceName}
      {standing.reporting ? ` · ${standing.reporting}` : ""}
      {d && (
        <>
          {" · updated "}
          <time dateTime={d.toISOString()}>
            {new Date().toDateString() === d.toDateString() ? "" : `${dayFmt.format(d)}, `}
            {clockFmt.format(d)}{" "}
            <small className="live-utc">({d.toISOString().slice(11, 16)}Z)</small>
          </time>
        </>
      )}
    </p>
  );
}
