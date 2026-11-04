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
 * publishes (every ballot item with its options' votes).
 */
export type CountyFeedKind = "clarity" | "lvt" | "results-api";

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
}

/** livevoterturnout.com's election folder and its number: `https://www.livevoterturnout.com/ENR/orangecaenr/24`. */
function lvt(name: string, folder: string, n: number, page: string): CountyFeed {
  return {
    name,
    kind: "lvt",
    base: `https://www.livevoterturnout.com/ENR/${folder}/${n}`,
    page,
    cors: false,
  };
}

/** The file a feed's whole count is in (after Clarity's version pointer). */
export function lvtSummaryPath(feed: CountyFeed): string {
  return `summary_${feed.base.split("/").pop()}.csv`;
}

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
  solano: lvt(
    "Solano",
    "solanocaenr",
    21,
    "https://www.livevoterturnout.com/ENR/solanocaenr/21/en/Index_21.html",
  ),
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
  if (feed.kind === "results-api") return inner === "data" ? 60 : null;
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

/** "Yes", "NO", "Bonds Yes", "Bonds - No". */
const YES_NO = /^(bonds?\s*-?\s*)?(yes|no)$/i;

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
  return [...contests.values()].map((c) => {
    const total = c.choices.reduce((s, x) => s + x.votes, 0);
    for (const x of c.choices)
      x.percent = total > 0 ? Math.round((x.votes / total) * 10000) / 100 : 0;
    c.measure = c.choices.length > 0 && c.choices.every((x) => YES_NO.test(x.name));
    if (c.measure) c.voteFor = 0;
    return c;
  });
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
    const measure = names.length > 0 && names.every((x) => YES_NO.test(x.trim()));
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
  reportingStatus?: { reportingUnits?: number; totalUnits?: number } | null;
  summaryResults?: {
    ballotOptions?: {
      name?: WireText[];
      voteCount?: number;
      party?: { abbreviation?: string | null } | null;
    }[];
  } | null;
}

function english(texts: WireText[] | undefined): string {
  return (texts?.find((t) => t.languageId === "en") ?? texts?.[0])?.text?.trim() ?? "";
}

/**
 * Sacramento's `…/elections/<county>/<id>/data`: `ballotItems[]`, each with
 * its name (per language), "Vote for N", reporting units, and options with
 * their votes. `election.asOf` says when the count was published.
 */
export function parseResultsApi(raw: unknown): { contests: CountyContest[]; asOf?: number } {
  const data = raw as { ballotItems?: WireBallotItem[]; election?: { asOf?: string } } | null;
  if (!data || !Array.isArray(data.ballotItems))
    throw new Error("Unexpected answer from the county (no ballot items)");
  const contests = data.ballotItems.flatMap((item): CountyContest[] => {
    const title = english(item.name);
    if (!item.id || !title) return [];
    const options = item.summaryResults?.ballotOptions ?? [];
    const total = options.reduce((s, o) => s + n(o.voteCount), 0);
    const choices: CountyChoice[] = options.map((o) => {
      const party = o.party?.abbreviation?.trim();
      const votes = n(o.voteCount);
      return {
        name: english(o.name),
        ...(party ? { party } : {}),
        votes,
        percent: total > 0 ? Math.round((votes / total) * 10000) / 100 : 0,
      };
    });
    const measure = choices.length > 0 && choices.every((c) => YES_NO.test(c.name));
    const status = item.reportingStatus;
    return [
      {
        key: item.id,
        title,
        measure,
        voteFor: measure ? 0 : n(english(item.voteFor).match(/\d+/)?.[0]),
        ...(status
          ? { precincts: { total: n(status.totalUnits), reporting: n(status.reportingUnits) } }
          : {}),
        choices,
      },
    ];
  });
  const asOf = Date.parse(data.election?.asOf ?? "");
  return Number.isFinite(asOf) ? { contests, asOf } : { contests };
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
  /^(governor|lieutenant governor|secretary of state|controller|treasurer(?![\s-]*tax)|attorney general|insurance commissioner|(state )?superintendent of public instruction)\b|united states (senator|representative)|u\.? ?s\.? (senator|representative)|representative in congress|congressional district|state senat|state assembly|member of (the )?assembly|assembly member|board (of )?equalization|^\d+(st|nd|rd|th) (assembly|senate|state senate|congressional) district\b|^(state |[a-z ]+ county )?prop(osition)?\.? ?\d+\b/i;
