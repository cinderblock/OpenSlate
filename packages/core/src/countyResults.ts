/**
 * California counties' own election-night results feeds: which counties have
 * one OpenSlate can read, where it lives, and pure parsers for each format.
 * One module for every way OpenSlate reaches a county: the public relay
 * (apps/poll-cache, which only fetches paths this registry allows), a
 * self-hosted apps/server, and a browser connecting directly. See
 * plans/county-results.md.
 *
 * Clarity ENR (Scytl): `<base>/current_ver.txt` names the latest version, and
 * `<base>/<version>/json/en/summary.json` holds every contest of the election in
 * one document. A versioned file never changes once published.
 */

export const COUNTY_RESULTS_USER_AGENT = "OpenSlate election-results relay (+https://openslate.us)";

/**
 * `clarity`: Clarity ENR (Scytl). `lvt`: livevoterturnout.com, whose
 * `summary_<n>.csv` holds every contest, one row per choice. `results-api`:
 * the `results/public/api/elections/<county>/<id>/data` JSON Sacramento
 * publishes (every ballot item with its options' votes). `lavote`: Los
 * Angeles' `electionresults/json?electionid=<n>` (contest groups → contests).
 *
 * Two counties publish no feed at all, only a results page, read as HTML (the
 * user agreed to it, 2026-11-04; a scheduled CI check, `.github/workflows/county-html.yml`,
 * says when a page's layout stops parsing): `lvt-html`, livevoterturnout.com's
 * `en/Index_<n>.html` for a county that turned the site's downloads off (San
 * Joaquin); `acvote`, Alameda's `rovresults/<election>/index.htm`.
 */
export type CountyFeedKind = "clarity" | "lvt" | "lvt-html" | "results-api" | "lavote" | "acvote";

export interface CountyFeed {
  /** The county's name, without "County" (`Santa Clara`). */
  name: string;
  kind: CountyFeedKind;
  /** The feed's root, no trailing slash. For Clarity, the election's folder. */
  base: string;
  /** The county's own results page, for people. */
  page: string;
  /** False when the feed sends no CORS header: a browser can only read it through a relay. */
  cors: boolean;
  /** Appended to every upstream URL (`?electionid=4348`): a relay passes paths only. */
  query?: string;
}

/** livevoterturnout.com's election folder and its number: `https://www.livevoterturnout.com/ENR/orangecaenr/24`. */
function lvt(
  name: string,
  folder: string,
  n: number,
  page: string,
  kind: "lvt" | "lvt-html" = "lvt",
): CountyFeed {
  return {
    name,
    kind,
    base: `https://www.livevoterturnout.com/ENR/${folder}/${n}`,
    page,
    cors: false,
  };
}

/** The file a feed's whole count is in (after Clarity's version pointer). */
export function lvtSummaryPath(feed: CountyFeed): string {
  return `summary_${feed.base.split("/").pop()}.csv`;
}

/** A livevoterturnout.com election's results page, in English (`en/Index_22.html`). */
export function lvtPagePath(feed: CountyFeed): string {
  return `en/Index_${feed.base.split("/").pop()}.html`;
}

/** Alameda's results page under its election's folder. */
export const ACVOTE_PAGE_PATH = "index.htm";

