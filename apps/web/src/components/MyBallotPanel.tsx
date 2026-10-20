import type { Stance } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import { memo, useMemo, useState } from "react";
import { type DraftRow, NOTE_CHOICE, rowIdFor, useBallotDraft } from "../lib/ballotDraft";
import { ballotFileName, ballotToCsv, ballotToJson } from "../lib/ballotExport";
import {
  type ChoiceGroup,
  type Race,
  areaOptionsOf,
  collateRaces,
  defaultElection,
  electionsOf,
  positionJurisdictions,
  stanceTone,
} from "../lib/collate";
import { formatElectionDate, formatLocalDate } from "../lib/dates";
import { downloadText } from "../lib/download";
import {
  EMPTY_AREA,
  districtFamilyLabel,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  noRaceReason,
  parseJurisdiction,
} from "../lib/jurisdictions";
import { localToday, useArea, useDecodedSlates, useFollows, useMyElection } from "../lib/myVote";
import { type MyPosition, useMyPositionsByRace } from "../lib/published";
import { isBallotSource, isFollowed } from "../lib/sources";
import { track } from "../lib/usage";
import { openWizard } from "../lib/wizard";
import { AreaPicker, describeArea } from "./AreaPicker";
import { electionOptions } from "./electionOptions";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { TextArea } from "./ui/TextField";

/** Same order as `compareRaces`: numbers in labels sort numerically. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The user's own picks. Private: kept in this browser, only shared if they publish. */
const PICKS: Array<{ stance: Stance; label: string; title: string }> = [
  { stance: "endorse", label: "Pick", title: "My pick" },
  { stance: "lean_for", label: "Maybe", title: "Leaning towards" },
  { stance: "oppose", label: "Against", title: "Against" },
];

const STANCE_WORD: Record<Stance, string> = {
  endorse: "endorses",
  oppose: "opposes",
  lean_for: "leans for",
  lean_against: "leans against",
  neutral: "is neutral on",
  abstain: "abstains on",
};

/** First person, for "You endorsed X". */
const MY_STANCE_WORD: Record<Stance, string> = {
  endorse: "endorsed",
  oppose: "opposed",
  lean_for: "lean towards",
  lean_against: "lean against",
  neutral: "are neutral on",
  abstain: "abstain on",
};

function describeMine(position: MyPosition): string {
  return `${MY_STANCE_WORD[position.stance]} ${position.choice || "it"}`;
}

