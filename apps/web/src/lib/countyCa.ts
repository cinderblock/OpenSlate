import {
  CA_COUNTY_FEEDS,
  type CountyContest,
  type CountyFeed,
  claritySummaryPath,
  isStateContest,
  parseClaritySummary,
  parseClarityVersion,
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
        name: c.title,
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
        incumbent: false,
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

/** What a contest is for, and its district: "City of Sunnyvale Council, District 3" → Sunnyvale, 3. */
export function contestEntity(title: string): { entity: string; district?: string } {
  let t = title;
  const measure = t.match(/^measure\s+[a-z0-9-]+\s+-\s+(.*)$/i);
  if (measure?.[1]) return { entity: measure[1].split(",")[0] ?? "" };
  t = t.replace(/^mayor,\s*/i, "");
  const [entity = "", ...rest] = t.split(",");
  const d = rest
    .join(",")
    .match(/\b(?:district|d|trustee area|ta|ward|division|seat)\s*([a-z0-9]+)\b/i);
  return d?.[1] ? { entity, district: d[1].toLowerCase() } : { entity };
}

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
  return localContests(contests).filter((c) => {
    if (c.category && /judicial/i.test(c.category)) return true;
    const { entity, district } = contestEntity(c.title);
    const core = coreName(entity);
    if (!core) return false;
    // The county's own ("Santa Clara County BOE"), not its namesake city's.
    if (core === county && /\bcounty\b/i.test(entity)) return true;
    if (!names.has(core)) return false;
    if (
      district &&
      council &&
      /council/i.test(c.title) &&
      core === councilCity &&
      district !== council[1].toLowerCase()
    )
      return false;
    return true;
  });
}

// ---- Fetching ----------------------------------------------------------------

function baseFor(slug: string, feed: CountyFeed): string {
  return getRoutingMode(PROVIDER) === "direct"
    ? feed.base
    : `${PROVIDERS[PROVIDER]?.proxyUrl ?? ""}/${slug}`;
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
  const modified = Date.parse(res.headers.get("Last-Modified") ?? "");
  const out: CountyResults = {
    county: slug,
    version,
    ...(Number.isFinite(modified) ? { updated: modified } : {}),
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
