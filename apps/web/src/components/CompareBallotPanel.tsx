import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleSlash, Equal, type LucideIcon, Minus, ShieldCheck, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  type Alignment,
  type AlignmentRow,
  ELSEWHERE_MIN_MARKS,
  type Evidence,
  evidenceOf,
  type RaceResult,
  splitOf,
  type Verdict,
} from "../lib/alignment";
import { useAllRaces } from "../lib/allSlates";
import { CONTEST_GROUP_LABEL } from "../lib/ballotView";
import { importCatalogEntry } from "../lib/catalogImport";
import { electionOf } from "../lib/collate";
import { useBallotComparison, useBallotElection } from "../lib/comparison";
import { setRemoved, setStanding, useDecodedSlates, useFollows } from "../lib/myVote";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "../lib/query";
import { type Standing, sourceIdOf, standingOf } from "../lib/sources";
import { AllSlatesLoading } from "./AllSlates";
import { EndorserAvatar } from "./EndorserAvatar";
import { StandingToggle } from "./StandingToggle";
import { cx } from "./ui/cx";
import { Segmented } from "./ui/Segmented";

/** How many of a group show before "Show all". */
const FIRST_ROWS = 5;

const EVIDENCE_NOTE: Record<Evidence, string> = {
  early:
    "A first hint, no more: on this few races almost anyone can match by chance. It firms up as you mark more.",
  building: "Taking shape. Rows marked “not sure yet” could still go either way.",
  solid: "Enough races to read this with some confidence, though not as a precise score.",
};

const VERDICT: Record<Verdict, { label: string; icon: LucideIcon }> = {
  agree: { label: "Agree", icon: Check },
  partly: { label: "Partly", icon: Equal },
  differ: { label: "Differ", icon: X },
  compatible: { label: "Both fit", icon: Minus },
  declined: { label: "No position", icon: CircleSlash },
};

/** The order a record reads in: what's worth checking first. */
const VERDICT_ORDER: Verdict[] = ["differ", "partly", "agree", "compatible", "declined"];

type Scope = "everyone" | "following";

/** What a row needs to follow a source from here. */
interface FollowContext {
  election: string | undefined;
  /** Sources with a slate for this election in this browser. */
  imported: ReadonlySet<string>;
  tokens: ReadonlySet<string>;
}

