import {
  CA_COUNTY_FEEDS,
  type CountyContest,
  type CountyFeed,
  claritySummaryPath,
  isStateContest,
  lvtSummaryPath,
  parseClaritySummary,
  parseClarityVersion,
  parseLaVote,
  parseLvtCsv,
  parseResultsApi,
  type Subject,
  samePerson,
} from "@openslate/core";
import type { Area } from "./jurisdictions";
import { getRoutingMode, PROVIDERS } from "./routing";
import { type ContestResult, countySlug, LIVE_REFRESH_MS } from "./sosCa";

/**
 * California counties' own election-night results (`@openslate/core/countyResults`
 * lists the counties and parses their feeds), for local races the Secretary of
 * State doesn't carry: city, county, school, special districts, local measures.
 * Fetched through the project's relay (a minute's cache) unless the user chose
 * their own connection in Settings; never switched to direct on failure.
 *
 * A county contest's id in the watch list is `county-ca/<county slug>/<feed key>`.
 * Pure helpers unit-tested in test/countyCa.test.ts.
 */

const PROVIDER = "county-ca";
const PREFIX = "county-ca/";

export interface CountyContestId {
  county: string;
  key: string;
}

export function countyContestId(county: string, key: string): string {
  return `${PREFIX}${county}/${key}`;
}

export function parseCountyContestId(id: string): CountyContestId | null {
  const m = id.match(/^county-ca\/([a-z-]+)\/([^/]+)$/);
  return m?.[1] && m[2] ? { county: m[1], key: m[2] } : null;
}

/** The county's feed, by its name (`Santa Clara`) or slug, when OpenSlate reads one. */
export function countyFeed(county: string | undefined): { slug: string; feed: CountyFeed } | null {
  if (!county) return null;
  const slug = countySlug(county);
  const feed = Object.hasOwn(CA_COUNTY_FEEDS, slug) ? CA_COUNTY_FEEDS[slug] : undefined;
  return feed ? { slug, feed } : null;
}

/** The counties whose own count OpenSlate reads, by name, sorted. */
export function feedCountyNames(): string[] {
  return Object.values(CA_COUNTY_FEEDS)
    .map((f) => f.name)
    .sort();
}

export interface CountyResults {
  county: string;
  /** The feed's own version (Clarity's), so an unchanged count isn't parsed twice. */
  version: string;
  /** When the county published this count, as the server says (`Last-Modified`), ms since epoch. */
  updated?: number;
  contests: CountyContest[];
}

// ---- To the Live page's shape ------------------------------------------------

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function countyContestResult(c: CountyContest, updated?: number): ContestResult {
  const p = c.precincts;
  const percent = p && p.total > 0 ? Math.round((p.reporting / p.total) * 1000) / 10 : undefined;
  const reporting = {
    text: p ? `${p.reporting} of ${p.total} precincts reporting` : "",
    ...(percent !== undefined ? { percent } : {}),
    ...(updated ? { time: timeFmt.format(updated) } : {}),
  };
  if (c.measure) {
    const yes = c.choices.find((x) => /yes/i.test(x.name));
    const no = c.choices.find((x) => /no/i.test(x.name));
    return {
      kind: "measure",
      title: c.title,
      reporting,
      measure: {
        number: "",
        // The card's heading already says it.
        name: "",
        yes: yes?.votes ?? 0,
        no: no?.votes ?? 0,
        yesPercent: yes?.percent ?? 0,
        noPercent: no?.percent ?? 0,
      },
    };
  }
  return {
    kind: "candidates",
    title: c.title,
    reporting,
    candidates: c.choices
      .map((x) => ({
        name: x.name,
        ...(x.party ? { party: x.party } : {}),
        votes: x.votes,
        percent: x.percent,
        incumbent: Boolean(x.incumbent),
      }))
      .sort((a, b) => b.votes - a.votes),
  };
}

/** The county's contests the Secretary of State doesn't already report. */
export function localContests(contests: readonly CountyContest[]): CountyContest[] {
  return contests.filter((c) => !isStateContest(c));
}

// ---- Which local contests are a place's --------------------------------------

