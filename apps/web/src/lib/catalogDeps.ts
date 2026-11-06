import { del, get, set } from "idb-keyval";
import { fetchCatalogBundle } from "./catalogBundle";
import type { CatalogCopy, CopiedSlate, CopyDeps } from "./catalogCopy";
import { decodeSlates, rememberVerified, verifyAhead } from "./collate";
import { yieldToPage } from "./yieldToPage";

/**
 * What the catalog loader (catalogCopy.ts) does without the page: download the
 * bundle, check signatures, keep the copy in IndexedDB. The catalog worker
 * (catalog.worker.ts) runs the loader with these; so does the page, where a
 * worker can't start. Fetching the catalog's list and single slates is left
 * out: those go through the page's query cache, which other pages share.
 */

/** Its own key rather than the query cache's: that blob is rewritten on every change. */
export const COPY_KEY = "openslate.catalogCopy.v1";
/** A check that hasn't finished yet, kept as it goes (`readChecked` in catalogCopy.ts). */
export const CHECKED_KEY = "openslate.catalogChecked.v1";

export type StoredDeps = Omit<CopyDeps, "fetchCatalog" | "fetchSlate">;

export const storedDeps: StoredDeps = {
  fetchBundle: fetchCatalogBundle,
  verify(token) {
    const [slate] = decodeSlates([{ token, importedAt: "" }]);
    return slate?.valid ? slate.payload : undefined;
  },
  verifyAhead,
  async readCopy(catalogUrl) {
    const copy = await get<CatalogCopy>(COPY_KEY);
    if (copy?.catalogUrl !== catalogUrl) return undefined;
    // Verified when it was kept; browser storage is as trusted as the app.
    for (const slate of copy.slates) rememberVerified(slate.token, slate.payload);
    return copy;
  },
  // Async, so storage that isn't there (some private windows) rejects rather than throws.
  async writeCopy(copy) {
    await set(COPY_KEY, copy);
  },
  async readChecked(catalogUrl) {
    const kept = await get<{ catalogUrl: string; slates: CopiedSlate[] }>(CHECKED_KEY);
    if (kept?.catalogUrl !== catalogUrl) return [];
    for (const slate of kept.slates) rememberVerified(slate.token, slate.payload);
    return kept.slates;
  },
  async writeChecked(catalogUrl, slates) {
    if (slates.length) await set(CHECKED_KEY, { catalogUrl, slates });
    else await del(CHECKED_KEY);
  },
  yieldToPage,
  now: () => Date.now(),
};