export function CompareBallotPanel() {
  const { slates, isReady } = useDecodedSlates();
  const election = useBallotElection(slates);
  const [follows] = useFollows();
  const catalog = useAllRaces(true);
  const [scope, setScope] = useState<Scope>("everyone");

  const context = useMemo((): FollowContext => {
    const here = slates.filter((slate) =>
      slate.payload.positions.some((p) => electionOf(p.subject, slate.payload) === election),
    );
    return {
      election,
      imported: new Set(here.map((slate) => slate.source.id)),
      tokens: new Set(slates.map((slate) => slate.token)),
    };
  }, [slates, election]);
  const only = useMemo(
    () =>
      scope === "following"
        ? (a: Alignment) =>
            context.imported.has(a.source.id) && standingOf(follows, a.source.id) !== "off"
        : undefined,
    [scope, context, follows],
  );
  const result = useBallotComparison(election, slates, catalog.all, only ? { only } : {});

  if (!isReady) {
    return (
      <section className="panel">
        <p className="hint">Loading your ballot…</p>
      </section>
    );
  }

  const comparison = result?.comparison;
  const groups = result?.groups;
  const marked = comparison?.marked ?? 0;
  const matched = comparison?.matched ?? 0;

  return (
    <section className="panel compare">
      <h2>Who agrees with you</h2>
      <p className="hint">
        Your picks, compared with what endorsers said. It's worked out here in your browser:
        everyone downloads the same public list, and your picks never leave this device.
      </p>

      <AllSlatesLoading state={catalog} />

      {marked === 0 ? (
        <div className="card">
          <p>
            Nothing to compare yet. <Link to="/">Mark a few races on My ballot</Link> and they'll
            line up here as you go.
          </p>
        </div>
      ) : (
        <>
          <div className="compare-summary">
            <p>
              <strong>
                Based on {marked} race{marked === 1 ? "" : "s"} you've marked
              </strong>
              {matched < marked && `, ${matched} of them with an endorser to compare`}.{" "}
              {EVIDENCE_NOTE[evidenceOf(matched)]}
            </p>
            {result?.scope === "imported" && (
              <p className="hint">
                Only the sources you've imported
                {catalog.status.state === "error" ? "." : " so far. Everyone else is on the way."}
              </p>
            )}
            {(catalog.all?.rejected ?? 0) > 0 && (
              <p className="hint">
                {catalog.all?.rejected} catalog {catalog.all?.rejected === 1 ? "entry" : "entries"}{" "}
                couldn't be used and {catalog.all?.rejected === 1 ? "is" : "are"} left out.
              </p>
            )}
            <div className="row compare-controls">
              <Segmented
                aria-label="Compare with"
                value={scope}
                onChange={setScope}
                options={[
                  { id: "everyone", label: "Every endorser" },
                  { id: "following", label: "Sources I follow" },
                ]}
              />
              <RecordLegend />
            </div>
          </div>

          <div className="compare-groups">
            <Group
              title="Most aligned"
              context={context}
              hint="They agree with you more often than not. The surest come first, so a long record beats a short perfect one."
              empty="Nobody yet."
              rows={groups?.aligned ?? []}
              clear={(a) => a.low > 0.5}
            />
            <Group
              title="Most at odds"
              context={context}
              hint="They disagree with you more often than not. Handy too: following someone to disagree counts their picks the other way."
              empty="Nobody yet."
              rows={groups?.opposed ?? []}
              clear={(a) => a.high < 0.5}
            />
            <Group
              title="Split with you"
              context={context}
              hint="They speak to plenty of your races and come out about even: a different line through the ballot from yours. Where they part ways is often the interesting bit."
              empty="Nobody yet. It takes at least six races in common to call a record even."
              rows={groups?.mixed ?? []}
            />
            <Group
              title="Looking at other races"
              context={context}
              hint="Active on your ballot, but on races you haven't marked. They haven't told you much about your picks; they may help with the races you've left."
              empty={
                matched < ELSEWHERE_MIN_MARKS
                  ? "Too early to say: mark a few more races first."
                  : "Nobody: everyone active here also speaks to what you've marked."
              }
              rows={groups?.elsewhere ?? []}
              line={elsewhereLine}
            />
          </div>

          <HowItsWorkedOut />
        </>
      )}
    </section>
  );
}

