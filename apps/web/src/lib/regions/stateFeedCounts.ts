import {
  type Race,
  type RaceCandidate,
  type RaceSummary,
  STATE_FEEDS,
  type StateFeed,
  type Subject,
} from "@openslate/core";
import type { StateCounts } from "../counts";
import { feedContestResult } from "../feedContest";
import { type ContestResult, LIVE_REFRESH_MS, NotOnBallot } from "../liveCount";
import { contestOfKey, fetchStateResults, stateContestKey } from "../stateFeeds";

/**
 * The states whose own count is read from one feed (`stateFeeds.ts`), as the
 * shared results code asks for a state's count (`counts.ts`): the same
 * adapter for each, since their contests are all read the same way. A race
 * from one gets the id `st-va:us-house/7`.
 */

const PARTY_COLORS: [RegExp, string][] = [
  [/^d(?:em|emocrat(?:ic)?)?$/i, "#2563eb"],
  [/^r(?:ep|epublican)?$/i, "#dc2626"],
  [/^g(?:rn|reen)$/i, "#3f9a4a"],
  [/^l(?:ib|bn|br|ibertarian)$/i, "#d9a326"],
];

function colorOf(party: string | undefined): string {
  return PARTY_COLORS.find(([pattern]) => pattern.test(party ?? ""))?.[1] ?? "#8a93a1";
}

/** A count in the shape the results pages show (civicAPI's). */
function toRace(
  code: string,
  feed: StateFeed,
  prefix: string,
  key: string,
  result: ContestResult,
): Race {
  let candidates: RaceCandidate[] = [];
  if (result.kind === "candidates") {
    candidates = result.candidates.map((c) => ({
      name: c.name,
      ...(c.party ? { party: c.party } : {}),
      color: colorOf(c.party),
      votes: c.votes,
      percent: c.percent,
      incumbent: c.incumbent,
    }));
  } else if (result.kind === "measure") {
    const m = result.measure;
    candidates = [
      { name: "Yes", color: "#18794a", votes: m.yes, percent: m.yesPercent },
      { name: "No", color: "#c52a2a", votes: m.no, percent: m.noPercent },
    ];
  }
  const { changedAt, changedSeen, percent } = result.reporting;
  return {
    id: `${prefix}${key}`,
    type: result.kind === "candidates" ? "Race" : "Referendum",
    country: "US",
    province: code.toUpperCase(),
    election_name: result.title,
    election_date: `${feed.election}T08:00:00.000Z`,
    has_breakdown: false,
    has_map: false,
    ...(percent !== undefined ? { percent_reporting: percent } : {}),
    // The state's own time for its count, not when this browser first saw it.
    ...(changedAt !== undefined && !changedSeen
      ? { last_updated: new Date(changedAt).toISOString() }
      : {}),
    candidates,
  };
}

/** One state's count from its feed. */
export function stateFeedCounts(code: string, feed: StateFeed): StateCounts {
  const region = `us/${code}`;
  const prefix = `st-${code}:`;
  const fetchContest = async (key: string): Promise<ContestResult> => {
    const results = await fetchStateResults(code);
    const contest = contestOfKey(feed, results.contests, key);
    if (!contest) throw new NotOnBallot();
    return feedContestResult(contest, results.updated, results.seenAt, feed.units);
  };
  return {
    region,
    name: feed.office,
    short: feed.office.startsWith(`${feed.name} `)
      ? feed.office.slice(feed.name.length + 1)
      : feed.office,
    page: feed.page,
    note: "the state's own unofficial count; it isn't final until the state certifies it.",
    racePrefix: prefix,
    contestFor: (subject: Subject) =>
      subject.jurisdiction?.toLowerCase().startsWith(region) ? stateContestKey(subject) : undefined,
    fetchContest,
    queryOptions: (key) => ({
      // Under the state's own key, so one "check now" covers every race of it.
      queryKey: ["state-feed", code, "contest", key],
      queryFn: () => fetchContest(key),
      staleTime: LIVE_REFRESH_MS / 2,
      refetchInterval: LIVE_REFRESH_MS,
      refetchIntervalInBackground: false,
      retry: (count, error) => !(error instanceof NotOnBallot) && count < 2,
    }),
    toRace: (key, result) => toRace(code, feed, prefix, key, result),
    searchSummary: (key, subject): RaceSummary => ({
      id: `${prefix}${key}`,
      country: "US",
      province: code.toUpperCase(),
      election_name: subject.title,
      election_date: `${feed.election}T08:00:00.000Z`,
      has_map: false,
      candidates: [],
    }),
    // These feeds give their time as an instant (`Reporting.changedAt`), not in words.
    parseTime: () => undefined,
  };
}

/** Every feed state's count. */
export const STATE_FEED_COUNTS: StateCounts[] = Object.entries(STATE_FEEDS).map(([code, feed]) =>
  stateFeedCounts(code, feed),
);