/** Counties with a feed for the 2026-11-03 general, by slug (`santa-clara`, as the Secretary of State spells them). */
export const CA_COUNTY_FEEDS: Record<string, CountyFeed> = {
  "santa-clara": {
    name: "Santa Clara",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Santa_Clara/127570",
    page: "https://results.enr.clarityelections.com/CA/Santa_Clara/127570/web.345435/#/summary",
    cors: true,
  },
  "contra-costa": {
    name: "Contra Costa",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Contra_Costa/127405",
    page: "https://www.contracostavote.gov/november-3-2026-election-results/",
    cors: true,
  },
  marin: {
    name: "Marin",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Marin/127071",
    page: "https://www.marincounty.gov/departments/elections/november-3-2026-general-election/election-results-110326",
    cors: true,
  },
  sonoma: {
    name: "Sonoma",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Sonoma/127275",
    page: "https://results.enr.clarityelections.com/CA/Sonoma/127275/",
    cors: true,
  },
  ventura: {
    name: "Ventura",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Ventura/127362",
    page: "https://clerkrecorder.venturacounty.gov/elections/november-3-2026-general-election/",
    cors: true,
  },
  "san-diego": lvt(
    "San Diego",
    "sandiegocaenr",
    25,
    "https://www.livevoterturnout.com/ENR/sandiegocaenr/25/en/Index_25.html",
  ),
  orange: lvt(
    "Orange",
    "orangecaenr",
    24,
    "https://www.ocvote.gov/results/current-election-results",
  ),
  riverside: lvt(
    "Riverside",
    "riversidecaenr",
    12,
    "https://www.voteinfo.net/november-3-2026-general-election",
  ),
  "san-bernardino": lvt(
    "San Bernardino",
    "sanbernardinocaenr",
    3,
    "https://elections.sbcounty.gov/elections/2026/1103/results/",
  ),
  "san-mateo": lvt("San Mateo", "sanmateocaenr", 20, "https://www.smcacre.gov/elections"),
  // No downloads (summary_22.csv is a 404): its page only.
  "san-joaquin": lvt(
    "San Joaquin",
    "sanjoaquincaenr",
    22,
    "https://www.livevoterturnout.com/ENR/sanjoaquincaenr/22/en/Index_22.html",
    "lvt-html",
  ),
  alameda: {
    name: "Alameda",
    kind: "acvote",
    base: "https://alamedacountyca.gov/rovresults/260",
    page: "https://alamedacountyca.gov/rovresults/260/",
    cors: false,
  },
  solano: lvt(
    "Solano",
    "solanocaenr",
    21,
    "https://www.livevoterturnout.com/ENR/solanocaenr/21/en/Index_21.html",
  ),
  "los-angeles": {
    name: "Los Angeles",
    kind: "lavote",
    base: "https://results.lavote.gov/electionresults",
    query: "?electionid=4348",
    page: "https://results.lavote.gov/",
    cors: false,
  },
  sacramento: {
    name: "Sacramento",
    kind: "results-api",
    base: "https://results.saccounty.gov/results/public/api/elections/sacramento-county-ca/69",
    page: "https://results.saccounty.gov/results/public/sacramento-county-ca/elections/69",
    cors: false,
  },
};

/** Whether a path under the feed's base is one OpenSlate reads, and how long its answer stays good. */
export function feedPathTtl(feed: CountyFeed, inner: string): number | null {
  if (feed.kind === "lvt") return inner === lvtSummaryPath(feed) ? 60 : null;
  if (feed.kind === "lvt-html") return inner === lvtPagePath(feed) ? 60 : null;
  if (feed.kind === "acvote") return inner === ACVOTE_PAGE_PATH ? 60 : null;
  if (feed.kind === "results-api") return inner === "data" ? 60 : null;
  if (feed.kind === "lavote") return inner === "json" ? 60 : null;
  if (!/^(current_ver\.txt|\d{1,9}\/json\/en\/summary\.json)$/.test(inner)) return null;
  // The version pointer moves; a versioned file never does.
  return inner === "current_ver.txt" ? 60 : 60 * 60;
}

export function claritySummaryPath(version: string): string {
  return `${version}/json/en/summary.json`;
}

/** The version a Clarity `current_ver.txt` names, or null when it names none. */
export function parseClarityVersion(text: string): string | null {
  const v = text.trim();
  return /^\d{1,9}$/.test(v) ? v : null;
}

// ---- Normalized --------------------------------------------------------------

export interface CountyChoice {
  name: string;
  party?: string;
  votes: number;
  percent: number;
  /** Marked as the incumbent by the county. */
  incumbent?: boolean;
}

export interface CountyContest {
  /** The feed's own key for the contest, stable through the election. */
  key: string;
  title: string;
  /** The feed's grouping ("Local", "School", "Measures"), when it has one. */
  category?: string;
  /** Yes/no on a measure, rather than people. */
  measure: boolean;
  /** How many to elect (0 when the feed doesn't say, or for measures). */
  voteFor: number;
  /** A measure's share of yes votes to pass, when the feed says so apart from the title (Alameda). */
  threshold?: "2/3" | "55%";
  precincts?: { total: number; reporting: number };
  choices: CountyChoice[];
}

interface WireClarityContest {
  K?: string | number;
  C?: string;
  CAT?: string;
  VF?: number;
  TP?: number;
  PR?: number;
  CH?: string[];
  P?: string[];
  V?: number[];
  PCT?: number[];
}

