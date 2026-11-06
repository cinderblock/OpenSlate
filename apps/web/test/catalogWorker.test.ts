import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createSlate, generateKeyPair, verifySlate } from "@openslate/core";
import type { FromCatalogWorker, ToCatalogWorker } from "../src/lib/catalog.worker";
import type { CatalogStatus } from "../src/lib/catalogService";
import { createCatalogService } from "../src/lib/catalogService";
import type { LinedUp } from "../src/lib/lineUp";
import type { Catalog, CatalogEntry } from "../src/lib/query";

const LIB = join(import.meta.dir, "../src/lib");

/** Modules a worker can't load: React, the database, localStorage, the query client. */
const PAGE_ONLY = [
  "react",
  "react-dom",
  "@tanstack/react-db",
  "@tanstack/react-query",
  "db.ts",
  "collections.ts",
  "localStore.ts",
  "query.ts",
];

/** Every module `entry` loads at run time (type-only imports are erased), by path or package name. */
function runtimeImports(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, "(entry)"]]);
  const queue = [entry];
  for (let file = queue.pop(); file; file = queue.pop()) {
    const text = readFileSync(file, "utf8");
    const pattern = /^(?:import|export)\s+(type\s+)?(?:[^;]*?\s+from\s+)?"([^"]+)"/gms;
    for (const [, typeOnly, spec] of text.matchAll(pattern)) {
      if (typeOnly || !spec) continue;
      const target = spec.startsWith(".")
        ? [".ts", ".tsx", "/index.ts"]
            .map((ext) => resolve(dirname(file), spec + ext))
            .find((path) => {
              try {
                readFileSync(path);
                return true;
              } catch {
                return false;
              }
            })
        : spec;
      if (!target || seen.has(target)) continue;
      seen.set(target, file);
      if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) queue.push(target);
    }
  }
  return seen;
}

describe("what the catalog worker loads", () => {
  test("the import walk finds what a page module loads", () => {
    const loaded = [...runtimeImports(join(LIB, "allSlates.ts")).keys()];
    expect(loaded).toContain("react");
    expect(loaded.map((path) => basename(path))).toContain("collections.ts");
  });

  test("nothing only a page has", () => {
    const loaded = runtimeImports(join(LIB, "catalog.worker.ts"));
    const bad = [...loaded.entries()]
      .filter(([target]) => PAGE_ONLY.includes(target) || PAGE_ONLY.includes(basename(target)))
      .map(([target, from]) => `${target} (from ${from})`);
    expect(bad).toEqual([]);
    // It does reach the loader and the collation.
    const names = [...loaded.keys()].map((path) => basename(path));
    expect(names).toContain("catalogCopy.ts");
    expect(names).toContain("collate.ts");
  });
});

// A small catalog, served for real, so the worker downloads its bundle itself.
const researcher = generateKeyPair();
const friend = generateKeyPair();
const E = "2026-11-03";
const mayor = { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: E };

function token(of: string | undefined, choice: string, keyPair = researcher): string {
  return createSlate({
    keyPair,
    issuer: { name: of ? "Researcher" : "Pat" },
    context: { election: E },
    ...(of
      ? {
          attribution: {
            of: { name: of },
            mode: "scraped" as const,
            retrieved_at: "2026-10-20T00:00:00Z",
          },
        }
      : {}),
    positions: [{ subject: mayor, stance: "endorse", choice }],
  }).token;
}

const catalogTokens = [
  token("Sierra Club", "Barbara Lee"),
  token("SEIU Local 1021", "Loren Taylor"),
];
const entries: CatalogEntry[] = catalogTokens.map((t, i) => ({
  slug: `e${i}`,
  election: E,
  path: `e${i}.slate`,
  issuer: { key: verifySlate(t).issuerKey ?? "", name: "Researcher" },
  attribution: { of: { name: `e${i}` }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
  positions: 1,
  issued_at: "2026-10-20T00:00:00Z",
}));
// One entry the bundle's token doesn't match: rejected.
entries.push({ ...(entries[0] as CatalogEntry), slug: "bad", path: "bad.slate" });
const bundle = {
  entries: [
    ...entries.slice(0, 2).map((e, i) => ({ ...e, token: catalogTokens[i] })),
    { ...entries[2], token: "garbage" },
  ],
};

let server: ReturnType<typeof Bun.serve>;
let catalogUrl = "";
let catalog: Catalog;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/bundle.json"
        ? Response.json(bundle)
        : new Response("not here", { status: 404 }),
  });
  catalogUrl = new URL("/index.json", server.url).href;
  catalog = {
    version: 1,
    generated_at: "v1",
    entries,
    bundle: { path: "bundle.json", bytes: JSON.stringify(bundle).length },
  };
});
afterAll(() => server.stop(true));

