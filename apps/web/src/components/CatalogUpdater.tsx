import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { updateFromCatalog } from "../lib/catalogImport";
import { missingNews } from "../lib/catalogUpdates";
import { decodeSlates } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { areaStore, removedSourcesStore } from "../lib/myVote";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "../lib/query";

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

/**
 * Keeps slates imported from the catalog current: whenever the catalog loads
 * (on start, and again when it's refetched) every entry newer than what the
 * user has of it replaces their copy, and news coverage of their races that
 * they don't have yet comes along. Renders nothing; ImportBanner shows the
 * update while it runs.
 */
export function CatalogUpdater() {
  const { data: rows, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const catalog = useQuery({
    ...catalogQueryOptions(CATALOG_URL),
    enabled: isReady && rows.length > 0,
  });
  // Once per version of the catalog: while an update runs, the slates it's
  // replacing are still here and would look out of date again.
  const checked = useRef(new Set<string>());

  useEffect(() => {
    const data = catalog.data;
    if (!data || !isReady || checked.current.has(data.generated_at)) return;
    checked.current.add(data.generated_at);
    // decodeSlates caches each token's verification, so this is cheap.
    const stored = decodeSlates(rows).filter((slate) => slate.valid);
    const news = missingNews(stored, data.entries, {
      area: areaStore.get(),
      removed: new Set(removedSourcesStore.get()),
    });
    updateFromCatalog(data, CATALOG_URL, stored, news);
  }, [catalog.data, rows, isReady]);

  return null;
}