/** Generic words dropped before comparing names: "San José Unified SD" ≈ "San Jose Unified School District". */
const GENERIC =
  /\b(city|town|of|the|council|mayor|county|unified|union|joint|high|elementary|school|schools|community|college|district|sd|usd|hsd|esd|uhsd|ccd|boe|board|education)\b/g;

export function coreName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(GENERIC, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A title as plain words, padded so a name can be found whole: " city of san jose council district 3 ". */
export function titleWords(title: string): string {
  return ` ${title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** The district a seat is for, however the county words it: "District 3", "D2", "TA 4", "Ward 1". */
export function titleDistrict(title: string): string | undefined {
  const words = titleWords(title);
  const m = words.match(/ (?:district|d|trustee area|ta|ward|division|seat) ?(?:no )?([a-z]|\d+) /);
  if (m?.[1]) return m[1];
  // "3rd District", "Fifth District" (Los Angeles).
  const ordinal = words.match(/ (\d+)(?:st|nd|rd|th) district /);
  if (ordinal?.[1]) return String(Number(ordinal[1]));
  const word = words.match(/ ([a-z]+) district /)?.[1];
  const at = word ? ORDINALS.indexOf(word) : -1;
  return at >= 0 ? String(at + 1) : undefined;
}

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
];

/**
 * The names a place answers to: its city and its districts' names. Not its
 * county's: "Santa Clara" the county would otherwise match Santa Clara the city.
 */
export function placeNames(area: Pick<Area, "localities" | "labels">): string[] {
  const out = new Set<string>();
  for (const path of area.localities) {
    const leaf = path.split("/").pop() ?? "";
    if (leaf.endsWith("-county")) continue;
    const core = coreName(leaf.replace(/-/g, " "));
    if (core) out.add(core);
  }
  for (const label of Object.values(area.labels ?? {})) {
    // "Sunnyvale council district 3" names the city; a school district names itself.
    const core = coreName(label.replace(/\b(council|supervisorial)\s+district\s+\S+$/i, ""));
    if (core) out.add(core);
  }
  return [...out];
}

/** Offices every voter in the county elects (no district): " sheriff ", " county measure a ". */
const COUNTYWIDE_OFFICE =
  /^ (county )?(sheriff|assessor|district attorney|county clerk|clerk recorder|auditor controller|treasurer tax collector|superintendent of schools|public defender|county measure [a-z]+)\b/;

/**
 * A contest for the whole county ("Santa Clara County BOE", "County of Marin
 * Measure"), not one for part of it that carries its name ("NORTH ORANGE
 * COUNTY COMMUNITY COLLEGE DISTRICT", "Orange County Water District").
 */
export function countyOwn(words: string, county: string): boolean {
  if (!county) return false;
  if (words.includes(` county of ${county} `)) return true;
  const at = words.indexOf(` ${county} county `);
  if (at < 0) return false;
  const before = words.slice(0, at);
  const after = words.slice(at + county.length + 9);
  if (/ (north|south|east|west|central|northern|southern|eastern|western)$/.test(before))
    return false;
  return !/^(water|sanitation|sanitary|fire|cemetery|recreation|park|vector|flood|transit|transportation|community college|junior college|hospital|health) /.test(
    after,
  );
}

/**
 * The county's local contests a place votes on, as far as names tell: its
 * city's and its school districts' seats and measures, the county's own, and
 * the courts. A council seat for another district of the city is left out when
 * the place's council district is known. Over-inclusive rather than missing one:
 * the voter removes what isn't theirs.
 */
export function contestsForPlace(
  contests: readonly CountyContest[],
  area: Pick<Area, "localities" | "labels" | "districts">,
  countyName: string,
): CountyContest[] {
  const names = new Set(placeNames(area));
  const county = coreName(countyName);
  const council = Object.entries(area.districts).find(([k]) => k.endsWith("/council"));
  const councilCity = council
    ? coreName(council[0].split("/").at(-2)?.replace(/-/g, " ") ?? "")
    : "";
  const has = (words: string, name: string) => name !== "" && words.includes(` ${name} `);
  return localContests(contests).filter((c) => {
    const words = titleWords(c.title);
    // The courts, and the county's own offices and measures ("Santa Clara County BOE",
    // "County of Marin Measure"), not its namesake city's.
    // Groups for the whole county ("County", "County Measures", "Sheriff"), and
    // countywide offices however they're titled.
    if (c.category && /judicial|^county( measures?)?$|^sheriff$/i.test(c.category.trim()))
      return true;
    if (COUNTYWIDE_OFFICE.test(words)) return true;
    if (/ (superior court|court of appeal|supreme court) /.test(words)) return true;
    if (countyOwn(words, county)) return true;
    if (![...names].some((n) => has(words, n))) return false;
    // Another council district of the place's own city.
    const district = titleDistrict(c.title);
    if (
      council &&
      district &&
      / council /.test(words) &&
      has(words, councilCity) &&
      district !== council[1].toLowerCase().replace(/^0+/, "")
    )
      return false;
    return true;
  });
}

// ---- The catalog's race for a county contest ---------------------------------

/** What a catalog race needs to be matched: its key, identity, how the ballot prints it, and its choices. */
export interface CatalogRace {
  key: string;
  subject: Pick<Subject, "title" | "jurisdiction" | "election" | "ballot">;
  ballot?: { number?: string };
  election?: string;
  jurisdiction?: string;
  choices: readonly { choice: string }[];
}

/** A measure's letter as the county titles it: "Measure K - …", "… - MEASURE W", "A – Laguna Beach…". */
export function measureLetter(title: string): string | undefined {
  const m =
    title.match(/\bmeasure\s+([a-z]{1,3})\b(?!\s*[a-z])/i) ??
    title.match(/^([a-z]{1,3})\s*[–-]\s/i);
  return m?.[1]?.toUpperCase();
}

const NOT_A_PERSON = /^(yes|no|write[\s-]*in|bonds?\s*-?\s*(yes|no))$/i;

/**
 * The catalog race a county contest is, when one clearly is: the same people
 * on it (at least two of the county's candidates, or all of them when there
 * are fewer), or for a measure the same letter in the same place. Only this
 * election's California races are considered.
 */
export function catalogRaceFor<R extends CatalogRace>(
  contest: CountyContest,
  races: readonly R[],
  countyName: string,
  election: string,
): R | undefined {
  const here = races.filter((r) => {
    const e = r.election ?? r.subject.election;
    const j = r.jurisdiction ?? r.subject.jurisdiction ?? "";
    return e === election && j.startsWith("us/ca/");
  });
  if (contest.measure) {
    const letter = measureLetter(contest.title);
    if (!letter) return undefined;
    const words = titleWords(contest.title);
    const county = coreName(countyName);
    return here.find((r) => {
      const number = (r.ballot?.number ?? r.subject.ballot?.number ?? "").toUpperCase();
      if (number !== letter) return false;
      const leaf = (r.jurisdiction ?? r.subject.jurisdiction ?? "").split("/").at(-1) ?? "";
      if (leaf.endsWith("-county")) return coreName(leaf.replace(/-/g, " ")) === county;
      const name = coreName(leaf.replace(/-/g, " "));
      return name !== "" && words.includes(` ${name} `);
    });
  }
  const people = contest.choices.map((c) => c.name).filter((n) => !NOT_A_PERSON.test(n));
  if (people.length === 0) return undefined;
  const need = Math.min(2, people.length);
  let best: { race: R; hits: number } | undefined;
  for (const race of here) {
    const names = race.choices.map((c) => c.choice).filter(Boolean);
    if (names.length === 0) continue;
    const hits = people.filter((p) => names.some((n) => samePerson(p, n))).length;
    if (hits >= need && (!best || hits > best.hits)) best = { race, hits };
  }
  return best?.race;
}

// ---- Fetching ----------------------------------------------------------------

/** A feed without CORS (livevoterturnout.com) can only be read through the relay, whatever Settings say. */
function baseFor(slug: string, feed: CountyFeed): string {
  return feed.cors && getRoutingMode(PROVIDER) === "direct"
    ? feed.base
    : `${PROVIDERS[PROVIDER]?.proxyUrl ?? ""}/${slug}`;
}

function updatedOf(res: Response): { updated?: number } {
  const modified = Date.parse(res.headers.get("Last-Modified") ?? "");
  return Number.isFinite(modified) ? { updated: modified } : {};
}

/** livevoterturnout.com: the whole count in one CSV, its time in `Last-Modified`. */
async function fetchLvt(slug: string, feed: CountyFeed): Promise<CountyResults> {
  const res = await fetch(`${baseFor(slug, feed)}/${lvtSummaryPath(feed)}`);
  if (!res.ok) throw new Error(`The county answered ${res.status}`);
  const text = await res.text();
  const updated = updatedOf(res);
  const previous = lastRead.get(slug);
  // The same file again (same time, same length): keep what was read.
  const version = `${updated.updated ?? ""}:${text.length}`;
  if (previous?.version === version) return previous;
  const out: CountyResults = { county: slug, version, ...updated, contests: parseLvtCsv(text) };
  lastRead.set(slug, out);
  return out;
}

/** Sacramento's results API: every ballot item in one JSON, its time in `election.asOf`. */
/** Los Angeles: every contest in one JSON (through the relay: no CORS, and a query the relay adds). */
async function fetchLaVote(slug: string, feed: CountyFeed): Promise<CountyResults> {
  const res = await fetch(`${baseFor(slug, feed)}/json`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`The county answered ${res.status}`);
  const text = await res.text();
  const updated = updatedOf(res);
  const version = `${updated.updated ?? ""}:${text.length}:${text.slice(-64)}`;
  const previous = lastRead.get(slug);
  if (previous?.version === version) return previous;
  const out: CountyResults = {
    county: slug,
    version,
    ...updated,
    contests: parseLaVote(JSON.parse(text)),
  };
  lastRead.set(slug, out);
  return out;
}

async function fetchResultsApi(slug: string, feed: CountyFeed): Promise<CountyResults> {
  const res = await fetch(`${baseFor(slug, feed)}/data`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`The county answered ${res.status}`);
  const text = await res.text();
  const { contests, asOf } = parseResultsApi(JSON.parse(text));
  const updated = asOf ? { updated: asOf } : updatedOf(res);
  const out: CountyResults = {
    county: slug,
    version: `${updated.updated ?? ""}:${text.length}`,
    ...updated,
    contests,
  };
  const previous = lastRead.get(slug);
  if (previous?.version === out.version) return previous;
  lastRead.set(slug, out);
  return out;
}

/** The last count read per county: a version seen before isn't fetched again. */
const lastRead = new Map<string, CountyResults>();

/**
 * Through the route the user chose (Settings → Data routing). No automatic
 * switch to the other one on failure: a relay outage must not turn every open
 * page into direct traffic on a county's servers.
 */
export async function fetchCountyResults(slug: string): Promise<CountyResults> {
  const hit = Object.hasOwn(CA_COUNTY_FEEDS, slug) ? CA_COUNTY_FEEDS[slug] : undefined;
  if (!hit) throw new Error(`No results feed for ${slug}`);
  if (hit.kind === "lvt") return fetchLvt(slug, hit);
  if (hit.kind === "results-api") return fetchResultsApi(slug, hit);
  if (hit.kind === "lavote") return fetchLaVote(slug, hit);
  const base = baseFor(slug, hit);
  const verRes = await fetch(`${base}/current_ver.txt`);
  if (!verRes.ok) throw new Error(`The county answered ${verRes.status}`);
  const version = parseClarityVersion(await verRes.text());
  if (!version) throw new Error("The county hasn't published results yet");
  const previous = lastRead.get(slug);
  if (previous?.version === version) return previous;
  const res = await fetch(`${base}/${claritySummaryPath(version)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`The county answered ${res.status}`);
  const out: CountyResults = {
    county: slug,
    version,
    ...updatedOf(res),
    contests: parseClaritySummary(await res.json()),
  };
  lastRead.set(slug, out);
  return out;
}

/** Under the Live page's `sos-ca` key, so its refresh bar and "Check now" cover counties too. */
export function countyQueryOptions(slug: string) {
  return {
    queryKey: ["sos-ca", "county-ca", slug] as const,
    queryFn: () => fetchCountyResults(slug),
    staleTime: LIVE_REFRESH_MS / 2,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: (count: number) => count < 2,
  };
}
