import type { CountyCounts, StateCounts } from "../../counts";
import {
  countyContestFor,
  countyContestResult,
  countyFeed,
  countyQueryOptions,
  localRaceCounty,
} from "./countyResults";
import { contestQueryOptions, fetchContest } from "./sos";
import {
  contestToRace,
  parseSosTime,
  SOS_ELECTION,
  SOS_RACE_PREFIX,
  sosContestForSubject,
  sosSearchSummary,
} from "./sosResults";

/**
 * California's counts as the shared results code asks for them (`counts.ts`):
 * the Secretary of State's (`sos.ts`, `sosResults.ts`) and the counties' own
 * (`countyResults.ts`).
 */

export const CA_STATE_COUNTS: StateCounts = {
  region: "us/ca",
  name: "California Secretary of State",
  short: "Secretary of State",
  page: "https://electionresults.sos.ca.gov",
  note: "semi-official election-night count; counties keep counting for weeks after.",
  racePrefix: SOS_RACE_PREFIX,
  contestFor: sosContestForSubject,
  fetchContest: (contest) => fetchContest(contest),
  queryOptions: (contest) => contestQueryOptions(contest),
  toRace: contestToRace,
  searchSummary: sosSearchSummary,
  parseTime: parseSosTime,
};

export const CA_COUNTY_COUNTS: CountyCounts = {
  region: "us/ca",
  // Only this election's local races: the Secretary of State counts the rest.
  countyFor: (race, area) => countyFeed(localRaceCounty(race, area, SOS_ELECTION))?.slug,
  countyName: (county) => `${countyFeed(county)?.feed.name ?? county} County`,
  queryOptions: countyQueryOptions,
  contestFor: (race, county, contests) => {
    const feed = countyFeed(county);
    return feed ? countyContestFor(race, contests, feed.feed.name, SOS_ELECTION) : undefined;
  },
  toResult: (contest, count) => countyContestResult(contest, count.updated, count.seenAt),
};