function n(raw: unknown): number {
  const v = typeof raw === "string" ? Number(raw.replace(/[,%\s]/g, "")) : Number(raw);
  return Number.isFinite(v) ? v : 0;
}

const MEASURE_PREFIX = String.raw`(?:(?:bonds?|levy|be retained)\s*-?\s*)?`;
const MEASURE_YES = new RegExp(
  String.raw`^${MEASURE_PREFIX}yes(?:\s*[/,].*)?$|^(?:for|approved?|in favou?r|retain)$`,
  "i",
);
const MEASURE_NO = new RegExp(
  String.raw`^${MEASURE_PREFIX}no(?:\s*[/,].*)?$|^(?:against|reject(?:ed)?|opposed?|do not retain)$`,
  "i",
);

/**
 * Which side of a measure a choice is, however the office words it: "Yes",
 * "NO", "Bonds Yes", "Bonds - No", "Levy Yes", "Be Retained No", "Yes/For",
 * "No/Against", "For", "Against", "Approve", "Rejected", "Yes, in favor of
 * the question". Undefined for anything else (a person, "No Candidate Filed").
 */
export function measureSide(name: string): "yes" | "no" | undefined {
  const text = name.trim();
  if (MEASURE_YES.test(text)) return "yes";
  if (MEASURE_NO.test(text)) return "no";
  return undefined;
}

/** Whether every choice is a side of a measure. */
function allSides(names: readonly string[]): boolean {
  return names.length > 0 && names.every((x) => measureSide(x) !== undefined);
}

/** One CSV line's fields (quoted with "", quotes doubled inside). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** A contest's key from its name, when the feed has no id: "Measure A – City of X" → "measure-a-city-of-x". */
function nameKey(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "contest"
  );
}

/**
 * A livevoterturnout.com `summary_<n>.csv`: a title line, the county's name, a
 * header, then one row per choice (`Contest Name`, `Candidate Name`, `Party`,
 * `Total Votes`, `Number Of Precincts`, `Precincts Reported`, sometimes
 * `Vote For`; the vote-type columns differ by county). A leading `*` on a name
 * marks the incumbent; Orange adds the party after the name.
 */
export function parseLvtCsv(text: string): CountyContest[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /^\s*"?contest name"?\s*,/i.test(l));
  if (headerAt < 0) throw new Error("Unexpected answer from the county (no results table)");
  const header = csvFields(lines[headerAt] ?? "").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [cContest, cName, cParty, cVotes, cPrec, cRep, cFor] = [
    col("contest name"),
    col("candidate name"),
    col("party"),
    col("total votes"),
    col("number of precincts"),
    col("precincts reported"),
    col("vote for"),
  ];
  if (cContest < 0 || cName < 0 || cVotes < 0)
    throw new Error("Unexpected answer from the county (missing columns)");
  const contests = new Map<string, CountyContest>();
  const keys = new Set<string>();
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    const f = csvFields(line);
    const title = f[cContest]?.trim();
    const raw = f[cName]?.trim();
    if (!title || raw === undefined || f.length < header.length - 2) continue;
    let contest = contests.get(title);
    if (!contest) {
      let key = nameKey(title);
      for (let i = 2; keys.has(key); i++) key = `${nameKey(title)}-${i}`;
      keys.add(key);
      contest = {
        key,
        title,
        measure: false,
        voteFor: cFor >= 0 ? n(f[cFor]) : 0,
        choices: [],
      };
      if (cPrec >= 0) contest.precincts = { total: n(f[cPrec]), reporting: n(f[cRep]) };
      contests.set(title, contest);
    }
    const party = cParty >= 0 ? f[cParty]?.trim() : "";
    let name = raw.replace(/^\*\s*/, "");
    if (party) name = name.replace(new RegExp(`\\s*\\(${party.replace(/\W/g, "")}\\)$`), "");
    contest.choices.push({
      name,
      ...(party ? { party } : {}),
      votes: n(f[cVotes]),
      percent: 0,
      ...(raw.startsWith("*") ? { incumbent: true } : {}),
    });
  }
  countywidePrecincts([...contests.values()], lines.slice(0, headerAt + 2));
  return [...contests.values()].map((c) => {
    const total = c.choices.reduce((s, x) => s + x.votes, 0);
    for (const x of c.choices)
      x.percent = total > 0 ? Math.round((x.votes / total) * 10000) / 100 : 0;
    c.measure = allSides(c.choices.map((x) => x.name));
    if (c.measure) c.voteFor = 0;
    return c;
  });
}

