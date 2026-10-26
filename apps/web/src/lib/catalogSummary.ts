import { type SlatePayload, racesByJurisdiction } from "@openslate/core";
import { type Area, inArea } from "./jurisdictions";
import type { CatalogEntry } from "./query";

/**
 * What the getting-started wizard knows about a catalog entry before it
 * downloads the slate: where the entry's races are. A catalog from a current
 * `openslate sign --batch` lists this per entry; for an older one the wizard
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
    };
  }
  if (!payload) return { entry, jurisdictions: {} };
  const scope = payload.context?.jurisdiction;
  return { entry, jurisdictions: racesByJurisdiction(payload), ...(scope ? { scope } : {}) };
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
