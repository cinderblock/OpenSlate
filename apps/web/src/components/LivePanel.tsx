import type { CountyContest } from "@openslate/core";
import { useIsFetching, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAllRaces, useCatalogCopyReady } from "../lib/allSlates";
import {
  catalogRaceFor,
  contestsForPlace,
  countyContestId,
  countyContestResult,
  countyFeed,
  countyQueryOptions,
  feedCountyNames,
  feedCountyOfArea,
  localContests,
  parseCountyContestId,
} from "../lib/countyCa";
import type { Area } from "../lib/jurisdictions";
import { EMPTY_AREA, isAreaSet } from "../lib/jurisdictions";
import { useArea } from "../lib/myVote";
import { baseUrlFor } from "../lib/routing";
import {
  type CandidateResult,
  type ContestResult,
  contestLabel,
  contestQueryOptions,
  countySlug,
  DISTRICT_FAMILIES,
  type DistrictFamily,
  fetchCounties,
  LIVE_REFRESH_MS,
  type MeasureResult,
  measurePasses,
  NotOnBallot,
  propContest,
  STATEWIDE_OFFICES,
} from "../lib/sosCa";
import { parseSosTime, SOS_ELECTION } from "../lib/sosResults";
import {
  addLocalOnce,
  addPlace,
  addSingle,
  addToGroup,
  districtsOfArea,
  type PlaceArea,
  type PlaceDistricts,
  placeArea,
  removeFromGroups,
  removeGroup,
  SINGLES_ID,
  STATEWIDE_ID,
  setGroupCounty,
  skipContest,
  useWatch,
  type WatchGroup,
  type WatchSection,
  watchSections,
  watchStore,
} from "../lib/watch";
import {
  type ContestFacts,
  moveInOrder,
  SORT_KEYS,
  SORT_LABELS,
  type SortKey,
  sortContests,
  useWatchView,
  watchViewStore,
} from "../lib/watchSort";
import { FindDistricts } from "./FindDistricts";
import { RaceLink } from "./RaceLink";
import { ComboBox, Select, type SelectOption } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { TextField } from "./ui/TextField";

/**
 * Live results: the races the voter watches, by place, from the California
 * Secretary of State's count, checked every minute while the page is open.
 */

const PARTY_COLORS: Record<string, string> = {
  Dem: "var(--pole-left)",
  Rep: "var(--pole-right)",
  Grn: "#3f9a4a",
  Lib: "#d9a326",
  PF: "#9b4fb5",
  AI: "#8a6d3b",
};

function partyColor(party: string | undefined): string {
  return (party && PARTY_COLORS[party]) || "var(--pole-mid)";
}

const fmt = new Intl.NumberFormat("en-US");

/** The statewide measures, for the race list and the statewide group. */
function useMeasures() {
  const query = useQuery(contestQueryOptions("ballot-measures"));
  return query.data?.kind === "measures" ? query.data.measures : [];
}

/** Every county's name, from the Secretary of State's reporting status. */
function useCounties(): string[] {
  const query = useQuery({
    queryKey: ["sos-ca", "counties"] as const,
    queryFn: fetchCounties,
    staleTime: 1000 * 60 * 60 * 24,
  });
  return query.data ?? [];
}

function statewideContests(measures: MeasureResult[]): string[] {
  return [...STATEWIDE_OFFICES.map((o) => o.id), ...measures.map((m) => propContest(m.number))];
}