/**
 * Riverside's `Precincts Reported` is the county's, on every row (1206 beside
 * a city ward's 11 precincts), not the contest's. When any contest claims more
 * precincts reporting than it has, the column is read that way: every contest
 * is fully reported once the whole county is; before then only contests
 * across the whole county (as many precincts as the county) keep a figure,
 * since a part of the county's share isn't in the file.
 */
function countywidePrecincts(contests: CountyContest[], head: string[]): void {
  if (!contests.some((c) => c.precincts && c.precincts.reporting > c.precincts.total)) return;
  const countyTotal = Math.max(...contests.map((c) => c.precincts?.total ?? 0));
  const row = head
    .map(csvFields)
    .find((f) => /^total precincts reported$/i.test(f[0]?.trim() ?? ""));
  const countyReporting = row
    ? n(row[1])
    : Math.max(...contests.map((c) => c.precincts?.reporting ?? 0));
  const complete = countyTotal > 0 && countyReporting >= countyTotal;
  for (const c of contests) {
    if (!c.precincts) continue;
    if (complete) c.precincts.reporting = c.precincts.total;
    else if (c.precincts.total === countyTotal) c.precincts.reporting = countyReporting;
    else delete c.precincts;
  }
}

/** A Clarity `summary.json`: every contest of the election. */
export function parseClaritySummary(raw: unknown): CountyContest[] {
  if (!Array.isArray(raw))
    throw new Error("Unexpected answer from the county (not a contest list)");
  return (raw as WireClarityContest[]).flatMap((c) => {
    if (!c || typeof c !== "object" || c.K === undefined || !c.C) return [];
    const names = c.CH ?? [];
    const choices = names.map((name, i) => {
      const party = c.P?.[i]?.trim();
      return {
        name: name.trim(),
        ...(party ? { party } : {}),
        votes: n(c.V?.[i]),
        percent: n(c.PCT?.[i]),
      };
    });
    const measure = allSides(names);
    const contest: CountyContest = {
      key: String(c.K),
      title: c.C.trim(),
      ...(c.CAT ? { category: c.CAT } : {}),
      measure,
      voteFor: n(c.VF),
      choices,
    };
    if (c.TP !== undefined) contest.precincts = { total: n(c.TP), reporting: n(c.PR) };
    return [contest];
  });
}

interface WireText {
  languageId?: string;
  text?: string;
}

interface WireBallotItem {
  id?: string;
  name?: WireText[];
  voteFor?: WireText[];
  contestType?: string;
  contestGroupId?: string | null;
  reportingStatus?: { reportingUnits?: number; totalUnits?: number } | null;
  summaryResults?: {
    ballotOptions?: {
      name?: WireText[];
      voteCount?: number;
      party?: { abbreviation?: string | null; name?: WireText[] | null } | null;
    }[];
  } | null;
}

interface WireContestGroup {
  id?: string;
  groupHeading?: WireText[];
}

function english(texts: WireText[] | undefined): string {
  return (texts?.find((t) => t.languageId === "en") ?? texts?.[0])?.text?.trim() ?? "";
}

/**
 * A candidate as an Enhanced Voting site names one, apart from what the site
 * put in the name: the party again in parentheses ("Mike Collins (Rep)",
 * "Katie Hobbs (DEM) / John Giles (PND)" keeps its ticket), and Georgia's
 * "(I)" for the incumbent.
 */
function optionName(text: string, party: string | undefined): { name: string; incumbent: boolean } {
  let name = text.trim();
  const escaped = party?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escaped && !name.includes(" / "))
    name = name.replace(new RegExp(String.raw`\s*\(${escaped}\)\s*$`, "i"), "");
  const incumbent = /\s*\(I\)\s*$/.test(name);
  if (incumbent) name = name.replace(/\s*\(I\)\s*$/, "");
  return { name: name.replace(/\s+/g, " "), incumbent };
}