export function MyBallotPanel() {
  const { slates, isReady } = useDecodedSlates();
  const [follows] = useFollows();
  const [area, setArea] = useArea();
  const [chosenElection, setChosenElection] = useMyElection();
  const draft = useBallotDraft();
  const mine = useMyPositionsByRace();
  const [showUnfollowed, setShowUnfollowed] = useState(false);
  const [editingArea, setEditingArea] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotes, setExportNotes] = useState(false);

  const today = localToday();
  const elections = useMemo(() => electionsOf(slates, follows), [slates, follows]);
  const election = elections.some((e) => e.date === chosenElection)
    ? chosenElection
    : defaultElection(elections, today);

  const areaOptions = useMemo(
    () => areaOptionsOf(positionJurisdictions(slates, election)),
    [slates, election],
  );

  const races = useMemo(
    () =>
      collateRaces(slates, {
        follows,
        ...(election ? { election } : {}),
        area,
        includeUnfollowed: showUnfollowed,
      }),
    [slates, follows, election, area, showUnfollowed],
  );

  // Races the area filter hid because a district kind isn't set, so the user
  // isn't left wondering where their Assembly race went.
  const hiddenByDistrict = useMemo(() => {
    if (!isAreaSet(area)) return [];
    const everywhere = collateRaces(slates, {
      follows,
      ...(election ? { election } : {}),
      includeUnfollowed: showUnfollowed,
    });
    const counts = new Map<string, number>();
    for (const race of everywhere) {
      const part = parseJurisdiction(race.jurisdiction);
      if (part.kind !== "district") continue;
      const family = `${part.state}/${part.family}`;
      if (area.districts[family]) continue;
      counts.set(part.family, (counts.get(part.family) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [slates, follows, election, area, showUnfollowed]);

  const sections = useMemo(() => {
    const out: Array<{ label: string; rank: number; races: Race[]; noRace?: string }> = [];
    for (const race of races) {
      const label = jurisdictionLabel(race.jurisdiction);
      const last = out.at(-1);
      if (last?.label === label) last.races.push(race);
      else out.push({ label, rank: jurisdictionRank(race.jurisdiction), races: [race] });
    }
    // The user's districts with nothing on this ballot get a section saying so
    // (e.g. an odd-numbered Senate district in 2026), in ballot order, rather
    // than silently going missing.
    for (const [family, n] of Object.entries(area.districts)) {
      const present = areaOptions.districts[family] ?? [];
      if (present.includes(n)) continue;
      const path = `${family}-${n}`;
      out.push({
        label: jurisdictionLabel(path),
        rank: jurisdictionRank(path),
        races: [],
        noRace: noRaceReason(family, n, present, election),
      });
    }
    return out.sort((a, b) => a.rank - b.rank || collator.compare(a.label, b.label));
  }, [races, area.districts, areaOptions, election]);

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((row) => row.electionId === election),
    [draft.rows, election],
  );
  const decided = races.filter((race) =>
    myRows.some((row) => row.id.startsWith(`${election}|${race.key}|`) && row.stance === "endorse"),
  ).length;

  // Ballot sources (official candidate lists) aren't recommendations to follow.
  const sourceIds = new Set(
    slates.filter((s) => !isBallotSource(s.source)).map((s) => s.source.id),
  );
  const followedCount = [...sourceIds].filter((id) => isFollowed(follows, id)).length;
  const summary = elections.find((e) => e.date === election);

  function exportBallot(format: "json" | "csv") {
    const input = {
      election,
      area: isAreaSet(area) ? describeArea(area) : "",
      races,
      rows: draft.rows,
      exportedAt: new Date().toISOString(),
    };
    const options = { privateNotes: exportNotes };
    downloadText(
      ballotFileName(election, format),
      format === "json" ? ballotToJson(input, options) : ballotToCsv(input, options),
      format === "json" ? "application/json" : "text/csv",
    );
    track({ name: "ballot.export", dims: { format } });
  }

  if (!isReady) {
    return (
      <section className="panel">
        <p className="hint">Loading your ballot…</p>
      </section>
    );
  }

  if (slates.length === 0) {
    return (
      <section className="panel">
        <h2>My ballot</h2>
        <div className="card empty-state">
          <h3>Whose recommendations do you trust?</h3>
          <p>
            OpenSlate lines up endorsements from the organizations and people you choose, race by
            race, so you can see where they agree and make your own picks. Nothing leaves this
            browser.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => openWizard()}>
              Get started
            </button>
            <Link to="/sources" className="link">
              or browse sources yourself →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel my-ballot">
      <div className="ballot-toolbar no-print">
        <Select
          className="ballot-election"
          label="Election"
          value={election}
          onChange={setChosenElection}
          options={electionOptions(elections, today)}
        />
        <div className="ballot-area">
          <span className="ballot-area-label">Where you vote</span>
          <button
            type="button"
            className="link"
            aria-expanded={editingArea}
            onClick={() => setEditingArea((v) => !v)}
          >
            {isAreaSet(area) ? describeArea(area) : "Everywhere (set your area)"} ✎
          </button>
        </div>
        <span className="grow" />
        <button
          type="button"
          aria-expanded={exporting}
          onClick={() => setExporting((v) => !v)}
          disabled={races.length === 0}
        >
          Export
        </button>
        <button type="button" onClick={() => window.print()} disabled={decided === 0}>
          Print my picks
        </button>
      </div>

      {editingArea && (
        <div className="card no-print">
          <AreaPicker options={areaOptions} area={area} election={election} onChange={setArea} />
          <div className="row">
            <button type="button" className="primary" onClick={() => setEditingArea(false)}>
              Done
            </button>
            {isAreaSet(area) && (
              <button type="button" className="link" onClick={() => setArea(EMPTY_AREA)}>
                show every area
              </button>
            )}
          </div>
        </div>
      )}

      {exporting && (
        <div className="card no-print">
          <p className="hint">
            This ballot as a file: every race listed here with its field, who backs whom, and your
            picks and statements.
          </p>
          <div className="row export-options">
            <Checkbox isSelected={exportNotes} onChange={setExportNotes}>
              Include my private notes
            </Checkbox>
            <button type="button" onClick={() => exportBallot("json")}>
              Download JSON
            </button>
            <button type="button" onClick={() => exportBallot("csv")}>
              Download CSV
            </button>
            <button type="button" className="link" onClick={() => setExporting(false)}>
              close
            </button>
          </div>
        </div>
      )}

      <div className="ballot-stats no-print">
        <span>
          <strong>{races.length}</strong> races
        </span>
        <span>
          <strong>{decided}</strong> picked
        </span>
        <span>
          <Link to="/sources">
            <strong>{followedCount}</strong> of {sourceIds.size} sources followed
          </Link>
        </span>
        <Switch isSelected={showUnfollowed} onChange={setShowUnfollowed}>
          Include races only unfollowed sources cover
        </Switch>
      </div>

      {summary && summary.followedSources === 0 && !showUnfollowed && (
        <div className="card">
          <p>
            None of the sources you follow cover this election.{" "}
            <Link to="/sources">Follow some</Link>, or tick “Include races only unfollowed sources
            cover”.
          </p>
        </div>
      )}

      {hiddenByDistrict.length > 0 && (
        <p className="hint no-print">
          Hidden until you set your district:{" "}
          {hiddenByDistrict
            .map(([family, n]) => `${n} ${districtFamilyLabel(family)} race${n === 1 ? "" : "s"}`)
            .join(", ")}
          .{" "}
          <button type="button" className="link" onClick={() => setEditingArea(true)}>
            Set districts
          </button>
        </p>
      )}

      {sections.map((section) =>
        section.noRace ? (
          <div key={section.label} className="ballot-section ballot-section-empty">
            <div className="ballot-section-title">
              {section.label} <span className="hint">· no race</span>
            </div>
            <p className="hint">{section.noRace}</p>
          </div>
        ) : (
          <BallotSection
            // Remount when the area changes, so "open by default" re-applies.
            key={`${section.label}|${isAreaSet(area)}`}
            label={section.label}
            races={section.races}
            // With no area set the ballot covers the whole state: hundreds of
            // district and local races. Start those closed.
            defaultOpen={isAreaSet(area) || section.rank < 2}
            election={election ?? ""}
            rows={draft.rows}
            patch={draft.patch}
            mine={mine}
          />
        ),
      )}

      <PrintPicks
        election={election}
        races={races}
        rows={myRows}
        area={isAreaSet(area) ? describeArea(area) : ""}
      />
    </section>
  );
}

type Patch = ReturnType<typeof useBallotDraft>["patch"];

function BallotSection({
  label,
  races,
  defaultOpen,
  election,
  rows,
  patch,
  mine,
}: {
  label: string;
  races: Race[];
  defaultOpen: boolean;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  mine: Map<string, MyPosition[]>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="ballot-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ballot-section-title">
        {label} <span className="hint">· {races.length}</span>
      </summary>
      {/* Closed sections render nothing: a statewide ballot can run to 600+ races. */}
      {open &&
        races.map((race) => (
          <RaceCard
            key={race.key}
            race={race}
            election={election}
            rows={rows}
            patch={patch}
            mine={mine.get(race.key)}
          />
        ))}
    </details>
  );
}

/** Draft rows that belong to one race (its choices plus the race-level row). */
function raceRowIds(race: Race, election: string): string[] {
  return [
    rowIdFor(election, race.subject, undefined),
    ...race.choices.filter((c) => c.choice).map((c) => rowIdFor(election, race.subject, c.choice)),
  ];
}

// A pick re-renders only its own race, not the whole ballot.
const RaceCard = memo(
  RaceCardInner,
  (prev, next) =>
    prev.race === next.race &&
    prev.election === next.election &&
    prev.patch === next.patch &&
    prev.mine === next.mine &&
    raceRowIds(next.race, next.election).every((id) => prev.rows[id] === next.rows[id]),
);

function RaceCardInner({
  race,
  election,
  rows,
  patch,
  mine,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  /** What I've signed on this race, if anything. */
  mine?: MyPosition[];
}) {
  const noteRow = rows[rowIdFor(election, race.subject, NOTE_CHOICE)];
  const [note, setNote] = useState(noteRow?.privateNote ?? "");
  const top = race.choices[0];
  const contested = race.choices.filter((c) => c.support > 0).length > 1;
  const verdict =
    top && top.support > 0 && !contested
      ? `your sources agree: ${top.choice || "for"}`
      : contested
        ? "your sources split"
        : "";
  const field = fieldHint(race);

  return (
    <div className="card race-card">
      <div className="card-title">
        <Link to="/race/$key" params={{ key: race.key }} className="race-link">
          <strong>{race.subject.title}</strong>
        </Link>
        {race.subject.kind === "measure" && <span className="tag">measure</span>}
        <span className="grow" />
        <span className="hint">
          {verdict}
          {verdict && field && " · "}
          {field && <span title={field.title}>{field.text}</span>}
        </span>
      </div>
      {mine && mine.length > 0 && (
        <p className="my-slate hint no-print">
          ✍ You {mine.map(describeMine).join("; ")} · signed {formatLocalDate(mine[0]?.publishedAt)}{" "}
          · <Link to="/publish">Compose</Link>
        </p>
      )}
      <ul className="choice-list">
        {race.choices.map((group) => (
          <ChoiceRow
            key={group.choice}
            group={group}
            race={race}
            election={election}
            row={rows[rowIdFor(election, race.subject, group.choice || undefined)]}
            patch={patch}
          />
        ))}
      </ul>
      <details className="race-note no-print">
        <summary>{noteRow?.privateNote ? "My note ✎" : "Add a private note"}</summary>
        <TextArea
          aria-label={`Private note on ${race.subject.title}`}
          placeholder="Only you see this. It stays in this browser."
          value={note}
          onChange={setNote}
          onBlur={() =>
            patch(election, race.subject, NOTE_CHOICE, { privateNote: note.trim() || undefined })
          }
        />
      </details>
    </div>
  );
}

/**
 * How much of the race your sources speak to. Without a ballot source the
 * endorsements only name who someone backed, so say so rather than pass a
 * one-name list off as the race.
 */
function fieldHint(race: Race): { text: string; title: string } | null {
  if (race.subject.kind === "measure") return null;
  if (race.onBallot) {
    const field = race.choices.filter((c) => c.onBallot);
    const covered = field.filter((c) => c.support > 0 || c.opposition > 0).length;
    return {
      text: `${covered} of ${field.length} candidates covered`,
      title: "Candidates from the official ballot list; how many your sources have a position on",
    };
  }
  return {
    text: "field unknown",
    title:
      "Only the names your sources mention. The official candidate list for this race isn't imported, so there may be others.",
  };
}

function ChoiceRow({
  group,
  race,
  election,
  row,
  patch,
}: {
  group: ChoiceGroup;
  race: Race;
  election: string;
  row: DraftRow | undefined;
  patch: Patch;
}) {
  const choice = group.choice || undefined;
  const followed = group.positions.filter((p) => p.followed);
  const others = group.positions.filter((p) => !p.followed);
  return (
    <li className={`choice-row${row?.stance === "endorse" ? " picked" : ""}`}>
      <div className="choice-main">
        <div className="choice-name">
          {group.choice || <em>{race.subject.title}</em>}
          <span className="choice-count hint">
            {group.support > 0 && `${group.support} for`}
            {group.support > 0 && group.opposition > 0 && " · "}
            {group.opposition > 0 && `${group.opposition} against`}
          </span>
          {group.ballotNote && <span className="ballot-note hint">{group.ballotNote}</span>}
        </div>
        {(followed.length > 0 || others.length > 0) && (
          <div className="source-chips">
            {followed.map((position) => (
              <span
                key={position.source.id}
                className={`source-chip tone-${stanceTone(position.stance)}`}
                title={[
                  `${position.source.name} ${STANCE_WORD[position.stance]} ${group.choice || race.subject.title}`,
                  position.source.secondhand
                    ? `Reported by ${position.source.signerName ?? "a researcher"}, not signed by ${position.source.name}`
                    : "",
                  position.statement ? `“${position.statement}”` : "",
                  position.valid ? "" : "Signature did not verify",
                ]
                  .filter(Boolean)
                  .join("\n")}
              >
                {stanceTone(position.stance) === "against" && "✗ "}
                {position.stance === "lean_for" && "~ "}
                {position.source.name}
                {!position.valid && " ⚠"}
              </span>
            ))}
            {others.length > 0 && (
              // Sources you don't follow are summarised, not shown: comparing
              // isn't trusting. The race page lists them all.
              <span
                className="source-chip tone-neutral unfollowed"
                title={others
                  .map((p) => `${p.source.name} ${STANCE_WORD[p.stance]} (not followed)`)
                  .join("\n")}
              >
                +{others.length} {followed.length > 0 ? "more " : ""}you don't follow
              </span>
            )}
          </div>
        )}
      </div>
      <fieldset className="pick-buttons no-print">
        <legend className="sr-only">My pick: {group.choice || race.subject.title}</legend>
        {PICKS.map((pick) => {
          const active = row?.stance === pick.stance;
          return (
            <button
              key={pick.stance}
              type="button"
              className={`stance-btn stance-${pick.stance}${active ? " active" : ""}`}
              aria-pressed={active}
              title={pick.title}
              onClick={() =>
                patch(election, race.subject, choice, { stance: active ? undefined : pick.stance })
              }
            >
              {pick.label}
            </button>
          );
        })}
      </fieldset>
    </li>
  );
}

/** Printed instead of the page: just the races the user picked, ballot-ordered. */
function PrintPicks({
  election,
  races,
  rows,
  area,
}: {
  election: string | undefined;
  races: Race[];
  rows: DraftRow[];
  area: string;
}) {
  const picked = races
    .map((race) => ({
      race,
      picks: rows.filter(
        (row) => row.id.startsWith(`${election}|${race.key}|`) && row.stance === "endorse",
      ),
      note: rows.find((row) => row.id === `${election}|${race.key}|${NOTE_CHOICE}`)?.privateNote,
    }))
    .filter((entry) => entry.picks.length > 0);
  return (
    <div className="print-only print-picks">
      <h2>My picks{election ? ` · ${formatElectionDate(election)}` : ""}</h2>
      {area && <p>{area}</p>}
      <ol>
        {picked.map(({ race, picks, note }) => (
          <li key={race.key}>
            <strong>{race.subject.title}</strong>:{" "}
            {picks.map((row) => row.choice ?? "Yes").join(", ")}
            {note && <div className="print-note">{note}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
