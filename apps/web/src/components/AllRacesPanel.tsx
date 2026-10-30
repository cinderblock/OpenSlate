import { Link } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";
import { type AllRaces, useAllRaces } from "../lib/allSlates";
import { raceHeading } from "../lib/ballotView";
import {
  contestGroup,
  type ContestGroup,
  defaultElection,
  type Race,
} from "../lib/collate";
import { formatElectionDate } from "../lib/dates";
import { followedRacesStore, followedSubject, useFollowedRaces, withSeen } from "../lib/followedRaces";
import {
  type Area,
  districtFamilyLabel,
  isAreaSet,
  jurisdictionLabel,
  parseJurisdiction,
  placeRace,
} from "../lib/jurisdictions";
import { localToday, useArea, useMyElection } from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { headlineChoices, namedChoices, type ChoiceTally, tallyRace } from "../lib/raceTally";
import {
  foldText,
  matchesSearch,
  raceSearchFields,
  raceSearchText,
  startsAWord,
} from "../lib/search";
import { AllSlatesLoading, CatalogNote, plural } from "./AllSlates";
import { FollowButton } from "./FollowButton";
import { FollowedRaceCard } from "./FollowedRaceCard";
import { PageSearch } from "./PageSearch";
import { Segmented } from "./ui/Segmented";

/** Rows opened on their own while searching; past that a section waits to be opened. */
const OPEN_ROWS = 150;

const PLACE_TAG = { in: "On your ballot", unknown: "Might be on your ballot" } as const;

type ContestFilter = ContestGroup | "all";

const CONTEST_FILTERS: Array<{ id: ContestFilter; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "office", label: "Candidates" },
  { id: "retention", label: "Judges" },
  { id: "measure", label: "Measures" },
];

/** A heading to browse by: a place, or a whole family of numbered districts. */
function placeOf(race: Race): string {
  const part = parseJurisdiction(race.jurisdiction);
  return part.kind === "district"
    ? `${districtFamilyLabel(part.family)}s`
    : jurisdictionLabel(race.jurisdiction);
}

/** Races under their headings. They come in ballot order, and stay in it. */
function sectionsOf(races: Race[]): Array<{ label: string; races: Race[] }> {
  const sections = new Map<string, Race[]>();
  for (const race of races) {
    const label = placeOf(race);
    const section = sections.get(label);
    if (section) section.push(race);
    else sections.set(label, [race]);
  }
  return [...sections].map(([label, list]) => ({ label, races: list }));
}

/** The choice a search is looking for, by name, so its row leads with it. */
function soughtChoice(choices: ChoiceTally[], terms: readonly string[]): ChoiceTally | undefined {
  if (terms.length === 0) return undefined;
  return (
    choices.find((c) => matchesSearch(foldText(c.group.choice), terms)) ??
    choices.find((c) => terms.some((term) => startsAWord(c.group.choice, term)))
  );
}

function countsOf(tally: ChoiceTally): string {
  return `${tally.group.choice} ${tally.for}${tally.against > 0 ? ` (${tally.against} against)` : ""}`;
}

const RaceRow = memo(function RaceRow({
  race,
  area,
  terms,
}: {
  race: Race;
  area: Area;
  terms: readonly string[];
}) {
  const tally = useMemo(() => tallyRace(race), [race]);
  const title = raceHeading(race);
  const subject = followedSubject(race);
  const sought = tally.yesNo ? undefined : soughtChoice(namedChoices(tally), terms);
  const lead = sought
    ? [sought, ...headlineChoices(tally, 2).filter((c) => c !== sought)]
    : headlineChoices(tally);
  const more = namedChoices(tally).length - lead.length;
  const placement = isAreaSet(area)
    ? placeRace(race.jurisdiction, race.district, area, race.votedIn)
    : "out";
  return (
    <li className="race-row">
      <div className="race-row-main">
        <Link
          to="/race/$key"
          params={{ key: race.key }}
          search={{ all: true }}
          className="race-row-title"
        >
          {title.heading}
        </Link>
        {placement !== "out" && (
          <span className="tag tag-inline">{PLACE_TAG[placement]}</span>
        )}
        {title.label && <div className="hint">{title.label}</div>}
        <div className="race-row-counts">
          <strong>{plural(tally.sources, "slate")}</strong>
          {lead.length > 0 && tally.sources > 0 && ` · ${lead.map(countsOf).join(" · ")}`}
          {lead.length > 0 && tally.sources === 0 && ` · ${lead.map((c) => c.group.choice).join(" · ")}`}
          {more > 0 && <span className="hint"> · and {more} more</span>}
        </div>
      </div>
      <div className="race-row-actions">
        <FollowButton raceKey={race.key} subject={subject} />
        {sought && (
          <FollowButton
            raceKey={race.key}
            subject={subject}
            choice={sought.group.choice}
            showName
          />
        )}
      </div>
    </li>
  );
});

