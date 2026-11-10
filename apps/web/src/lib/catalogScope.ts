import { createLocalStore, useLocalStore } from "./localStore";

/**
 * Which regions' part of the public catalog this browser asks for. A big
 * catalog comes in shards, one per election and region (core's `shardsFor`),
 * and the app loads the voter's own: the states their area names (`mine`,
 * kept up to date by `keepCatalogScope`) and any they chose to look at
 * besides (`also`). Kept in this browser only; the catalog's host sees which
 * regions' files are asked for and nothing finer.
 *
 * No regions at all means the whole catalog: a visitor who hasn't said where
 * they vote, and every catalog that isn't cut into shards.
 */
export interface CatalogScope {
  /** Regions the voter's area puts them in: `us/ca`. */
  mine: string[];
  /** Regions they asked to see as well. */
  also: string[];
}

const EMPTY: CatalogScope = { mine: [], also: [] };

function isRegions(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every((r) => typeof r === "string");
}

export const catalogScopeStore = createLocalStore<CatalogScope>(
  "openslate.catalogScope.v1",
  EMPTY,
  (raw) => {
    if (typeof raw !== "object" || raw === null) return undefined;
    const { mine, also } = raw as Partial<CatalogScope>;
    return isRegions(mine) && isRegions(also) ? { mine, also } : undefined;
  },
);

export const useCatalogScope = () => useLocalStore(catalogScopeStore);

/** Every region a scope asks for, each once, sorted. Empty: the whole catalog. */
export function scopeRegions(scope: CatalogScope = catalogScopeStore.get()): string[] {
  return [...new Set([...scope.mine, ...scope.also])].sort();
}

/** The scope with the voter's own regions replaced; the same object when they haven't changed. */
export function withMine(scope: CatalogScope, mine: readonly string[]): CatalogScope {
  const next = [...new Set(mine)].sort();
  return next.join() === scope.mine.join() ? scope : { ...scope, mine: next };
}

/** Look at a region besides the voter's own. */
export function addScopeRegion(scope: CatalogScope, region: string): CatalogScope {
  if (scope.mine.includes(region) || scope.also.includes(region)) return scope;
  return { ...scope, also: [...scope.also, region].sort() };
}

/** Stop looking at a region the voter added. Their own stay. */
export function removeScopeRegion(scope: CatalogScope, region: string): CatalogScope {
  return scope.also.includes(region)
    ? { ...scope, also: scope.also.filter((r) => r !== region) }
    : scope;
}