export function LivePanel() {
  const [groups] = useWatch();
  const measures = useMeasures();
  const [adding, setAdding] = useState<"place" | "race" | null>(null);
  const empty = groups.length === 0;

  return (
    <section className="panel live-panel">
      <h2>Live count</h2>
      <p className="hint">
        The California Secretary of State's count for the places and races you watch, checked every
        minute while this page is open. Kept in this browser.
      </p>
      <RefreshBar />
      <CivicApiStatus />

      <div className="live-actions">
        <button
          type="button"
          className={adding === "place" ? "primary" : ""}
          onClick={() => setAdding(adding === "place" ? null : "place")}
        >
          + Add races for a place
        </button>
        <button
          type="button"
          className={adding === "race" ? "primary" : ""}
          onClick={() => setAdding(adding === "race" ? null : "race")}
        >
          + Add one race
        </button>
      </div>
      {adding === "place" && <AddPlace measures={measures} onDone={() => setAdding(null)} />}
      {adding === "race" && <AddRace measures={measures} onDone={() => setAdding(null)} />}

      {empty && adding === null && (
        <p className="hint">
          Nothing watched yet. Add a place to watch its House, Senate, Assembly and Board of
          Equalization races with the statewide ones, or add races one at a time.
        </p>
      )}

      <PlacesBar groups={groups} />
      {!empty && <SortBar />}
      <Sections groups={groups} />

      <p className="hint live-source">
        Source:{" "}
        <a href="https://electionresults.sos.ca.gov" target="_blank" rel="noreferrer">
          California Secretary of State ↗
        </a>
        , and for local races (city, county, school, special districts, local measures) the county's
        own count where OpenSlate reads it ({feedCountyNames().join(", ")} so far: give a place its
        county, then "Local races"). Semi-official election-night results; counties keep counting
        for weeks. Races you follow from a race page are under{" "}
        <Link to="/races">All races → Following</Link>.
      </p>
    </section>
  );
}

/** When it last checked, and a button to check now. */
function RefreshBar() {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["sos-ca"] });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const last = Math.max(
    0,
    ...client
      .getQueryCache()
      .findAll({ queryKey: ["sos-ca"] })
      .map((q) => q.state.dataUpdatedAt),
  );
  const ago = last ? Math.max(0, Math.round((now - last) / 1000)) : null;
  return (
    <p className="live-refresh">
      {fetching > 0 ? (
        <span className="hint">Checking…</span>
      ) : ago !== null ? (
        <span className="hint">
          Checked{" "}
          {ago < 10 ? "just now" : `${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago`} ·
          next check within {Math.round(LIVE_REFRESH_MS / 1000)} s
        </span>
      ) : null}{" "}
      <button
        type="button"
        className="link"
        onClick={() => void client.invalidateQueries({ queryKey: ["sos-ca"] })}
      >
        Check now
      </button>
    </p>
  );
}

/** civicAPI backs up the state's count; say when it's down, so blanks it leaves make sense. */
function CivicApiStatus() {
  const query = useQuery({
    queryKey: ["results", "civicapi-status"] as const,
    queryFn: async () => {
      const res = await fetch(`${baseUrlFor("civicapi")}/status`);
      return res.ok;
    },
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 2,
    retry: false,
  });
  if (query.data !== false && !query.isError) return null;
  return (
    <p className="hint warning-line">
      civicAPI, the backup source for races the Secretary of State doesn't count (past elections),
      isn't answering right now. This year's California races don't depend on it.
    </p>
  );
}

