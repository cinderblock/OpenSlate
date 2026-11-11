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
 * sections are each base64-encoded JSON.
 */
export type StateFeedKind =
  | "clarity"
  | "results-api"
  | "totalvote-csv"
  | "ncsbe-json"
  | "civix-enr";

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
  // Nebraska's one export has every contest; New Mexico's `STATE` every one
  // the state reports; South Dakota's comes in three.
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
  ne: totalVote("Nebraska", "Nebraska Secretary of State", "https://electionresults.nebraska.gov", {
    all: "type=All&map=CTY",
  }),
  nm: totalVote(
    "New Mexico",
    "New Mexico Secretary of State",
    "https://electionresults.sos.nm.gov",
    { state: "type=STATE&map=CTY" },
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

/**
 * A state's count from the files its feed names (`StateFeed.files`), each as
 * its text. For the platforms whose one document is fixed by their kind, use
 * `parseStateFeed`.
 */
export function parseStateFiles(feed: StateFeed, texts: Record<string, string>): StateCount {
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
