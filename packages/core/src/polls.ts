import type { Subject } from "./schema";

// ---- Wire shapes (provider-agnostic) ----------------------------------------

export interface PollAnswer {
  choice: string;
  pct: number;
}

export interface Poll {
  id: string;
  /** Provider-specific kind tag (e.g. VoteHub uses "governor", "us-senator", "proposition-50"). */
  poll_type: string;
  pollster: string;
  sample_size?: number;
  population?: string;
  url?: string;
  created_at?: string;
  start_date?: string;
  end_date?: string;
  seat_name?: string | null;
  /** Provider's own subject key — opaque from our perspective. */
  subject?: string;
  sponsors?: string[];
  internal?: boolean;
  partisan?: string | null;
  answers: PollAnswer[];
}

// ---- Office taxonomy (provider-agnostic) ------------------------------------

/**
 * The kind of office or measure a Subject is about. Provider-agnostic; each
 * `PollsSource` adapter maps these to its own internal labels.
 */
export type OfficeKind =
  | "governor"
  | "senator"
  | "representative"
  | "attorney_general"
  | "secretary_of_state"
  | "treasurer"
  | "mayor"
  | "president"
  | "measure"
  | "other";

// ---- PollsSource interface --------------------------------------------------

export interface PollsLookup {
  /**
   * Provider subject keys to try, ordered most-specific first. A caller fans
   * out fetches across these in parallel and dedups results by `Poll.id`.
   */
  subjectKeys: string[];
  /**
   * Optional office filter the caller should apply to returned polls. The
   * adapter exposes a matcher so providers' own `poll_type` taxonomy stays
   * encapsulated.
   */
  office?: OfficeKind;
}

export interface PollsSource {
  /** Display name of the source — surfaced in attribution. */
  readonly name: string;
  /** Project homepage. */
  readonly url: string;
  /** SPDX-style license string, when known. */
  readonly license?: string;

  /** Derive provider-specific lookup params from an OpenSlate Subject. */
  lookup(subject: Subject): PollsLookup;

  /** Fetch polls for one provider subject key. */
  pollsForKey(subjectKey: string): Promise<Poll[]>;

  /**
   * True if a returned poll matches the requested office. Provider-specific:
   * VoteHub's "us-senator" matches `senator`, etc. When `office` is undefined
   * the matcher SHOULD pass everything through.
   */
  matchesOffice(poll: Poll, office: OfficeKind | undefined): boolean;
}

// ---- Subject → derived bits (helpers usable by any adapter) -----------------

/**
 * Best-effort guess of the office kind from a Subject's title. Pure regex —
 * adapters are free to ignore or post-process this.
 *
 * Defensive: returns `undefined` when nothing matches so adapters can pass
 * through unfiltered.
 */
export function inferOfficeFromTitle(subject: Subject): OfficeKind | undefined {
  const t = subject.title.toLowerCase();
  if (/\bgovernor\b|\bgubernatorial\b/.test(t)) return "governor";
  if (/\battorney\s+general\b/.test(t)) return "attorney_general";
  if (/\bsecretary\s+of\s+state\b/.test(t)) return "secretary_of_state";
  if (/\btreasurer\b/.test(t)) return "treasurer";
  if (/\bmayor\b/.test(t)) return "mayor";
  if (/\bu\.?s\.?\s+senate\b|\bsenator\b/.test(t)) return "senator";
  if (/\bu\.?s\.?\s+house\b|\brepresentative\b|\bcongress(?:woman|man|person)?\b/.test(t)) {
    return "representative";
  }
  if (/\bpresident\b/.test(t)) return "president";
  if (/\bprop(?:osition)?\b|\bmeasure\b|\bamendment\b|\breferendum\b/.test(t)) return "measure";
  return "other";
}

/** Extract a 4-digit year from `subject.election`. */
export function inferYear(subject: Subject): string | undefined {
  if (!subject.election) return undefined;
  const m = /(\d{4})/.exec(subject.election);
  return m?.[1];
}

/**
 * US state code (e.g. "CA") from an OpenSlate jurisdiction like `us/ca/sf`.
 * Returns undefined when the jurisdiction doesn't look US-shaped.
 */
export function inferUsStateCode(subject: Subject): string | undefined {
  const parts = (subject.jurisdiction ?? "").trim().split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const country = parts[0]?.toUpperCase();
  if (country !== "US" && country !== "USA") return undefined;
  const code = parts[1]?.toUpperCase();
  if (!code || code.length < 2) return undefined;
  return code;
}

/**
 * Detect "CA-22" style US House district patterns from a Subject's title.
 * Returns the canonical zero-padded form (`CA-22`) or undefined.
 */
export function inferUsHouseDistrict(subject: Subject): string | undefined {
  const m = /\b([A-Z]{2})[\s-]?(\d{1,3})\b/.exec(subject.title.toUpperCase());
  if (!m) return undefined;
  const [, state, num] = m;
  if (!state || !num) return undefined;
  return `${state}-${num.padStart(2, "0")}`;
}

// ---- US state-name table ----------------------------------------------------

/**
 * USPS state codes → full name. Includes DC and the five inhabited
 * territories so jurisdictions like `us/pr` resolve cleanly.
 */
export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
};
