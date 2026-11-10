import { subjectIdentity } from "./adopts";
import { utf8 } from "./canonical";
import { sha256 } from "./guide";
import type { SlatePayload } from "./schema";

/**
 * How many races (distinct subjects) a slate speaks to, per jurisdiction: by
 * a position or an attached article (SPEC §3.15), under the subject's own
 * `jurisdiction`, else the slate's `context.jurisdiction`, else `""` (none).
 * A regional contest counts under each jurisdiction that votes on it
 * (`voted_in`, SPEC §3.3) instead of the region's own path, which says nothing
 * about whose ballot it is on.
 * A catalog lists this per entry, so an app can match a source to a voter's
 * area, and count the races it covers there, without downloading every slate
 * first.
 */
export function racesByJurisdiction(payload: SlatePayload): Record<string, number> {
  const subjects = new Map<string, Set<string>>();
  for (const { subject } of [...payload.positions, ...(payload.articles ?? [])]) {
    const jurisdiction = subject.jurisdiction ?? payload.context?.jurisdiction ?? "";
    for (const where of new Set(subject.voted_in ?? [jurisdiction])) {
      const set = subjects.get(where) ?? new Set();
      set.add(subjectIdentity(subject));
      subjects.set(where, set);
    }
  }
  return Object.fromEntries(
    [...subjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jurisdiction, set]) => [jurisdiction, set.size]),
  );
}

/**
 * Where each region a slate's contests are filed under is voted: the region's
 * path (a subject's `jurisdiction`, SPEC §3.3) with every jurisdiction any of
 * its contests lists in `voted_in`. A region's path doesn't say what it
 * contains, so a catalog lists this per entry, and an app can tell whether an
 * outlet based in a region (`context.jurisdiction` `us/ca/bay-area`) is local
 * to a voter without downloading anything. Contests without `voted_in` add
 * nothing: they're voted where they're filed.
 */
export function regionsOf(payload: SlatePayload): Record<string, string[]> {
  const regions = new Map<string, Set<string>>();
  for (const { subject } of [...payload.positions, ...(payload.articles ?? [])]) {
    const region = subject.jurisdiction ?? payload.context?.jurisdiction;
    if (!region || !subject.voted_in?.length) continue;
    const members = regions.get(region) ?? new Set();
    for (const where of subject.voted_in) members.add(where);
    regions.set(region, members);
  }
  return Object.fromEntries(
    [...regions.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, members]) => [region, [...members].sort()]),
  );
}

// ---- Shards -----------------------------------------------------------------

/**
 * A catalog too big to hand every visitor whole is cut into shards: one per
 * election and region. A region is the first two segments of a jurisdiction
 * path (`us/ca`: a state), or the path itself when it's shorter (`us`:
 * contests a whole country votes on), or `""` for an entry that names no
 * place. An app loads the shards for where its voter votes, and their
 * parents: someone in `us/ca` needs `us/ca`, `us` and `""`.
 *
 * Nothing finer than a region, on purpose: whoever hosts the files sees which
 * ones are asked for, and a state says little about a voter where a city or a
 * race would say a lot.
 */

/** The region a jurisdiction is in: `us/ca/sf` → `us/ca`, `us` → `us`, none → `""`. */
export function regionOfJurisdiction(jurisdiction: string | undefined): string {
  const parts = (jurisdiction ?? "").trim().toLowerCase().split("/").filter(Boolean);
  return parts.slice(0, 2).join("/");
}

/** What a catalog entry says about where and when it applies. */
export interface ShardableEntry {
  election: string;
  /** The slate's `context.jurisdiction`. */
  scope?: string;
  /** Races per jurisdiction (`racesByJurisdiction`). */
  jurisdictions?: Record<string, number>;
}

/**
 * Every region an entry speaks to, sorted: its races' (`jurisdictions`), else
 * where it publishes for (`scope`), else `""`. A national group's slate with
 * House races in twelve states is in twelve regions.
 */
export function entryRegions(entry: ShardableEntry): string[] {
  const places = Object.keys(entry.jurisdictions ?? {});
  const regions = new Set(
    (places.length > 0 ? places : [entry.scope ?? ""]).map(regionOfJurisdiction),
  );
  return [...regions].sort();
}