const imported = token(undefined, "Barbara Lee", friend);
const friendKey = verifySlate(imported).issuerKey ?? "";
const ask = {
  rows: [{ token: imported, importedAt: "2026-10-21" }],
  follows: {},
  contacts: [{ publicKey: friendKey, displayName: "My friend Pat" }],
};

describe("the catalog worker", () => {
  test("loads the catalog and lines up what the page would", async () => {
    const worker = new Worker(new URL("../src/lib/catalog.worker.ts", import.meta.url));
    const statuses: CatalogStatus[] = [];
    const asked: string[] = [];
    const send = (message: ToCatalogWorker) => worker.postMessage(message);
    try {
      let linedUp: (result: LinedUp) => void = () => {};
      const result = new Promise<LinedUp>((done) => {
        linedUp = done;
      });
      await new Promise<void>((ready, fail) => {
        worker.onerror = (event) => fail(event);
        worker.onmessage = (event: MessageEvent<FromCatalogWorker>) => {
          const message = event.data;
          if (message.type === "status") {
            statuses.push(message.status);
            if (message.status.state === "ready") ready();
            if (message.status.state === "error") fail(new Error(message.status.error));
          } else if (message.type === "ask") {
            asked.push(message.question.what);
            send({ type: "answer", id: message.id, value: catalog });
          } else if (message.result) linedUp(message.result);
          else fail(new Error(message.error));
        };
        send({ type: "load", catalogUrl });
      });
      // The page is asked for the list (its query cache has it); the bundle comes direct.
      expect(asked).toEqual(["catalog"]);
      const ready = statuses.at(-1);
      expect(ready).toEqual({
        state: "ready",
        copy: { catalogUrl, generatedAt: "v1", slates: 2, rejected: 1 },
      });
      expect(statuses.some((s) => s.state === "loading" && s.label === "Checking signatures")).toBe(
        true,
      );

      send({ type: "lineUp", id: 1, ask });
      const fromWorker = await result;

      // The same, worked out here with the same deps but no storage or network.
      const here = createCatalogService({
        fetchCatalog: async () => catalog,
        fetchBundle: async () => new Map(bundle.entries.map((e) => [e.path ?? "", e.token ?? ""])),
        fetchSlate: async () => {
          throw new Error("unused");
        },
        verify: (t) => {
          const r = verifySlate(t);
          return r.valid ? r.payload : undefined;
        },
        readCopy: async () => undefined,
        writeCopy: async () => {},
        yieldToPage: async () => {},
        now: () => 0,
      });
      here.load(catalogUrl);
      while (here.status().state !== "ready") await Bun.sleep(5);
      expect(fromWorker).toEqual(await here.lineUp(ask));
      expect(fromWorker.races).toHaveLength(1);
      const names = fromWorker.races[0]?.choices.flatMap((c) =>
        c.positions.map((p) => p.source.name),
      );
      expect(names).toContain("My friend Pat");
      expect(names).toContain("Sierra Club");
    } finally {
      worker.terminate();
    }
  });

  test("lining up before the catalog is in says so", async () => {
    const worker = new Worker(new URL("../src/lib/catalog.worker.ts", import.meta.url));
    try {
      const reply = await new Promise<FromCatalogWorker>((done) => {
        worker.onmessage = (event: MessageEvent<FromCatalogWorker>) => done(event.data);
        worker.postMessage({ type: "lineUp", id: 3, ask } satisfies ToCatalogWorker);
      });
      expect(reply).toEqual({ type: "linedUp", id: 3, error: "the catalog isn't loaded" });
    } finally {
      worker.terminate();
    }
  });
});
