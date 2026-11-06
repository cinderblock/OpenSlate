import { readTextWithProgress } from "./fetchProgress";
import type { Catalog, CatalogBundleEntry } from "./query";

/**
 * Download a catalog's bundle (every entry's slate in one file) and return the
 * tokens by entry path. Reports bytes received against the bundle's
 * uncompressed size; `total` is undefined when the catalog doesn't say.
 * On its own, away from catalogImport.ts's storage and query cache, so the
 * catalog worker (catalog.worker.ts) can load it.
 */
export async function fetchCatalogBundle(
  catalog: Catalog,
  catalogUrl: string,
  onProgress: (received: number, total: number | undefined) => void,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  if (!catalog.bundle) throw new Error("this catalog has no bundle");
  const total = catalog.bundle.bytes;
  const response = await fetch(new URL(catalog.bundle.path, catalogUrl), { signal });
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
  const text = await readTextWithProgress(response, (received) => onProgress(received, total));
  const bundle = JSON.parse(text) as { entries?: CatalogBundleEntry[] };
  const tokens = new Map<string, string>();
  for (const entry of bundle.entries ?? []) {
    if (typeof entry.path === "string" && typeof entry.token === "string") {
      tokens.set(entry.path, entry.token.trim());
    }
  }
  return tokens;
}
