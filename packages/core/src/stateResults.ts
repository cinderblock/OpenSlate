import {
  type CountyContest,
  type CountyFeed,
  type CountyFeedKind,
  feedPathTtl,
  parseClaritySummary,
  parseResultsApi,
} from "./countyResults";

/**
 * State election offices' own results feeds, beyond California's (which has
 * an API of its own, `apps/web/src/lib/regions/us-ca/sos.ts`): which states
 * publish one OpenSlate can read, where it lives, and how each becomes the
 * contests every feed is read as (`CountyContest`, from `countyResults.ts`).
 * One module for every way OpenSlate reaches a state: the public relay
 * (apps/poll-cache, which only fetches paths this registry allows), a
 * self-hosted apps/server, and a browser connecting directly where the state
 * allows it. See plans/national-scale.md.
 *
 * A feed is one election's. The ids below are the 2026-11-03 general's; each
 * platform has a list of a state's elections to find the next one's by
 * (Enhanced Voting: `…/results/public/api/jurisdictions/<slug>`; Clarity:
 * `…/<ST>/elections.json`).
 */

/** The platforms read so far: the two the county feeds already use. */
export type StateFeedKind = Extract<CountyFeedKind, "clarity" | "results-api">;

export interface StateFeed extends CountyFeed {
  /** The state's name: "Virginia". */
  name: string;
  kind: StateFeedKind;
  /** Who counts: "Virginia Department of Elections". */
  office: string;
  /** The election this feed is, as a date: `2026-11-03`. */
  election: string;
  /**
   * What a contest's "reporting" counts, in the plural: a state site counts
   * its counties (or towns, or localities), where a county's counts
   * precincts.
   */
  units: string;
  /**
   * The state's lower chamber isn't a House of Representatives, so a bare
   * "House of Representatives" in a title is Congress (`contestOffice`).
   */
  bareHouseIsCongress?: true;
  /** Candidates' names come with the party before them ("REP Alan Wilson"): South Carolina. */
  partyPrefixed?: true;
}

function enhancedVoting(
  name: string,
  office: string,
  site: string,
  slug: string,
  id: string,
  extra: Partial<Pick<StateFeed, "cors" | "units" | "bareHouseIsCongress">> = {},
): StateFeed {
  return {
    name,
    kind: "results-api",
    office,
    election: "2026-11-03",
    base: `${site}/results/public/api/elections/${slug}/${id}`,
    page: `${site}/results/public/${slug}/elections/${id}`,
    cors: false,
    units: "counties",
    ...extra,
  };
}

function clarity(
  name: string,
  office: string,
  base: string,
  extra: Partial<Pick<StateFeed, "units" | "bareHouseIsCongress" | "partyPrefixed">> = {},
): StateFeed {
  return {
    name,
    kind: "clarity",
    office,
    election: "2026-11-03",
    base,
    page: `${base}/`,
    // Clarity answers any origin.
    cors: true,
    units: "counties",
    ...extra,
  };
}

/**
 * States with a feed for the 2026-11-03 general, by postal code in lower
 * case. Each was fetched and read on 2026-11-10 (plans/national-scale.md has
 * what every state publishes, these and the ones not read yet).
 */
export const STATE_FEEDS: Record<string, StateFeed> = {
  az: enhancedVoting(
    "Arizona",
    "Arizona Secretary of State",
    "https://app.enhancedvoting.com",
    "Arizona",
    "110326GeneralElection",
  ),
  co: clarity(
    "Colorado",
    "Colorado Secretary of State",
    "https://results.enr.clarityelections.com/CO/127407",
  ),
  ga: enhancedVoting(
    "Georgia",
    "Georgia Secretary of State",
    "https://results.sos.ga.gov",
    "Georgia",
    "11032026GeneralAndSpecialElection",
  ),
  ia: clarity("Iowa", "Iowa Secretary of State", "https://electionresults.iowa.gov/IA/127077"),
  id: enhancedVoting(
    "Idaho",
    "Idaho Secretary of State",
    "https://results.voteidaho.gov",
    "id",
    "nov2026",
  ),
  ri: enhancedVoting(
    "Rhode Island",
    "Rhode Island Board of Elections",
    "https://electionresults.ri.gov",
    "rhodeisland",
    "2026StatewideGeneralElection",
    { cors: true, units: "cities and towns" },
  ),
  sc: clarity(
    "South Carolina",
    "South Carolina State Election Commission",
    "https://www.enr-scvotes.org/SC/127300",
    { partyPrefixed: true },
  ),
  ut: enhancedVoting(
    "Utah",
    "Utah Lieutenant Governor's Office",
    "https://electionresults.utah.gov",
    "Utah",
    "General11032026",
  ),
  va: enhancedVoting(
    "Virginia",
    "Virginia Department of Elections",
    "https://enr.elections.virginia.gov",
    "virginia",
    "2026-November-General",
    { units: "localities", bareHouseIsCongress: true },
  ),
  wa: enhancedVoting(
    "Washington",
    "Washington Secretary of State",
    "https://results.votewa.gov",
    "washington",
    "20261103",
  ),
  wv: clarity(
    "West Virginia",
    "West Virginia Secretary of State",
    "https://results.enr.clarityelections.com/WV/127496",
    { bareHouseIsCongress: true },
  ),
};

/** A state's feed by its postal code, in either case. */
export function stateFeed(code: string | undefined): StateFeed | undefined {
  const key = code?.toLowerCase() ?? "";
  return Object.hasOwn(STATE_FEEDS, key) ? STATE_FEEDS[key] : undefined;
}

/** Whether a path under a state feed's base is one OpenSlate reads, and how long its answer stays good. */
export function stateFeedPathTtl(feed: StateFeed, inner: string): number | null {
  return feedPathTtl(feed, inner);
}

/** Things a state's site lists among its contests that aren't one. */
const NOT_A_CONTEST = /^straight party\b|^registered voters\b|^ballots cast\b/i;

/** A state's count, as its feed's one document says it. */
export interface StateCount {
  contests: CountyContest[];
  /** When the state published it, ms since epoch, when the document says. */
  asOf?: number;
  /** The state calls it official (certified), when the document says either way. */
  official?: boolean;
}

/**
 * A state feed's document (Clarity's `summary.json`, Enhanced Voting's
 * `data`) as contests, with what that state's site does to names undone.
 */
export function parseStateFeed(feed: StateFeed, raw: unknown): StateCount {
  const read: StateCount =
    feed.kind === "clarity" ? { contests: parseClaritySummary(raw) } : parseResultsApi(raw);
  const contests = read.contests
    .filter((contest) => !NOT_A_CONTEST.test(contest.title))
    .map((contest) => ({
      ...contest,
      title: contest.title.replace(/\s+/g, " ").trim(),
      choices: contest.choices.map((choice) => {
        const prefixed =
          feed.partyPrefixed && choice.party && choice.name.startsWith(`${choice.party} `);
        return prefixed
          ? { ...choice, name: choice.name.slice((choice.party ?? "").length).trim() }
          : choice;
      }),
    }));
  return { ...read, contests };
}
