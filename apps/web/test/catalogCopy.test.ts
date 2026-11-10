import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, type SlatePayload, verifySlate } from "@openslate/core";
import {
  type CatalogCopy,
  type CopyDeps,
  createCatalogLoader,
  gatherSlates,
} from "../src/lib/catalogCopy";
import { collateRaces, decodeSlates } from "../src/lib/collate";
import type { Catalog, CatalogEntry } from "../src/lib/query";

const URL_A = "https://catalog.test/index.json";
const researcher = generateKeyPair();

function token(of: string, keyPair = researcher, kind = "organization"): string {
  return createSlate({
    keyPair,
    issuer: { name: "Researcher" },
    context: { election: "2026-11-03" },
    attribution: { of: { name: of, kind }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
    positions: [
      {
        subject: { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: "2026-11-03" },
        stance: kind === "election-authority" ? "neutral" : "endorse",
        choice: "Barbara Lee",
      },
    ],
  }).token;
}

function entry(path: string, of: string): CatalogEntry {
  return {
    slug: path,
    election: "2026-11-03",
    path,
    issuer: { key: verifySlate(token(of)).issuerKey ?? "", name: "Researcher" },
    attribution: {
      of: { name: of },
      mode: "scraped",
      retrieved_at: "2026-10-20T00:00:00Z",
    },
    positions: 1,
    issued_at: "2026-10-20T00:00:00Z",
  };
}

function catalog(generated: string, entries: CatalogEntry[], bundle = true): Catalog {
  return {
    version: 1,
    generated_at: generated,
    entries,
    ...(bundle ? { bundle: { path: "bundle.json", bytes: 100 } } : {}),
  };
}

/** A loader over fakes, counting what it does. */
function harness(current: Catalog, tokens: Map<string, string>, over: Partial<CopyDeps> = {}) {
  const calls = { bundle: 0, slate: 0, verify: 0, writes: 0, yields: 0, catalog: 0 };
  let kept: CatalogCopy | undefined;
  let clock = 1000;
  const deps: CopyDeps = {
    async fetchCatalog() {
      calls.catalog++;
      return current;
    },
    async fetchBundle(_catalog, _url, onProgress) {
      calls.bundle++;
      onProgress(50, 100);
      return tokens;
    },
    async fetchSlate(item) {
      calls.slate++;
      const found = tokens.get(item.path);
      if (!found) throw new Error("not found");
      return found;
    },
    verify(raw) {
      calls.verify++;
      const result = verifySlate(raw);
      return result.valid ? result.payload : undefined;
    },
    async readCopy(url) {
      return kept?.catalogUrl === url ? kept : undefined;
    },
    async writeCopy(copy) {
      calls.writes++;
      kept = copy;
    },
    async yieldToPage() {
      calls.yields++;
    },
    now: () => (clock += 5),
    ...over,
  };
  return {
    loader: createCatalogLoader(deps),
    calls,
    keep(copy: CatalogCopy) {
      kept = copy;
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}

const A = token("Sierra Club");
const B = token("SEIU Local 1021");
const entries = [entry("a.slate", "Sierra Club"), entry("b.slate", "SEIU Local 1021")];
const tokens = new Map([
  ["a.slate", A],
  ["b.slate", B],
]);

describe("createCatalogLoader", () => {
  test("nothing happens until something asks", () => {
    const { loader, calls } = harness(catalog("v1", entries), tokens);
    expect(loader.status()).toEqual({ state: "idle" });
    expect(calls.catalog).toBe(0);
  });

  test("first time: one bundle, every signature, kept for next time", async () => {
    const { loader, calls } = harness(catalog("v1", entries), tokens);
    await loader.load(URL_A);
    const status = loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates.map((s) => s.token)).toEqual([A, B]);
    expect(status.copy.rejected).toBe(0);
    expect(calls).toMatchObject({ bundle: 1, slate: 0, verify: 2, writes: 1 });
  });

  test("a kept copy of the same catalog needs no download and no signature checks", async () => {
    const h = harness(catalog("v1", entries), tokens);
    const payload = verifySlate(A).payload as SlatePayload;
    h.keep({
      catalogUrl: URL_A,
      generatedAt: "v1",
      slates: [{ token: A, payload }],
      rejected: 0,
    });
    await h.loader.load(URL_A);
    expect(h.calls).toMatchObject({ bundle: 0, verify: 0, writes: 0 });
    expect(h.loader.status().state).toBe("ready");
  });

  test("a newer catalog only checks the tokens it hasn't seen", async () => {
    const h = harness(catalog("v2", entries), tokens);
    const payload = verifySlate(A).payload as SlatePayload;
    h.keep({
      catalogUrl: URL_A,
      generatedAt: "v1",
      slates: [{ token: A, payload }],
      rejected: 0,
    });
    await h.loader.load(URL_A);
    expect(h.calls).toMatchObject({ bundle: 1, verify: 1, writes: 1 });
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.generatedAt).toBe("v2");
    expect(status.copy.slates).toHaveLength(2);
  });

  test("a kept copy shows while a newer one comes in, with no bar over it", async () => {
    const h = harness(catalog("v2", entries), tokens);
    const payload = verifySlate(A).payload as SlatePayload;
    h.keep({
      catalogUrl: URL_A,
      generatedAt: "v1",
      slates: [{ token: A, payload }],
      rejected: 0,
    });
    const states: string[] = [];
    h.loader.subscribe(() => states.push(h.loader.status().state));
    await h.loader.load(URL_A);
    expect(states.slice(states.indexOf("ready"))).not.toContain("loading");
    expect(h.calls.bundle).toBe(1);
  });

  test("the bar moves a few times a second, not once a slice", async () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`s${i}.slate`, "Sierra Club"));
    const h = harness(catalog("v1", many), new Map(many.map((e) => [e.path, A])));
    const checking: number[] = [];
    h.loader.subscribe(() => {
      const status = h.loader.status();
      if (status.state === "loading" && status.label === "Checking signatures")
        checking.push(status.value);
    });
    await h.loader.load(URL_A);
    expect(h.loader.status().state).toBe("ready");
    expect(h.calls.yields).toBeGreaterThan(10);
    // The first step always shows; after it, one about every 250 ms of the fake clock.
    expect(checking[0]).toBe(0);
    expect(checking.length).toBeGreaterThan(1);
    expect(checking.length).toBeLessThan(h.calls.yields / 2);
  });

  test("a kept copy for another catalog isn't used", async () => {
    const h = harness(catalog("v1", entries), tokens);
    h.keep({
      catalogUrl: "https://other.test/index.json",
      generatedAt: "v1",
      slates: [],
      rejected: 0,
    });
    await h.loader.load(URL_A);
    expect(h.calls.bundle).toBe(1);
  });

  test("a slate that fails its signature is left out and counted", async () => {
    const parts = A.split(".");
    const broken = [parts[0], parts[1], `${parts[2]?.slice(0, -4)}AAAA`].join(".");
    const { loader } = harness(
      catalog("v1", entries),
      new Map([
        ["a.slate", broken],
        ["b.slate", B],
      ]),
    );
    await loader.load(URL_A);
    const status = loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates.map((s) => s.token)).toEqual([B]);
    expect(status.copy.rejected).toBe(1);
  });

  test("a slate signed by a key the index doesn't list is left out", async () => {
    const stranger = token("Sierra Club", generateKeyPair());
    const { loader } = harness(
      catalog("v1", entries),
      new Map([
        ["a.slate", stranger],
        ["b.slate", B],
      ]),
    );
    await loader.load(URL_A);
    const status = loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.rejected).toBe(1);
  });

  test("no bundle, or a bundle that fails: fetched one by one", async () => {
    const noBundle = harness(catalog("v1", entries, false), tokens);
    await noBundle.loader.load(URL_A);
    expect(noBundle.calls).toMatchObject({ bundle: 0, slate: 2 });
    expect(noBundle.loader.status().state).toBe("ready");

    const failing = harness(catalog("v1", entries), tokens, {
      fetchBundle: () => Promise.reject(new Error("502")),
    });
    await failing.loader.load(URL_A);
    expect(failing.calls.slate).toBe(2);
    expect(failing.loader.status().state).toBe("ready");
  });

  test("offline with nothing kept is an error, and trying again works", async () => {
    let online = false;
    const h = harness(catalog("v1", entries), tokens, {
      async fetchCatalog() {
        if (!online) throw new Error("offline");
        return catalog("v1", entries);
      },
    });
    await h.loader.load(URL_A);
    expect(h.loader.status()).toEqual({ state: "error", error: "offline" });
    online = true;
    await h.loader.load(URL_A);
    expect(h.loader.status().state).toBe("ready");
  });

  test("offline with a copy kept just shows the copy", async () => {
    const h = harness(catalog("v1", entries), tokens, {
      fetchCatalog: () => Promise.reject(new Error("offline")),
    });
    h.keep({ catalogUrl: URL_A, generatedAt: "v1", slates: [], rejected: 0 });
    await h.loader.load(URL_A);
    expect(h.loader.status().state).toBe("ready");
  });

  test("gives way to the page during the checks", async () => {
    const h = harness(catalog("v1", entries), tokens, {
      // Every step of the clock is past the slice.
      now: (() => {
        let t = 0;
        return () => (t += 100);
      })(),
    });
    await h.loader.load(URL_A);
    expect(h.calls.yields).toBeGreaterThan(0);
  });

  test("a check cut off by a reload picks up where it stopped", async () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(`s${i}.slate`, `Source ${i}`));
    const manyTokens = new Map(many.map((e, i) => [e.path, token(`Source ${i}`)]));
    let checked: { url: string; slates: CatalogCopy["slates"] } | undefined;
    const writes: number[] = [];
    const storage: Partial<CopyDeps> = {
      async readChecked(url) {
        return checked?.url === url ? checked.slates : [];
      },
      async writeChecked(url, slates) {
        writes.push(slates.length);
        checked = slates.length ? { url, slates } : undefined;
      },
    };
    // Each step is 100 ms of the fake clock, so it keeps what it has every 2 s or so.
    const ticking = () => {
      let t = 0;
      return () => (t += 100);
    };
    // The first visit's page goes away 25 slates in.
    let verified = 0;
    const first = harness(catalog("v1", many), manyTokens, {
      ...storage,
      now: ticking(),
      verify(raw) {
        if (++verified > 25) throw new Error("reloaded");
        const result = verifySlate(raw);
        return result.valid ? result.payload : undefined;
      },
    });
    await first.loader.load(URL_A);
    expect(first.loader.status().state).toBe("error");
    const kept = checked?.slates.length ?? 0;
    expect(kept).toBeGreaterThan(10);
    expect(kept).toBeLessThanOrEqual(25);

    const second = harness(catalog("v1", many), manyTokens, { ...storage, now: ticking() });
    await second.loader.load(URL_A);
    const status = second.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates).toHaveLength(40);
    expect(second.calls.verify).toBe(40 - kept);
    // Once the whole copy is kept, the partial one is cleared.
    expect(writes.at(-1)).toBe(0);
    expect(checked).toBeUndefined();
  });

  test("storage that throws outright (no IndexedDB) still leaves a working copy", async () => {
    const gone = () => {
      throw new Error("indexedDB is not defined");
    };
    const h = harness(catalog("v1", entries), tokens, {
      readCopy: gone,
      writeCopy: gone,
      readChecked: gone,
      writeChecked: gone,
    });
    await h.loader.load(URL_A);
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates).toHaveLength(2);
  });

  test("a partial check isn't cleared when keeping the whole copy fails", async () => {
    const cleared: number[] = [];
    const h = harness(catalog("v1", entries), tokens, {
      async writeCopy() {
        throw new Error("quota");
      },
      async writeChecked(_url, slates) {
        cleared.push(slates.length);
      },
    });
    await h.loader.load(URL_A);
    expect(h.loader.status().state).toBe("ready");
    expect(cleared).not.toContain(0);
  });

  test("asking twice at once loads once, and again only after a while", async () => {
    const h = harness(catalog("v1", entries), tokens);
    await Promise.all([h.loader.load(URL_A), h.loader.load(URL_A)]);
    expect(h.calls.catalog).toBe(1);
    await h.loader.load(URL_A);
    expect(h.calls.catalog).toBe(1);
    h.advance(10 * 60 * 1000);
    await h.loader.load(URL_A);
    expect(h.calls.catalog).toBe(2);
  });
});

