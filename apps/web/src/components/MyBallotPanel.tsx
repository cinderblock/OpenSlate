import type { Stance } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  CircleHelp,
  Download,
  Focus,
  List,
  type LucideIcon,
  MapPin,
  PartyPopper,
  PenLine,
  Pencil,
  Printer,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProgressBar } from "react-aria-components";
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
import { subjectKey } from "../lib/subjects";
import { type RaceStatus, isDecided, marksOn, raceStatus, stepThrough } from "../lib/triage";
import { track } from "../lib/usage";
import { openWizard } from "../lib/wizard";
import { AreaPicker, describeArea } from "./AreaPicker";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanSummary } from "./LeanMeter";
import { QuickFill } from "./QuickFill";
import { electionOptions } from "./electionOptions";
import { Checkbox } from "./ui/Checkbox";
import { InfoPopover } from "./ui/InfoPopover";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { TextArea } from "./ui/TextField";

/** Same order as `compareRaces`: numbers in labels sort numerically. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The user's own picks. Private: kept in this browser, only shared if they publish. */
const PICKS: Array<{ stance: Stance; label: string; icon: LucideIcon }> = [
  { stance: "endorse", label: "Pick", icon: Check },
  { stance: "lean_for", label: "Maybe", icon: CircleHelp },
  { stance: "oppose", label: "Against", icon: X },
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

type StatusFilter = "all" | RaceStatus;

/** The status filter's segments, in working order. */
const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "todo", label: "To do" },
  { id: "maybe", label: "Maybe" },
  { id: "picked", label: "Picked" },
  { id: "against", label: "Against all" },
];