const COUNT_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** How many to elect, from "Vote for 2" or "Vote for only one"; 0 when it doesn't say. */
function voteForOf(text: string): number {
  const digits = text.match(/\d+/)?.[0];
  if (digits) return n(digits);
  const word = COUNT_WORDS.findIndex((w) => new RegExp(String.raw`\b${w}\b`, "i").test(text));
  return word + 1;
}

/**
 * An Enhanced Voting site's `…/elections/<slug>/<id>/data` (Sacramento
 * County's, and the state sites of Arizona, Georgia, Idaho, Rhode Island,
 * Utah, Virginia and Washington): `ballotItems[]`, each with its name (per
 * language), "Vote for N", reporting units, and options with their votes.
 * `election.asOf` says when the count was published,
 * `election.isOfficialResults` whether it is certified. A site that groups
 * its contests ("Federal", "State Measures") gives each its group as
 * `category`. What a contest's units are (precincts for a county, counties or
 * towns for a state) is the site's to say; they are in `precincts` either way.
 */
export function parseResultsApi(raw: unknown): {
  contests: CountyContest[];
  asOf?: number;
  official?: boolean;
} {
  const data = raw as {
    ballotItems?: WireBallotItem[];
    election?: { asOf?: string; isOfficialResults?: boolean; contestGroups?: WireContestGroup[] };
  } | null;
  if (!data || !Array.isArray(data.ballotItems))
    throw new Error("Unexpected answer from the county (no ballot items)");
  const groups = new Map(
    (data.election?.contestGroups ?? []).flatMap((g): [string, string][] => {
      const heading = english(g.groupHeading);
      return g.id && heading ? [[g.id, heading]] : [];
    }),
  );
  const contests = data.ballotItems.flatMap((item): CountyContest[] => {
    const title = english(item.name);
    if (!item.id || !title) return [];
    const options = item.summaryResults?.ballotOptions ?? [];
    const total = options.reduce((s, o) => s + n(o.voteCount), 0);
    const choices: CountyChoice[] = options.map((o) => {
      // Utah fills in only the party's whole name.
      const party =
        o.party?.abbreviation?.trim() || english(o.party?.name ?? undefined) || undefined;
      const votes = n(o.voteCount);
      const { name, incumbent } = optionName(english(o.name), o.party?.abbreviation?.trim());
      return {
        name,
        ...(party ? { party } : {}),
        votes,
        percent: total > 0 ? Math.round((votes / total) * 10000) / 100 : 0,
        ...(incumbent ? { incumbent } : {}),
      };
    });
    const measure = item.contestType === "BallotMeasure" || allSides(choices.map((c) => c.name));
    const status = item.reportingStatus;
    const category = item.contestGroupId ? groups.get(item.contestGroupId) : undefined;
    return [
      {
        key: item.id,
        title,
        ...(category ? { category } : {}),
        measure,
        voteFor: measure ? 0 : voteForOf(english(item.voteFor)),
        ...(status
          ? { precincts: { total: n(status.totalUnits), reporting: n(status.reportingUnits) } }
          : {}),
        choices,
      },
    ];
  });
  const asOf = Date.parse(data.election?.asOf ?? "");
  const official = data.election?.isOfficialResults;
  return {
    contests,
    ...(Number.isFinite(asOf) ? { asOf } : {}),
    ...(typeof official === "boolean" ? { official } : {}),
  };
}

interface WireLaContest {
  Title?: string;
  Type?: string;
  VoteFor?: string;
  Candidates?: { Name?: string; Party?: string; Votes?: number | string }[];
}

const pacificParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** California's clock minus UTC at an instant, in ms (−8 h in winter, −7 in summer). */
function pacificOffset(at: number): number {
  const p: Record<string, number> = {};
  for (const x of pacificParts.formatToParts(at)) p[x.type] = Number(x.value);
  const wall = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  // The parts carry whole seconds only.
  return wall - (at - (((at % 1000) + 1000) % 1000));
}

/**
 * A time as a county writes it, as ms since epoch. One with no zone
 * (`2026-11-04T03:11:55.89`, Los Angeles) is California's wall clock, by the
 * real zone rules; one with a zone or `Z` is read as it says.
 */