describe("gatherSlates", () => {
  const importedRow = { token: A, importedAt: "2026-10-20T00:00:00Z" };
  const imported = decodeSlates([importedRow]);
  const fromCatalog = decodeSlates([
    importedRow,
    { token: B, importedAt: "2026-10-28T00:00:00Z" },
    { token: token("Registrar", researcher, "election-authority"), importedAt: "x" },
  ]);

  test("each token once, imports first", () => {
    const { slates } = gatherSlates(imported, fromCatalog, {});
    expect(slates).toHaveLength(3);
    expect(slates[0]?.token).toBe(A);
  });

  test("a catalog source you never imported is off, and yours stay as they are", () => {
    const { follows } = gatherSlates(imported, fromCatalog, { "of:sierra club": -1 });
    expect(follows["of:sierra club"]).toBe(-1);
    expect(follows["of:seiu local 1021"]).toBe(0);
  });

  test("collated, an unimported source is off and a ballot listing never counts", () => {
    const { slates, follows } = gatherSlates(imported, fromCatalog, {});
    const [race] = collateRaces(slates, { follows, includeUnfollowed: true });
    expect(race?.totalSources).toBe(2);
    expect(race?.followedSources).toBe(1);
    expect(race?.onBallot).toBe(true);
    const choice = race?.choices.find((c) => c.choice === "Barbara Lee");
    expect(choice?.support).toBe(1);
    expect(choice?.positions.map((p) => p.standing).sort()).toEqual(["follow", "off"]);
  });
});

