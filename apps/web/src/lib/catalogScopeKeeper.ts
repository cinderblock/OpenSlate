import type { QueryClient } from "@tanstack/react-query";
import { type CatalogScope, scopeRegions, withMine } from "./catalogScope";
import { type Area, areaStates } from "./jurisdictions";
import type { LocalStore } from "./localStore";

/**
 * Keeps the catalog's scope (catalogScope.ts) in step with where the voter
 * votes: the regions their area names are theirs, from the first page load
 * and whenever the area changes (a lookup, a hand edit, another tab). When
 * the regions asked for change, every catalog query is marked stale, so the
 * pages showing the catalog fetch the new regions' part.
 *
 * Takes its stores so it can be unit-tested (test/catalogScope.test.ts);
 * main.tsx wires the real ones, once, before the first render.
 */
export function keepCatalogScope(deps: {
  area: Pick<LocalStore<Area>, "get" | "subscribe">;
  scope: LocalStore<CatalogScope>;
  queryClient: Pick<QueryClient, "invalidateQueries">;
}): () => void {
  let asked = scopeRegions(deps.scope.get()).join();
  const sync = () => {
    const scope = deps.scope.get();
    const next = withMine(scope, [...areaStates(deps.area.get())]);
    if (next !== scope) deps.scope.set(next);
  };
  const changed = () => {
    const now = scopeRegions(deps.scope.get()).join();
    if (now === asked) return;
    asked = now;
    void deps.queryClient.invalidateQueries({ queryKey: ["catalog"] });
  };
  const stops = [deps.area.subscribe(sync), deps.scope.subscribe(changed)];
  sync();
  return () => {
    for (const stop of stops) stop();
  };
}