export function californiaTime(text: string | undefined): number | undefined {
  const t = text?.trim() ?? "";
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/);
  if (!m) {
    const at = Date.parse(t);
    return t && /(z|[+-]\d{2}:?\d{2})$/i.test(t) && Number.isFinite(at) ? at : undefined;
  }
  const [y, mo, d, h, mi, s, frac] = m.slice(1).map((x) => Number(x ?? 0));
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d, h, mi, s, Math.round((frac ?? 0) * 1000));
  // The offset at the wall time read as UTC is right except near a DST
  // change; taking it again at that first guess settles it.
  let at = wall - pacificOffset(wall);
  at = wall - pacificOffset(at);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * Los Angeles' `electionresults/json?electionid=<n>`:
 * `Election.ContestGroups[].{Name, Contests[].{Title, Type, VoteFor, Candidates[]}}`,
 * and beside `Election` a `Timestamp` with no zone (California time) for when
 * the count was published. No contest ids, no precincts: contests are keyed
 * by group and title.
 */
export function parseLaVote(raw: unknown): { contests: CountyContest[]; asOf?: number } {
  const data = raw as { Election?: { ContestGroups?: unknown }; Timestamp?: unknown } | null;
  const groups = data?.Election?.ContestGroups;
  if (!Array.isArray(groups)) throw new Error("Unexpected answer from the county (no contests)");
  const asOf = typeof data?.Timestamp === "string" ? californiaTime(data.Timestamp) : undefined;
  const contests = laContests(groups as { Name?: string; Contests?: WireLaContest[] }[]);
  return asOf !== undefined ? { contests, asOf } : { contests };
}

function laContests(groups: { Name?: string; Contests?: WireLaContest[] }[]): CountyContest[] {
  const keys = new Set<string>();
  return groups.flatMap((g) =>
    (g.Contests ?? []).flatMap((c): CountyContest[] => {
      const title = c.Title?.replace(/\s+/g, " ").trim();
      if (!title) return [];
      let key = nameKey(`${g.Name ?? ""} ${title}`);
      for (let i = 2; keys.has(key); i++) key = `${nameKey(`${g.Name ?? ""} ${title}`)}-${i}`;
      keys.add(key);
      const options = c.Candidates ?? [];
      const total = options.reduce((s, o) => s + n(o.Votes), 0);
      const choices: CountyChoice[] = options.map((o) => {
        const party = o.Party?.trim();
        const votes = n(o.Votes);
        return {
          name: (o.Name ?? "").replace(/\s+/g, " ").trim(),
          ...(party && !/^non[\s-]?partisan$/i.test(party) ? { party } : {}),
          votes,
          percent: total > 0 ? Math.round((votes / total) * 10000) / 100 : 0,
        };
      });
      const measure = c.Type === "Measure" || allSides(choices.map((x) => x.name));
      return [
        {
          key,
          title,
          ...(g.Name ? { category: g.Name } : {}),
          measure,
          voteFor: measure ? 0 : n(c.VoteFor?.match(/\d+/)?.[0]),
          choices,
        },
      ];
    }),
  );
}

// ---- Results pages (HTML) -----------------------------------------------------

/** An HTML fragment's text: tags dropped, entities decoded, spaces collapsed. */
export function htmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
      const r = ref.toLowerCase();
      if (r.startsWith("#x")) return String.fromCodePoint(Number.parseInt(r.slice(2), 16));
      if (r.startsWith("#")) return String.fromCodePoint(Number(r.slice(1)));
      return HTML_ENTITIES[r] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A 12-hour California wall-clock time as ms since epoch. */
function californiaClock(
  y: number,
  mo: number,
  d: number,
  h12: number,
  mi: number,
  s: number,
  ampm: string,
): number | undefined {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h12 >= 1 && h12 <= 12)) return undefined;
  const h = (h12 % 12) + (/^p/i.test(ampm) ? 12 : 0);
  const pad = (x: number) => String(x).padStart(2, "0");
  return californiaTime(`${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`);
}

/** Choices' percents of the votes counted among them. */
function withPercents(choices: CountyChoice[]): CountyChoice[] {
  const total = choices.reduce((s, c) => s + c.votes, 0);
  for (const c of choices) c.percent = total > 0 ? Math.round((c.votes / total) * 10000) / 100 : 0;
  return choices;
}

/** A unique key from a contest's name, numbered when two contests share one. */
function uniqueKey(keys: Set<string>, name: string): string {
  let key = nameKey(name);
  for (let i = 2; keys.has(key); i++) key = `${nameKey(name)}-${i}`;
  keys.add(key);
  return key;
}

