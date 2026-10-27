import { describe, expect, test } from "bun:test";
import type { VerifiedSlate } from "../src/lib/catalogImport";
import { createImportQueue, type ImportDeps, type ImportStatus } from "../src/lib/importQueue";
import type { Catalog, CatalogEntry } from "../src/lib/query";

function entry(slug: string): CatalogEntry {
  return {
    slug,
    election: "2026-11-03",
    path: `orgs/${slug}/2026-11-03/signed.slate`,
    issuer: { key: "ed25519:R" },
    positions: 3,
    issued_at: "2026-10-24T00:00:00Z",
  };
}

const URL_ = "https://example.org/index.json";

/** Fake network and storage: each entry's token is `token:<slug>`, "bad" fails to verify. */
function fakes(overrides: Partial<ImportDeps> = {}) {
  const stored = new Set<string>();
  const batches: string[][] = [];
  /** Every store and removal, in order. */
  const log: string[] = [];
  const fetched: string[] = [];
  const deps: ImportDeps = {
    fetchBundle: async () => {
      throw new Error("no bundle");
    },
    fetchSlate: async (e) => {
      fetched.push(e.slug);
      if (e.slug === "offline") throw new Error("fetch failed: 404");
      return `token:${e.slug}`;
    },
    verify: (token, known) => {
      if (token === "token:bad") return { kind: "error", error: "bad signature" };
      if (known.has(token)) return { kind: "already-imported", token };
      return { kind: "verified", slate: { token } };
    },
    store: (slates: VerifiedSlate[]) => {
      batches.push(slates.map((s) => s.token));
      for (const s of slates) stored.add(s.token);
      log.push(...slates.map((s) => `store ${s.token}`));
    },
    remove: (tokens) => {
      for (const token of tokens) stored.delete(token);
      log.push(...tokens.map((token) => `remove ${token}`));
    },
    isStored: (token) => stored.has(token),
    ...overrides,
  };
  return { deps, stored, batches, fetched, log };
}

function catalog(entries: CatalogEntry[], bundle?: Catalog["bundle"]): Catalog {
  return { entries, ...(bundle ? { bundle } : {}) } as Catalog;
}

