import type { CountyContest, Race, RaceSummary, Subject } from "@openslate/core";
import type { UseQueryOptions } from "@tanstack/react-query";
import type { Area } from "./jurisdictions";
import type { ContestResult } from "./liveCount";
import { regionFor } from "./regions";
import { CA_COUNTY_COUNTS, CA_STATE_COUNTS } from "./regions/us-ca/counts";

/**
 * Who counts the votes, region by region. The results pages ask here, and
 * fall back to civicAPI for whatever no source below reports: another
 * election, a state whose own count OpenSlate doesn't read yet.
 *
 * - `StateCounts`: a state election office's own count, for the races it
 *   reports (California's Secretary of State: statewide offices and measures,
 *   Congress, the Legislature).
 * - `CountyCounts`: counties' own counts, for the local races the state
 *   doesn't carry.
 *
 * Adding a state is adding its two objects to the lists at the bottom.
 */

/** The fields of a race a source matches it by: its identity, how the ballot prints it, its choices. */
export interface CountedRace {
  key: string;
  subject: Pick<Subject, "title" | "jurisdiction" | "election" | "ballot">;
  ballot?: { number?: string };
  election?: string;
  jurisdiction?: string;
  choices: readonly { choice: string }[];
}

/** A state election office's count. */
export interface StateCounts {
  /** The region it counts for: `us/ca`. */
  region: string;
  /** Who it is, for a source line: "California Secretary of State". */
  name: string;
  /** The office alone, where the state is understood: "Secretary of State". */
  short: string;
  /** Its own results site, for people. */
  page: string;
  /** What kind of count it is, after the name: "semi-official election-night count; …". */
  note: string;
  /**
   * What starts the id of a race from this source (`sos:` in `sos:governor`),
   * so the results code can tell its races from civicAPI's numeric ids.
   */
  racePrefix: string;
  /** The source's contest for a subject, when it counts that race. */
  contestFor: (subject: Subject) => string | undefined;
  fetchContest: (contest: string) => Promise<ContestResult>;
  /** TanStack Query options for one contest, shared by every page showing it. */
  queryOptions: (contest: string) => UseQueryOptions<ContestResult, Error>;
  /** A count in the shape the results pages show (civicAPI's). */
  toRace: (contest: string, result: ContestResult) => Race;
  /** A search answer naming the contest, without asking anyone. */
  searchSummary: (contest: string, subject: Subject) => RaceSummary;
  /** When a count was updated, from how the source words it, as an ISO instant. */
  parseTime: (text: string | undefined) => string | undefined;
}

/** One county's count, as fetched. */
export interface CountyCount {
  /** The feed's own version, so an unchanged count isn't matched twice. */
  version: string;
  /** When the county published it, ms since epoch, when it says. */
  updated?: number;
  /** When OpenSlate first read this version, ms since epoch. */
  seenAt: number;
  contests: CountyContest[];
}

/** Counties' own counts in one region. */
export interface CountyCounts {
  region: string;
  /**
   * The county whose count may carry a race for this voter, as the key
   * `queryOptions` takes: the race's own county, else the voter's. Undefined
   * when the state counts the race, or OpenSlate doesn't read that county.
   */
  countyFor: (race: CountedRace, area: Pick<Area, "localities" | "found">) => string | undefined;
  /** What to call a county's count: "Santa Clara County". */
  countyName: (county: string) => string;
  queryOptions: (county: string) => UseQueryOptions<CountyCount, Error>;
  /** Which of a county's contests a race is, if any. */
  contestFor: (
    race: CountedRace,
    county: string,
    contests: readonly CountyContest[],
  ) => CountyContest | undefined;
  /** A county contest in the shape the pages show. */
  toResult: (
    contest: CountyContest,
    count: Pick<CountyCount, "updated" | "seenAt">,
  ) => ContestResult;
}

const STATE_COUNTS: readonly StateCounts[] = [CA_STATE_COUNTS];
const COUNTY_COUNTS: readonly CountyCounts[] = [CA_COUNTY_COUNTS];

/** A contest in a state's own count. */
export interface StateContest {
  source: StateCounts;
  contest: string;
  /** The race id the results code knows it by: `sos:governor`. */
  raceId: string;
}

/** The state count that reports a subject, and its contest there. */
export function stateContestFor(subject: Subject): StateContest | undefined {
  const region = regionFor(subject.jurisdiction)?.path;
  for (const source of STATE_COUNTS) {
    if (source.region !== region) continue;
    const contest = source.contestFor(subject);
    if (contest) return { source, contest, raceId: `${source.racePrefix}${contest}` };
  }
  return undefined;
}

/** The state count a race id is from (`sos:governor`), if it's one's. */
export function stateContestOfRace(raceId: string | number | undefined): StateContest | undefined {
  if (typeof raceId !== "string") return undefined;
  const source = STATE_COUNTS.find((s) => raceId.startsWith(s.racePrefix));
  return source ? { source, contest: raceId.slice(source.racePrefix.length), raceId } : undefined;
}

/** Whether a race id is a state count's, not civicAPI's. */
export function isStateRaceId(raceId: string | number | undefined): raceId is string {
  return stateContestOfRace(raceId) !== undefined;
}

/** The regions whose own state count OpenSlate reads, by path. */
export function stateCountRegions(): string[] {
  return STATE_COUNTS.map((source) => source.region);
}

/** The counties' counts of the region a race is in. */
export function countyCountsFor(jurisdiction: string | undefined): CountyCounts | undefined {
  const region = regionFor(jurisdiction)?.path;
  return region ? COUNTY_COUNTS.find((source) => source.region === region) : undefined;
}
