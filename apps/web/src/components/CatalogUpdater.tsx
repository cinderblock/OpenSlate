import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { adoptedEntries, expandAdoptions } from "../lib/adoptions";
import { importAdoptedEntries, resumeSetupImport, updateFromCatalog } from "../lib/catalogImport";
import { missingNews } from "../lib/catalogUpdates";
import { decodeSlates } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { areaStore, removedSourcesStore } from "../lib/myVote";
import { pendingSetupStore } from "../lib/pendingSetup";
import {
  catalogQueryOptions,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  queryClient,
} from "../lib/query";

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

/**
 * Keeps slates imported from the catalog current: whenever the catalog loads
 * (on start, and again when it's refetched) every entry newer than what the
 * user has of it replaces their copy, and news coverage of their races that
 * they don't have yet comes along. First, though, it finishes any setup
 * download an earlier visit was cut off in the middle of (pendingSetup.ts),
 * even before anything is stored. It also brings in, unfollowed, any catalog
 * slate an imported slate adopts positions from (SPEC §3.10). Renders nothing;
 * ImportBanner shows the first two while they run.
 */
export function CatalogUpdater() {
  const { data: rows, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  // Read once: a download to resume is only ever one left over from an earlier visit.
  const [pendingAtLoad] = useState(() => pendingSetupStore.get() !== null);
  const catalog = useQuery({
    ...catalogQueryOptions(CATALOG_URL),
    enabled: isReady && (rows.length > 0 || pendingAtLoad),
  });
  // Once per version of the catalog: while an update runs, the slates it's
  // replacing are still here and would look out of date again.
  const checked = useRef(new Set<string>());
  const resumed = useRef(false);
  // Each adopted slate is tried once a visit: one that won't import stays unresolved.
  const adopted = useRef(new Set<string>());

  useEffect(() => {
    const data = catalog.data;
    if (!data || !isReady) return;
    if (pendingAtLoad && !resumed.current) {
      resumed.current = true;
      resumeSetupImport(data, CATALOG_URL);
    }
    if (rows.length === 0 || checked.current.has(data.generated_at)) return;
    checked.current.add(data.generated_at);
    // decodeSlates caches each token's verification, so this is cheap.
    const stored = decodeSlates(rows).filter((slate) => slate.valid);
    const news = missingNews(stored, data.entries, {
      area: areaStore.get(),
      removed: new Set(removedSourcesStore.get()),
    });
    updateFromCatalog(data, CATALOG_URL, stored, news);
  }, [catalog.data, rows, isReady, pendingAtLoad]);

  // On every change to what's imported, unlike the update above: following a
  // source for the first time can bring a new adoption with it.
  useEffect(() => {
    const data = catalog.data;
    if (!data || !isReady || rows.length === 0) return;
    const removed = new Set(removedSourcesStore.get());
    const entries = adoptedEntries(
      expandAdoptions(decodeSlates(rows)),
      data.entries,
      removed,
    ).filter((entry) => !adopted.current.has(entry.path));
    if (entries.length === 0) return;
    for (const entry of entries) adopted.current.add(entry.path);
    void importAdoptedEntries(
      entries,
      CATALOG_URL,
      new Set(rows.map((row) => row.token)),
      queryClient,
    );
  }, [catalog.data, rows, isReady]);

  return null;
}
