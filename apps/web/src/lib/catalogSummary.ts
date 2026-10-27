import { racesByJurisdiction, regionsOf, type SlatePayload } from "@openslate/core";
import { type Area, inArea, parseJurisdiction } from "./jurisdictions";
import type { CatalogEntry } from "./query";

/**
 * What setup knows about a catalog entry before it
 * downloads the slate: where the entry's races are. A catalog from a current
 * `openslate sign --batch` lists this per entry; for an older one setup
 * reads it from the slate instead.
 *
 * Pure helpers: no React, no storage. Unit-tested in test/catalogSummary.test.ts.
 */
export interface EntrySummary {
  entry: CatalogEntry;
  /** Races per position jurisdiction, `""` for none. */
  jurisdictions: Record<string, number>;
  /** Where the slate publishes for (its `context.jurisdiction`). */
  scope?: string;
  /** Each region its contests are filed under, with where they're voted (core's `regionsOf`). */
  regions?: Record<string, string[]>;
}

/** Whether the catalog lists this entry's races, so its slate needn't be fetched to match it. */
export function isSummarized(entry: CatalogEntry): boolean {
  return entry.jurisdictions !== undefined;
}

/**
 * An entry's summary: from the catalog when it has one, else from the slate's
 * payload. With neither (the slate didn't load), it has no races.
 */
export function summaryOf(entry: CatalogEntry, payload?: SlatePayload): EntrySummary {
  if (entry.jurisdictions) {
    return {
      entry,
      jurisdictions: entry.jurisdictions,
      ...(entry.scope ? { scope: entry.scope } : {}),
      ...(entry.regions ? { regions: entry.regions } : {}),
    };
  }
  if (!payload) return { entry, jurisdictions: {} };
  const scope = payload.context?.jurisdiction;
  const regions = regionsOf(payload);
  return {
    entry,
    jurisdictions: racesByJurisdiction(payload),
    ...(scope ? { scope } : {}),
    ...(Object.keys(regions).length ? { regions } : {}),
  };
}

/** How many of the entry's races are on the ballot of someone in `area` (all of them with none set). */
export function racesInArea(summary: EntrySummary, area: Area): number {
  let races = 0;
  for (const [jurisdiction, count] of Object.entries(summary.jurisdictions)) {
    if (inArea(jurisdiction, area)) races += count;
  }
  return races;
}

/** Every summary's jurisdictions, weighted by race count, for `areaOptionsOf`. */
export function summaryJurisdictions(
  summaries: Iterable<EntrySummary>,
): Array<{ jurisdiction?: string; count: number }> {
  const out: Array<{ jurisdiction?: string; count: number }> = [];
  for (const summary of summaries) {
    for (const [jurisdiction, count] of Object.entries(summary.jurisdictions)) {
      out.push(jurisdiction ? { jurisdiction, count } : { count });
    }
  }
  return out;
}

/**
 * Every region the summaries' contests are filed under, with everywhere any
 * of them is voted: what this election's catalog knows a region contains.
 */
export function regionsOfSummaries(summaries: Iterable<EntrySummary>): Map<string, Set<string>> {
  const regions = new Map<string, Set<string>>();
  for (const summary of summaries) {
    for (const [region, members] of Object.entries(summary.regions ?? {})) {
      const set = regions.get(region) ?? new Set();
      for (const member of members) set.add(member);
      regions.set(region, set);
    }
  }
  return regions;
}

/**
 * Whether a source based in `scope` (its `context.jurisdiction`) is local to
 * someone in `area`: everyone's for a state or none, else only when the place
 * is theirs. A region's path doesn't say what it contains (SPEC §3.3), so a
 * region is theirs when one of its contests is voted in their area
 * (`regionsOfSummaries`); with none in the catalog it can't be placed, and
 * isn't. True for everything with no area set.
 */
export function basedInArea(
  scope: string | undefined,
  area: Area,
  regions: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const part = parseJurisdiction(scope);
  if (part.kind !== "local") return true;
  if (inArea(part.path, area)) return true;
  return [...(regions.get(part.path) ?? [])].some((place) => inArea(place, area));
}
