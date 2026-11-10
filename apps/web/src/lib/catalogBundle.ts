import { catalogBundles } from "./catalogShards";
import { readTextWithProgress } from "./fetchProgress";
import type { Catalog, CatalogBundleEntry } from "./query";

/**
 * Download a catalog's bundle (every entry's slate in one file; one file per
 * shard for a catalog that came in shards) and return the tokens by entry
 * path. Reports bytes received against the bundles' uncompressed size;
 * `total` is undefined when the catalog doesn't say.
 * On its own, away from catalogImport.ts's storage and query cache, so the
 * catalog worker (catalog.worker.ts) can load it.
 */
export async function fetchCatalogBundle(
  catalog: Catalog,
  catalogUrl: string,
  onProgress: (received: number, total: number | undefined) => void,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const bundles = catalogBundles(catalog);
  if (bundles.length === 0) throw new Error("this catalog has no bundle");
  const total = bundles.every((b) => b.bytes !== undefined)
    ? bundles.reduce((sum, b) => sum + (b.bytes ?? 0), 0)
    : undefined;
  const tokens = new Map<string, string>();
  // One after another: a phone parses several MB at a time as it is.
  let before = 0;
  for (const { path, bytes } of bundles) {
    const response = await fetch(new URL(path, catalogUrl), signal ? { signal } : {});
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    let received = 0;
    const text = await readTextWithProgress(response, (n) => {
      received = n;
      onProgress(before + n, total);
    });
    before += bytes ?? received;
    const bundle = JSON.parse(text) as { entries?: CatalogBundleEntry[] };
    for (const entry of bundle.entries ?? []) {
      if (typeof entry.path === "string" && typeof entry.token === "string") {
        tokens.set(entry.path, entry.token.trim());
      }
    }
  }
  return tokens;
}