describe("createImportQueue", () => {
  test("stores every slate, reports progress, ends done", async () => {
    const { deps, stored, batches } = fakes();
    const queue = createImportQueue(deps);
    const seen: ImportStatus[] = [];
    queue.subscribe(() => {
      const s = queue.status();
      if (s) seen.push(s);
    });
    const entries = ["a", "b", "c"].map(entry);
    await queue.start({ catalog: catalog(entries), catalogUrl: URL_, entries, label: "Picks" });

    expect([...stored].sort()).toEqual(["token:a", "token:b", "token:c"]);
    // Within the flush interval, everything goes in one transaction.
    expect(batches).toHaveLength(1);
    expect(seen.some((s) => s.state === "running" && s.value === 1 && s.maxValue === 3)).toBe(true);
    expect(queue.status()).toMatchObject({ state: "done", imported: 3, errors: [], value: 3 });
  });

  test("stores as it goes when the flush interval passes", async () => {
    const { deps, batches } = fakes();
    const queue = createImportQueue(deps, { flushMs: 0 });
    // More than are downloaded at once, so some arrive after the first store.
    const slugs = "abcdefghij".split("");
    const entries = slugs.map(entry);
    await queue.start({ catalog: catalog(entries), catalogUrl: URL_, entries, label: "Picks" });
    expect(batches.flat().sort()).toEqual(slugs.map((slug) => `token:${slug}`));
    expect(batches.length).toBeGreaterThan(1);
  });

  test("stores get rarer as the ballot grows", async () => {
    const { deps, batches } = fakes();
    // Slates trickle in, so each could be stored on its own.
    const trickle = async (e: CatalogEntry, u: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return deps.fetchSlate(e, u);
    };
    const queue = createImportQueue({ ...deps, fetchSlate: trickle }, { flushMs: 0 });
    const entries = Array.from({ length: 40 }, (_, i) => entry(`org${i}`));
    await queue.start({ catalog: catalog(entries), catalogUrl: URL_, entries, label: "All" });

    expect(batches.flat()).toHaveLength(40);
    // Each store but the last waits for at least as many as are stored already.
    let stored = 0;
    for (const batch of batches.slice(0, -1)) {
      expect(batch.length).toBeGreaterThanOrEqual(Math.max(1, stored));
      stored += batch.length;
    }
    expect(batches.length).toBeLessThanOrEqual(8);
  });

  test("lists what failed and carries on with the rest", async () => {
    const { deps, stored } = fakes();
    const queue = createImportQueue(deps);
    const entries = ["a", "bad", "offline", "b"].map(entry);
    const followed: string[] = [];
    await queue.start({
      catalog: catalog(entries),
      catalogUrl: URL_,
      entries,
      label: "Picks",
      onImported: (e) => followed.push(e.slug),
    });
    expect([...stored].sort()).toEqual(["token:a", "token:b"]);
    expect(followed.sort()).toEqual(["a", "b"]);
    const status = queue.status();
    expect(status?.state).toBe("done");
    expect(status?.imported).toBe(2);
    expect(status?.errors.sort()).toEqual(["bad: bad signature", "offline: fetch failed: 404"]);
  });

  test("already-imported slates count as in and aren't stored again", async () => {
    const { deps, stored, batches } = fakes();
    stored.add("token:a");
    const queue = createImportQueue(deps);
    const entries = ["a", "b"].map(entry);
    const followed: string[] = [];
    await queue.start({
      catalog: catalog(entries),
      catalogUrl: URL_,
      entries,
      label: "Picks",
      onImported: (e) => followed.push(e.slug),
    });
    expect(batches).toEqual([["token:b"]]);
    expect(followed.sort()).toEqual(["a", "b"]);
    expect(queue.status()?.imported).toBe(2);
  });

  test("an update removes what each slate replaces, after storing it", async () => {
    const { deps, stored, log } = fakes();
    for (const old of ["old:a", "old:a2", "old:b"]) stored.add(old);
    const queue = createImportQueue(deps);
    const entries = ["a", "b"].map(entry);
    const replaces: Record<string, string[]> = { a: ["old:a", "old:a2"], b: ["old:b"] };
    await queue.start({
      kind: "update",
      catalog: catalog(entries),
      catalogUrl: URL_,
      entries,
      label: "Updating 2 sources",
      replaces: (e) => replaces[e.slug] ?? [],
    });
    expect([...stored].sort()).toEqual(["token:a", "token:b"]);
    // The ballot never lacks both versions.
    const lastStore = Math.max(log.indexOf("store token:a"), log.indexOf("store token:b"));
    expect(log.findIndex((line) => line.startsWith("remove"))).toBeGreaterThan(lastStore);
    expect(queue.status()).toMatchObject({ kind: "update", state: "done", imported: 2 });
  });

  test("an update keeps the old slate when the new one fails its check", async () => {
    const { deps, stored } = fakes();
    stored.add("old:a");
    const queue = createImportQueue(deps);
    const entries = ["a"].map(entry);
    await queue.start({
      kind: "update",
      catalog: catalog(entries),
      catalogUrl: URL_,
      entries,
      label: "Updating 1 source",
      check: () => "signed by a different key",
      replaces: () => ["old:a"],
    });
    expect([...stored]).toEqual(["old:a"]);
    expect(queue.status()?.errors).toEqual(["a: signed by a different key"]);
  });

  test("takes tokens from the bundle, with a byte bar, and fetches nothing else", async () => {
    const entries = ["a", "b"].map(entry);
    const bars: Array<[number, number | undefined]> = [];
    const { deps, stored, fetched } = fakes({
      fetchBundle: async (_catalog, _url, onProgress) => {
        onProgress(500, 1000);
        return new Map(entries.map((e) => [e.path, `token:${e.slug}`]));
      },
    });
    const queue = createImportQueue(deps);
    queue.subscribe(() => {
      const s = queue.status();
      if (s?.label.startsWith("Downloading every")) bars.push([s.value, s.maxValue]);
    });
    await queue.start({
      catalog: catalog(entries, { path: "bundle.json", bytes: 1000 }),
      catalogUrl: URL_,
      entries,
      label: "All",
      bundle: true,
    });
    expect(bars).toEqual([
      [0, 1000],
      [500, 1000],
    ]);
    expect(fetched).toEqual([]);
    expect(stored.size).toBe(2);
  });

  test("falls back to one by one when the bundle fails", async () => {
    const { deps, fetched } = fakes();
    const queue = createImportQueue(deps);
    const entries = ["a", "b"].map(entry);
    await queue.start({
      catalog: catalog(entries, { path: "bundle.json" }),
      catalogUrl: URL_,
      entries,
      label: "All",
      bundle: true,
    });
    expect(fetched.sort()).toEqual(["a", "b"]);
    expect(queue.status()).toMatchObject({ state: "done", imported: 2 });
  });

  test("a second import waits for the first, and says it's queued", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, fetched } = fakes();
    const slow = {
      ...deps,
      fetchSlate: async (e: CatalogEntry, u: string) => {
        await gate;
        return deps.fetchSlate(e, u);
      },
    };
    const queue = createImportQueue(slow);
    const first = ["a"].map(entry);
    const second = ["b"].map(entry);
    const one = queue.start({
      catalog: catalog(first),
      catalogUrl: URL_,
      entries: first,
      label: "1",
    });
    const two = queue.start({
      catalog: catalog(second),
      catalogUrl: URL_,
      entries: second,
      label: "2",
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(queue.status()).toMatchObject({ state: "running", label: "1", queued: 1 });
    release();
    await Promise.all([one, two]);
    expect(fetched).toEqual(["a", "b"]);
    expect(queue.status()).toMatchObject({ state: "done", label: "2", queued: 0 });
  });

  test("dismiss clears a finished import only", async () => {
    const { deps } = fakes();
    const queue = createImportQueue(deps);
    const entries = [entry("a")];
    const running = queue.start({
      catalog: catalog(entries),
      catalogUrl: URL_,
      entries,
      label: "1",
    });
    queue.dismiss();
    expect(queue.status()?.state).toBe("running");
    await running;
    queue.dismiss();
    expect(queue.status()).toBeNull();
  });
});
