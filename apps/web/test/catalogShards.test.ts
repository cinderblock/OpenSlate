import { describe, expect, test } from "bun:test";
import type { CatalogShard } from "@openslate/core";
import {
  addScopeRegion,
  type CatalogScope,
  removeScopeRegion,
  scopeRegions,
  withMine,
} from "../src/lib/catalogScope";
import { keepCatalogScope } from "../src/lib/catalogScopeKeeper";
import {
  catalogBundles,
  catalogRevision,
  type FetchJson,
  fetchShardList,
  loadCatalog,
} from "../src/lib/catalogShards";
import { type Area, EMPTY_AREA } from "../src/lib/jurisdictions";
import type { LocalStore } from "../src/lib/localStore";
import type { Catalog, CatalogEntry } from "../src/lib/query";

const URL_ = "https://catalog.example/index.json";
const E = "2026-11-03";

function entry(slug: string, election = E): CatalogEntry {
  return {
    slug,
    election,
    path: `orgs/${slug}/${election}/signed.slate`,
    issuer: { key: "ed25519:x" },
    positions: 1,
    issued_at: "2026-10-01T00:00:00Z",
  };
}

function shard(region: string, revision: string, election = E): CatalogShard {
  const dir = `shards/${election}/${region || "_"}`;
  return {
    region,
    election,
    index: `${dir}/index.json`,
    entries: 1,
    bundle: { path: `${dir}/bundle.json`, bytes: 100 },
    revision,
  };
}

/** A catalog host: each path's JSON, and a log of what was asked for. */
function host(files: Record<string, unknown>): { fetchJson: FetchJson; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetchJson: async (url) => {
      const { pathname, search } = new URL(url);
      asked.push(`${pathname.slice(1)}${search}`);
      const data = files[pathname.slice(1)];
      return data === undefined ? { ok: false, status: 404 } : { ok: true, data };
    },
  };
}

const whole: Catalog = {
  version: 1,
  generated_at: "2026-11-01T00:00:00Z",
  entries: [entry("a"), entry("b")],
  bundle: { path: "bundle.json", bytes: 10 },
};

describe("a catalog without shards", () => {
  test("is read whole from index.json, whatever the regions", async () => {
    const { fetchJson, asked } = host({ "index.json": whole });
    expect(await loadCatalog(URL_, ["us/ca"], fetchJson)).toEqual(whole);
    expect(asked).toEqual(["shards.json", "index.json"]);
    expect(catalogBundles(whole)).toEqual([{ path: "bundle.json", bytes: 10 }]);
    expect(catalogRevision(whole)).toBe("2026-11-01T00:00:00Z");
  });

  test("a shard list that isn't one reads as none", async () => {
    for (const bad of [{ version: 1, shards: [] }, "<html>", { version: 2, shards: [{}] }]) {
      const { fetchJson } = host({ "shards.json": bad, "index.json": whole });
      expect(await fetchShardList(URL_, fetchJson)).toBeUndefined();
      expect(await loadCatalog(URL_, [], fetchJson)).toEqual(whole);
    }
  });

  test("a host that doesn't answer for shards.json still gets asked for the catalog", async () => {
    const fetchJson: FetchJson = async (url) => {
      if (url.endsWith("shards.json")) throw new Error("blocked");
      return { ok: true, data: whole };
    };
    expect(await loadCatalog(URL_, [], fetchJson)).toEqual(whole);
  });

  test("no catalog at all is an error", async () => {
    const { fetchJson } = host({});
    await expect(loadCatalog(URL_, [], fetchJson)).rejects.toThrow("fetch failed: 404");
  });
});