function RaceSection({
  label,
  races,
  defaultOpen,
  area,
  terms,
}: {
  label: string;
  races: Race[];
  defaultOpen: boolean;
  area: Area;
  terms: readonly string[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="ballot-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ballot-section-title">
        {label} <span className="hint">· {races.length}</span>
      </summary>
      {/* Closed sections render nothing: Los Angeles County alone has hundreds of races. */}
      {open && (
        <ul className="race-rows">
          {races.map((race) => (
            <RaceRow key={race.key} race={race} area={area} terms={terms} />
          ))}
        </ul>
      )}
    </details>
  );
}

function RaceList({ all, election, onElection }: {
  all: AllRaces;
  election: string;
  onElection: (next: string) => void;
}) {
  const search = usePageSearch("/races");
  const [area] = useArea();
  const [contest, setContest] = useState<ContestFilter>("all");
  const inElection = useMemo(
    () => all.races.filter((race) => race.election === election),
    [all.races, election],
  );
  const searchText = useMemo(
    () =>
      new Map(
        inElection.map((race) => [
          race.key,
          { text: raceSearchText(race), fields: raceSearchFields(race) },
        ]),
      ),
    [inElection],
  );
  const { terms } = search;
  const found = useMemo(() => {
    const ofContest =
      contest === "all"
        ? inElection
        : inElection.filter((race) => contestGroup(race) === contest);
    if (terms.length === 0) return ofContest;
    return ofContest.filter((race) => matchesSearch(searchText.get(race.key)?.text ?? "", terms));
  }, [inElection, searchText, contest, terms]);
  // With 11,000 positions to look through, a name's words turn up apart in
  // plenty of races that have nothing to do with it: those wait behind the
  // races with the whole of it in one place.
  const [shown, scattered] = useMemo(() => {
    const whole = found.filter((race) =>
      searchText.get(race.key)?.fields.some((field) => matchesSearch(field, terms)),
    );
    if (terms.length === 0 || whole.length === 0) return [found, []];
    const held = new Set(whole);
    return [whole, found.filter((race) => !held.has(race))];
  }, [found, searchText, terms]);
  const sections = useMemo(() => sectionsOf(shown), [shown]);
  let rows = 0;
  return (
    <>
      <PageSearch
        search={search}
        label="Search every race"
        placeholder="Find a seat, measure, candidate, place or endorser"
      >
        {found.length === 0
          ? `Nothing in the catalog matches “${search.query.trim()}”.`
          : `${plural(shown.length, "race")} match${shown.length === 1 ? "es" : ""}.`}
      </PageSearch>
      <div className="all-races-filters no-print">
        {all.elections.length > 1 && (
          <Segmented
            aria-label="Election"
            value={election}
            onChange={onElection}
            options={all.elections.map((e) => ({ id: e.date, label: formatElectionDate(e.date) }))}
          />
        )}
        <Segmented<ContestFilter>
          aria-label="Kind of race"
          value={contest}
          onChange={setContest}
          options={CONTEST_FILTERS}
        />
      </div>
      {!search.searching && (
        <p className="hint">
          {plural(shown.length, "race")} in {plural(sections.length, "place")}. Open a place, or
          search for a name.
        </p>
      )}
      <div className="ballot-sections">
        {sections.map((section, index) => {
          rows += section.races.length;
          return (
            <RaceSection
              key={`${election}|${section.label}|${search.searching}`}
              label={section.label}
              races={section.races}
              defaultOpen={search.searching ? rows <= OPEN_ROWS : index === 0}
              area={area}
              terms={terms}
            />
          );
        })}
        {scattered.length > 0 && (
          <RaceSection
            key={`${election}|scattered`}
            label="Those words, but apart"
            races={scattered}
            defaultOpen={false}
            area={area}
            terms={terms}
          />
        )}
      </div>
      <CatalogNote all={all} />
    </>
  );
}

/**
 * Every race and measure the public catalog knows of, on the voter's ballot or
 * not, with what every slate says about it, and the ones they're following on
 * top. Opening the page is what asks for the catalog (lib/allSlates.ts).
 */
export function AllRacesPanel() {
  const state = useAllRaces(true);
  const { all } = state;
  const [followed] = useFollowedRaces();
  const [myElection] = useMyElection();
  const [picked, setPicked] = useState<string>();

  // Nothing is new about a race followed before its slates were read.
  useEffect(() => {
    if (!all) return;
    const current = followedRacesStore.get();
    const tallyOf = (key: string) => {
      const race = all.byKey.get(key);
      return race ? tallyRace(race) : undefined;
    };
    const next = withSeen(current, tallyOf, new Date().toISOString());
    if (next !== current) followedRacesStore.set(next);
  }, [all, followed]);

  const dates = all?.elections.map((e) => e.date) ?? [];
  const election =
    picked ??
    (myElection && dates.includes(myElection)
      ? myElection
      : all && defaultElection(all.elections, localToday()));

  return (
    <section className="panel">
      <h2>All races</h2>
      <p className="hint">
        Every race and measure in the public catalog, on your ballot or not, with every slate for
        and against it. The catalog covers California so far.
      </p>

      {followed.length > 0 && (
        <>
          <h3>Following</h3>
          <p className="hint">
            Kept in this browser. Following a race here changes nothing on My ballot.
          </p>
          <ul className="followed-races">
            {followed.map((item) => (
              <FollowedRaceCard
                key={`${item.key}|${item.choice ?? ""}`}
                item={item}
                race={all?.byKey.get(item.key)}
                loaded={Boolean(all)}
              />
            ))}
          </ul>
        </>
      )}

      <AllSlatesLoading state={state} />
      {all && election && <RaceList all={all} election={election} onElection={setPicked} />}
    </section>
  );
}
