import { type CatalogShard, type CatalogShards, shardsFor } from "@openslate/core";
import { forEachConcurrently } from "./fetchProgress";
import type { Catalog, CatalogEntry } from "./query";

/**
 * Reading a catalog that may be cut into shards (core's catalog.ts says why
 * and how). `shards.json` sits beside the catalog's `index.json` and lists
 * every shard; the app fetches the ones for the voter's regions and puts them
 * together as one catalog, so the rest of the app never knows the difference.
 * A catalog without `shards.json` (an older one, a small self-hosted one, the
 * copy built into the desktop app) is read whole from `index.json`, as before.
 *
 * No network of its own: `fetchJson` is handed in, so this is unit-tested in
 * test/catalogShards.test.ts.
 */

/** A JSON file's contents, or the status it failed with. Throws when nothing answered. */
export type FetchJson = (
  url: string,
) => Promise<{ ok: true; data: unknown } | { ok: false; status: number }>;

/** Shard indexes fetched at once. */
const CONCURRENCY = 6;

function isShard(raw: unknown): raw is CatalogShard {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Partial<CatalogShard>;
  return (
    typeof s.region === "string" &&
    typeof s.election === "string" &&
    typeof s.index === "string" &&
    typeof s.revision === "string" &&
    (s.bundle === undefined || typeof s.bundle.path === "string")
  );
}

function isShardList(raw: unknown): raw is CatalogShards {
  if (typeof raw !== "object" || raw === null) return false;
  const list = raw as Partial<CatalogShards>;
  return (
    list.version === 2 &&
    typeof list.generated_at === "string" &&
    Array.isArray(list.shards) &&
    list.shards.every(isShard)
  );
}

/** A catalog's shard list, when it has one. Any failure reads as "it has none". */
export async function fetchShardList(
  catalogUrl: string,
  fetchJson: FetchJson,
): Promise<CatalogShards | undefined> {
  try {
    const answer = await fetchJson(new URL("shards.json", catalogUrl).href);
    return answer.ok && isShardList(answer.data) ? answer.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A shard's file, asked for by its revision: the file at that address never
 * changes, so a cache can't hand back last week's beside this week's list.
 */
function atRevision(path: string, revision: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(revision.slice(0, 16))}`;
}

async function getJson(url: string, fetchJson: FetchJson): Promise<unknown> {
  const answer = await fetchJson(url);
  if (!answer.ok) throw new Error(`fetch failed: ${answer.status}`);
  return answer.data;
}

/**
 * The catalog for a voter in `regions` (none: all of it). From shards when
 * the catalog has them: every wanted shard's entries, each entry once (a
 * slate that speaks to two of the voter's regions is in both shards), with
 * each shard's bundle. Otherwise the whole `index.json`.
 */
export async function loadCatalog(
  catalogUrl: string,
  regions: readonly string[],
  fetchJson: FetchJson,
): Promise<Catalog> {
  const list = await fetchShardList(catalogUrl, fetchJson);
  if (!list) return (await getJson(catalogUrl, fetchJson)) as Catalog;

  const listUrl = new URL("shards.json", catalogUrl).href;
  const wanted = shardsFor(list.shards, regions);
  const parts = new Array<CatalogEntry[]>(wanted.length);
  await forEachConcurrently(
    wanted.map((shard, index) => ({ shard, index })),
    CONCURRENCY,
    async ({ shard, index }) => {
      const url = new URL(atRevision(shard.index, shard.revision), listUrl).href;
      const part = (await getJson(url, fetchJson)) as Partial<Catalog>;
      if (!Array.isArray(part.entries)) throw new Error(`not a catalog: ${shard.index}`);
      parts[index] = part.entries;
    },
  );

  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const part of parts) {
    for (const entry of part ?? []) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      entries.push(entry);
    }
  }
  return {
    version: list.version,
    generated_at: list.generated_at,
    entries,
    bundles: wanted.flatMap((shard) =>
      shard.bundle
        ? [{ path: atRevision(shard.bundle.path, shard.revision), bytes: shard.bundle.bytes }]
        : [],
    ),
    // Which shards, at which revisions: the same again means nothing changed.
    revision: wanted.map((s) => `${s.election}:${s.region}=${s.revision}`).join("\n"),
    regions: [...regions].sort(),
    sharded: {
      shards: list.shards.length,
      regions: [...new Set(list.shards.map((s) => s.region))].sort(),
    },
  };
}

/** Every bundle a catalog offers: one for a whole catalog, one per shard for a sharded one. */
export function catalogBundles(catalog: Catalog): Array<{ path: string; bytes?: number }> {
  return catalog.bundles ?? (catalog.bundle ? [catalog.bundle] : []);
}

/** What tells one version of a catalog's contents from the next. */
export function catalogRevision(catalog: Pick<Catalog, "revision" | "generated_at">): string {
  return catalog.revision ?? catalog.generated_at;
}
