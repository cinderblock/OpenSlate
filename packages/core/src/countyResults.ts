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

export type CountyFeedKind = "clarity";

export interface CountyFeed {
  /** The county's name, without "County" (`Santa Clara`). */
  name: string;
  kind: CountyFeedKind;
  /** The feed's root, no trailing slash. For Clarity, the election's folder. */
  base: string;
  /** The county's own results page, for people. */
  page: string;
}

/** Counties with a feed for the 2026-11-03 general, by slug (`santa-clara`, as the Secretary of State spells them). */
export const CA_COUNTY_FEEDS: Record<string, CountyFeed> = {
  "santa-clara": {
    name: "Santa Clara",
    kind: "clarity",
    base: "https://results.enr.clarityelections.com/CA/Santa_Clara/127570",
    page: "https://results.enr.clarityelections.com/CA/Santa_Clara/127570/web.345435/#/summary",
  },
};

/** The paths under a feed's base a client may ask for (the relay's allowlist). */
const FEED_PATHS: Record<CountyFeedKind, RegExp> = {
  clarity: /^(current_ver\.txt|\d{1,9}\/json\/en\/summary\.json)$/,
};

/** Whether a path under the feed's base is one OpenSlate reads, and how long its answer stays good. */
export function feedPathTtl(feed: CountyFeed, inner: string): number | null {
  if (!FEED_PATHS[feed.kind].test(inner)) return null;
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

const YES_NO = /^(yes|no|bonds? yes|bonds? no)$/i;

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

/** Whether a contest is one the Secretary of State already reports (state and federal offices, statewide propositions). */
export function isStateContest(c: CountyContest): boolean {
  if (c.category && /state\s*(and|&)\s*federal|proposition/i.test(c.category)) return true;
  return /^(state\s+)?proposition\b/i.test(c.title);
}