/**
 * livevoterturnout.com's results page (`en/Index_<n>.html`), for a county that
 * publishes no `summary_<n>.csv`. One `listid_<race id>` block per contest:
 * `race-title`, `(VOTE FOR n)`, and a row per choice (`data-candidate`,
 * `data-votes`, keyed by `data-contestant`). No precincts or parties per
 * contest. Its time is `lblLastPublishedDateTime` (`11/4/2026 1:11:00 AM`,
 * California). Throws when the page has no contest it can read: a changed
 * layout must not pass as an empty count.
 */
export function parseLvtHtml(html: string): { contests: CountyContest[]; asOf?: number } {
  const blocks = html.split(/<div id="listid_(?=\d+")/).slice(1);
  const contests = blocks.flatMap((block): CountyContest[] => {
    const id = block.match(/^(\d+)"/)?.[1];
    const title = htmlText(block.match(/class="race-title">([\s\S]*?)<\/span>/)?.[1] ?? "");
    if (!id || !title) return [];
    const names = new Map<string, string>();
    for (const m of block.matchAll(
      // A measure's "NO" is the negative of its "YES" (`-6880`).
      /data-contestant="(-?\d+)" data-candidate="true"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g,
    ))
      if (m[1]) names.set(m[1], htmlText(m[2] ?? ""));
    const choices: CountyChoice[] = [];
    for (const m of block.matchAll(
      /data-contestant="(-?\d+)" data-votes="true"[^>]*>([\s\S]*?)<\/td>/g,
    )) {
      const raw = names.get(m[1] ?? "");
      if (raw === undefined) continue;
      choices.push({
        name: raw.replace(/^\*\s*/, ""),
        votes: n(htmlText(m[2] ?? "")),
        percent: 0,
        ...(raw.startsWith("*") ? { incumbent: true } : {}),
      });
    }
    if (choices.length === 0) return [];
    const measure = allSides(choices.map((c) => c.name));
    return [
      {
        key: id,
        title,
        measure,
        voteFor: measure ? 0 : n(block.match(/\(VOTE FOR (\d+)\)/i)?.[1]),
        choices: withPercents(choices),
      },
    ];
  });
  if (contests.length === 0)
    throw new Error("Unexpected answer from the county (no contests on its results page)");
  const t = html.match(
    /id="lblLastPublishedDateTime"[^>]*>\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)/i,
  );
  const asOf = t
    ? californiaClock(
        Number(t[3]),
        Number(t[1]),
        Number(t[2]),
        Number(t[4]),
        Number(t[5]),
        Number(t[6] ?? 0),
        t[7] ?? "",
      )
    : undefined;
  return asOf !== undefined ? { contests, asOf } : { contests };
}

/**
 * Alameda's results page (`rovresults/<election>/index.htm`): `<h2>` groups
 * (Federal, State, Judicial, School, City, Districts, Measures), each race a
 * `racePanelHeading` followed by "N of M Precincts … Reported", "Vote for One
 * (1)", a measure's "Needs 2/3 majority Yes votes to pass", and a
 * `resultsRow` per choice with its votes. Ranked-choice races show first
 * choices only (their titles end "(RCV)"). "Last Updated: Wednesday, November
 * 04, 2026; 2:07 AM" is the time, California's. Registration & Turnout is
 * left out. Throws when no race reads: a changed layout must not pass as an
 * empty count.
 */