describe("a catalog in shards", () => {
  const national = entry("national");
  const files = {
    "shards.json": {
      version: 2,
      generated_at: "2026-11-02T00:00:00Z",
      shards: [
        shard("us/ca", "r-ca-june", "2026-06-02"),
        shard("us", "r-us"),
        shard("us/ca", "r-ca"),
        shard("us/tx", "r-tx"),
      ],
    },
    "shards/2026-06-02/us/ca/index.json": { entries: [entry("ca-june", "2026-06-02")] },
    "shards/2026-11-03/us/index.json": { entries: [national] },
    "shards/2026-11-03/us/ca/index.json": { entries: [entry("ca"), national] },
    "shards/2026-11-03/us/tx/index.json": { entries: [entry("tx"), national] },
    // Never read: a new app doesn't need the whole list.
    "index.json": whole,
  };

  test("only the voter's regions, and what they're inside", async () => {
    const { fetchJson, asked } = host(files);
    const catalog = await loadCatalog(URL_, ["us/ca"], fetchJson);
    expect(catalog.entries.map((e) => e.slug)).toEqual(["ca-june", "national", "ca"]);
    expect(catalog.generated_at).toBe("2026-11-02T00:00:00Z");
    expect(catalog.regions).toEqual(["us/ca"]);
    expect(catalog.sharded).toEqual({ shards: 4, regions: ["us", "us/ca", "us/tx"] });
    expect(asked.sort()).toEqual([
      "shards.json",
      "shards/2026-06-02/us/ca/index.json?v=r-ca-june",
      "shards/2026-11-03/us/ca/index.json?v=r-ca",
      "shards/2026-11-03/us/index.json?v=r-us",
    ]);
  });

  test("a slate in two of the voter's shards is listed once", async () => {
    const { fetchJson } = host(files);
    const catalog = await loadCatalog(URL_, ["us/ca", "us/tx"], fetchJson);
    expect(catalog.entries.filter((e) => e.slug === "national")).toHaveLength(1);
    expect(catalog.entries.map((e) => e.slug).sort()).toEqual(["ca", "ca-june", "national", "tx"]);
  });

  test("nowhere said yet: every shard", async () => {
    const { fetchJson } = host(files);
    const catalog = await loadCatalog(URL_, [], fetchJson);
    expect(catalog.entries).toHaveLength(4);
    expect(catalogBundles(catalog)).toHaveLength(4);
  });

  test("each shard's bundle, at its revision", async () => {
    const { fetchJson } = host(files);
    const catalog = await loadCatalog(URL_, ["us/tx"], fetchJson);
    expect(catalogBundles(catalog)).toEqual([
      { path: "shards/2026-11-03/us/bundle.json?v=r-us", bytes: 100 },
      { path: "shards/2026-11-03/us/tx/bundle.json?v=r-tx", bytes: 100 },
    ]);
    // Paths resolve against the catalog, as every entry's does.
    expect(new URL(catalogBundles(catalog)[1]?.path ?? "", URL_).href).toBe(
      "https://catalog.example/shards/2026-11-03/us/tx/bundle.json?v=r-tx",
    );
  });

  test("the revision changes when a shard the voter has does, and only then", async () => {
    const load = async (revisions: { ca: string; tx: string }) => {
      const { fetchJson } = host({
        ...files,
        "shards.json": {
          version: 2,
          generated_at: `at ${revisions.ca} ${revisions.tx}`,
          shards: [shard("us/ca", revisions.ca), shard("us/tx", revisions.tx)],
        },
      });
      return catalogRevision(await loadCatalog(URL_, ["us/ca"], fetchJson));
    };
    const before = await load({ ca: "1", tx: "1" });
    expect(await load({ ca: "1", tx: "2" })).toBe(before);
    expect(await load({ ca: "2", tx: "1" })).not.toBe(before);
  });

  test("a region the catalog has nothing for: an empty catalog, not an error", async () => {
    const { fetchJson } = host({
      ...files,
      "shards.json": { version: 2, generated_at: "x", shards: [shard("us/ca", "r-ca")] },
    });
    const catalog = await loadCatalog(URL_, ["us/va"], fetchJson);
    expect(catalog.entries).toEqual([]);
    expect(catalog.sharded?.regions).toEqual(["us/ca"]);
  });

  test("a listed shard that won't load is an error, not a quiet gap", async () => {
    const { "shards/2026-11-03/us/index.json": _, ...missing } = files;
    const { fetchJson } = host(missing);
    await expect(loadCatalog(URL_, ["us/ca"], fetchJson)).rejects.toThrow("fetch failed: 404");
  });
});

