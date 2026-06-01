import type { Subject } from "./schema";

// civicAPI race shape — see https://civicapi.org/api-documentation. Kept narrow
// on purpose: only fields we render or match against. Other fields the upstream
// returns (`region_results`, raw `polls_open` / `polls_close`, etc.) are passed
// through opaquely on `Race` and ignored here.

export interface RaceCandidate {
  name: string;
  party?: string;
  color?: string;
  votes?: number;
  percent?: number;
  winner?: boolean;
  incumbent?: boolean;
  electoral_votes?: number;
  seats?: number;
  delegates?: number;
  legislative_votes?: number;
  fusion_votes?: number;
}

/** Subset returned by `/race/search` — only the top three candidates per race. */
export interface RaceSummary {
  id: number | string;
  type?: string;
  country?: string;
  province?: string | null;
  district?: string | null;
  municipality?: string | null;
  election_name: string;
  election_type?: string;
  /** RFC 3339 date-time, UTC. */
  election_date?: string;
  has_breakdown?: boolean;
  has_map?: boolean;
  percent_reporting?: number;
  candidates: RaceCandidate[];
}

/** Full race detail returned by `/race/{raceid}`. */
export interface Race extends RaceSummary {
  polls_open?: string;
  polls_close?: string;
  registered_voters?: number;
  region_results?: unknown;
}

export interface RaceSearchParams {
  query?: string;
  country?: string;
  province?: string;
  district?: string;
  election_type?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD */
  endDate?: string;
  limit?: number;
}

export interface RaceSearchResult {
  count: number;
  offset: number;
  limit: number;
  races: RaceSummary[];
}

/**
 * Transport-agnostic source of election results. civicAPI is one implementation,
 * but the panel/timeline code only ever sees this interface so other providers
 * (AP Elections, Decision Desk, OpenElections) can slot in without changes.
 */
export interface ResultsSource {
  search(params: RaceSearchParams): Promise<RaceSearchResult>;
  get(raceId: number | string): Promise<Race>;
  history(raceId: number | string, timestamp?: string): Promise<RaceHistoryResult>;
}

export type RaceHistoryResult =
  | { kind: "timestamps"; timestamps: string[] }
  | { kind: "snapshot"; race: Race };

// ---- Subject → search params --------------------------------------------------

/**
 * Derive civicAPI search params from a Subject. OpenSlate jurisdictions follow
 * a loose `<country>/<state>/<locality>` slug convention (see SPEC.md §3.3),
 * but we tolerate missing / partial values. When nothing useful can be derived,
 * returns `{ query: subject.title }` — civicAPI's search accepts a query alone.
 */
export function subjectToRaceQuery(subject: Subject, limit = 10): RaceSearchParams {
  const params: RaceSearchParams = { query: subject.title, limit };

  const j = parseJurisdiction(subject.jurisdiction);
  if (j.country) params.country = j.country;
  if (j.province) params.province = j.province;
  if (j.district) params.district = j.district;

  const window = electionDateWindow(subject.election);
  if (window) {
    params.startDate = window.startDate;
    params.endDate = window.endDate;
  }

  return params;
}

interface ParsedJurisdiction {
  country?: string;
  province?: string;
  district?: string;
}

/**
 * Best-effort parse of OpenSlate's `us/ca/sf`-style jurisdiction strings into
 * civicAPI's `(country, province, district)` triple.
 *
 * Recognised forms:
 * - `us` → country `US`
 * - `us/ca` → country `US`, province `CA`
 * - `us/ca/sf` → country `US`, province `CA`, district `SF`
 * - `us/ca/san-francisco` → district `SAN-FRANCISCO` (dashes inside a segment survive)
 * - `JP-06` (ISO 3166-2 style with a single `-`) → country `JP`, province `06`
 *
 * Slashes are the primary separator. A single `-` immediately after the country
 * code (the ISO 3166-2 convention) is also treated as a separator; further `-`
 * within a segment are preserved.
 */
