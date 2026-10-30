import { matchBallotName, type Stance } from "@openslate/core";
import { Link, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleX,
  Download,
  Focus,
  List,
  MapPin,
  PartyPopper,
  Pencil,
  PenLine,
  Printer,
  UserPlus,
  Users,
  WandSparkles,
} from "lucide-react";
import {
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProgressBar } from "react-aria-components";
import { flushSync } from "react-dom";
import { articlesByRace } from "../lib/articles";
import { ballotProblems } from "../lib/ballotCheck";
import {
  type DraftRow,
  NOTE_CHOICE,
  rankingKeyFor,
  rankingStore,
  rowIdFor,
  setRanking,
  useBallotDraft,
} from "../lib/ballotDraft";
import { ballotFileName, ballotToCsv, ballotToJson } from "../lib/ballotExport";
import {
  ballotChoices,
  contestGroups,
  instructionLine,
  isMarked,
  isYesNo,
  type PrintScope,
  picksIn,
  raceHeading,
  sourcesVerdict,
  voteFor,
  voteForLine,
  writeInRows,
} from "../lib/ballotView";
import { backgroundImports } from "../lib/catalogImport";
import {
  areaOptionsOf,
  collateRaces,
  defaultElection,
  electionsOf,
  positionJurisdictions,
  type Race,
} from "../lib/collate";
import { formatLocalDate } from "../lib/dates";
import { downloadText } from "../lib/download";
import { useGuideListed } from "../lib/guides";
import { useImportRunning } from "../lib/importQueue";
import {
  type Area,
  answerPlacement,
  clearNoAnswers,
  DISTRICT_COUNTS,
  districtFamilyLabel,
  EMPTY_AREA,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  NO_DISTRICT,
  noAnswerCount,
  noRaceReason,
  parseJurisdiction,
  withFoundLocalities,
} from "../lib/jurisdictions";
import {
  localToday,
  useArea,
  useDecodedSlates,
  useDisagreeMode,
  useFollows,
  useMyElection,
} from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { fitToPage, MIN_PRINT_SCALE, type PrintFit } from "../lib/printFit";
import { type MyPosition, useMyPositionsByRace } from "../lib/published";
import { type ApplyRank, isRanked, markChange, pickChange, shownNames } from "../lib/ranking";
import { raceLinks, VOTE411 } from "../lib/researchLinks";
import { matchesSearch, raceSearchText } from "../lib/search";
import { isBallotSource, isFollowed, standingOf } from "../lib/sources";
import { subjectKey } from "../lib/subjects";
import { isDecided, marksOn, type RaceStatus, raceStatus, stepThrough } from "../lib/triage";
import { track } from "../lib/usage";
import { AreaPicker, describeArea } from "./AreaPicker";
import { BallotProblemsNotice, RaceUnlistedNote } from "./BallotTags";
import { ChoiceRow } from "./ChoiceRow";
import { CompareStrip } from "./CompareStrip";
import { electionOptions } from "./electionOptions";
import { PageSearch } from "./PageSearch";
import { PrintBallot, type PrintSection } from "./PrintBallot";
import { QuickFill } from "./QuickFill";
import { RankedChoices } from "./RankedChoices";
import { Checkbox } from "./ui/Checkbox";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { TextArea, TextField } from "./ui/TextField";

// Setup's code (the catalog list, the area picker) is fetched only when it's shown.
const GetStarted = lazy(() =>
  import("./GetStarted").then((module) => ({ default: module.GetStarted })),
);

