import type { RaceCandidate, RegionResult } from "@openslate/core";

/**
 * Pure helpers for sorting / summarizing civicAPI's per-region breakdown.
 * Kept dependency-free so they can be unit-tested directly.
 */

export interface NormalizedRegion {
  slug: string;
  name: string;
  type?: string;
  fill?: string;
  percentReporting?: number;
  totalVotes: number;
  /** Leader's vote percent minus runner-up's vote percent. NaN when not derivable. */
  margin: number;
  leader?: RaceCandidate;
  runnerUp?: RaceCandidate;
  candidates: RaceCandidate[];
}

export type RegionSort = "votes_desc" | "margin_asc" | "margin_desc" | "reporting_asc" | "name_asc";

const NUMERIC_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Flatten the `region_results` map to a NormalizedRegion[] with leader/runner-up
 * pre-computed. The map's key (the slug) is included so callers can use it
 * as a React key without colliding when two regions share a display name.
 */
export function normalizeRegions(
  regionResults: Record<string, RegionResult> | undefined,
): NormalizedRegion[] {
  if (!regionResults) return [];
  return Object.entries(regionResults).map(([slug, region]): NormalizedRegion => {
    const sorted = [...region.candidates].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    const leader = sorted[0];
    const runnerUp = sorted[1];
    const margin =
      leader?.percent !== undefined && runnerUp?.percent !== undefined
        ? leader.percent - runnerUp.percent
        : Number.NaN;
    const totalVotes = region.candidates.reduce((acc, c) => acc + (c.votes ?? 0), 0);
    return {
      slug,
      name: region.name,
      type: region.type,
      fill: region.fill,
      percentReporting: region.percent_reporting,
      totalVotes,
      margin,
      leader,
      runnerUp,
      candidates: sorted,
    };
  });
}

/** Sort a flattened region list in-place style (returns new array). */
export function sortRegions(regions: NormalizedRegion[], by: RegionSort): NormalizedRegion[] {
  const out = [...regions];
  switch (by) {
    case "votes_desc":
      out.sort((a, b) => b.totalVotes - a.totalVotes);
      break;
    case "margin_asc":
      // NaN regions sink to the bottom either way.
      out.sort((a, b) => safeMargin(a.margin) - safeMargin(b.margin));
      break;
    case "margin_desc":
      out.sort((a, b) => safeMargin(b.margin) - safeMargin(a.margin));
      break;
    case "reporting_asc":
      out.sort((a, b) => (a.percentReporting ?? 101) - (b.percentReporting ?? 101));
      break;
    case "name_asc":
      out.sort((a, b) => NUMERIC_COLLATOR.compare(a.name, b.name));
      break;
  }
  return out;
}

function safeMargin(margin: number): number {
  return Number.isNaN(margin) ? Number.POSITIVE_INFINITY : margin;
}

/**
 * Aggregate summary across all regions — for the headline above the table.
 * Useful when the user wants "how many regions had X leading."
 */
export interface RegionAggregate {
  totalRegions: number;
  fullyReporting: number;
  totalVotes: number;
  /** Map from candidate name to number of regions where they were the leader. */
  leaderTally: Map<string, number>;
}

export function aggregateRegions(regions: NormalizedRegion[]): RegionAggregate {
  const leaderTally = new Map<string, number>();
  let totalVotes = 0;
  let fullyReporting = 0;
  for (const r of regions) {
    totalVotes += r.totalVotes;
    if (r.percentReporting === 100) fullyReporting++;
    if (r.leader?.name) {
      leaderTally.set(r.leader.name, (leaderTally.get(r.leader.name) ?? 0) + 1);
    }
  }
  return { totalRegions: regions.length, fullyReporting, totalVotes, leaderTally };
}