describe("the regions this browser asks for", () => {
  const empty: CatalogScope = { mine: [], also: [] };

  test("the voter's own and the ones they added, each once", () => {
    expect(scopeRegions(empty)).toEqual([]);
    expect(scopeRegions({ mine: ["us/ca"], also: ["us/tx", "us/ca"] })).toEqual(["us/ca", "us/tx"]);
  });

  test("adding and removing a region to look at", () => {
    const mine = withMine(empty, ["us/ca"]);
    expect(addScopeRegion(mine, "us/ca")).toBe(mine);
    const both = addScopeRegion(mine, "us/tx");
    expect(both.also).toEqual(["us/tx"]);
    expect(addScopeRegion(both, "us/tx")).toBe(both);
    expect(removeScopeRegion(both, "us/tx").also).toEqual([]);
    // Their own region isn't theirs to remove here: it follows their area.
    expect(removeScopeRegion(both, "us/ca")).toBe(both);
  });

  test("the same regions again change nothing", () => {
    const mine = withMine(empty, ["us/tx", "us/ca"]);
    expect(mine.mine).toEqual(["us/ca", "us/tx"]);
    expect(withMine(mine, ["us/ca", "us/tx", "us/ca"])).toBe(mine);
  });
});

/** A store in memory, with the listeners a LocalStore has. */
function memoryStore<T>(initial: T): LocalStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      value = initial;
      for (const listener of listeners) listener();
    },
  };
}

describe("keeping the scope in step with the voter's area", () => {
  const inCa: Area = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } };
  const setup = (area: Area, scope: CatalogScope = { mine: [], also: [] }) => {
    const stores = { area: memoryStore(area), scope: memoryStore(scope) };
    const stale: unknown[] = [];
    const queryClient = {
      invalidateQueries: async (filter?: unknown) => {
        stale.push(filter);
      },
    };
    const stop = keepCatalogScope({ ...stores, queryClient });
    return { ...stores, stale, stop };
  };

  test("an area already set is in scope before anything is fetched", () => {
    const { scope, stale } = setup(inCa);
    expect(scope.get().mine).toEqual(["us/ca"]);
    expect(stale).toEqual([{ queryKey: ["catalog"] }]);
  });

  test("no area: nothing asked for, nothing marked stale", () => {
    const { scope, stale } = setup(EMPTY_AREA);
    expect(scopeRegions(scope.get())).toEqual([]);
    expect(stale).toEqual([]);
  });

  test("moving to another state swaps the region and refreshes the catalog", () => {
    const { area, scope, stale } = setup(inCa, { mine: ["us/ca"], also: [] });
    expect(stale).toEqual([]);
    area.set({ localities: ["us/tx/austin"], districts: {} });
    expect(scope.get().mine).toEqual(["us/tx"]);
    expect(stale).toHaveLength(1);
    // A change within the state asks for nothing new.
    area.set({ localities: ["us/tx/austin", "us/tx/travis-county"], districts: {} });
    expect(stale).toHaveLength(1);
  });

  test("a region added by hand refreshes too, and outlasts an area change", () => {
    const { area, scope, stale } = setup(inCa, { mine: ["us/ca"], also: [] });
    scope.set((s) => addScopeRegion(s, "us/va"));
    expect(stale).toHaveLength(1);
    area.set(EMPTY_AREA);
    expect(scope.get()).toEqual({ mine: [], also: ["us/va"] });
    expect(stale).toHaveLength(2);
  });

  test("stopping stops", () => {
    const { area, scope, stop } = setup(inCa, { mine: ["us/ca"], also: [] });
    stop();
    area.set(EMPTY_AREA);
    expect(scope.get().mine).toEqual(["us/ca"]);
  });
});