/** Same order as `compareRaces`: numbers in labels sort numerically. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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
  const { setup } = useSearch({ from: "/" });
  const { slates, isReady } = useDecodedSlates();
  const importing = useImportRunning(backgroundImports);
  const [follows] = useFollows();
  const [disagree] = useDisagreeMode();
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
  const [printOptions, setPrintOptions] = useState(false);
  const [printScope, setPrintScope] = useState<PrintScope>("ballot");
  const [printNotes, setPrintNotes] = useState(false);
  /** The browser is printing (Ctrl+P as well as the Print button). */
  const [printing, setPrinting] = useState(false);
  const [fit, setFit] = useState<PrintFit | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { patch: draftPatch, patchMany: draftPatchMany, refile } = draft;

  const today = localToday();
  const elections = useMemo(() => electionsOf(slates, follows), [slates, follows]);
  const election = elections.some((e) => e.date === chosenElection)
    ? chosenElection
    : defaultElection(elections, today);

  const areaOptions = useMemo(
    () => areaOptionsOf(positionJurisdictions(slates, election)),
    [slates, election],
  );

  // A city or county the area's lookup found that races have started using
  // since joins the area (`withFoundLocalities`).
  useEffect(() => {
    const next = withFoundLocalities(area, areaOptions.localities);
    if (next !== area) setArea(next);
  }, [area, areaOptions.localities, setArea]);

  // Marks on races the catalog has re-filed follow them (`refiledRows`).
  const subjects = useMemo(
    () => slates.flatMap((slate) => slate.payload.positions.map((p) => p.subject)),
    [slates],
  );
  useEffect(() => {
    if (isReady) refile(subjects);
  }, [isReady, subjects, refile]);

  // Localities an old area can't tell are the user's (`upgradeArea`), asked
  // about once the county's own path is in use: answering "no" before then
  // would drop the county's races.
  const recheck = (area.recheck ?? []).filter((p) =>
    areaOptions.localities.includes(`${p}-county`),
  );

  /** Answer "Do you live in the City of …?" for a locality the app couldn't place (`upgradeArea`). */
  function answerRecheck(path: string, inCity: boolean) {
    const { recheck: asked = [], ...rest } = area;
    const under = (key: string) => key.startsWith(`${path}/`);
    const next: Area = inCity
      ? rest
      : {
          ...rest,
          localities: rest.localities.filter((p) => p !== path),
          districts: Object.fromEntries(Object.entries(rest.districts).filter(([f]) => !under(f))),
        };
    if (!inCity && rest.labels) {
      next.labels = Object.fromEntries(Object.entries(rest.labels).filter(([f]) => !under(f)));
    }
    const left = asked.filter((p) => p !== path);
    setArea(left.length > 0 ? { ...next, recheck: left } : next);
  }

  const collated = useMemo(
    () =>
      collateRaces(slates, {
        follows,
        disagree,
        ...(election ? { election } : {}),
        area,
        includeUnfollowed: showUnfollowed,
      }),
    [slates, follows, disagree, election, area, showUnfollowed],
  );
  // Articles slates attach to each race (SPEC §3.15): how many, on each card.
  const articleCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const [key, list] of articlesByRace(slates, follows)) out.set(key, list.length);
    return out;
  }, [slates, follows]);
  // Races only part of a jurisdiction votes on, where the area can't tell which
  // part the user is in (a water district, a trustee area): listed apart, so a
  // county's every school board doesn't pad the ballot.
  const races = useMemo(() => collated.filter((race) => !race.maybe), [collated]);
  const maybeRaces = useMemo(() => collated.filter((race) => race.maybe), [collated]);

  // The user's answer to "is this on your ballot?" for a race the area can't
  // place, with one step of undo.
  const [placed, setPlaced] = useState<{ message: string; previous: Area } | null>(null);
  const place = useCallback(
    (race: Race, onBallot: boolean | undefined) => {
      if (!race.district) return;
      setArea(answerPlacement(area, race.district, onBallot));
      const title = `“${race.subject.title}”`;
      setPlaced({
        previous: area,
        message:
          onBallot === true
            ? `${title} is on your ballot now.`
            : onBallot === false
              ? `${title} is off your ballot.`
              : `${title} is back under Might be on your ballot.`,
      });
    },
    [area, setArea],
  );
  const noAnswers = noAnswerCount(area);

  // The search box: narrows what's listed, never what's counted or exported.
  const search = usePageSearch("/");
  const raceText = useMemo(
    () => new Map(collated.map((race) => [race.key, raceSearchText(race)])),
    [collated],
  );
  const matches = useCallback(
    (race: Race) => matchesSearch(raceText.get(race.key) ?? "", search.terms),
    [raceText, search.terms],
  );

  // What the shown races' endorsements name that the ballot listing doesn't have.
  const offBallot = useMemo(() => {
    const keys = new Set(races.map((race) => race.key));
    return ballotProblems(slates).filter((p) => keys.has(subjectKey(p.subject)));
  }, [slates, races]);

  // Races the area filter hid because a district kind isn't set, so the user
  // isn't left wondering where their Assembly race went.
  const hiddenByDistrict = useMemo(() => {
    if (!isAreaSet(area)) return [];
    const everywhere = collateRaces(slates, {
      follows,
      disagree,
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
  }, [slates, follows, disagree, election, area, showUnfollowed]);

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

  // A ranking change: the race's order and the marks that go with it.
  const applyRank = useCallback<ApplyRank>(
    (electionId, subject, change) => {
      const key = subjectKey(subject);
      setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
      draftPatchMany(electionId, change.patches);
      setRanking(electionId, subject, change.order);
    },
    [draftPatchMany],
  );

  // Under a filter: races that match it, plus the ones you've just dealt with.
  // Then only those the search finds.
  const shown = useMemo(
    () =>
      races.filter(
        (race) =>
          (filter === "all" || statuses.get(race.key) === filter || touched.has(race.key)) &&
          matches(race),
      ),
    [races, statuses, filter, touched, matches],
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
    // than silently going missing. Not under a status filter or a search:
    // nothing to do there, and nothing that was looked for.
    const noRaces = filter === "all" && !search.searching ? Object.entries(area.districts) : [];
    for (const [family, n] of noRaces) {
      // Only families races are filed under (not school districts, which only
      // narrow a race's `district`).
      if (n === NO_DISTRICT || !(family in DISTRICT_COUNTS || family in areaOptions.districts))
        continue;
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
  }, [shown, filter, search.searching, area.districts, areaOptions, election]);

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((row) => row.electionId === election),
    [draft.rows, election],
  );

  const maybeShown = useMemo(() => maybeRaces.filter(matches), [maybeRaces, matches]);
  const maybeSections = useMemo(() => sectionsOf(maybeShown), [maybeShown]);
  // How many races the search finds, and how many more a status filter hides.
  const found = shown.length + (filter === "all" ? maybeShown.length : 0);
  const foundUnderAll = useMemo(
    () => (search.searching && filter !== "all" ? races.filter(matches).length : 0),
    [search.searching, filter, races, matches],
  );
  // What's yours to print and export: the ballot, and any maybe you've marked.
  const yours = useMemo(
    () => [
      ...races,
      ...maybeRaces.filter((race) =>
        myRows.some((row) => row.id.startsWith(`${election}|${race.key}|`)),
      ),
    ],
    [races, maybeRaces, myRows, election],
  );
  // Maybes a lookup would place (school boards, supervisors…), when the area
  // has had no lookup that finds those districts (set by hand, or set before
  // lookups found them: every such lookup sets the school district families).
  const lookupWouldPlace =
    maybeRaces.some((race) => LOOKUP_DISTRICT.test(race.district ?? "")) &&
    !Object.keys(area.districts).some((family) => SCHOOL_FAMILY.test(family));

  // Ballot sources (official candidate lists) aren't recommendations to follow,
  // and news coverage (articles only, SPEC §3.15) recommends nothing either.
  const sourceIds = new Set(
    slates
      .filter((s) => !isBallotSource(s.source) && s.payload.positions.length > 0)
      .map((s) => s.source.id),
  );
  const followedCount = [...sourceIds].filter((id) => isFollowed(follows, id)).length;
  const disagreeCount = [...sourceIds].filter(
    (id) => standingOf(follows, id) === "disagree",
  ).length;
  const summary = elections.find((e) => e.date === election);

  // The paper ballot is only rendered while it's wanted: a statewide ballot
  // is hundreds of races. It's the whole ballot, whatever the status filter.
  const printMounted = printOptions || printing;
  const printSections = useMemo((): PrintSection[] => {
    if (!printMounted) return [];
    return sectionsOf(yours)
      .map((section) => ({
        label: section.label,
        races:
          printScope === "marked"
            ? section.races.filter((race) => isMarked(race, election ?? "", draft.rows))
            : section.races,
      }))
      .filter((section) => section.races.length > 0);
  }, [printMounted, yours, printScope, election, draft.rows]);

  // How it fits on paper, shown on the print card as the options change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when what's printed changes
  useEffect(() => {
    if (!printOptions || !printRef.current) return;
    setFit(fitToPage(printRef.current));
  }, [printOptions, printSections, printNotes]);

  // Ctrl+P prints the same ballot as the Print button. `beforeprint` runs
  // before the browser lays out the pages, so render and fit synchronously.
  useEffect(() => {
    const before = () => {
      flushSync(() => setPrinting(true));
      if (printRef.current) fitToPage(printRef.current);
      track({ name: "ballot.print", dims: { scope: printScope } });
    };
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [printScope]);

  function exportBallot(format: "json" | "csv") {
    const input = {
      election,
      area: isAreaSet(area) ? describeArea(area) : "",
      races: yours,
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

  // Setup's import is still bringing in the first slates (ImportBanner shows
  // how far along); showing setup again here would say the opposite.
  if (slates.length === 0 && importing) {
    return (
      <section className="panel">
        <h2>My ballot</h2>
        <p className="hint">Your sources are on their way. Races show up here as they arrive.</p>
      </section>
    );
  }

  // Nothing in yet: setup is the page. A visitor is here to plan a vote, so
  // they land straight in it. `?setup` brings it back once there's a ballot.
  if (slates.length === 0 || setup) {
    return (
      <Suspense fallback={<section className="panel" />}>
        <GetStarted again={slates.length > 0} />
      </Suspense>
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
        {/* The way back to adding more once setup's done: Sources is
            where it happens, but "Sources" alone doesn't say so. */}
        <Link to="/sources" search={{ add: true }} className="button-link">
          <UserPlus className="icon" /> Add endorsements
        </Link>
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
        <button
          type="button"
          aria-expanded={printOptions}
          onClick={() => setPrintOptions((v) => !v)}
          disabled={races.length === 0}
        >
          <Printer className="icon" /> Print
        </button>
      </div>

      {collated.length > 0 && (
        <PageSearch
          search={search}
          label="Search the ballot"
          placeholder="Search races, candidates, measures, endorsers…"
        >
          {found === 0
            ? `Nothing ${filter === "all" ? "on this ballot" : `in ${STATUS_LABEL[filter]}`} matches “${search.query.trim()}”.`
            : `${found} race${found === 1 ? "" : "s"} match${found === 1 ? "es" : ""}.`}
          {foundUnderAll > found && (
            <>
              {" "}
              <button type="button" className="link" onClick={() => setFilter("all")}>
                Show all {foundUnderAll}
              </button>
            </>
          )}
        </PageSearch>
      )}

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

      {recheck.map((path) => (
        <div key={path} className="card no-print">
          <p>
            <strong>Do you live in the City of {jurisdictionLabel(path)}?</strong>{" "}
            {jurisdictionLabel(`${path}-county`)}'s races used to be filed under the city's name, so
            the area you set before can't tell.
          </p>
          <div className="row">
            <button type="button" onClick={() => answerRecheck(path, true)}>
              Yes
            </button>
            <button type="button" onClick={() => answerRecheck(path, false)}>
              No
            </button>
            <button type="button" className="link" onClick={() => setEditingArea(true)}>
              Find my districts again
            </button>
          </div>
        </div>
      ))}

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

      {printOptions && (
        <div className="card no-print print-options">
          <p className="hint">
            Prints like the real ballot: every choice with a bubble, filled where you picked, and
            beside it how many of the sources you follow back it. Take it with you to fill in your
            ballot.
          </p>
          <div className="row export-options">
            <Segmented
              aria-label="What to print"
              options={[
                { id: "ballot", label: "Whole ballot" },
                { id: "marked", label: "Only races I've marked" },
              ]}
              value={printScope}
              onChange={setPrintScope}
            />
            <Checkbox isSelected={printNotes} onChange={setPrintNotes}>
              Include my private notes
            </Checkbox>
          </div>
          <p className="print-fit" aria-live="polite">
            {printSections.length === 0
              ? "Nothing to print yet: mark a race, or print the whole ballot."
              : !fit
                ? ""
                : fit.pages === 1
                  ? fit.scale >= 0.995
                    ? "Fits on one page."
                    : `Fits on one page, printed at ${Math.round(fit.scale * 100)}% size.`
                  : `About ${fit.pages} pages, even at the smallest readable size (${Math.round(MIN_PRINT_SCALE * 100)}%). ${
                      isAreaSet(area)
                        ? "For one page, print only the races you've marked."
                        : "For one page, set where you vote, or print only the races you've marked."
                    }`}
          </p>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => window.print()}
              disabled={printSections.length === 0}
            >
              <Printer className="icon" /> Print
            </button>
            <button type="button" className="link" onClick={() => setPrintOptions(false)}>
              close
            </button>
          </div>
        </div>
      )}

      <BallotProblemsNotice problems={offBallot} />

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
            {disagreeCount > 0 && ` (${disagreeCount} to disagree)`}
          </Link>
        </span>
        <Switch isSelected={showUnfollowed} onChange={setShowUnfollowed}>
          Include races only unfollowed sources cover
        </Switch>
        <a href={VOTE411.href} target="_blank" rel="noreferrer">
          Your ballot by address on {VOTE411.label} ↗
        </a>
      </div>

      {election && counts.picked + counts.maybe + counts.against > 0 && (
        <CompareStrip election={election} slates={slates} />
      )}

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
                <button type="button" className="link" onClick={() => setPrintOptions(true)}>
                  Print your ballot
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
            <Link to="/sources" search={{ add: true }}>
              Follow some
            </Link>
            , or tick “Include races only unfollowed sources cover”.
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
          applyRank={applyRank}
          mine={focused ? mine.get(focused.key) : undefined}
          articles={focused ? articleCounts.get(focused.key) : undefined}
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
                // Remount when the area changes or a search starts or ends, so
                // "open by default" re-applies.
                key={`${section.label}|${isAreaSet(area)}|${search.searching}`}
                label={section.label}
                races={section.races}
                // With no area set the ballot covers the whole state: hundreds of
                // district and local races. Start those closed, unless searching.
                defaultOpen={search.searching || isAreaSet(area) || section.rank < 2}
                election={election ?? ""}
                rows={draft.rows}
                patch={patch}
                applyRank={applyRank}
                mine={mine}
                articles={articleCounts}
                // Under a filter, races you've dealt with shrink to a summary.
                statuses={filter === "all" ? undefined : statuses}
                filter={filter}
                onPlace={place}
              />
            ),
          )}
        </div>
      )}

      {/* Always mounted, so screen readers announce an answer. */}
      <output className="quick-fill-notice no-print">
        {placed && (
          <>
            {placed.message}{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                setArea(placed.previous);
                setPlaced(null);
              }}
            >
              Undo
            </button>{" "}
            <button type="button" className="link" onClick={() => setPlaced(null)}>
              dismiss
            </button>
          </>
        )}
      </output>

      {!focusing && filter === "all" && (maybeSections.length > 0 || noAnswers > 0) && (
        <div className="ballot-maybe">
          <h3>
            Might be on your ballot <span className="hint">· {maybeShown.length}</span>
          </h3>
          <p className="hint">
            Only some of the voters where each of these is listed vote on it, like one trustee area
            of a school board or one division of a water district, and OpenSlate can't tell from
            where you vote whether you're one of them. Your sample ballot lists the ones you have.
            {lookupWouldPlace && (
              <>
                {" "}
                <button type="button" className="link" onClick={() => setEditingArea(true)}>
                  Find your districts
                </button>{" "}
                from your address or the map to place more of them.
              </>
            )}{" "}
            If you know, say so on each race: On my ballot, or Not on my ballot.
            {noAnswers > 0 && (
              <>
                {" "}
                {noAnswers === 1 ? "One you said isn't" : `${noAnswers} you said aren't`} on your
                ballot {noAnswers === 1 ? "is" : "are"} hidden.{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setPlaced({
                      previous: area,
                      message: "Showing every race you said isn't on your ballot again.",
                    });
                    setArea(clearNoAnswers(area));
                  }}
                >
                  Show {noAnswers === 1 ? "it" : "them"} again
                </button>
              </>
            )}
          </p>
          {maybeSections.map((section) => (
            <BallotSection
              key={`${section.label}|${search.searching}`}
              label={section.label}
              races={section.races}
              defaultOpen={search.searching}
              election={election ?? ""}
              rows={draft.rows}
              patch={patch}
              applyRank={applyRank}
              mine={mine}
              articles={articleCounts}
              statuses={undefined}
              filter={filter}
              onPlace={place}
            />
          ))}
        </div>
      )}

      {printMounted && (
        <PrintBallot
          ref={printRef}
          election={election ?? ""}
          area={isAreaSet(area) ? describeArea(area) : ""}
          sections={printSections}
          rows={draft.rows}
          followedCount={followedCount}
          notes={printNotes}
        />
      )}
    </section>
  );
}

