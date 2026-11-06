import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createSlate, generateKeyPair } from "@openslate/core";
import { decodeSlates } from "../src/lib/collate";
import { type LineUpInput, lineUp } from "../src/lib/lineUp";
import type { LineUpReply } from "../src/lib/lineUp.worker";

const LIB = join(import.meta.dir, "../src/lib");

/** Modules a worker can't load: React, the database, storage, the query client. */
const PAGE_ONLY = [
  "react",
  "react-dom",
  "@tanstack/react-db",
  "@tanstack/react-query",
  "idb-keyval",
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

describe("lineUp off the page", () => {
  test("the import walk finds what a page module loads", () => {
    const loaded = [...runtimeImports(join(LIB, "allSlates.ts")).keys()];
    expect(loaded).toContain("react");
    expect(loaded.map((path) => basename(path))).toContain("collections.ts");
  });

  test("the worker loads nothing only a page has", () => {
    const loaded = runtimeImports(join(LIB, "lineUp.worker.ts"));
    const bad = [...loaded.entries()]
      .filter(([target]) => PAGE_ONLY.includes(target) || PAGE_ONLY.includes(basename(target)))
      .map(([target, from]) => `${target} (from ${from})`);
    expect(bad).toEqual([]);
    // It does reach the collation itself.
    expect([...loaded.keys()].some((path) => path.endsWith("collate.ts"))).toBe(true);
  });

  test("the worker lines up what the page would", async () => {
    const researcher = generateKeyPair();
    const friend = generateKeyPair();
    const token = (of: string | undefined, choice: string, keyPair = researcher) =>
      createSlate({
        keyPair,
        issuer: { name: of ? "Researcher" : "Pat" },
        context: { election: "2026-11-03" },
        ...(of
          ? {
              attribution: {
                of: { name: of },
                mode: "scraped" as const,
                retrieved_at: "2026-10-20T00:00:00Z",
              },
            }
          : {}),
        positions: [
          {
            subject: {
              title: "Oakland Mayor",
              jurisdiction: "us/ca/oakland",
              election: "2026-11-03",
            },
            stance: "endorse",
            choice,
          },
        ],
      }).token;
    const imported = decodeSlates([
      { token: token(undefined, "Barbara Lee", friend), importedAt: "2026-10-21" },
    ]);
    const catalog = decodeSlates(
      [token("Sierra Club", "Barbara Lee"), token("SEIU Local 1021", "Loren Taylor")].map((t) => ({
        token: t,
        importedAt: "v1",
      })),
    );
    const friendKey = imported[0]?.source.signerKey ?? "";
    const input: LineUpInput = {
      imported,
      catalog,
      follows: {},
      contacts: [{ publicKey: friendKey, displayName: "My friend Pat" }],
      rejected: 1,
      generatedAt: "v1",
    };

    const worker = new Worker(new URL("../src/lib/lineUp.worker.ts", import.meta.url));
    try {
      const reply = await new Promise<LineUpReply>((done, fail) => {
        worker.onmessage = (event: MessageEvent<LineUpReply>) => done(event.data);
        worker.onerror = (event) => fail(event);
        worker.postMessage({ id: 7, input });
      });
      expect(reply.id).toBe(7);
      if (!("result" in reply)) throw new Error(reply.error);
      const here = lineUp(input);
      expect(reply.result).toEqual(here);
      expect(here.races).toHaveLength(1);
      const sources = here.races[0]?.choices.flatMap((c) => c.positions.map((p) => p.source.name));
      expect(sources).toContain("My friend Pat");
    } finally {
      worker.terminate();
    }
  });
});