function Group({
  title,
  context,
  hint,
  empty,
  rows,
  clear,
  line = recordLine,
}: {
  title: string;
  context: FollowContext;
  hint: string;
  empty: string;
  rows: AlignmentRow[];
  /** Whether the row's record settles it, for groups that can be unsure. */
  clear?: (row: Alignment) => boolean;
  line?: (row: Alignment) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const headingId = useId();
  const shown = showAll ? rows : rows.slice(0, FIRST_ROWS);
  return (
    <section className="card compare-group" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {title} <span className="hint">· {rows.length}</span>
      </h3>
      <p className="hint">{hint}</p>
      {rows.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className="compare-list">
          {shown.map((row) => (
            <Row
              key={row.source.id}
              row={row}
              context={context}
              line={line(row)}
              unsure={clear ? !clear(row) : false}
              showBar={line === recordLine}
            />
          ))}
        </ul>
      )}
      {rows.length > FIRST_ROWS && (
        <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `Show the first ${FIRST_ROWS}` : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

/** "Agreed on 12 of 14 races, partly on 1. No position on 2." */
function recordLine(a: Alignment): string {
  const parts = [`Agreed on ${a.agree} of ${a.shared} race${a.shared === 1 ? "" : "s"}`];
  if (a.partly > 0) parts[0] += `, partly on ${a.partly}`;
  if (a.declined > 0) parts.push(`no position on ${a.declined}`);
  if (a.compatible > 0) parts.push(`${a.compatible} that fit side by side`);
  return parts.join(" · ");
}

function elsewhereLine(a: Alignment): string {
  const spoke = a.shared + a.compatible;
  return `A side on ${a.open} race${a.open === 1 ? "" : "s"} you haven't marked, and ${spoke} you have`;
}

function Row({
  row,
  context,
  line,
  unsure,
  showBar,
}: {
  row: AlignmentRow;
  context: FollowContext;
  line: string;
  unsure: boolean;
  showBar: boolean;
}) {
  const { source } = row;
  const split = splitOf(row);
  const [open, setOpen] = useState(false);
  return (
    <li className="compare-row">
      <EndorserAvatar sourceId={source.id} name={source.name} size="md" />
      <div className="compare-row-body">
        <div className="compare-row-head">
          <strong>{source.name}</strong>
          {unsure && <span className="tag tag-inline">not sure yet</span>}
        </div>
        {showBar && <RecordBar agree={row.agree} partly={row.partly} differ={row.differ} />}
        <div className="compare-line">{line}</div>
        {split && (
          <div className="hint">
            Agreed on {split.high[1].agree} of {split.high[1].total}{" "}
            {CONTEST_GROUP_LABEL[split.high[0]].toLowerCase()}, {split.low[1].agree} of{" "}
            {split.low[1].total} {CONTEST_GROUP_LABEL[split.low[0]].toLowerCase()}
          </div>
        )}
        {row.repeats && (
          <div className="hint">
            Mostly repeats {row.repeats.of}: {row.repeats.count} of {row.shared} races
          </div>
        )}
        {row.folded.length > 0 && <Folded row={row} />}
        <details
          className="compare-details"
          open={open}
          onToggle={(e) => setOpen(e.currentTarget.open)}
        >
          <summary>See the races</summary>
          {open && <RaceList results={row.results} />}
        </details>
      </div>
      <FollowControl alignment={row} context={context} />
    </li>
  );
}

/** Endorsers sharing this row: one opinion here, so one row, but never hidden. */
function Folded({ row }: { row: AlignmentRow }) {
  const repeating = row.folded.filter((a) => a.repeats?.of === row.source.name);
  const same = row.folded.filter((a) => a.repeats?.of !== row.source.name);
  return (
    <details className="compare-details">
      <summary>
        {row.folded.length} more with {same.length === 0 ? "this list" : "the same record"}
      </summary>
      {same.length > 0 && <p className="hint">Same picks on every race you share with them.</p>}
      <ul className="compare-folded">
        {same.map((a) => (
          <li key={a.source.id}>{a.source.name}</li>
        ))}
        {repeating.map((a) => (
          <li key={a.source.id}>
            {a.source.name}{" "}
            <span className="hint">
              (repeats this list on {a.repeats?.count} of {a.shared} races)
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RaceList({ results }: { results: RaceResult[] }) {
  const sorted = [...results].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict),
  );
  return (
    <ul className="compare-races">
      {sorted.map((result) => {
        const { label, icon: Icon } = VERDICT[result.verdict];
        return (
          <li key={result.race.key}>
            <span className={cx("compare-verdict", `verdict-${result.verdict}`)}>
              <Icon className="icon" aria-hidden="true" /> {label}
            </span>
            <div>
              <Link to="/race/$key" params={{ key: result.race.key }} className="race-link">
                {result.race.subject.title}
              </Link>
              <div className="hint">{raceLine(result)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function names(backed: string[], against: string[]): string {
  return [...backed, ...against.map((name) => `against ${name}`)].join(", ");
}

/** What each side said. The endorser's own word for it goes in, when it has one (SPEC §3.17). */
function raceLine(result: RaceResult): string {
  const mine = names(result.mine, result.against);
  if (result.verdict === "declined") return `You: ${mine} · They took no position`;
  const theirs = names(result.theirs, result.theirsAgainst);
  const said = result.label ? `${theirs} (“${result.label}”)` : theirs;
  const parts = [`You: ${mine}`, `They: ${said}`];
  if (result.via) parts.push(`adopted from ${result.via}`);
  if (result.maybe) parts.push("counts half: your Maybe");
  if (result.guessedSeats) parts.push("counts half: seats unknown");
  return parts.join(" · ");
}

function RecordBar({ agree, partly, differ }: { agree: number; partly: number; differ: number }) {
  // The counts are in words right beside it, so this is for the eye only.
  return (
    <span className="record-bar" aria-hidden="true">
      {agree > 0 && <span className="record-agree" style={{ flexGrow: agree }} />}
      {partly > 0 && <span className="record-partly" style={{ flexGrow: partly }} />}
      {differ > 0 && <span className="record-differ" style={{ flexGrow: differ }} />}
    </span>
  );
}

function RecordLegend() {
  return (
    <span className="record-legend hint">
      <span>
        <span className="record-swatch record-agree" aria-hidden="true" /> Agree
      </span>
      <span>
        <span className="record-swatch record-partly" aria-hidden="true" /> Partly
      </span>
      <span>
        <span className="record-swatch record-differ" aria-hidden="true" /> Differ
      </span>
    </span>
  );
}

/** Follow from the result, bringing the source's slate in first if it isn't here yet. */
function FollowControl({ alignment, context }: { alignment: Alignment; context: FollowContext }) {
  const { source } = alignment;
  const catalogUrl = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;
  const [follows] = useFollows();
  const { data: catalog } = useQuery(catalogQueryOptions(catalogUrl));
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const has = context.imported.has(source.id);
  const standing: Standing = has ? standingOf(follows, source.id) : "off";
  const entry = catalog?.entries.find(
    (e) => e.election === context.election && sourceIdOf(e) === source.id,
  );

  async function change(next: Standing) {
    if (has || !entry) {
      setStanding(source.id, next);
      return;
    }
    setBusy(true);
    setError(undefined);
    const outcome = await importCatalogEntry(entry, catalogUrl, context.tokens, queryClient);
    setBusy(false);
    if (outcome.kind === "error") setError(outcome.error);
    else {
      setRemoved(source.id, false);
      setStanding(source.id, next);
    }
  }

  return (
    <div className="compare-follow">
      <StandingToggle
        name={source.name}
        value={standing}
        onChange={(next) => void change(next)}
        isDisabled={busy || (!has && !entry)}
      />
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function HowItsWorkedOut() {
  return (
    <details className="card compare-method">
      <summary>How this is worked out</summary>
      <ul>
        <li>
          <strong>Every race counts once</strong>, and you see the count: “agreed on 12 of 14” is
          something you can check yourself under See the races.
        </li>
        <li>
          <strong>Two picks only clash if they can't both go on one ballot.</strong> Picking A when
          they endorse B is a disagreement in a vote-for-one race. In a vote-for-three it isn't:
          both fit, so it isn't counted either way. Filling the seats with different names is.
        </li>
        <li>
          <strong>Yes or no:</strong> a “No on X” and an opposition to “Yes on X” are the same side.
        </li>
        <li>
          <strong>Ranked-choice races</strong> compare first choices. Sharing a first choice is
          agreement, ranking the same names in another order is half, and no names in common is a
          disagreement.
        </li>
        <li>
          <strong>Neutral or abstaining isn't disagreeing.</strong> Those are listed, not counted.
        </li>
        <li>
          <strong>Your Maybes count half</strong>, because you haven't decided. So does a clash in a
          race where no official list says how many seats there are, since the app has to guess. A
          Maybe beside a pick is a backup, and doesn't count at all.
        </li>
        <li>
          <strong>The order is cautious.</strong> Rows rank by the worst their record could
          plausibly be (a Wilson bound), so 36 of 40 beats 2 of 2. It's for ordering, not a
          probability: an endorser's picks aren't independent coin tosses.
        </li>
        <li>
          <strong>Republished lists are one opinion.</strong> A group that mostly repeats another's
          list sits under it, and groups with the same picks on your races share a row. That says
          they picked the same names, not that one copied the other.
        </li>
        <li>
          <ShieldCheck className="icon" aria-hidden="true" /> Each catalog entry is a{" "}
          <strong>secondhand report</strong>: a researcher's signed record of what the group
          published, not something the group signed. Official candidate lists aren't endorsers, so
          they're left out.
        </li>
      </ul>
    </details>
  );
}