type Patch = ReturnType<typeof useBallotDraft>["patch"];
/** Answer whether a race is on the user's ballot (`answerPlacement`); `undefined` takes the answer back. */
type OnPlace = (race: Race, onBallot: boolean | undefined) => void;

/** School district families (Census TIGER's unified, elementary and secondary). */
const SCHOOL_FAMILY = /\/(?:unsd|elsd|scsd)$/;
/** A `district` a lookup can place: school, BOE, community college, supervisorial. */
const LOOKUP_DISTRICT = /\/(?:unsd|elsd|scsd|boe|ccd|sup)-/;

/** Races grouped by jurisdiction, in ballot order (the races come sorted). */
function sectionsOf(races: Race[]): Array<{ label: string; races: Race[] }> {
  const out: Array<{ label: string; races: Race[] }> = [];
  for (const race of races) {
    const label = jurisdictionLabel(race.jurisdiction);
    const last = out.at(-1);
    if (last?.label === label) last.races.push(race);
    else out.push({ label, races: [race] });
  }
  return out;
}

function BallotSection({
  label,
  races,
  defaultOpen,
  election,
  rows,
  patch,
  applyRank,
  mine,
  articles,
  statuses,
  filter,
  onPlace,
}: {
  label: string;
  races: Race[];
  defaultOpen: boolean;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  applyRank: ApplyRank;
  mine: Map<string, MyPosition[]>;
  /** How many articles are attached to each race, by key. */
  articles: Map<string, number>;
  statuses: Map<string, RaceStatus> | undefined;
  filter: StatusFilter;
  onPlace: OnPlace;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => contestGroups(races), [races]);
  const grid = (groupRaces: Race[]) => (
    <div className="race-grid">
      {groupRaces.map((race) => {
        const status = statuses?.get(race.key);
        const card = (
          <RaceCard
            key={race.key}
            race={race}
            election={election}
            rows={rows}
            patch={patch}
            applyRank={applyRank}
            mine={mine.get(race.key)}
            articles={articles.get(race.key)}
            onPlace={onPlace}
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
  );
  return (
    <details className="ballot-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ballot-section-title">
        {label} <span className="hint">· {races.length}</span>
      </summary>
      {/* Closed sections render nothing: a statewide ballot can run to 600+ races. */}
      {open &&
        // Candidates, judges and measures each under their own heading, when
        // the section has more than one kind.
        (groups.length > 1
          ? groups.map((group) => (
              <div key={group.group} className="ballot-subsection">
                <h4 className="ballot-subsection-title">
                  {group.label} <span className="hint">· {group.races.length}</span>
                </h4>
                {grid(group.races)}
              </div>
            ))
          : grid(races))}
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
  applyRank,
  mine,
  articles,
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
  applyRank: ApplyRank;
  mine: MyPosition[] | undefined;
  articles: number | undefined;
  onStep: (direction: 1 | -1) => void;
  onExit: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);

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
        if (!race || !digit) return;
        // Numbered as shown: a ranking first, else the ballot's order.
        const saved = rankingStore.get()[rankingKeyFor(election, race.subject)];
        const name = shownNames(race, election, rows, saved)[Number(digit) - 1];
        if (name === undefined) return;
        // A yes/no question has no Against: "against Yes" is No.
        if (event.shiftKey && isYesNo(race)) return;
        const stance: Stance = event.shiftKey ? "oppose" : "endorse";
        if (isRanked(race) && name) {
          applyRank(
            election,
            race.subject,
            stance === "endorse"
              ? pickChange(race, election, rows, saved, name)
              : markChange(race, election, rows, saved, name, stance),
          );
        } else {
          const choice = name || undefined;
          const current = rows[rowIdFor(election, race.subject, choice)]?.stance;
          patch(election, race.subject, choice, {
            stance: current === stance ? undefined : stance,
          });
        }
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [election, patch, applyRank]);

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
      <section
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
          applyRank={applyRank}
          mine={mine}
          articles={articles}
          numbered
        />
      </section>
      <p className="hint focus-keys">
        <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>Shift</kbd>+number against (not on yes/no questions) ·{" "}
        <kbd>←</kbd> <kbd>→</kbd> previous / next · <kbd>Esc</kbd> whole list. Once a race is
        decided, the next one comes up.
      </p>
    </div>
  );
}

/** Draft rows that belong to one race (its choices plus the race-level row). */
function raceRowIds(race: Race, election: string): string[] {
  const choices = race.choices.map((c) => c.choice).filter(Boolean);
  // A yes/no question always shows Yes and No, whether or not anyone named them.
  if (isYesNo(race)) choices.push("Yes", "No");
  return [
    rowIdFor(election, race.subject, undefined),
    ...choices.map((choice) => rowIdFor(election, race.subject, choice)),
  ];
}

// A pick re-renders only its own race, not the whole ballot.
const RaceCard = memo(
  RaceCardInner,
  (prev, next) =>
    prev.race === next.race &&
    prev.election === next.election &&
    prev.patch === next.patch &&
    prev.applyRank === next.applyRank &&
    prev.mine === next.mine &&
    prev.articles === next.articles &&
    prev.numbered === next.numbered &&
    prev.onPlace === next.onPlace &&
    raceRowIds(next.race, next.election).every((id) => prev.rows[id] === next.rows[id]) &&
    sameRows(
      writeInRows(prev.rows, prev.race, prev.election),
      writeInRows(next.rows, next.race, next.election),
    ),
);

function sameRows(a: DraftRow[], b: DraftRow[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

function RaceCardInner({
  race,
  election,
  rows,
  patch,
  applyRank,
  mine,
  articles,
  numbered,
  onPlace,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  patch: Patch;
  applyRank: ApplyRank;
  /** What I've signed on this race, if anything. */
  mine?: MyPosition[];
  /** How many articles are attached to the race (SPEC §3.15). */
  articles?: number;
  /** Show each choice's key (focus mode). */
  numbered?: boolean;
  /** Offered on races the area can't place, and on ones the user placed. */
  onPlace?: OnPlace;
}) {
  const noteRow = rows[rowIdFor(election, race.subject, NOTE_CHOICE)];
  const [note, setNote] = useState(noteRow?.privateNote ?? "");
  const title = raceHeading(race);
  const instruction = instructionLine(race);
  const choices = useMemo(() => ballotChoices(race), [race]);
  // Candidates are ranked (RankedChoices); what's left is shown as plain rows.
  const ranked = isRanked(race);
  const plain = ranked ? choices.filter((c) => c.choice === "") : choices;
  const links = useMemo(() => raceLinks(race, localToday()), [race]);
  // The official voter guide's text (a measure's, or candidates' statements), on the race's own page.
  const inGuide = useGuideListed(race.subject);
  const seats = voteFor(race);
  const picked = picksIn(race, election, rows);
  const verdict = sourcesVerdict(race);
  const field = fieldHint(race);

  return (
    <div className="card race-card">
      <div className="ballot-box-header">
        <Link to="/race/$key" params={{ key: race.key }} className="race-link">
          {title.heading}
        </Link>
        {instruction && <div className="vote-for">{instruction}</div>}
        {title.label && <div className="ballot-box-detail">{title.label}</div>}
        {title.measureType && (
          <div className="ballot-box-detail">
            <em>{title.measureType}</em>
          </div>
        )}
      </div>
      {onPlace && race.maybe && (
        <div className="race-placement no-print">
          <span className="hint">Is this on your ballot?</span>
          <button type="button" onClick={() => onPlace(race, true)}>
            <CircleCheck className="icon" aria-hidden /> On my ballot
          </button>
          <button type="button" onClick={() => onPlace(race, false)}>
            <CircleX className="icon" aria-hidden /> Not on my ballot
          </button>
        </div>
      )}
      {onPlace && race.answered && (
        <p className="hint no-print">
          On your ballot because you said so.{" "}
          <button type="button" className="link" onClick={() => onPlace(race, undefined)}>
            Not sure after all
          </button>
        </p>
      )}
      {(verdict || field) && (
        <p className="race-summary hint">
          {verdict}
          {verdict && field && " · "}
          {field}
        </p>
      )}
      <RaceUnlistedNote race={race} />
      {mine && mine.length > 0 && (
        <p className="my-slate hint no-print">
          <PenLine className="icon" /> You {mine.map(describeMine).join("; ")} · signed{" "}
          {formatLocalDate(mine[0]?.publishedAt)} · <Link to="/publish">Compose</Link>
        </p>
      )}
      {ranked && (
        <RankedChoices
          race={race}
          election={election}
          rows={rows}
          applyRank={applyRank}
          numbered={numbered}
        />
      )}
      {/* A yes/no question's two bubbles; on a candidate race, a stance on the race as a whole. */}
      {plain.length > 0 && (
        <ul className="choice-list">
          {plain.map((group, i) => {
            const choice = group.choice || undefined;
            const stance = rows[rowIdFor(election, race.subject, choice)]?.stance;
            const mark = (next: Stance) =>
              patch(election, race.subject, choice, {
                stance: stance === next ? undefined : next,
              });
            return (
              <ChoiceRow
                key={group.choice}
                shortcut={numbered && !ranked && i < 9 ? i + 1 : undefined}
                group={group}
                race={race}
                stance={stance}
                onPick={() => mark("endorse")}
                onMark={mark}
              />
            );
          })}
        </ul>
      )}
      {seats !== undefined && picked > seats && (
        <p className="overvote">
          ⚠ {picked} picks: {voteForLine(seats).toLowerCase()}. Mark more than that on the real
          ballot and your vote in this race doesn't count.
        </p>
      )}
      {ranked && <WriteInField race={race} election={election} rows={rows} applyRank={applyRank} />}
      <p className="race-all-slates no-print">
        <Link
          to="/race/$key"
          params={{ key: race.key }}
          search={{ all: true }}
          hash="all-slates"
          className="button-link"
          aria-label={`All slates on ${race.subject.title}`}
        >
          <Users className="icon" aria-hidden="true" /> All slates
        </Link>
      </p>
      <p className="research-links no-print">
        <span className="hint">Read up:</span>{" "}
        {inGuide && (
          <>
            <Link to="/race/$key" params={{ key: race.key }} hash="official">
              {race.subject.kind === "measure" ? "Full text and arguments" : "Candidate statements"}
            </Link>
            {links.length > 0 && " · "}
          </>
        )}
        {links.map((link, i) => (
          <span key={link.label}>
            {i > 0 && " · "}
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </span>
        ))}
        {articles ? (
          <>
            {" · "}
            <Link to="/race/$key" params={{ key: race.key }} hash="articles">
              {articles} {articles === 1 ? "article" : "articles"}
            </Link>
          </>
        ) : null}
      </p>
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
function fieldHint(race: Race): string | null {
  if (isYesNo(race)) return null;
  if (race.onBallot) {
    const field = race.choices.filter((c) => c.onBallot);
    // Named by a followed source, wherever My ballot counts it (`named`).
    const named = new Set(
      race.choices.flatMap((c) =>
        c.positions.filter((p) => p.standing !== "off").map((p) => p.named ?? c.choice),
      ),
    );
    const covered = field.filter((c) => named.has(c.choice)).length;
    return `${covered} of ${field.length} candidates covered`;
  }
  return "only names your sources mention: the official candidate list isn't imported";
}

/**
 * Write in a name (SPEC §3.12). A name that is plainly someone already on the
 * list picks them instead, so a write-in never duplicates a printed candidate.
 */
function WriteInField({
  race,
  election,
  rows,
  applyRank,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  applyRank: ApplyRank;
}) {
  const [name, setName] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  function add() {
    const typed = name.trim().replace(/\s+/g, " ");
    if (!typed) return;
    const named = race.choices.filter((c) => c.choice);
    const match = matchBallotName(
      typed,
      named.map((c) => c.choice),
    );
    const existing = match?.sure ? named.find((c) => c.choice === match.name) : undefined;
    const saved = rankingStore.get()[rankingKeyFor(election, race.subject)];
    const pick = (choice: string, writeIn: boolean) => {
      // Already marked: writing it in again shouldn't unmark it.
      if (rows[rowIdFor(election, race.subject, choice)]?.stance === "endorse") return;
      applyRank(
        election,
        race.subject,
        pickChange(race, election, rows, saved, choice, { writeIn }),
      );
    };
    if (existing?.onBallot && !existing.writeIn) {
      pick(existing.choice, false);
      setSaid(`${existing.choice} is on the ballot, so they're picked instead of written in.`);
    } else {
      pick(existing?.choice ?? typed, true);
      setSaid(null);
    }
    setName("");
  }
  return (
    <details className="write-in no-print">
      <summary>Write in a name</summary>
      <div className="row">
        <TextField
          className="grow"
          aria-label={`Write-in candidate for ${race.subject.title}`}
          placeholder="Name, as you'll write it on the ballot"
          value={name}
          onChange={setName}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" onClick={add} disabled={!name.trim()}>
          Add
        </button>
      </div>
      {said && <p className="hint">{said}</p>}
      {race.onBallot && (
        <p className="hint">
          In many places, including California, a write-in vote counts only for a certified write-in
          candidate.
        </p>
      )}
    </details>
  );
}