/** The places watched: each with its county pick, a way to stop, and what it skipped. */
function PlacesBar({ groups }: { groups: WatchGroup[] }) {
  const counties = useCounties();
  const countyOptions: SelectOption[] = [
    { id: "", label: "No county breakdown" },
    ...counties.map((c) => ({ id: c, label: `${c} County` })),
  ];
  if (groups.length === 0) return null;
  return (
    <ul className="live-places">
      {groups.map((group) => (
        <li key={group.id} className="live-place">
          <strong>{group.label}</strong>
          <ComboBox
            aria-label={`County count for ${group.label}`}
            className="live-county"
            options={countyOptions}
            value={group.county ?? ""}
            placeholder="Add a county's count"
            onChange={(county) =>
              watchStore.set((gs) => setGroupCounty(gs, group.id, county || undefined))
            }
          />
          <button
            type="button"
            className="link"
            onClick={() => watchStore.set((gs) => removeGroup(gs, group.id))}
          >
            Stop watching
          </button>
          <AutoLocalRaces group={group} />
          <LocalRaces group={group} />
          {!group.county && group.id !== STATEWIDE_ID && group.id !== SINGLES_ID && (
            <span className="hint live-skipped">
              Pick this place's county to see its local races and measures.
            </span>
          )}
          {group.skipped && group.skipped.length > 0 && (
            <span className="hint live-skipped">
              No race this election for {group.skipped.map(contestLabel).join(", ")}.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Where I vote", including places added before groups said so. */
function isMine(group: WatchGroup): boolean {
  return group.mine === true || group.label === "Where I vote";
}

/**
 * A place's local races and measures, added on their own the first time its
 * county's count is in (the voter removes any that aren't theirs). "Where I
 * vote" uses the voter's area when the place kept none, and takes its county
 * from there when it has none.
 */
function AutoLocalRaces({ group }: { group: WatchGroup }) {
  const [myArea] = useArea();
  const mine = isMine(group);
  const area = group.area ?? (mine && isAreaSet(myArea) ? placeArea(myArea) : undefined);
  const missingCounty = !group.county && mine ? feedCountyOfArea(myArea) : undefined;
  useEffect(() => {
    if (missingCounty) watchStore.set((gs) => setGroupCounty(gs, group.id, missingCounty));
  }, [missingCounty, group.id]);
  const found = countyFeed(group.county);
  const want = Boolean(found && area && !group.localAdded);
  const query = useQuery({ ...countyQueryOptions(found?.slug ?? ""), enabled: want });
  useEffect(() => {
    if (!want || !found || !area || !query.data) return;
    const ids = contestsForPlace(localContests(query.data.contests), area, found.feed.name).map(
      (c) => countyContestId(found.slug, c.key),
    );
    watchStore.set((gs) => addLocalOnce(gs, group.id, ids));
  }, [want, found, area, query.data, group.id]);
  return null;
}

/** A place's local races, from its county's own count, when OpenSlate reads that county's feed. */
function LocalRaces({ group }: { group: WatchGroup }) {
  const found = countyFeed(group.county);
  const [open, setOpen] = useState(false);
  if (!found) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Close local races" : "+ Local races and measures"}
      </button>
      {open && (
        <LocalRacesPicker
          group={group}
          slug={found.slug}
          countyName={found.feed.name}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LocalRacesPicker({
  group,
  slug,
  countyName,
  onDone,
}: {
  group: WatchGroup;
  slug: string;
  countyName: string;
  onDone: () => void;
}) {
  const query = useQuery(countyQueryOptions(slug));
  const contests = useMemo(() => localContests(query.data?.contests ?? []), [query.data]);
  const mine = useMemo(
    () => (group.area ? contestsForPlace(contests, group.area, countyName) : []),
    [contests, group.area, countyName],
  );
  const options = useMemo<SelectOption[]>(
    () =>
      contests.map((c) => ({
        id: countyContestId(slug, c.key),
        label: c.title,
        ...(c.category ? { description: c.category } : {}),
      })),
    [contests, slug],
  );
  const add = (ids: string[]) => watchStore.set((gs) => addToGroup(gs, group.id, ids));
  if (query.isError && !query.data)
    return (
      <p className="error live-local">
        Couldn't get {countyName} County's count: {query.error.message}.
      </p>
    );
  if (!query.data) return <p className="hint live-local">Getting {countyName} County's races…</p>;
  return (
    <div className="card-inset live-local">
      {mine.length > 0 && (
        <p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              add(mine.map((c) => countyContestId(slug, c.key)));
              onDone();
            }}
          >
            Add all {mine.length} local races for {group.label}
          </button>{" "}
          <span className="hint">Matched by name: remove any that aren't on your ballot.</span>
        </p>
      )}
      <ComboBox
        label={`${countyName} County local race or measure`}
        options={options}
        value={null}
        placeholder="Type to find: council, school board, Measure A…"
        onChange={(id) => {
          if (id) add([id]);
        }}
      />
    </div>
  );
}

/** How to order the races, and whether to group them by place. */
function SortBar() {
  const [view] = useWatchView();
  const options: SelectOption<SortKey>[] = SORT_KEYS.map((key) => ({
    id: key,
    label: SORT_LABELS[key].label,
    description: SORT_LABELS[key].description,
  }));
  return (
    <div className="live-sortbar">
      <Select
        label="Sort"
        className="live-sort"
        options={options}
        value={view.sort}
        onChange={(sort) => watchViewStore.set((v) => ({ ...v, sort }))}
      />
      <Switch
        isSelected={view.grouped}
        onChange={(grouped) => watchViewStore.set((v) => ({ ...v, grouped }))}
      >
        Group by place
      </Switch>
      {view.sort === "manual" && <span className="hint">Move races with the arrows on each.</span>}
    </div>
  );
}

/** What each race's count says, for sorting: the same queries the cards use, so nothing extra is fetched. */
function useContestFacts(ids: string[]): (id: string) => ContestFacts {
  const stateIds = ids.filter((id) => !parseCountyContestId(id));
  const slugs = [
    ...new Set(
      ids.flatMap((id) => {
        const c = parseCountyContestId(id);
        return c ? [c.county] : [];
      }),
    ),
  ];
  const state = useQueries({ queries: stateIds.map((id) => contestQueryOptions(id)) });
  const counties = useQueries({ queries: slugs.map((slug) => countyQueryOptions(slug)) });
  return (id) => {
    const county = parseCountyContestId(id);
    if (county) {
      const data = counties[slugs.indexOf(county.county)]?.data;
      const contest = data?.contests.find((c) => c.key === county.key);
      return {
        title: contest?.title ?? "Local race",
        ...(contest ? { result: countyContestResult(contest, data?.updated) } : {}),
        ...(data?.updated ? { updatedAt: data.updated } : {}),
      };
    }
    const result = state[stateIds.indexOf(id)]?.data;
    const time = parseSosTime(result?.reporting.time);
    return {
      title: contestLabel(id),
      ...(result ? { result } : {}),
      ...(time ? { updatedAt: Date.parse(time) } : {}),
    };
  };
}

function Sections({ groups }: { groups: WatchGroup[] }) {
  const [view] = useWatchView();
  const sections = watchSections(groups);
  const all = sections.flatMap((s) => s.contests);
  const facts = useContestFacts(all);
  const shown: WatchSection[] = view.grouped
    ? sections
    : all.length > 0
      ? [{ key: "all", groups: [], contests: all }]
      : [];
  return (
    <>
      {shown.map((section) => (
        <Section
          key={section.key}
          section={section}
          groups={groups}
          sorted={sortContests(section.contests, view.sort, facts, view.order)}
          manual={view.sort === "manual"}
        />
      ))}
    </>
  );
}

function Section({
  section,
  groups,
  sorted,
  manual,
}: {
  section: WatchSection;
  groups: WatchGroup[];
  sorted: string[];
  manual: boolean;
}) {
  const names = section.groups.map((g) => g.label);
  const title =
    names.length === 0
      ? "All races"
      : names.length > 1
        ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
        : names[0];
  const move = (id: string, direction: -1 | 1) =>
    watchViewStore.set((v) => ({ ...v, order: moveInOrder(v.order, sorted, id, direction) }));
  return (
    <section className="live-group">
      <h3>{title}</h3>
      <ul className="live-contests">
        {sorted.map((id, i) => {
          // The places watching this race: which to remove it from, and their counties' counts.
          const owners = groups.filter((g) => g.contests.includes(id));
          const counties = [...new Set(owners.flatMap((g) => (g.county ? [g.county] : [])))];
          const moves: Move = {
            ...(i > 0 ? { up: () => move(id, -1) } : {}),
            ...(i < sorted.length - 1 ? { down: () => move(id, 1) } : {}),
          };
          return (
            <ContestCard
              key={id}
              id={id}
              groupIds={owners.map((g) => g.id)}
              counties={counties}
              {...(manual ? { move: moves } : {})}
            />
          );
        })}
      </ul>
    </section>
  );
}

interface Move {
  up?: () => void;
  down?: () => void;
}

/** Up and down arrows, for "Your order". */
function MoveButtons({ move, title }: { move: Move; title: string }) {
  return (
    <span className="live-move">
      <button
        type="button"
        className="link"
        disabled={!move.up}
        onClick={move.up}
        aria-label={`Move ${title} up`}
      >
        ↑
      </button>
      <button
        type="button"
        className="link"
        disabled={!move.down}
        onClick={move.down}
        aria-label={`Move ${title} down`}
      >
        ↓
      </button>
    </span>
  );
}

function ContestCard({
  id,
  groupIds,
  counties,
  move,
}: {
  id: string;
  groupIds: string[];
  counties: string[];
  move?: Move;
}) {
  const county = parseCountyContestId(id);
  if (county)
    return (
      <CountyContestCard
        id={id}
        slug={county.county}
        contestKey={county.key}
        groupIds={groupIds}
        {...(move ? { move } : {})}
      />
    );
  return (
    <StateContestCard id={id} groupIds={groupIds} counties={counties} {...(move ? { move } : {})} />
  );
}

/** A local race, from its county's own count. */
function CountyContestCard({
  id,
  slug,
  contestKey,
  groupIds,
  move,
}: {
  id: string;
  slug: string;
  contestKey: string;
  groupIds: string[];
  move?: Move;
}) {
  const query = useQuery(countyQueryOptions(slug));
  const remove = () => watchStore.set((gs) => removeFromGroups(gs, groupIds, id));
  const contest = query.data?.contests.find((c) => c.key === contestKey);
  const result = contest
    ? countyContestResult(contest, query.data?.updated, query.data?.seenAt)
    : undefined;
  const changed = useChanged(query.data?.version);
  const feed = countyFeed(slug)?.feed;
  const title = contest?.title ?? "Local race";
  return (
    <li className={`live-contest card${changed ? " live-changed" : ""}`}>
      <div className="live-contest-head">
        {move && <MoveButtons move={move} title={title} />}
        <strong>{title}</strong>
        {result && <ReportingLine result={result} checkedAt={query.dataUpdatedAt} />}
        <button
          type="button"
          className="link live-remove"
          onClick={remove}
          aria-label={`Stop watching ${title}`}
        >
          ✕
        </button>
      </div>
      {query.isError && !query.data ? (
        <p className="error">
          Couldn't get the county's count: {query.error.message}. Trying again.
        </p>
      ) : !query.data ? (
        <p className="hint">Loading…</p>
      ) : result ? (
        <ResultBody result={result} />
      ) : (
        <p className="hint">The county's count doesn't list this race any more.</p>
      )}
      {feed && (
        <p className="hint live-county-source">
          {feed.name} County's own count ·{" "}
          <a href={feed.page} target="_blank" rel="noreferrer">
            county results ↗
          </a>
          {contest && <CatalogRaceLink contest={contest} countyName={feed.name} />}
        </p>
      )}
    </li>
  );
}

/**
 * The catalog's page for a county contest, when the catalog is already on this
 * device and one of its races is clearly this one (same people, or the same
 * measure in the same place). Never downloads the catalog just for this.
 */
function CatalogRaceLink({ contest, countyName }: { contest: CountyContest; countyName: string }) {
  const { all } = useAllRaces(useCatalogCopyReady());
  const race = useMemo(
    () => (all ? catalogRaceFor(contest, all.races, countyName, SOS_ELECTION) : undefined),
    [all, contest, countyName],
  );
  if (!race) return null;
  return (
    <>
      {" · "}
      <RaceLink raceKey={race.key}>endorsements for this race</RaceLink>
    </>
  );
}

function StateContestCard({
  id,
  groupIds,
  counties,
  move,
}: {
  id: string;
  groupIds: string[];
  counties: string[];
  move?: Move;
}) {
  const query = useQuery(contestQueryOptions(id));
  const remove = () => watchStore.set((gs) => removeFromGroups(gs, groupIds, id));
  const result = query.data;
  const notOnBallot = query.error instanceof NotOnBallot;
  const changed = useChanged(result?.reporting.time);

  // A district with no race this election (odd State Senate seats in 2026)
  // leaves the list; its place says so.
  useEffect(() => {
    if (notOnBallot) watchStore.set((gs) => skipContest(gs, id));
  }, [notOnBallot, id]);
  if (notOnBallot) return null;

  return (
    <li className={`live-contest card${changed ? " live-changed" : ""}`}>
      <div className="live-contest-head">
        {move && <MoveButtons move={move} title={contestLabel(id)} />}
        <strong>{contestLabel(id)}</strong>
        {result && <ReportingLine result={result} checkedAt={query.dataUpdatedAt} />}
        <button
          type="button"
          className="link live-remove"
          onClick={remove}
          aria-label={`Stop watching ${contestLabel(id)}`}
        >
          ✕
        </button>
      </div>
      {query.isError && !result ? (
        <p className="error">Couldn't get this count: {query.error.message}. Trying again.</p>
      ) : !result ? (
        <p className="hint">Loading…</p>
      ) : (
        <ResultBody result={result} />
      )}
      {result && counties.map((county) => <CountyCount key={county} id={id} county={county} />)}
    </li>
  );
}

function CountyCount({ id, county }: { id: string; county: string }) {
  const query = useQuery(contestQueryOptions(id, county));
  if (!query.data) return null;
  return (
    <div className="live-county-count">
      <span className="hint">
        {county} County
        {query.data.reporting.percent !== undefined &&
          ` (${query.data.reporting.percent}% of precincts)`}
        :
      </span>{" "}
      <CompactLine result={query.data} />
    </div>
  );
}

/** True for two minutes after the count's timestamp moves on. */
function useChanged(time: string | undefined): boolean {
  const previous = useRef(time);
  const [changedAt, setChangedAt] = useState(0);
  useEffect(() => {
    if (previous.current !== undefined && time !== undefined && time !== previous.current) {
      setChangedAt(Date.now());
    }
    previous.current = time;
  }, [time]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!changedAt) return;
    const t = setTimeout(() => tick((n) => n + 1), 120_000);
    return () => clearTimeout(t);
  }, [changedAt]);
  return changedAt > 0 && Date.now() - changedAt < 120_000;
}

const clockFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** A moment as local time (with the day when it isn't today), UTC beside it, smaller. */
function Clock({ at }: { at: number }) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const utc = `${d.toISOString().slice(11, 16)}Z`;
  return (
    <time dateTime={d.toISOString()}>
      {today ? "" : `${dayFmt.format(d)}, `}
      {clockFmt.format(d)} <small className="live-utc">({utc})</small>
    </time>
  );
}

/**
 * Precincts, when the count says, then two times: when the source last changed
 * its count (its own time; for a county that gives none, when OpenSlate first
 * saw this count), and when OpenSlate last checked it.
 */
function ReportingLine({ result, checkedAt }: { result: ContestResult; checkedAt: number }) {
  const { percent } = result.reporting;
  const lead = percent !== undefined ? `${percent}% of precincts` : result.reporting.text;
  const sosTime = parseSosTime(result.reporting.time);
  const changedAt = result.reporting.changedAt ?? (sosTime ? Date.parse(sosTime) : undefined);
  return (
    <span className="hint live-reporting">
      {lead && <span>{lead}</span>}
      {changedAt !== undefined && (
        <span>
          {result.reporting.changedSeen ? "New by " : "Changed "}
          <Clock at={changedAt} />
        </span>
      )}
      {checkedAt > 0 && (
        <span>
          Checked <Clock at={checkedAt} />
        </span>
      )}
    </span>
  );
}

function ResultBody({ result }: { result: ContestResult }) {
  if (result.kind === "candidates") {
    if (result.candidates.length === 0) return <p className="hint">No candidates listed.</p>;
    const total = result.candidates.reduce((s, c) => s + c.votes, 0);
    return (
      <ul className="live-candidates">
        {result.candidates.map((c) => (
          <CandidateRow key={c.name} c={c} counted={total > 0} />
        ))}
      </ul>
    );
  }
  if (result.kind === "measure") return <MeasureRow m={result.measure} />;
  return (
    <ul className="live-candidates">
      {result.measures.map((m) => (
        <li key={m.number}>
          <MeasureRow m={m} />
        </li>
      ))}
    </ul>
  );
}

function CandidateRow({ c, counted }: { c: CandidateResult; counted: boolean }) {
  return (
    <li className="live-candidate">
      <span className="live-name">
        {c.name}
        {c.party && <span className="tag-inline"> {c.party}</span>}
        {c.incumbent && <span className="hint"> · incumbent</span>}
      </span>
      <span className="live-bar" aria-hidden="true">
        <span
          className="live-bar-fill"
          style={{ width: `${counted ? c.percent : 0}%`, background: partyColor(c.party) }}
        />
      </span>
      <span className="live-num">
        {counted ? `${c.percent.toFixed(1)}%` : "–"}
        <span className="hint"> {fmt.format(c.votes)}</span>
      </span>
    </li>
  );
}

function MeasureRow({ m }: { m: MeasureResult }) {
  const counted = m.yes + m.no > 0;
  const passing = counted && measurePasses(m);
  const needs = m.threshold === "2/3" ? "two-thirds" : m.threshold;
  return (
    <div className="live-measure">
      {m.name && <div className="hint live-measure-name">{m.name}</div>}
      <div className="live-yesno">
        <span className={counted ? (passing ? "ok" : "bad") : "hint"}>
          {counted ? (passing ? "Passing" : "Failing") : "No votes counted yet"}
          {needs && <span className="hint"> (needs {needs})</span>}
        </span>
        <span className="live-bar" aria-hidden="true">
          <span
            className="live-bar-fill"
            style={{ width: `${m.yesPercent}%`, background: "var(--ok)" }}
          />
          <span
            className="live-bar-fill"
            style={{ width: `${m.noPercent}%`, background: "var(--bad)" }}
          />
        </span>
        <span className="live-num">
          Yes {m.yesPercent.toFixed(1)}% · No {m.noPercent.toFixed(1)}%
          <span className="hint">
            {" "}
            {fmt.format(m.yes)} / {fmt.format(m.no)}
          </span>
        </span>
      </div>
    </div>
  );
}

/** A county's count on one line. */
function CompactLine({ result }: { result: ContestResult }) {
  if (result.kind === "candidates") {
    const total = result.candidates.reduce((s, c) => s + c.votes, 0);
    if (total === 0) return <span className="hint">no votes counted yet</span>;
    return (
      <span>
        {result.candidates
          .slice(0, 3)
          .map((c) => `${c.name} ${c.percent.toFixed(1)}%`)
          .join(" · ")}
      </span>
    );
  }
  const m = result.kind === "measure" ? result.measure : undefined;
  if (!m) return null;
  if (m.yes + m.no === 0) return <span className="hint">no votes counted yet</span>;
  return (
    <span>
      Yes {m.yesPercent.toFixed(1)}% · No {m.noPercent.toFixed(1)}%
    </span>
  );
}

// ---- Adding ------------------------------------------------------------------

/** The county an area's localities name, if one is a county (`us/ca/santa-clara-county`). */
function countyOfArea(area: Area, counties: string[]): string | undefined {
  for (const path of [...area.localities, ...(area.found ?? [])]) {
    const leaf = path.split("/").pop() ?? "";
    const m = leaf.match(/^(.*)-county$/);
    const slug = m?.[1] ?? leaf;
    const hit = counties.find((c) => countySlug(c) === slug);
    if (hit) return hit;
  }
  return undefined;
}

function describe(d: PlaceDistricts): string {
  const parts = DISTRICT_FAMILIES.flatMap(({ family, label }) =>
    d[family] ? [`${label.replace(" District", "")} ${d[family]}`] : [],
  );
  return parts.join(", ");
}

/** Every district number of every family, so an address lookup keeps them all. */
const ALL_DISTRICT_OPTIONS = {
  localities: [] as string[],
  districts: Object.fromEntries(
    DISTRICT_FAMILIES.map(({ family, count }) => [
      `us/ca/${family}`,
      Array.from({ length: count }, (_, i) => String(i + 1)),
    ]),
  ),
};

function AddPlace({ measures, onDone }: { measures: MeasureResult[]; onDone: () => void }) {
  const [myArea] = useArea();
  const counties = useCounties();
  const mine = districtsOfArea(myArea);
  const [label, setLabel] = useState("");
  const [districts, setDistricts] = useState<PlaceDistricts>({});
  const [county, setCounty] = useState<string>("");
  const [found, setFound] = useState<Area>(EMPTY_AREA);

  function add(place: {
    label: string;
    districts: PlaceDistricts;
    county?: string;
    area?: PlaceArea;
    mine?: boolean;
  }) {
    watchStore.set((gs) => addPlace(gs, place, statewideContests(measures)));
    onDone();
  }

  function onFound(area: Area) {
    setFound(area);
    setDistricts(districtsOfArea(area));
    const c = countyOfArea(area, counties);
    if (c) setCounty(c);
  }

  const countyOptions: SelectOption[] = [
    { id: "", label: "None" },
    ...counties.map((c) => ({ id: c, label: `${c} County` })),
  ];
  const hasAny = Object.values(districts).some(Boolean);
  const foundArea = isAreaSet(found) ? placeArea(found) : undefined;

  return (
    <div className="card-inset live-add">
      {isAreaSet(myArea) && Object.keys(mine).length > 0 && (
        <p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const c = countyOfArea(myArea, counties);
              const area = placeArea(myArea);
              add({
                label: "Where I vote",
                mine: true,
                districts: mine,
                ...(c ? { county: c } : {}),
                ...(area ? { area } : {}),
              });
            }}
          >
            Add where I vote
          </button>{" "}
          <span className="hint">{describe(mine)}</span>
        </p>
      )}

      <h4>Another place</h4>
      <FindDistricts
        options={ALL_DISTRICT_OPTIONS}
        area={found}
        election="2026-11-03"
        onChange={onFound}
        onAdjust={() => undefined}
      />
      <p className="hint">Or pick its districts:</p>
      <div className="live-district-pickers">
        {DISTRICT_FAMILIES.map(({ family, count, label: fl }) => (
          <ComboBox
            key={family}
            label={fl.replace(" District", "")}
            options={[
              { id: "", label: "None" },
              ...Array.from({ length: count }, (_, i) => ({
                id: String(i + 1),
                label: String(i + 1),
              })),
            ]}
            value={districts[family] ?? ""}
            onChange={(n) =>
              setDistricts((d) => {
                const next = { ...d };
                if (n) next[family as DistrictFamily] = n;
                else delete next[family as DistrictFamily];
                return next;
              })
            }
          />
        ))}
        <ComboBox label="County" options={countyOptions} value={county} onChange={setCounty} />
      </div>
      <TextField label="Call it" value={label} onChange={setLabel} placeholder="Mom's place" />
      <p>
        <button
          type="button"
          className="primary"
          disabled={!hasAny && !county}
          onClick={() =>
            add({
              label: label || describe(districts) || `${county} County`,
              districts,
              ...(county ? { county } : {}),
              ...(foundArea ? { area: foundArea } : {}),
            })
          }
        >
          Watch this place
        </button>{" "}
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </p>
    </div>
  );
}

/** The county "Add one race" starts on: a watched place's, else the voter's own, when OpenSlate reads it. */
function useDefaultFeedCounty(): string {
  const [groups] = useWatch();
  const [myArea] = useArea();
  for (const g of groups) {
    const found = countyFeed(g.county);
    if (found) return found.feed.name;
  }
  return feedCountyOfArea(myArea) ?? "";
}

function AddRace({ measures, onDone }: { measures: MeasureResult[]; onDone: () => void }) {
  const startCounty = useDefaultFeedCounty();
  const [county, setCounty] = useState(startCounty);
  const found = countyFeed(county || undefined);
  const local = useQuery({ ...countyQueryOptions(found?.slug ?? ""), enabled: Boolean(found) });
  const countyOptions = useMemo<SelectOption[]>(
    () => [
      { id: "", label: "None" },
      ...feedCountyNames().map((name) => ({ id: name, label: `${name} County` })),
    ],
    [],
  );
  const options = useMemo<SelectOption[]>(() => {
    // The county's own races and measures first: what the state's lists don't have.
    const out: SelectOption[] =
      found && local.data
        ? localContests(local.data.contests).map((c) => ({
            id: countyContestId(found.slug, c.key),
            label: c.title,
            description: `${found.feed.name} County${c.category ? ` · ${c.category}` : ""}`,
          }))
        : [];
    out.push(
      ...STATEWIDE_OFFICES.map((o) => ({
        id: o.id,
        label: o.label,
        description: "Statewide",
      })),
    );
    for (const m of measures) {
      out.push({
        id: propContest(m.number),
        label: `Proposition ${m.number}`,
        textValue: `Proposition ${m.number} Prop ${m.number} ${m.name}`,
        description: m.name,
      });
    }
    for (const { family, count, label } of DISTRICT_FAMILIES) {
      for (let n = 1; n <= count; n++) {
        const id = `${DISTRICT_FAMILIES.find((f) => f.family === family)?.path}/district/${n}`;
        out.push({ id, label: `${label} ${n}` });
      }
    }
    return out;
  }, [measures, found, local.data]);
  return (
    <div className="card-inset live-add">
      <ComboBox
        label="County, for its local races and measures"
        options={countyOptions}
        value={county}
        onChange={(c) => setCounty(c ?? "")}
      />
      {found && local.isPending && (
        <p className="hint">Getting {found.feed.name} County's races and measures…</p>
      )}
      {found && local.isError && (
        <p className="error">
          Couldn't get {found.feed.name} County's count: {local.error.message}.
        </p>
      )}
      <ComboBox
        label="Race or measure"
        options={options}
        value={null}
        placeholder="Type to find: Measure O, city council, Governor, Prop 50…"
        onChange={(id) => {
          if (!id) return;
          watchStore.set((gs) => addSingle(gs, id));
          onDone();
        }}
      />
    </div>
  );
}