export function parseAcvoteHtml(html: string): { contests: CountyContest[]; asOf?: number } {
  const marks = [
    ...html.matchAll(/<h2>([\s\S]*?)<\/h2>|class="racePanelHeading">([\s\S]*?)<\/h[3-6]>/gi),
  ];
  const keys = new Set<string>();
  const contests: CountyContest[] = [];
  let category = "";
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (!m) continue;
    if (m[1] !== undefined) {
      category = htmlText(m[1]);
      continue;
    }
    const title = htmlText(m[2] ?? "");
    if (!title || /registration|turnout/i.test(category)) continue;
    const end = marks[i + 1]?.index ?? html.length;
    const body = html.slice((m.index ?? 0) + m[0].length, end);
    const text = htmlText(body);
    const prec = text.match(/([\d,]+) of ([\d,]+) Precincts/i);
    const precincts = prec ? { precincts: { total: n(prec[2]), reporting: n(prec[1]) } } : {};
    // The state propositions share one table: a row each, with YES and NO columns.
    if (/colspan="2"[^>]*>\s*YES\s*</i.test(body)) {
      for (const row of body.matchAll(
        /<th[^>]*class="resultsRow[^"]*"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
      )) {
        const name = htmlText(row[1] ?? "");
        if (!name) continue;
        contests.push({
          key: uniqueKey(keys, name),
          title: name,
          ...(category ? { category } : {}),
          measure: true,
          voteFor: 0,
          ...precincts,
          choices: withPercents([
            { name: "Yes", votes: n(htmlText(row[2] ?? "")), percent: 0 },
            { name: "No", votes: n(htmlText(row[3] ?? "")), percent: 0 },
          ]),
        });
      }
      continue;
    }
    const choices: CountyChoice[] = [];
    for (const row of body.matchAll(
      /<th[^>]*class="resultsRow[^"]*"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    ))
      choices.push({ name: htmlText(row[1] ?? ""), votes: n(htmlText(row[2] ?? "")), percent: 0 });
    if (choices.length === 0) continue;
    const measure = allSides(choices.map((c) => c.name));
    const needs = text.match(/Needs ([^.]*?) Yes votes/i)?.[1] ?? "";
    const threshold = /2\s*\/\s*3|two[\s-]*thirds/i.test(needs)
      ? "2/3"
      : /\b55\s*%/.test(needs)
        ? "55%"
        : undefined;
    contests.push({
      key: uniqueKey(keys, title),
      title,
      ...(category ? { category } : {}),
      measure,
      // "Vote for One (1) Only", "Vote for no more than Two (2)".
      voteFor: measure ? 0 : n(text.match(/Vote for [^()]*\((\d+)\)/i)?.[1]),
      ...precincts,
      ...(measure && threshold ? { threshold } : {}),
      choices: withPercents(choices),
    });
  }
  if (contests.length === 0)
    throw new Error("Unexpected answer from the county (no races on its results page)");
  const t = html.match(
    /Last Updated:\s*(?:[a-z]+,\s*)?([a-z]+)\s+(\d{1,2}),\s*(\d{4})[;,]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)/i,
  );
  const asOf = t
    ? californiaClock(
        Number(t[3]),
        MONTHS.indexOf((t[1] ?? "").toLowerCase()) + 1,
        Number(t[2]),
        Number(t[4]),
        Number(t[5]),
        Number(t[6] ?? 0),
        t[7] ?? "",
      )
    : undefined;
  return asOf !== undefined ? { contests, asOf } : { contests };
}

/** Whether a contest is one the Secretary of State already reports (state and federal offices, statewide propositions). */
export function isStateContest(c: CountyContest): boolean {
  // Judges are on the ballot statewide but the Secretary of State's results
  // don't carry them: the county's count is the place to see them.
  if (JUDGE_TITLE.test(c.title)) return false;
  // Counties name their groups differently: "State and Federal", "Federal",
  // "State", "State Propositions"; Marin files everything under "Results".
  if (
    c.category &&
    /^(state|federal|state\s*(and|&)\s*federal|(state\s+)?propositions?)$/i.test(c.category.trim())
  )
    return true;
  // San Bernardino starts every state contest with "State of California".
  const title = c.title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^state of california,?\s+/i, "");
  return STATE_TITLE.test(title);
}

const JUDGE_TITLE = /justice|judge|court of appeal|supreme court|superior court|app\.? dist/i;

/** Titles of the contests the Secretary of State reports, however a county words them. */
const STATE_TITLE =
  /^(governor|lieutenant governor|secretary of state|controller|treasurer(?![\s-]*tax)|attorney general|insurance commissioner|(state )?superintendent of public instruction)\b|united states (senator|representative)|u\.? ?s\.? (senator|representative)|representative in congress|congressional district|state senat|state assembly|member of (the )?assembly|assembly member|board (of )?equalization|^\d+(st|nd|rd|th) (assembly|senate|state senate|congressional) district\b|^(assembly|state senate|senate|congressional) district \d+\b|^(state |[a-z ]+ county )?prop(osition)?\.? ?\d+\b|^state measure \d+\b/i;