const STATUS_LABEL: Record<RaceStatus, string> = {
  todo: "To do",
  maybe: "Maybe",
  picked: "Picked",
  against: "Against all",
};

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
  const [filling, setFilling] = useState(false);
  const [filter, setFilterState] = useState<StatusFilter>("all");
  // Races you marked while filtering. One that leaves the filter (you picked
  // it in To do) stays as a one-line summary until the filter changes, so
  // nothing jumps away under the pointer and a misclick is easy to fix.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  // Focus mode: one race at a time, keyboard-driven. `focusKey` is the race on
  // screen; it stays put as the list around it changes.
  const [focusing, setFocusing] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const { patch: draftPatch } = draft;

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

  const statuses = useMemo(
    () => new Map(races.map((race) => [race.key, raceStatus(race, draft.rows, election ?? "")])),
    [races, draft.rows, election],
  );
  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: races.length,
      todo: 0,
      maybe: 0,
      picked: 0,
      against: 0,
    };
    for (const status of statuses.values()) out[status]++;
    return out;
  }, [races.length, statuses]);
  const decided = counts.picked + counts.against;

  function setFilter(next: StatusFilter) {
    setFilterState(next);
    setTouched(new Set());
  }

  // Remember which race a mark came from (see `touched`). Stable, so a mark
  // still re-renders only its own race card.
  const patch = useCallback<Patch>(
    (electionId, subject, choice, fields) => {
      const key = subjectKey(subject);
      setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
      draftPatch(electionId, subject, choice, fields);
    },
    [draftPatch],
  );

  // Under a filter: races that match it, plus the ones you've just dealt with.
  const shown = useMemo(
    () =>
      filter === "all"
        ? races
        : races.filter((race) => statuses.get(race.key) === filter || touched.has(race.key)),
    [races, statuses, filter, touched],
  );
  const doneHere =
    filter === "all" ? 0 : shown.filter((race) => statuses.get(race.key) !== filter).length;

  // Still to work on: matches the filter (under All, not yet decided).
  const isLive = useCallback(
    (race: Race) => {
      const status = statuses.get(race.key);
      return status !== undefined && (filter === "all" ? !isDecided(status) : status === filter);
    },
    [statuses, filter],
  );
  const focusIndex = useMemo(() => {
    const at = shown.findIndex((race) => race.key === focusKey);
    return at >= 0 ? at : shown.findIndex(isLive);
  }, [shown, focusKey, isLive]);
  const focused = focusing ? shown[focusIndex] : undefined;
  const focusedStatus = focused ? statuses.get(focused.key) : undefined;

  // Pin the race on screen (the first one left, when none is yet), so it stays
  // put when marking it changes the list.
  useEffect(() => {
    if (focused && focused.key !== focusKey) setFocusKey(focused.key);
  }, [focused, focusKey]);

  function focusStep(direction: 1 | -1, live?: boolean) {
    const next = stepThrough(shown, focusIndex, direction, live ? isLive : undefined);
    if (next >= 0) setFocusKey(shown[next]?.key ?? null);
  }
  const focusStepRef = useRef(focusStep);
  focusStepRef.current = focusStep;

  function startFocus() {
    if (filter === "all" && counts.todo > 0) setFilter("todo");
    setFocusKey(null);
    setFocusing(true);
  }

  // Once the race on screen is dealt with (it leaves the filter; under All,
  // it's decided), move on to the next one left, after a beat to see the mark.
  const lastSeen = useRef<{ key?: string; status?: RaceStatus }>({});
  useEffect(() => {
    const was = lastSeen.current;
    lastSeen.current = { key: focused?.key, status: focusedStatus };
    if (!focused || !focusedStatus || was.key !== focused.key || was.status === focusedStatus)
      return;
    const dealtWith = filter === "all" ? isDecided(focusedStatus) : focusedStatus !== filter;
    if (!dealtWith) return;
    const timer = setTimeout(() => focusStepRef.current(1, true), 450);
    return () => clearTimeout(timer);
  }, [focused, focusedStatus, filter]);

  const sections = useMemo(() => {
    const out: Array<{ label: string; rank: number; races: Race[]; noRace?: string }> = [];
    for (const race of shown) {
      const label = jurisdictionLabel(race.jurisdiction);
      const last = out.at(-1);
      if (last?.label === label) last.races.push(race);
      else out.push({ label, rank: jurisdictionRank(race.jurisdiction), races: [race] });
    }
    // The user's districts with nothing on this ballot get a section saying so
    // (e.g. an odd-numbered Senate district in 2026), in ballot order, rather
    // than silently going missing. Not under a status filter: nothing to do there.
    for (const [family, n] of filter === "all" ? Object.entries(area.districts) : []) {
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
  }, [shown, filter, area.districts, areaOptions, election]);

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((row) => row.electionId === election),
    [draft.rows, election],
  );

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
            <MapPin className="icon" />{" "}
            {isAreaSet(area) ? describeArea(area) : "Everywhere (set your area)"}{" "}
            <Pencil className="icon" />
          </button>
        </div>
        <span className="grow" />
        <button
          type="button"
          aria-expanded={filling}
          onClick={() => setFilling((v) => !v)}
          disabled={races.length === 0}
        >
          <WandSparkles className="icon" /> Quick fill
        </button>
        <button
          type="button"
          aria-expanded={exporting}
          onClick={() => setExporting((v) => !v)}
          disabled={races.length === 0}
        >
          <Download className="icon" /> Export
        </button>
        <button type="button" onClick={() => window.print()} disabled={counts.picked === 0}>
          <Printer className="icon" /> Print my picks
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
              <Download className="icon" /> Download JSON
            </button>
            <button type="button" onClick={() => exportBallot("csv")}>
              <Download className="icon" /> Download CSV
            </button>
            <button type="button" className="link" onClick={() => setExporting(false)}>
              close
            </button>
          </div>
        </div>
      )}

      <QuickFill
        open={filling}
        onClose={() => setFilling(false)}
        races={races}
        election={election ?? ""}
        draft={draft}
      />

      <div className="ballot-stats no-print">
        <ProgressBar
          className="triage-progress"
          value={decided}
          maxValue={Math.max(races.length, 1)}
          aria-label="Races decided"
          valueLabel={`${decided} of ${races.length} races decided`}
        >
          {({ percentage }) => (
            <>
              <span>
                <strong>{decided}</strong> of <strong>{races.length}</strong> races decided
              </span>
              <span className="triage-bar" aria-hidden="true">
                <span className="triage-fill" style={{ width: `${percentage ?? 0}%` }} />
              </span>
            </>
          )}
        </ProgressBar>
        <span>
          <Link to="/sources">
            <strong>{followedCount}</strong> of {sourceIds.size} sources followed
          </Link>
        </span>
        <Switch isSelected={showUnfollowed} onChange={setShowUnfollowed}>
          Include races only unfollowed sources cover
        </Switch>
      </div>

      {races.length > 0 && (
        <div className="triage-filter no-print">
          <Segmented
            aria-label="Show races"
            value={filter}
            onChange={setFilter}
            options={STATUS_FILTERS.map(({ id, label }) => ({
              id,
              label: (
                <>
                  {label} <span className="segment-count">{counts[id]}</span>
                </>
              ),
            }))}
          />
          {doneHere > 0 && !focusing && (
            <button type="button" className="link" onClick={() => setTouched(new Set())}>
              Clear {doneHere} done
            </button>
          )}
          <span className="grow" />
          <button
            type="button"
            aria-pressed={focusing}
            onClick={() => (focusing ? setFocusing(false) : startFocus())}
          >
            {focusing ? (
              <>
                <List className="icon" /> Show the whole list
              </>
            ) : (
              <>
                <Focus className="icon" /> One at a time
              </>
            )}
          </button>
        </div>
      )}

      {filter === "todo" && counts.todo === 0 && races.length > 0 && (
        <div className="card ballot-zero no-print">
          <h3>
            <PartyPopper className="icon" /> Ballot zero
          </h3>
          <p>
            Every race has a decision
            {counts.maybe > 0 ? `, except ${counts.maybe} you're still on the fence about` : ""}.{" "}
            {counts.maybe > 0 ? (
              <button type="button" className="link" onClick={() => setFilter("maybe")}>
                Settle the maybes
              </button>
            ) : (
              counts.picked > 0 && (
                <button type="button" className="link" onClick={() => window.print()}>
                  Print my picks
                </button>
              )
            )}
          </p>
        </div>
      )}

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

      {focusing ? (
        <FocusRace
          race={focused}
          index={focusIndex}
          total={shown.length}
          left={shown.filter(isLive).length}
          label={focused ? jurisdictionLabel(focused.jurisdiction) : ""}
          election={election ?? ""}
          rows={draft.rows}
          patch={patch}
          mine={focused ? mine.get(focused.key) : undefined}
          onStep={(direction) => focusStep(direction)}
          onExit={() => setFocusing(false)}
        />
      ) : (
        <div className="ballot-sections">
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
                patch={patch}
                mine={mine}
                // Under a filter, races you've dealt with shrink to a summary.
                statuses={filter === "all" ? undefined : statuses}
                filter={filter}
              />
            ),
          )}
        </div>
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
  statuses,
  filter,
}: {
  label: string;
  races: Race[];
  defaultOpen: boolean;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  mine: Map<string, MyPosition[]>;
  statuses: Map<string, RaceStatus> | undefined;
  filter: StatusFilter;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="ballot-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ballot-section-title">
        {label} <span className="hint">· {races.length}</span>
      </summary>
      {/* Closed sections render nothing: a statewide ballot can run to 600+ races. */}
      {open && (
        <div className="race-grid">
          {races.map((race) => {
            const status = statuses?.get(race.key);
            const card = (
              <RaceCard
                key={race.key}
                race={race}
                election={election}
                rows={rows}
                patch={patch}
                mine={mine.get(race.key)}
              />
            );
            return status && status !== filter ? (
              <DoneRace key={race.key} race={race} status={status} election={election} rows={rows}>
                {card}
              </DoneRace>
            ) : (
              card
            );
          })}
        </div>
      )}
    </details>
  );
}

