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
  /** Election year, so polls from another cycle can be dropped. */
  year?: string;
  /**
   * For a measure, its normalized identifier (`"proposition 50"`, see
   * `inferMeasureNumber`), so one measure's polls don't show on another's page.
   */
  measure?: string;
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
   * True if a returned poll is about the race `lookup` describes. Provider-
   * specific: VoteHub's "us-senator" matches `senator`, etc. A poll about
   * another race reads as data about this one, so when the matcher can't tell,
   * it SHOULD reject.
   */
  matches(poll: Poll, lookup: PollsLookup): boolean;
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
  if (subject.kind === "measure") return "measure";
  const t = subject.title.toLowerCase();
  // Before the offices: a measure's title can name one ("Measure DE (Directly
  // Elected Mayor)").
  if (/\bprop(?:osition)?\b|\bmeasure\b|\bamendment\b|\breferendum\b/.test(t)) return "measure";
  // Offices whose names contain a federal or gubernatorial one, but aren't it.
  if (/\b(?:lieutenant|lt\.?)\s+governor\b/.test(t)) return "other";
  if (/\bstate\s+(?:senate|senator|house|representative|assembly)\b/.test(t)) return "other";
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
 * True when the jurisdiction is a whole US state (`us/ca`), not a county, city
 * or district within one (`us/ca/sf`, `us/ca/cd-12`).
 */
export function isUsStatewide(subject: Subject): boolean {
  const parts = (subject.jurisdiction ?? "").trim().split("/").filter(Boolean);
  return parts.length === 2 && inferUsStateCode(subject) !== undefined;
}

/**
 * The US House district a Subject is about, in the canonical zero-padded form
 * (`CA-22`): from a `cd-NN` jurisdiction (`us/ca/cd-22`), else a "CA-22" style
 * pattern in the title. Undefined when neither is there.
 */
export function inferUsHouseDistrict(subject: Subject): string | undefined {
  const stateCode = inferUsStateCode(subject);
  const part = (subject.jurisdiction ?? "").trim().split("/").filter(Boolean)[2];
  const cd = /^cd-?(\d{1,3})$/i.exec(part ?? "");
  if (stateCode && cd?.[1]) return `${stateCode}-${cd[1].padStart(2, "0")}`;

  const m = /\b([A-Z]{2})[\s-]?(\d{1,3})\b/.exec(subject.title.toUpperCase());
  if (!m) return undefined;
  const [, state, num] = m;
  if (!state || !num) return undefined;
  return `${state}-${num.padStart(2, "0")}`;
}

/**
 * A measure's identifier from its title, normalized to `"<kind> <id>"` in
 * lower case: "California – Proposition 1 (…)" → `"proposition 1"`, "Prop. 50"
 * → `"proposition 50"`, "Berkeley – Measure AA" → `"measure aa"`. The id must
 * look like one (digits, or up to four capitals), so "Amendment of …" isn't
 * read as amendment "of". Undefined when the title names no numbered measure.
 */
export function inferMeasureNumber(subject: Subject): string | undefined {
  const re =
    /\b(prop(?:osition)?|amendment|measure|referendum)\.?\s+(?:no\.?\s*)?#?([a-z0-9]+)\b/gi;
  for (const [, kind, id] of subject.title.matchAll(re)) {
    if (!kind || !id || !/^(?:\d+[A-Za-z]?|[A-Z]{1,4})$/.test(id)) continue;
    const k = kind.toLowerCase();
    return `${k === "prop" ? "proposition" : k} ${id.toLowerCase()}`;
  }
  return undefined;
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