/** One shard as a catalog's `shards.json` lists it. */
export interface CatalogShard {
  /** `us/ca`, `us`, or `""`. */
  region: string;
  election: string;
  /** The shard's own `index.json` (a catalog of just its entries), relative to `shards.json`. */
  index: string;
  /** How many entries it has. */
  entries: number;
  /** Its entries with their slates inline; `bytes` is the uncompressed size. */
  bundle?: { path: string; bytes: number };
  /**
   * Changes when anything in the shard does, and only then (a hash of its
   * bundle): an app that has this revision needs nothing from the shard.
   */
  revision: string;
}

/** `shards.json`, beside a catalog's `index.json`: every shard it's cut into. */
export interface CatalogShards {
  version: 2;
  generated_at: string;
  shards: CatalogShard[];
}

/**
 * Where a shard's files go, relative to `shards.json`:
 * `shards/2026-11-03/us/ca`, and `shards/2026-11-03/_` for the entries that
 * name no place. Anything a path can't hold is replaced.
 */
export function shardDirectory(region: string, election: string): string {
  // Never a `.` or `..` segment: these become directories.
  const safe = (part: string) => part.replace(/[^a-z0-9._-]+/gi, "-").replace(/^\.*$/, "-");
  const place = region ? region.split("/").map(safe).join("/") : "_";
  return `shards/${safe(election)}/${place}`;
}

/**
 * A catalog's entries cut into shards: each entry under its election and
 * every region it speaks to (`entryRegions`), shards by election then region,
 * entries in the order given.
 */
export function shardEntries<T extends ShardableEntry>(
  entries: readonly T[],
): Array<{ region: string; election: string; entries: T[] }> {
  const shards = new Map<string, { region: string; election: string; entries: T[] }>();
  for (const entry of entries) {
    for (const region of entryRegions(entry)) {
      const key = `${entry.election}\n${region}`;
      const shard = shards.get(key) ?? { region, election: entry.election, entries: [] };
      shard.entries.push(entry);
      shards.set(key, shard);
    }
  }
  return [...shards.values()].sort(
    (a, b) => a.election.localeCompare(b.election) || a.region.localeCompare(b.region),
  );
}

/**
 * The shards someone voting in `regions` needs: each region's own, and those
 * of everything it's inside (`us/ca` → `us/ca`, `us`, `""`). With no regions
 * (a voter who hasn't said where they vote), every shard.
 */
export function shardsFor<T extends Pick<CatalogShard, "region">>(
  shards: readonly T[],
  regions: readonly string[],
): T[] {
  if (regions.length === 0) return [...shards];
  const wanted = new Set<string>([""]);
  for (const region of regions) {
    const parts = regionOfJurisdiction(region).split("/").filter(Boolean);
    for (let end = 1; end <= parts.length; end++) wanted.add(parts.slice(0, end).join("/"));
  }
  return shards.filter((shard) => wanted.has(shard.region));
}

/** One file of a sharded catalog, by its path relative to `shards.json`. */
export interface ShardFile {
  path: string;
  text: string;
}

/**
 * Everything a catalog publishes to be read in shards, from its entries with
 * their signed slates (`token`): `shards.json`'s contents, and each shard's
 * `index.json` (its entries) and `bundle.json` (the same with tokens). A
 * shard's files carry no date of their own, so one whose entries didn't
 * change comes out byte for byte the same, with the same revision, however
 * often the catalog is rebuilt.
 */
export async function buildCatalogShards<T extends ShardableEntry & { token: string }>(
  entries: readonly T[],
  generatedAt: string,
): Promise<{ list: CatalogShards; files: ShardFile[] }> {
  const files: ShardFile[] = [];
  const shards: CatalogShard[] = [];
  for (const shard of shardEntries(entries)) {
    const dir = shardDirectory(shard.region, shard.election);
    const head = { version: 1, region: shard.region, election: shard.election };
    const bundle = JSON.stringify({ ...head, entries: shard.entries });
    const index = JSON.stringify({
      ...head,
      entries: shard.entries.map(({ token: _, ...entry }) => entry),
    });
    files.push({ path: `${dir}/index.json`, text: index });
    files.push({ path: `${dir}/bundle.json`, text: bundle });
    shards.push({
      region: shard.region,
      election: shard.election,
      index: `${dir}/index.json`,
      entries: shard.entries.length,
      bundle: { path: `${dir}/bundle.json`, bytes: utf8(bundle).byteLength },
      revision: (await sha256(utf8(bundle))).slice(0, 32),
    });
  }
  return { list: { version: 2, generated_at: generatedAt, shards }, files };
}
