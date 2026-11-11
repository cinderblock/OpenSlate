import {
  type CountyChoice,
  type CountyContest,
  type CountyFeed,
  csvFields,
  feedPathTtl,
  measureSide,
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

/**
 * The platforms read so far. `clarity` and `results-api` (Enhanced Voting)
 * are the two the county feeds already use, each one document. `totalvote-csv`:
 * KNOWiNK's (once BPro's) TotalVote sites, whose "media" exports are CSV with
 * one row per candidate (`resultsCSV.aspx?text=All&type=…`). `ncsbe-json`:
 * North Carolina's own `results_0.txt`, a JSON array with a row per
 * candidate. `civix-enr`: Texas's results API, one JSON document whose
 * sections are each base64-encoded JSON. `mn-text`: Minnesota's
 * semicolon-separated files, one per office. `pa-json`: Pennsylvania's
 * returns API, a document per office. `mi-text`: Michigan's tab-separated
 * file of every county's count. `totalresults`: KNOWiNK's newer TotalResults
 * API (Arkansas, North Dakota), where one document names the contests and
 * choices and others hold the votes by id.
 */
export type StateFeedKind =
  | "clarity"
  | "results-api"
  | "totalvote-csv"
  | "ncsbe-json"
  | "civix-enr"
  | "mn-text"
  | "pa-json"
  | "mi-text"
  | "totalresults"
  /** Delaware: one JSON array, a row per candidate, keys with spaces in them. */
  | "de-json"
  /** Louisiana: one document of races and candidates, one of votes, joined by id. */
  | "la-json"
  /** The District of Columbia: every citywide and ward contest in one array, the time in another call. */
  | "dc-json"
  /** Montana: TotalVote's map service, a JSON array per kind of race with a row per candidate. */
  | "totalvote-json"
  /** Hawaii: one tab-separated summary, a row per candidate. */
  | "hi-text"
  /** Alaska: a CSV with a row per candidate per precinct, summed. */
  | "ak-csv";

export interface StateFeed {
  /** The state's name: "Virginia". */
  name: string;
  kind: StateFeedKind;
  /** The feed's root, no trailing slash. For Clarity, the election's folder. */
  base: string;
  /** The state's own results page, for people. */
  page: string;
  /** False when the feed sends no CORS header: a browser can only read it through a relay. */
  cors: boolean;
  /**
   * The files the count is in, where the platform doesn't fix them: a short
   * name (what a relay is asked for: `/api/state/sd/swr`) to the path under
   * `base` it stands for, query included. Clarity's pointer and summary and
   * Enhanced Voting's `data` are fixed by their kind, and list none.
   */
  files?: Record<string, string>;
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
  /**
   * The files' `Last-Modified` is when the count was published: static files
   * the state writes at each count (North Carolina), not pages made per request.
   */
  lastModified?: true;
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
 * A TotalResults site: `names` is its list of contests and choices, the rest
 * its results by contest type (`types`: our name for each to the site's).
 */
function totalResults(
  name: string,
  office: string,
  api: string,
  page: string,
  client: string,
  election: string,
  types: Record<string, string>,
): StateFeed {
  return {
    name,
    kind: "totalresults",
    office,
    election: "2026-11-03",
    base: api,
    page,
    // The API answers any origin.
    cors: true,
    units: "precincts",
    files: {
      names: `Contest/GetContestSearchList?cid=${client}&electionID=${election}`,
      ...Object.fromEntries(
        Object.entries(types).map(([key, type]) => [
          key,
          `Contest/GetContestResults?cId=${client}&electionID=${election}&contestType=${encodeURIComponent(type)}`,
        ]),
      ),
    },
  };
}

function totalVote(
  name: string,
  office: string,
  site: string,
  types: Record<string, string>,
): StateFeed {
  return {
    name,
    kind: "totalvote-csv",
    office,
    election: "2026-11-03",
    base: site,
    page: `${site}/`,
    cors: false,
    units: "precincts",
    files: Object.fromEntries(
      Object.entries(types).map(([key, query]) => [key, `resultsCSV.aspx?text=All&${query}`]),
    ),
  };
}

/**
 * States with a feed for the 2026-11-03 general, by postal code in lower
 * case. Each was fetched and read on 2026-11-10 (plans/national-scale.md has
 * what every state publishes, these and the ones not read yet).
 */
export const STATE_FEEDS: Record<string, StateFeed> = {
  ak: {
    name: "Alaska",
    kind: "ak-csv",
    office: "Alaska Division of Elections",
    election: "2026-11-03",
    base: "https://www.elections.alaska.gov/enr/26GENR/results",
    page: "https://www.elections.alaska.gov/election-results/",
    cors: false,
    units: "precincts",
    files: { results: "GA_ENR_Precinct_State_of_Alaska.csv" },
    lastModified: true,
  },
  ar: totalResults(
    "Arkansas",
    "Arkansas Secretary of State",
    "https://enr-results-api.totalresults.com",
    "https://arkansas.tally-enr.com/#election=11b07106-031e-4d7c-911a-d01fb473d6dd",
    "arkansas",
    "11b07106-031e-4d7c-911a-d01fb473d6dd",
    {
      federal: "Federal",
      statewide: "Statewide",
      senate: "State Senate",
      house: "State Representative",
    },
  ),
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
  dc: {
    name: "District of Columbia",
    kind: "dc-json",
    office: "District of Columbia Board of Elections",
    election: "2026-11-03",
    base: "https://electionresults.dcboe.org",
    page: "https://electionresults.dcboe.org/election_results/2026-General-Election",
    cors: false,
    units: "precincts",
    files: {
      contests: "cityWide/getCityWide/2026-General-Election",
      info: "electionResults/getElectionInfo/2026-General-Election",
    },
  },
  de: {
    name: "Delaware",
    kind: "de-json",
    office: "Delaware Department of Elections",
    election: "2026-11-03",
    base: "https://elections.delaware.gov/results/enr",
    page: "https://elections.delaware.gov/results/enr/GE2026.html",
    cors: false,
    units: "election districts",
    files: { results: "Election_StatewideResults_ID_GE2026.json" },
  },
  ga: enhancedVoting(
    "Georgia",
    "Georgia Secretary of State",
    "https://results.sos.ga.gov",
    "Georgia",
    "11032026GeneralAndSpecialElection",
  ),
  hi: {
    name: "Hawaii",
    kind: "hi-text",
    office: "Hawaii Office of Elections",
    election: "2026-11-03",
    base: "https://elections.hawaii.gov/wp-content/results/2026%20General",
    page: "https://elections.hawaii.gov/election-results/",
    cors: false,
    units: "precincts",
    files: { summary: "summary.txt" },
  },
  ia: clarity("Iowa", "Iowa Secretary of State", "https://electionresults.iowa.gov/IA/127077"),
  id: enhancedVoting(
    "Idaho",
    "Idaho Secretary of State",
    "https://results.voteidaho.gov",
    "id",
    "nov2026",
  ),
  // Nebraska's one export has every contest; New Mexico's `STATE` every one
  // the state reports; South Dakota's comes in three.
  la: {
    name: "Louisiana",
    kind: "la-json",
    office: "Louisiana Secretary of State",
    election: "2026-11-03",
    base: "https://voterportal.sos.la.gov/ElectionResults/ElectionResults",
    page: "https://voterportal.sos.la.gov/graphical",
    cors: false,
    units: "precincts",
    files: {
      races: "Data?blob=20261103/RacesCandidates_Multiparish.htm",
      votes: "Data?blob=20261103/Votes_Multiparish.htm",
    },
  },
  mi: {
    name: "Michigan",
    kind: "mi-text",
    office: "Michigan Department of State",
    election: "2026-11-03",
    base: "https://mvic.sos.state.mi.us",
    page: "https://mvic.sos.state.mi.us/votehistory/",
    cors: false,
    units: "counties",
    files: { results: "VoteHistory/GetElectionResultFile?electionId=707" },
  },
  mt: {
    name: "Montana",
    kind: "totalvote-json",
    office: "Montana Secretary of State",
    election: "2026-11-03",
    base: "https://esersws.mt.gov/ResultsAjax.svc",
    page: "https://electionresults.mt.gov/",
    // The service answers any origin.
    cors: true,
    units: "precincts",
    files: Object.fromEntries(
      [
        ["federal", "FED"],
        ["senate", "SENATE"],
        ["house", "HOUSE"],
        ["questions", "BQ"],
        ["commission", "PSC"],
        ["court", "SCJ"],
      ].map(([name, type]) => [
        name,
        `GetMapData?type=${type}&category=SW&raceID=0&osn=0&county=0&party=0`,
      ]),
    ),
  },
  nc: {
    name: "North Carolina",
    kind: "ncsbe-json",
    office: "North Carolina State Board of Elections",
    election: "2026-11-03",
    base: "https://er.ncsbe.gov",
    page: "https://er.ncsbe.gov/?election_dt=11/03/2026&county_id=0&office=FED&contest=0",
    // It answers any origin, but not from its cache every time: through the relay.
    cors: false,
    units: "precincts",
    files: { results: "enr/20261103/data/results_0.txt" },
    lastModified: true,
  },
  nd: totalResults(
    "North Dakota",
    "North Dakota Secretary of State",
    "https://api.resultsnd.sos.nd.gov",
    "https://resultsnd.sos.nd.gov/#election=348",
    "north-dakota",
    "348",
    { statewide: "SW", legislature: "LEG" },
  ),
  ne: totalVote("Nebraska", "Nebraska Secretary of State", "https://electionresults.nebraska.gov", {
    all: "type=All&map=CTY",
  }),
  nm: totalVote(
    "New Mexico",
    "New Mexico Secretary of State",
    "https://electionresults.sos.nm.gov",
    { state: "type=STATE&map=CTY" },
  ),
  pa: {
    name: "Pennsylvania",
    kind: "pa-json",
    office: "Pennsylvania Department of State",
    election: "2026-11-03",
    base: "https://www.electionreturns.pa.gov/api/ElectionReturn",
    page: "https://www.electionreturns.pa.gov/",
    cors: false,
    units: "districts",
    // The office ids are the site's own: 3 governor, 11 Congress, 12 Senate, 13 House.
    files: Object.fromEntries(
      [
        ["governor", 3],
        ["congress", 11],
        ["senate", 12],
        ["house", 13],
      ].map(([name, id]) => [
        name,
        `GetOfficeData?officeId=${id}&methodName=GetOfficeDetails&electionid=117&electiontype=G&isactive=1`,
      ]),
    ),
  },
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
  sd: totalVote(
    "South Dakota",
    "South Dakota Secretary of State",
    "https://electionresults.sd.gov",
    {
      statewide: "type=SWR&map=CTY",
      questions: "type=BQ&map=CTY",
      legislature: "type=LEG&map=DIST",
    },
  ),
  tx: {
    name: "Texas",
    kind: "civix-enr",
    office: "Texas Secretary of State",
    election: "2026-11-03",
    base: "https://goelect.txelections.civixapps.com",
    page: "https://results.texas-election.com/races",
    // It answers with two Access-Control-Allow-Origin headers, which no browser accepts.
    cors: false,
    units: "counties",
    files: { election: "api-ivis-system/api/s3/enr/election/53815" },
  },
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

/**
 * States whose feed is read and parsed here but can't be reached by the
 * hosted app, so they aren't offered: neither a browser nor the public relay
 * gets an answer.
 *
 * - Minnesota: its file host sends no CORS header, and doesn't accept
 *   connections from Cloudflare, where the public relay runs (HTTP 522,
 *   checked 2026-11-10; the same request from a home connection answers).
 *   A relay on another network could read it.
 */
export const UNREACHED_STATE_FEEDS: Record<string, StateFeed> = {
  mn: {
    name: "Minnesota",
    kind: "mn-text",
    office: "Minnesota Secretary of State",
    election: "2026-11-03",
    base: "https://electionresultsfiles.sos.mn.gov/20261103",
    page: "https://electionresults.sos.mn.gov/",
    cors: false,
    units: "precincts",
    files: {
      ussenate: "ussenate.txt",
      ushouse: "ushouse.txt",
      governor: "Governor.txt",
      secofstate: "secofstate.txt",
      auditor: "auditor.txt",
      attorneygen: "attorneygen.txt",
      stsenate: "stsenate.txt",
      sthouse: "LegislativeByDistrict.txt",
      amendment: "ConstAmend.txt",
      judicial: "judicial.txt",
    },
    lastModified: true,
  },
};

/** A state's feed by its postal code, in either case. */
export function stateFeed(code: string | undefined): StateFeed | undefined {
  const key = code?.toLowerCase() ?? "";
  return Object.hasOwn(STATE_FEEDS, key) ? STATE_FEEDS[key] : undefined;
}

/**
 * Whether a relay may be asked for `inner` of a state's feed, and how long its
 * answer stays good: one of the feed's named files, or a path the platform
 * fixes (Clarity's pointer and versioned summary, Enhanced Voting's `data`).
 */
export function stateFeedPathTtl(feed: StateFeed, inner: string): number | null {
  if (feed.files) return Object.hasOwn(feed.files, inner) ? 60 : null;
  if (feed.kind !== "clarity" && feed.kind !== "results-api") return null;
  return feedPathTtl({ ...feed, kind: feed.kind } satisfies CountyFeed, inner);
}

/** Where an allowed `inner` (`stateFeedPathTtl`) is on the state's own site. */
export function stateFeedUrl(feed: StateFeed, inner: string): string {
  return `${feed.base}/${feed.files?.[inner] ?? inner}`;
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
 * A TotalVote "media" export: a header row, then one row per candidate,
 * read by column name since states' exports differ in which columns they
 * have. A contest is a `RaceID`; its district, where it has one, is in
 * `AreaNum` ("District 01"), not in `RaceName`, so the two together are the
 * title ("State Senator District 01"). `CandidatePercentage` is a fraction,
 * `PrecinctsReporting` is `671/671`, which South Dakota and Nebraska wrap as
 * an Excel formula (`="671/671"`). The export says nothing true about when
 * the count was made: its `CurrentDateTime` is the server's clock.
 */
export function parseTotalVoteCsv(text: string): CountyContest[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = csvFields(lines[0] ?? "").map((name) => name.trim());
  const at = (name: string) => header.indexOf(name);
  const columns = {
    race: at("RaceID"),
    name: at("RaceName"),
    party: at("PartyCode"),
    area: at("AreaNum"),
    candidate: at("CandidateName"),
    voteFor: at("VoteFor"),
    votes: at("CandidateVotes"),
    percent: at("CandidatePercentage"),
    precincts: at("PrecinctsReporting"),
  };
  if (columns.race < 0 || columns.name < 0 || columns.candidate < 0 || columns.votes < 0)
    throw new Error("Unexpected answer from the state (not a results export)");
  const contests = new Map<string, CountyContest>();
  for (const line of lines.slice(1)) {
    const row = csvFields(line);
    const cell = (index: number) =>
      index >= 0 ? (row[index] ?? "").replace(/\s+/g, " ").trim() : "";
    const key = cell(columns.race);
    if (!key) continue;
    let contest = contests.get(key);
    if (!contest) {
      const area = cell(columns.area);
      const reported = cell(columns.precincts).match(/(\d+)\s*\/\s*(\d+)/);
      contest = {
        key,
        title: area ? `${cell(columns.name)} ${area}` : cell(columns.name),
        measure: false,
        voteFor: Number(cell(columns.voteFor)) || 0,
        ...(reported
          ? { precincts: { total: Number(reported[2]), reporting: Number(reported[1]) } }
          : {}),
        choices: [],
      };
      contests.set(key, contest);
    }
    const party = cell(columns.party);
    const choice: CountyChoice = {
      name: cell(columns.candidate),
      ...(party ? { party } : {}),
      votes: Number(cell(columns.votes)) || 0,
      percent: Math.round((Number(cell(columns.percent)) || 0) * 10000) / 100,
    };
    contest.choices.push(choice);
  }
  for (const contest of contests.values()) {
    contest.measure =
      contest.choices.length > 0 &&
      contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

/**
 * North Carolina's `results_0.txt`: a JSON array, one object per candidate
 * with its contest repeated on it. `gid` is the contest, `cnm` its title
 * ("US SENATE (VOTE FOR 1)"), `bnm` the candidate, `pty` the party (a space
 * for none), `vct` votes, `pct` a fraction, `prt`/`ptl` precincts reported
 * and total, `ref` "1" for a referendum. Every value is a string.
 */
export function parseNcsbeResults(raw: unknown): CountyContest[] {
  if (!Array.isArray(raw)) throw new Error("Unexpected answer from the state (not a results list)");
  const contests = new Map<string, CountyContest>();
  for (const row of raw as Record<string, string | undefined>[]) {
    const key = row?.gid;
    const title = row?.cnm?.replace(/\s*\(VOTE FOR \d+\)\s*$/i, "").trim();
    if (!key || !title) continue;
    let contest = contests.get(key);
    if (!contest) {
      contest = {
        key,
        title,
        measure: row.ref === "1",
        voteFor: row.ref === "1" ? 0 : Number(row.vfr) || 0,
        ...(row.ptl
          ? { precincts: { total: Number(row.ptl) || 0, reporting: Number(row.prt) || 0 } }
          : {}),
        choices: [],
      };
      contests.set(key, contest);
    }
    const party = row.pty?.trim();
    contest.choices.push({
      name: (row.bnm ?? "").trim(),
      ...(party ? { party } : {}),
      votes: Number(row.vct) || 0,
      percent: Math.round((Number(row.pct) || 0) * 10000) / 100,
    });
  }
  return [...contests.values()];
}

/** A wall-clock time in a zone, as ms since epoch, by the zone's real rules. */
function zonedInstant(wallAsUtc: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(wallAsUtc))
    parts[part.type] = Number(part.value);
  const shown = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  // What the zone's clock showed at that instant, less the instant, is its offset.
  return wallAsUtc - (shown - wallAsUtc);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Nov 04, 2026 22:48:37" on Texas's clock, as ms since epoch. */
export function texasTime(text: string | undefined): number | undefined {
  const m = text?.match(/^([a-z]{3})[a-z]* (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/i);
  const month = MONTHS.indexOf((m?.[1] ?? "").toLowerCase());
  if (!m || month < 0) return undefined;
  const wall = Date.UTC(
    Number(m[3]),
    month,
    Number(m[2]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return zonedInstant(wall, "America/Chicago");
}

interface WireCivixRace {
  id?: number;
  N?: string;
  Candidates?: { N?: string; P?: string; V?: number; PE?: number }[];
}

/** One base64 section of a Civix document, as the JSON inside it. */
function civixSection(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Texas's `…/enr/election/<id>`: an object whose values are each
 * base64-encoded JSON. `Federal`, `StateWide`, `StateWideQ` (propositions)
 * and `Districted` each hold `Races[]` with a title `N` and `Candidates[]`
 * (`N` name, with " (I)" after an incumbent's; `P` party, `W` for a declared
 * write-in; `V` votes; `PE` percent). No race says how much of it has
 * reported; `Home.LastUpdatedTime` is when the count was published, on
 * Texas's clock.
 */
export function parseCivixEnr(raw: unknown): StateCount {
  const doc = raw as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object" || typeof doc.StateWide !== "string")
    throw new Error("Unexpected answer from the state (not an election document)");
  const contests: CountyContest[] = [];
  for (const [section, category] of [
    ["Federal", "Federal"],
    ["StateWide", "Statewide"],
    ["StateWideQ", "Statewide propositions"],
    ["Districted", "Districts"],
  ] as const) {
    const races = (civixSection(doc[section]) as { Races?: WireCivixRace[] } | undefined)?.Races;
    for (const race of races ?? []) {
      const title = race.N?.trim();
      if (race.id === undefined || !title) continue;
      const choices: CountyChoice[] = (race.Candidates ?? []).map((c) => {
        const incumbent = /\s*\(I\)\s*$/.test(c.N ?? "");
        const party = c.P?.trim();
        return {
          name: (c.N ?? "").replace(/\s*\(I\)\s*$/, "").trim(),
          // `W` marks a write-in candidate, not a party.
          ...(party && party !== "W" ? { party } : {}),
          votes: Number(c.V) || 0,
          percent: Math.round((Number(c.PE) || 0) * 100) / 100,
          ...(incumbent ? { incumbent } : {}),
        };
      });
      const measure = choices.length > 0 && choices.every((c) => measureSide(c.name) !== undefined);
      contests.push({
        key: `${section}:${race.id}`,
        title,
        category,
        measure,
        voteFor: measure ? 0 : 1,
        choices,
      });
    }
  }
  const home = civixSection(doc.Home) as { LastUpdatedTime?: string } | undefined;
  const asOf = texasTime(home?.LastUpdatedTime);
  return { contests, ...(asOf !== undefined ? { asOf } : {}) };
}

/** A share of the votes, as a percent with two decimals. */
function share(votes: number, total: number): number {
  return total > 0 ? Math.round((votes / total) * 10000) / 100 : 0;
}

/**
 * One of Minnesota's results files (`ushouse.txt`, `Governor.txt`): no
 * header, a row per candidate, sixteen fields separated by semicolons. The
 * fourth is the office's id, the fifth its title with the district in it,
 * the eighth the candidate, the eleventh the party (`NP` for none, `WI` for
 * the write-in line), then precincts reporting and in all, votes, percent.
 * An amendment has a third line, "ESTIMATED BLANKS": Minnesota counts a
 * ballot that skips an amendment against it, and publishes how many did. It
 * is left out here, so Yes and No are as the state shows them.
 */
export function parseMnFile(text: string): CountyContest[] {
  const contests = new Map<string, CountyContest>();
  for (const line of text.split(/\r?\n/)) {
    const row = line.split(";");
    const key = row[3]?.trim();
    const title = row[4]?.trim();
    const name = row[7]?.trim();
    if (row.length < 16 || !key || !title || !name) continue;
    if (/^estimated blanks$/i.test(name)) continue;
    let contest = contests.get(key);
    if (!contest) {
      contest = {
        key,
        title,
        measure: false,
        voteFor: 1,
        precincts: { total: Number(row[12]) || 0, reporting: Number(row[11]) || 0 },
        choices: [],
      };
      contests.set(key, contest);
    }
    const party = row[10]?.trim();
    contest.choices.push({
      name,
      ...(party && party !== "NP" && party !== "WI" ? { party } : {}),
      votes: Number(row[13]) || 0,
      percent: Number(row[14]) || 0,
    });
  }
  for (const contest of contests.values()) {
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

interface WirePaCandidate {
  CandidateName?: string;
  PartyName?: string;
  Votes?: string;
  Percentage?: string;
  IsRetention?: string;
  YesVotes?: string;
  NoVotes?: string;
}

/**
 * One office from Pennsylvania's returns API (`GetOfficeData?officeId=…`).
 * The body is JSON inside a JSON string. `Election[<office>][0]` maps
 * `<district>$$<id>$$` to `[{ District, Candidates[] }]`; the district is
 * words ("1st Congressional District", or "Statewide"), so office and
 * district together are the title. Every number is a string. A retention
 * question is a candidate with yes and no votes.
 */
export function parsePaOffice(text: string): CountyContest[] {
  let doc: unknown = JSON.parse(text);
  if (typeof doc === "string") doc = JSON.parse(doc);
  const election = (doc as { Election?: Record<string, Record<string, unknown>[]> } | null)
    ?.Election;
  if (!election || typeof election !== "object")
    throw new Error("Unexpected answer from the state (not an office's returns)");
  const contests: CountyContest[] = [];
  for (const [office, groups] of Object.entries(election)) {
    for (const [key, entries] of Object.entries(groups?.[0] ?? {})) {
      const entry = (entries as { District?: string; Candidates?: WirePaCandidate[] }[])?.[0];
      const district = entry?.District?.trim();
      const title = !district || district === "Statewide" ? office : `${office} ${district}`;
      const candidates = entry?.Candidates ?? [];
      const retained = candidates.filter((c) => c.IsRetention === "1");
      for (const judge of retained) {
        const [yes, no] = [Number(judge.YesVotes) || 0, Number(judge.NoVotes) || 0];
        contests.push({
          key: `${office}|${key}|${judge.CandidateName}`,
          title: `${title}: retain ${judge.CandidateName?.trim()}`,
          measure: true,
          voteFor: 0,
          choices: [
            { name: "Yes", votes: yes, percent: share(yes, yes + no) },
            { name: "No", votes: no, percent: share(no, yes + no) },
          ],
        });
      }
      const running = candidates.filter((c) => c.IsRetention !== "1");
      if (running.length === 0) continue;
      contests.push({
        key: `${office}|${key}`,
        title,
        measure: false,
        voteFor: 1,
        choices: running.map((c) => {
          const party = c.PartyName?.trim();
          return {
            name: (c.CandidateName ?? "").trim(),
            ...(party ? { party } : {}),
            votes: Number(c.Votes) || 0,
            percent: Number(c.Percentage) || 0,
          };
        }),
      });
    }
  }
  return contests;
}

/**
 * Michigan's results file: a line of turnout, a header, then a row per
 * candidate per county, tab-separated, and a footer. Nothing is totalled:
 * a contest is an office code, district code and description, and a
 * candidate's votes are summed over the counties. The description carries
 * the term and seats ("1ST DISTRICT REPRESENTATIVE IN CONGRESS 2 YEAR TERM
 * (1) POSITION"): the seats become `voteFor` and both come off the title. A
 * contest with district code `0` is the whole state's.
 */
export function parseMiResults(text: string): CountyContest[] {
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((line) => line.startsWith("ElectionDate\t"));
  if (head < 0) throw new Error("Unexpected answer from the state (not a results file)");
  const header = (lines[head] ?? "").split("\t").map((name) => name.trim());
  const at = (name: string) => header.indexOf(name);
  const columns = {
    office: at("OfficeCode(text)"),
    district: at("DistrictCode(Text)"),
    title: at("OfficeDescription"),
    party: at("PartyDescription"),
    candidate: at("CandidateID"),
    last: at("CandidateLastName"),
    first: at("CandidateFirstName"),
    middle: at("CandidateMiddleName"),
    votes: at("CandidateVotes"),
  };
  if (Object.values(columns).some((index) => index < 0))
    throw new Error("Unexpected answer from the state (columns missing)");
  const contests = new Map<string, CountyContest>();
  const choices = new Map<string, CountyChoice>();
  for (const line of lines.slice(head + 1)) {
    const row = line.split("\t");
    if (row.length < header.length - 4 || !/^\d{4}-\d\d-\d\d$/.test(row[0] ?? "")) continue;
    const cell = (index: number) => (row[index] ?? "").replace(/\s+/g, " ").trim();
    const described = cell(columns.title);
    const key = `${cell(columns.office)}|${cell(columns.district)}|${described}`;
    let contest = contests.get(key);
    if (!contest) {
      const seats = Number(described.match(/\((\d+)\) POSITIONS?$/i)?.[1]) || 1;
      contest = {
        key,
        title: described
          .replace(/\s*\(\d+\) POSITIONS?$/i, "")
          .replace(/\s+(?:\d+ YEAR TERMS?|- PARTIAL TERM ENDING [\d/]+)$/i, "")
          .trim(),
        ...(cell(columns.district) === "0" ? { category: "Statewide" } : {}),
        measure: false,
        voteFor: seats,
        choices: [],
      };
      contests.set(key, contest);
    }
    const id = `${key}|${cell(columns.candidate)}|${cell(columns.last)}`;
    let choice = choices.get(id);
    if (!choice) {
      const party = cell(columns.party);
      const name = [cell(columns.first), cell(columns.middle), cell(columns.last)]
        .filter(Boolean)
        .join(" ");
      choice = {
        name: name === "WRITE-IN" ? "Write-in" : name,
        ...(party && party !== "NO PARTY AFFILIATION" ? { party } : {}),
        votes: 0,
        percent: 0,
      };
      choices.set(id, choice);
      contest.choices.push(choice);
    }
    choice.votes += Number(cell(columns.votes)) || 0;
  }
  for (const contest of contests.values()) {
    const total = contest.choices.reduce((sum, choice) => sum + choice.votes, 0);
    for (const choice of contest.choices) choice.percent = share(choice.votes, total);
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

/** "240,587" or 240587, as a number. */
function count(value: unknown): number {
  return Number(String(value ?? "").replace(/[,\s]/g, "")) || 0;
}

/**
 * Delaware's `Election_StatewideResults_ID_<election>.json`: an array with a
 * row per candidate, the contest repeated on each (`Contest Title`, `Total
 * Precincts`, `Precincts Reported`), votes with thousands separators, the
 * party spelled out ("Democratic Party"), and on every row when the report
 * was made (`ReportTime`, with its offset) and whether it is official.
 */
export function parseDeResults(raw: unknown): StateCount {
  if (!Array.isArray(raw)) throw new Error("Unexpected answer from the state (not a results list)");
  const contests = new Map<string, CountyContest>();
  let asOf: number | undefined;
  let official: boolean | undefined;
  for (const row of raw as Record<string, unknown>[]) {
    const title = String(row?.["Contest Title"] ?? "").trim();
    const name = String(row?.["Candidate Name"] ?? "").trim();
    if (!title || !name) continue;
    const at = Date.parse(String(row.ReportTime ?? ""));
    if (Number.isFinite(at) && (asOf === undefined || at > asOf)) asOf = at;
    if (typeof row["Results Type"] === "string")
      official = /^official/i.test(row["Results Type"].trim());
    let contest = contests.get(title);
    if (!contest) {
      contest = {
        key: title,
        title,
        measure: false,
        voteFor: 1,
        precincts: {
          total: count(row["Total Precincts"]),
          reporting: count(row["Precincts Reported"]),
        },
        choices: [],
      };
      contests.set(title, contest);
    }
    const party = String(row["Party Name"] ?? "")
      .replace(/\s+Party(?: of Delaware)?$/i, "")
      .trim();
    contest.choices.push({
      name,
      ...(party ? { party } : {}),
      votes: count(row["Total Votes"]),
      percent: Number(row.Percentage) || 0,
    });
  }
  for (const contest of contests.values()) {
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return {
    contests: [...contests.values()],
    ...(asOf !== undefined ? { asOf } : {}),
    ...(official !== undefined ? { official } : {}),
  };
}

interface WireLaRace {
  ID?: string;
  SpecificTitle?: string;
  NumberToBeElected?: string;
  PrecinctsReporting?: string;
  PrecinctsExpected?: string;
  Choice?:
    | { ID?: string; Desc?: string; VoteTotal?: string }[]
    | { ID?: string; Desc?: string; VoteTotal?: string };
}

/** One thing or several, as a list: Louisiana writes a lone choice as an object. */
function listOf<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/**
 * Louisiana's two documents: `races` (`RacesCandidates_Multiparish`: each
 * race's title and its choices' names, "Julia Letlow (REP)") and `votes`
 * (`Votes_Multiparish`: votes and precincts by the same ids). Everything is
 * a string. `Races.WriteTime` is when the count was written, on Louisiana's
 * clock.
 */
export function parseLaResults(races: unknown, votes: unknown): StateCount {
  const named = (
    races as { Races?: { WriteTime?: string; Race?: WireLaRace | WireLaRace[] } } | null
  )?.Races;
  const counted = (votes as { Races?: { Race?: WireLaRace | WireLaRace[] } } | null)?.Races;
  if (!named?.Race || !counted?.Race)
    throw new Error("Unexpected answer from the state (no races)");
  const tallies = new Map(listOf(counted.Race).map((race) => [race.ID ?? "", race]));
  const contests: CountyContest[] = [];
  for (const race of listOf(named.Race)) {
    const tally = tallies.get(race.ID ?? "");
    const title = race.SpecificTitle?.trim();
    if (!race.ID || !title || !tally) continue;
    const totals = new Map(listOf(tally.Choice).map((c) => [c.ID ?? "", count(c.VoteTotal)]));
    const all = [...totals.values()].reduce((sum, n) => sum + n, 0);
    const choices: CountyChoice[] = listOf(race.Choice).map((c) => {
      const described = (c.Desc ?? "").trim().match(/^(.*?)\s*\(([A-Z]+)\)$/);
      const party = described?.[2];
      const votes = totals.get(c.ID ?? "") ?? 0;
      return {
        name: (described?.[1] ?? c.Desc ?? "").trim(),
        // `NOPTY`: no party.
        ...(party && party !== "NOPTY" ? { party } : {}),
        votes,
        percent: share(votes, all),
      };
    });
    const measure = choices.length > 0 && choices.every((c) => measureSide(c.name) !== undefined);
    contests.push({
      key: race.ID,
      title,
      measure,
      voteFor: measure ? 0 : count(race.NumberToBeElected) || 1,
      precincts: {
        total: count(tally.PrecinctsExpected),
        reporting: count(tally.PrecinctsReporting),
      },
      choices,
    });
  }
  const written = named.WriteTime?.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/);
  const asOf = written
    ? zonedInstant(
        Date.UTC(
          Number(written[1]),
          Number(written[2]) - 1,
          Number(written[3]),
          Number(written[4]),
          Number(written[5]),
          Number(written[6]),
        ),
        "America/Chicago",
      )
    : undefined;
  return { contests, ...(asOf !== undefined ? { asOf } : {}) };
}

interface WireDcContest {
  OfficeName?: string;
  ContestNumber?: number;
  ElectionData?: {
    Contestant?: string;
    Votes?: number;
    PartyCode?: string;
    VotesPercentage?: number;
  }[];
}

/**
 * The District of Columbia's `getCityWide` (an array of contests, each with
 * its `ElectionData`: "DEM Robert White" with `PartyCode` "DEM" beside it)
 * and `getElectionInfo` (when it was last updated). A contest that isn't a
 * ward's is the whole District's.
 */
export function parseDcResults(contestsRaw: unknown, info: unknown): StateCount {
  if (!Array.isArray(contestsRaw))
    throw new Error("Unexpected answer from the District (not a list of contests)");
  const contests = (contestsRaw as WireDcContest[]).flatMap((contest): CountyContest[] => {
    const title = contest.OfficeName?.trim();
    if (!title) return [];
    // "OVER VOTES" and "UNDER VOTES" are listed beside the choices; they aren't any.
    const cast = (contest.ElectionData ?? []).filter(
      (c) => !/^(?:over|under) ?votes$/i.test((c.Contestant ?? "").trim()),
    );
    const total = cast.reduce((sum, c) => sum + (Number(c.Votes) || 0), 0);
    const choices: CountyChoice[] = cast.map((c) => {
      const party = c.PartyCode?.trim();
      const raw = (c.Contestant ?? "").trim();
      const name = party && raw.startsWith(`${party} `) ? raw.slice(party.length + 1) : raw;
      const votes = Number(c.Votes) || 0;
      return {
        name,
        // `NPN`: no party named.
        ...(party && party !== "NPN" ? { party } : {}),
        votes,
        // Of the votes for a choice: the District's own share counts blank ballots too.
        percent: share(votes, total),
      };
    });
    const measure = choices.length > 0 && choices.every((c) => measureSide(c.name) !== undefined);
    return [
      {
        key: String(contest.ContestNumber ?? title),
        title,
        ...(/^ward\b/i.test(title) ? {} : { category: "Statewide" }),
        measure,
        voteFor: measure ? 0 : 1,
        choices,
      },
    ];
  });
  const asOf = Date.parse((info as { LastUpdated?: string } | null)?.LastUpdated ?? "");
  return { contests, ...(Number.isFinite(asOf) ? { asOf } : {}) };
}

interface WireMapRow {
  RaceID?: number | string;
  RaceName?: string;
  PartyCode?: string;
  PrecinctsReporting?: number;
  TotalPrecincts?: number;
  VoteFor?: number;
  calcCandidate?: string;
  calcCandidatePercentage?: number;
  calcCandidateVotes?: number;
}

/**
 * One answer of TotalVote's map service (`GetMapData?type=…&category=SW`,
 * Montana): `{ d: [...] }`, a row per candidate with its race's name (the
 * district in it), precincts, and the candidate's votes and share (a
 * fraction).
 */
export function parseTotalVoteMap(raw: unknown): CountyContest[] {
  const rows = (raw as { d?: WireMapRow[] | null } | null)?.d;
  if (rows === null) return [];
  if (!Array.isArray(rows)) throw new Error("Unexpected answer from the state (no rows)");
  const contests = new Map<string, CountyContest>();
  for (const row of rows) {
    const key = String(row.RaceID ?? "");
    const title = row.RaceName?.trim();
    if (!key || !title) continue;
    let contest = contests.get(key);
    if (!contest) {
      contest = {
        key,
        title,
        measure: false,
        voteFor: Number(row.VoteFor) || 1,
        precincts: {
          total: Number(row.TotalPrecincts) || 0,
          reporting: Number(row.PrecinctsReporting) || 0,
        },
        choices: [],
      };
      contests.set(key, contest);
    }
    const party = row.PartyCode?.trim();
    contest.choices.push({
      name: (row.calcCandidate ?? "").trim(),
      ...(party && party !== "NON" ? { party } : {}),
      votes: Number(row.calcCandidateVotes) || 0,
      percent: Math.round((Number(row.calcCandidatePercentage) || 0) * 10000) / 100,
    });
  }
  for (const contest of contests.values()) {
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

/** Records of a delimited text, a quoted field keeping its delimiters and line breaks (`""` is a quote). */
function delimited(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Hawaii's `summary.txt`: tab-separated, a `#FormatVersion` line, a header
 * starting `#Contest ID`, then a row per candidate. A name carries its
 * party before it, surname first ("(D) CASE, Ed"; `N` is nonpartisan), and
 * the governor's ticket is one quoted field of two lines. Its precinct
 * columns count every precinct twice against the counted ones, so they are
 * left out; nothing in it says when it was made.
 */
export function parseHiSummary(text: string): CountyContest[] {
  const records = delimited(text, "\t");
  const head = records.findIndex((record) => record[0]?.trim() === "#Contest ID");
  if (head < 0) throw new Error("Unexpected answer from the state (not a summary)");
  const header = (records[head] ?? []).map((name) => name.trim());
  const at = (name: string) => header.indexOf(name);
  const columns = {
    title: at("Contest Title"),
    name: at("Candidate Name"),
    votes: at("Total Votes"),
  };
  if (columns.title < 0 || columns.name < 0 || columns.votes < 0)
    throw new Error("Unexpected answer from the state (columns missing)");
  const contests = new Map<string, CountyContest>();
  for (const record of records.slice(head + 1)) {
    const key = record[0]?.trim();
    const title = record[columns.title]?.trim();
    if (!key || !title || record.length < header.length - 2) continue;
    let contest = contests.get(key);
    if (!contest) {
      contest = { key, title, measure: false, voteFor: 1, choices: [] };
      contests.set(key, contest);
    }
    // One line a person; a ticket's two, each with its party and, under it,
    // the office it is for ("For GOVERNOR"), which the title already says.
    const people = (record[columns.name] ?? "")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^for\s/i.test(line));
    const party = people[0]?.match(/^\(([A-Z]+)\)\s*/)?.[1];
    contest.choices.push({
      name: people.map((person) => person.replace(/^\([A-Z]+\)\s*/, "")).join(" / "),
      ...(party && party !== "N" ? { party } : {}),
      votes: count(record[columns.votes]),
      percent: 0,
    });
  }
  for (const contest of contests.values()) {
    const total = contest.choices.reduce((sum, choice) => sum + choice.votes, 0);
    for (const choice of contest.choices) choice.percent = share(choice.votes, total);
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

/**
 * Alaska's precinct export (Dominion's): a header, then a row per candidate
 * per precinct, comma-separated. A contest is a `Contest_Id`; a candidate's
 * `total_votes` are summed over the precincts, and the precincts a contest
 * has rows for are its total (whether each has reported isn't told: its
 * `Reporting_flag` stays 0). These are first choices: Alaska ranks, and the
 * rounds aren't in this file.
 */
export function parseAkPrecincts(text: string): CountyContest[] {
  const lines = text.split(/\r?\n/);
  const header = csvFields(lines[0] ?? "").map((name) => name.trim());
  const at = (name: string) => header.indexOf(name);
  const columns = {
    precinct: at("Pct_Id"),
    contest: at("Contest_Id"),
    title: at("Contest_title"),
    seats: at("Selectable_Options"),
    candidate: at("candidate_id"),
    name: at("candidate_name"),
    party: at("Party_Code"),
    votes: at("total_votes"),
  };
  if (Object.values(columns).some((index) => index < 0))
    throw new Error("Unexpected answer from the state (not a precinct export)");
  const contests = new Map<string, CountyContest>();
  const choices = new Map<string, CountyChoice>();
  const precincts = new Map<string, Set<string>>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const row = csvFields(line);
    const key = row[columns.contest]?.trim();
    const title = row[columns.title]?.trim();
    if (!key || !title) continue;
    let contest = contests.get(key);
    if (!contest) {
      contest = {
        key,
        title,
        measure: false,
        voteFor: count(row[columns.seats]) || 1,
        choices: [],
      };
      contests.set(key, contest);
      precincts.set(key, new Set());
    }
    precincts.get(key)?.add(row[columns.precinct] ?? "");
    const id = `${key}|${row[columns.candidate]}`;
    let choice = choices.get(id);
    if (!choice) {
      const party = row[columns.party]?.trim();
      choice = {
        name: (row[columns.name] ?? "").trim(),
        ...(party && party !== "NON" ? { party } : {}),
        votes: 0,
        percent: 0,
      };
      choices.set(id, choice);
      contest.choices.push(choice);
    }
    choice.votes += count(row[columns.votes]);
  }
  for (const contest of contests.values()) {
    const total = contest.choices.reduce((sum, choice) => sum + choice.votes, 0);
    for (const choice of contest.choices) choice.percent = share(choice.votes, total);
    contest.precincts = { total: precincts.get(contest.key)?.size ?? 0, reporting: 0 };
    contest.measure = contest.choices.every((choice) => measureSide(choice.name) !== undefined);
    if (contest.measure) contest.voteFor = 0;
  }
  return [...contests.values()];
}

interface WireTotalResults {
  lastUpdated?: string;
  isOfficial?: boolean;
  response?: { contests?: Record<string, unknown> | unknown[] };
}

interface WireTotalResultsName {
  contestName?: string;
  voteFor?: number;
  choices?: Record<string, { name?: string; partyID?: string }>;
}

interface WireTotalResultsCount {
  contestID?: string;
  precinctsReporting?: number;
  totalPrecincts?: number;
  choices?: { choiceID?: string; totalVotes?: number; partyID?: string }[];
}

/**
 * A TotalResults site's count: `names` is `GetContestSearchList` (each
 * contest's name and its choices' names, by id), `results` the
 * `GetContestResults` documents (votes by the same ids, precincts reporting,
 * and when the state last published). A party is a short code (North
 * Dakota's `REP`), or an id with the code written before the name instead
 * (Arkansas's "REP Tom Cotton").
 */
export function parseTotalResults(names: unknown, results: readonly unknown[]): StateCount {
  const named = (names as WireTotalResults | null)?.response?.contests;
  if (!named || typeof named !== "object" || Array.isArray(named))
    throw new Error("Unexpected answer from the state (no list of contests)");
  const contests: CountyContest[] = [];
  let asOf: number | undefined;
  let official: boolean | undefined;
  for (const document of results as (WireTotalResults | null)[]) {
    const counted = document?.response?.contests;
    if (!counted || typeof counted !== "object")
      throw new Error("Unexpected answer from the state (no results)");
    const at = Date.parse(document.lastUpdated ?? "");
    if (Number.isFinite(at) && (asOf === undefined || at > asOf)) asOf = at;
    if (typeof document.isOfficial === "boolean") official = document.isOfficial;
    for (const count of Object.values(counted) as WireTotalResultsCount[]) {
      const name = count.contestID
        ? (named[count.contestID] as WireTotalResultsName | undefined)
        : undefined;
      if (!count.contestID || !name?.contestName) continue;
      const total = (count.choices ?? []).reduce((sum, c) => sum + (Number(c.totalVotes) || 0), 0);
      const choices: CountyChoice[] = (count.choices ?? []).map((c) => {
        let label = (name.choices?.[c.choiceID ?? ""]?.name ?? "").replace(/\s+/g, " ").trim();
        let party = c.partyID?.trim();
        if (party && !/^[A-Z]{1,4}$/.test(party)) {
          // An id, not a code: the code is before the name.
          // (A measure's "FOR ISSUE NO. 1" is a side, not a party and a name.)
          const prefixed =
            measureSide(label) === undefined ? label.match(/^([A-Z]{3}) (.+)$/) : null;
          party = prefixed?.[1];
          if (prefixed?.[2]) label = prefixed[2];
        }
        const votes = Number(c.totalVotes) || 0;
        return {
          name: label,
          ...(party && party !== "NON" ? { party } : {}),
          votes,
          percent: share(votes, total),
        };
      });
      const measure = choices.length > 0 && choices.every((c) => measureSide(c.name) !== undefined);
      contests.push({
        key: count.contestID,
        title: name.contestName,
        measure,
        voteFor: measure ? 0 : Number(name.voteFor) || 1,
        ...(count.totalPrecincts
          ? {
              precincts: {
                total: Number(count.totalPrecincts) || 0,
                reporting: Number(count.precinctsReporting) || 0,
              },
            }
          : {}),
        choices,
      });
    }
  }
  return {
    contests,
    ...(asOf !== undefined ? { asOf } : {}),
    ...(official !== undefined ? { official } : {}),
  };
}

/**
 * A state's count from the files its feed names (`StateFeed.files`), each as
 * its text. For the platforms whose one document is fixed by their kind, use
 * `parseStateFeed`.
 */
export function parseStateFiles(feed: StateFeed, texts: Record<string, string>): StateCount {
  const names = Object.keys(feed.files ?? {});
  if (feed.kind === "totalresults")
    return tidied(
      feed,
      parseTotalResults(
        JSON.parse(texts.names ?? "null"),
        names.filter((name) => name !== "names").map((name) => JSON.parse(texts[name] ?? "null")),
      ),
    );
  if (feed.kind === "hi-text")
    return tidied(feed, { contests: parseHiSummary(texts.summary ?? "") });
  if (feed.kind === "ak-csv")
    return tidied(feed, { contests: parseAkPrecincts(texts.results ?? "") });
  if (feed.kind === "de-json")
    return tidied(feed, parseDeResults(JSON.parse(texts.results ?? "null")));
  if (feed.kind === "la-json")
    return tidied(
      feed,
      parseLaResults(JSON.parse(texts.races ?? "null"), JSON.parse(texts.votes ?? "null")),
    );
  if (feed.kind === "dc-json")
    return tidied(
      feed,
      parseDcResults(JSON.parse(texts.contests ?? "null"), JSON.parse(texts.info ?? "null")),
    );
  if (feed.kind === "totalvote-json")
    return tidied(feed, {
      contests: names.flatMap((name) => parseTotalVoteMap(JSON.parse(texts[name] ?? "null"))),
    });
  if (feed.kind === "mn-text")
    return tidied(feed, { contests: names.flatMap((name) => parseMnFile(texts[name] ?? "")) });
  if (feed.kind === "pa-json")
    return tidied(feed, {
      contests: names.flatMap((name) => parsePaOffice(texts[name] ?? "null")),
    });
  if (feed.kind === "mi-text")
    return tidied(feed, { contests: parseMiResults(texts.results ?? "") });
  if (feed.kind === "ncsbe-json")
    return tidied(feed, { contests: parseNcsbeResults(JSON.parse(texts.results ?? "null")) });
  if (feed.kind === "civix-enr")
    return tidied(feed, parseCivixEnr(JSON.parse(texts.election ?? "null")));
  if (feed.kind !== "totalvote-csv")
    throw new Error(`${feed.name}'s feed isn't read from named files`);
  const seen = new Set<string>();
  const contests = Object.keys(feed.files ?? {}).flatMap((name) =>
    parseTotalVoteCsv(texts[name] ?? "").filter((contest) => {
      // One contest can be in two of a state's exports.
      if (seen.has(contest.key)) return false;
      seen.add(contest.key);
      return true;
    }),
  );
  return tidied(feed, { contests });
}

/**
 * A state feed's document (Clarity's `summary.json`, Enhanced Voting's
 * `data`) as contests, with what that state's site does to names undone.
 */
export function parseStateFeed(feed: StateFeed, raw: unknown): StateCount {
  if (feed.kind !== "clarity" && feed.kind !== "results-api")
    throw new Error(`${feed.name}'s feed isn't one document`);
  return tidied(
    feed,
    feed.kind === "clarity" ? { contests: parseClaritySummary(raw) } : parseResultsApi(raw),
  );
}

/** What every state's contests get: no tallies that aren't contests, single spaces, parties off names. */
function tidied(feed: StateFeed, read: StateCount): StateCount {
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