export function parseJurisdiction(input: string | undefined): ParsedJurisdiction {
  if (!input) return {};
  const trimmed = input.trim();
  if (!trimmed) return {};

  // Normalize the ISO 3166-2 single-dash form (`JP-06`) into slash form, but
  // only when no slash is present — otherwise a path like `us/ca/san-francisco`
  // would have the `-` mis-split.
  const normalized = trimmed.includes("/") ? trimmed : trimmed.replace("-", "/");

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return {};

  const country = parts[0]?.toUpperCase();
  const province = parts[1]?.toUpperCase();
  const district = parts.slice(2).join("/").toUpperCase();

  const out: ParsedJurisdiction = {};
  if (country) out.country = country;
  if (province) out.province = province;
  if (district) out.district = district;
  return out;
}

/**
 * Derive a `(startDate, endDate)` search window from a Subject's `election`
 * field. Accepts an RFC 3339 date or date-time. Widens by ±1 day so a UTC-vs-
 * local-tz boundary doesn't accidentally exclude the target.
 *
 * Returns `null` if `election` doesn't look like a date — the caller falls back
 * to the title query alone.
 */
export function electionDateWindow(
  election: string | undefined,
): { startDate: string; endDate: string } | null {
  if (!election) return null;
  const date = parseDateLoose(election);
  if (!date) return null;

  const start = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return { startDate: toYmd(start), endDate: toYmd(end) };
}

function parseDateLoose(text: string): Date | null {
  // Try full RFC 3339 first, then bare YYYY-MM-DD.
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---- Matching score -----------------------------------------------------------

/**
 * Score a candidate race against a Subject in [0, 1]. Higher = better match.
 *
 * Heuristics, in rough order of weight:
 * - exact / near-exact `election_date` match
 * - country / province / district agreement
 * - title token overlap (Jaccard on normalized words)
 *
 * Caller is expected to sort `RaceSummary[]` by this score and surface the
 * best candidate; the UI exposes the score (or a coarse "high / low confidence"
 * derivation of it) so the user can override.
 */
export function scoreMatch(subject: Subject, race: RaceSummary): number {
  let score = 0;
  let weight = 0;

  // Election date proximity. Same UTC day = full; within 7 days = partial.
  const subjectDate = parseDateLoose(subject.election ?? "");
  const raceDate = parseDateLoose(race.election_date ?? "");
  if (subjectDate && raceDate) {
    const diffDays = Math.abs(subjectDate.getTime() - raceDate.getTime()) / 86_400_000;
    let s = 0;
    if (diffDays < 1) s = 1;
    else if (diffDays < 7) s = 0.5;
    else if (diffDays < 30) s = 0.1;
    score += s * 3;
    weight += 3;
  }

  const j = parseJurisdiction(subject.jurisdiction);
  if (j.country && race.country) {
    score += (j.country === race.country.toUpperCase() ? 1 : 0) * 1.5;
    weight += 1.5;
  }
  if (j.province && race.province) {
    score += (j.province === race.province.toUpperCase() ? 1 : 0) * 1.5;
    weight += 1.5;
  }
  if (j.district && race.district) {
    score += (j.district === race.district.toUpperCase() ? 1 : 0) * 1;
    weight += 1;
  }

  // Title similarity (Jaccard on normalized tokens).
  const titleSim = jaccard(tokens(subject.title), tokens(race.election_name));
  score += titleSim * 2;
  weight += 2;

  return weight === 0 ? 0 : score / weight;
}

const STOPWORDS = new Set([
  "the",
  "of",
  "for",
  "and",
  "or",
  "to",
  "a",
  "an",
  "in",
  "on",
  "at",
  "by",
  "vs",
  "vs.",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Coarse confidence bucket for UI display.
 * - `high`: ≥ 0.75 — auto-apply silently
 * - `medium`: 0.4–0.75 — auto-apply with a "looks like this race — change?" hint
 * - `low`: < 0.4 — don't auto-apply; surface the search box instead
 */
export function confidenceBucket(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}