describe("when the voter's regions change", () => {
  // What the catalog hands back depends on the regions asked for (catalogShards.ts):
  // here, one slate for California and another for Texas.
  const ca = { ...catalog("d1", [entries[0] as CatalogEntry]), revision: "ca=1" };
  const tx = { ...catalog("d1", [entries[1] as CatalogEntry]), revision: "tx=1" };

  function moving() {
    let current: Catalog = ca;
    const h = harness(ca, tokens, {
      async fetchCatalog() {
        return current;
      },
    });
    return { ...h, to: (next: Catalog) => (current = next) };
  }

  test("a change is fetched now, not at the next check", async () => {
    const h = moving();
    await h.loader.load(URL_A);
    h.to(tx);
    // A revisit within a few minutes asks for nothing.
    await h.loader.load(URL_A);
    expect(h.calls.bundle).toBe(1);
    await h.loader.load(URL_A, true);
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates.map((s) => s.token)).toEqual([B]);
    expect(status.copy.revision).toBe("tx=1");
    expect(h.calls.bundle).toBe(2);
  });

  test("the copy for the old regions isn't shown while the new one loads", async () => {
    const h = moving();
    await h.loader.load(URL_A);
    h.to(tx);
    const seen: string[] = [];
    h.loader.subscribe(() => seen.push(h.loader.status().state));
    await h.loader.load(URL_A, true);
    expect(seen[0]).toBe("loading");
    expect(seen.at(-1)).toBe("ready");
    // Never "ready" with California's slate on the way.
    expect(seen.slice(0, -1)).not.toContain("ready");
  });

  test("slates checked for the old regions aren't checked again", async () => {
    const both = { ...catalog("d1", entries), revision: "ca=1\ntx=1" };
    const h = moving();
    await h.loader.load(URL_A);
    expect(h.calls.verify).toBe(1);
    h.to(both);
    await h.loader.load(URL_A, true);
    // Only Texas's is new.
    expect(h.calls.verify).toBe(2);
  });

  test("the same regions after all: the kept copy, no download", async () => {
    const h = moving();
    await h.loader.load(URL_A);
    await h.loader.load(URL_A, true);
    expect(h.calls.bundle).toBe(1);
    expect(h.loader.status().state).toBe("ready");
  });

  test("a change that arrives mid-load is loaded when that one finishes", async () => {
    const h = moving();
    const first = h.loader.load(URL_A);
    h.to(tx);
    void h.loader.load(URL_A, true);
    await first;
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.revision).toBe("tx=1");
    // And the loader is free again.
    h.to(ca);
    await h.loader.load(URL_A, true);
    expect((h.loader.status() as { copy: CatalogCopy }).copy.revision).toBe("ca=1");
  });

  test("regions with nothing in the catalog: an empty copy, not an error", async () => {
    const h = moving();
    await h.loader.load(URL_A);
    h.to({ ...catalog("d1", [], false), revision: "", bundles: [] });
    await h.loader.load(URL_A, true);
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates).toEqual([]);
    expect(status.copy.rejected).toBe(0);
  });

  test("a bundle that misses a slate: that one is fetched by itself", async () => {
    const partial = new Map([["a.slate", A]]);
    const h = harness(catalog("v1", entries), tokens, {
      async fetchBundle() {
        return new Map(partial);
      },
    });
    await h.loader.load(URL_A);
    const status = h.loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates.map((s) => s.token)).toEqual([A, B]);
    expect(h.calls.slate).toBe(1);
  });
});