/**
 * A race that left the status filter while you worked: one line saying where
 * it stands, with the full card a click away.
 */
function DoneRace({
  race,
  status,
  election,
  rows,
  children,
}: {
  race: Race;
  status: RaceStatus;
  election: string;
  rows: Record<string, DraftRow>;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (expanded) return <>{children}</>;
  const marks = marksOn(race, rows, election);
  const detail =
    status === "picked"
      ? marks.picked.join(", ") || "No"
      : status === "maybe"
        ? marks.maybe.join(", ")
        : status === "against"
          ? "skipping this race"
          : marks.against.length > 0
            ? `ruled out ${marks.against.join(", ")}`
            : "nothing marked";
  return (
    <div className={`card race-done status-${status}`}>
      <span className={`race-done-status${isDecided(status) ? " decided" : ""}`}>
        {isDecided(status) && <CircleCheck className="icon" />}
        {STATUS_LABEL[status]}
      </span>
      <strong className="race-done-title">{race.subject.title}</strong>
      <span className="hint race-done-detail">{detail}</span>
      <span className="grow" />
      <button type="button" className="link" onClick={() => setExpanded(true)}>
        Edit
      </button>
    </div>
  );
}

/** Keys a focused race listens for. Typing in a field or list is left alone. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, [contenteditable], [role=radiogroup], [role=combobox], [role=listbox], [role=slider]",
    ) !== null
  );
}

/**
 * Focus mode: one race on screen, with Previous / Next and keys. 1–9 pick a
 * choice, Shift with a number marks it Against, ← → (or K J) move, Esc leaves.
 */
function FocusRace({
  race,
  index,
  total,
  left,
  label,
  election,
  rows,
  patch,
  mine,
  onStep,
  onExit,
}: {
  race: Race | undefined;
  index: number;
  total: number;
  /** Races still to work on, this one included if it is. */
  left: number;
  label: string;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  mine: MyPosition[] | undefined;
  onStep: (direction: 1 | -1) => void;
  onExit: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Each new race takes keyboard focus, so the keys (and a screen reader)
  // follow along, and a click that moved us on doesn't strand focus.
  const raceKey = race?.key;
  useEffect(() => {
    if (raceKey) cardRef.current?.focus();
  }, [raceKey]);

  const latest = useRef({ race, rows, onStep, onExit });
  latest.current = { race, rows, onStep, onExit };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const { race, rows, onStep, onExit } = latest.current;
      if (event.key === "Escape") onExit();
      else if (event.key === "ArrowRight" || event.key === "j") onStep(1);
      else if (event.key === "ArrowLeft" || event.key === "k") onStep(-1);
      else {
        const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
        const group = digit && race ? race.choices[Number(digit) - 1] : undefined;
        if (!race || !group) return;
        const choice = group.choice || undefined;
        const stance: Stance = event.shiftKey ? "oppose" : "endorse";
        const current = rows[rowIdFor(election, race.subject, choice)]?.stance;
        patch(election, race.subject, choice, { stance: current === stance ? undefined : stance });
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [election, patch]);

  if (!race) {
    return (
      <div className="card no-print">
        <p>Nothing left here.</p>
        <button type="button" onClick={onExit}>
          Show the whole list
        </button>
      </div>
    );
  }

  return (
    <div className="focus-mode no-print">
      <div className="focus-bar">
        <button type="button" onClick={() => onStep(-1)} disabled={index <= 0}>
          <ArrowLeft className="icon" /> Previous
        </button>
        <span className="focus-position">
          <span className="hint">{label} · </span>
          {index + 1} of {total}
          <span className="hint"> · {left} left</span>
        </span>
        <button type="button" onClick={() => onStep(1)} disabled={index >= total - 1}>
          Next <ArrowRight className="icon" />
        </button>
      </div>
      <div
        ref={cardRef}
        className="focus-card"
        tabIndex={-1}
        aria-label={`${race.subject.title}, race ${index + 1} of ${total}`}
      >
        <RaceCard
          key={race.key}
          race={race}
          election={election}
          rows={rows}
          patch={patch}
          mine={mine}
          numbered
        />
      </div>
      <p className="hint focus-keys">
        <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>Shift</kbd>+number against · <kbd>←</kbd> <kbd>→</kbd>{" "}
        previous / next · <kbd>Esc</kbd> whole list. Once a race is decided, the next one comes up.
      </p>
    </div>
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
    prev.numbered === next.numbered &&
    raceRowIds(next.race, next.election).every((id) => prev.rows[id] === next.rows[id]),
);

function RaceCardInner({
  race,
  election,
  rows,
  patch,
  mine,
  numbered,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  /** What I've signed on this race, if anything. */
  mine?: MyPosition[];
  /** Show each choice's key (focus mode). */
  numbered?: boolean;
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
          <PenLine className="icon" /> You {mine.map(describeMine).join("; ")} · signed{" "}
          {formatLocalDate(mine[0]?.publishedAt)} · <Link to="/publish">Compose</Link>
        </p>
      )}
      <ul className="choice-list">
        {race.choices.map((group, i) => (
          <ChoiceRow
            key={group.choice}
            shortcut={numbered && i < 9 ? i + 1 : undefined}
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
  shortcut,
  group,
  race,
  election,
  row,
  patch,
}: {
  /** The number key that picks this choice (focus mode). */
  shortcut?: number;
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
    <li
      className={`choice-row${row?.stance === "endorse" ? " picked" : ""}${row?.stance === "oppose" ? " ruled-out" : ""}`}
    >
      <div className="choice-main">
        <div className="choice-name">
          {shortcut !== undefined && <kbd className="choice-key">{shortcut}</kbd>}
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
            {followed.map((position) => {
              const what = `${position.source.name} ${STANCE_WORD[position.stance]} ${group.choice || race.subject.title}`;
              return (
                <InfoPopover
                  key={position.source.id}
                  className={`source-chip tone-${stanceTone(position.stance)}`}
                  bare={false}
                  label={what}
                  trigger={
                    <>
                      <EndorserAvatar sourceId={position.source.id} name={position.source.name} />
                      {stanceTone(position.stance) === "against" && "✗ "}
                      {position.stance === "lean_for" && "~ "}
                      {position.source.name}
                      {!position.valid && " ⚠"}
                    </>
                  }
                >
                  <div className="chip-detail-head">
                    <EndorserAvatar
                      sourceId={position.source.id}
                      name={position.source.name}
                      size="md"
                    />
                    <strong>{what}</strong>
                  </div>
                  {position.statement && <p>“{position.statement}”</p>}
                  {position.source.secondhand && (
                    <p className="hint">
                      Reported by {position.source.signerName ?? "a researcher"}, not signed by{" "}
                      {position.source.name}.
                    </p>
                  )}
                  {!position.valid && <p className="warning">The signature did not verify.</p>}
                  <LeanSummary sourceId={position.source.id} />
                </InfoPopover>
              );
            })}
            {others.length > 0 && (
              // Sources you don't follow are summarised, not shown: comparing
              // isn't trusting. The race page lists them all.
              <InfoPopover
                className="source-chip tone-neutral unfollowed"
                bare={false}
                label={`${others.length} sources you don't follow`}
                trigger={
                  <>
                    +{others.length} {followed.length > 0 ? "more " : ""}you don't follow
                  </>
                }
              >
                <ul className="chip-detail-list">
                  {others.map((p) => (
                    <li key={p.source.id}>
                      <EndorserAvatar sourceId={p.source.id} name={p.source.name} />
                      {p.source.name} {STANCE_WORD[p.stance]} {group.choice || race.subject.title}
                    </li>
                  ))}
                </ul>
                <p className="hint">Not followed, so they don't count here.</p>
              </InfoPopover>
            )}
          </div>
        )}
      </div>
      <fieldset className="pick-buttons no-print">
        <legend className="sr-only">My pick: {group.choice || race.subject.title}</legend>
        {PICKS.map((pick) => {
          const active = row?.stance === pick.stance;
          const PickIcon = pick.icon;
          return (
            <button
              key={pick.stance}
              type="button"
              className={`stance-btn stance-${pick.stance}${active ? " active" : ""}`}
              aria-pressed={active}
              aria-keyshortcuts={
                shortcut === undefined
                  ? undefined
                  : pick.stance === "endorse"
                    ? `${shortcut}`
                    : pick.stance === "oppose"
                      ? `Shift+${shortcut}`
                      : undefined
              }
              onClick={() =>
                patch(election, race.subject, choice, { stance: active ? undefined : pick.stance })
              }
            >
              <PickIcon className="icon" /> {pick.label}
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
