import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, verifySlate } from "@openslate/core";
import { type CopyDeps, createCatalogLoader } from "../src/lib/catalogCopy";
import { decodeSlates, isDecoded, verifyAhead } from "../src/lib/collate";
import { decodeSlatesInSlices } from "../src/lib/decodedSlates";
import type { Catalog, CatalogEntry } from "../src/lib/query";

const keyPair = generateKeyPair();

function token(of: string): string {
  return createSlate({
    keyPair,
    issuer: { name: "Researcher" },
    context: { election: "2026-11-03" },
    attribution: { of: { name: of }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
    positions: [
      {
        subject: { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: "2026-11-03" },
        stance: "endorse",
        choice: `Candidate ${of}`,
      },
    ],
  }).token;
}

/** The same token with its signature's middle character changed. */
function badSignature(t: string): string {
  const [h, p, s = ""] = t.split(".");
  const at = Math.floor(s.length / 2);
  return `${h}.${p}.${s.slice(0, at)}${s[at] === "A" ? "B" : "A"}${s.slice(at + 1)}`;
}

describe("verifyAhead", () => {
  test("leaves decodeSlates the result it would have worked out itself", async () => {
    const good = token("ahead-good");
    const bad = badSignature(token("ahead-bad"));
    const rows = [good, bad, "garbage"].map((t) => ({ token: t, importedAt: "x" }));
    await verifyAhead(rows.map((r) => r.token));
    for (const row of rows) expect(isDecoded(row.token)).toBe(true);
    const out = decodeSlates(rows);
    expect(out.map((s) => [s.token, s.valid])).toEqual([
      [good, true],
      [bad, false],
    ]);
    expect(out[0]?.payload).toEqual(verifySlate(good).payload);
  });

  test("decodeSlatesInSlices with it gives what it gives without", async () => {
    const rows = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"].map((of, i) => ({
      token: i === 4 ? badSignature(token(of)) : token(of),
      importedAt: "x",
    }));
    const asked: string[][] = [];
    const out = await decodeSlatesInSlices(rows, {
      yieldToPage: async () => {},
      now: () => 0,
      verifyAhead: async (tokens) => {
        asked.push(tokens);
        await verifyAhead(tokens);
      },
    });
    expect(asked.flat()).toEqual(rows.map((r) => r.token));
    expect(Math.max(...asked.map((a) => a.length))).toBeLessThanOrEqual(8);
    expect(out?.map((s) => s.valid)).toEqual(rows.map((r) => verifySlate(r.token).valid));
  });
});

describe("the catalog loader's verifyAhead", () => {
  test("each token is checked ahead once, a few at a time, and verify finds them done", async () => {
    const entries: CatalogEntry[] = Array.from({ length: 20 }, (_, i) => ({
      slug: `e${i}`,
      election: "2026-11-03",
      path: `e${i}.slate`,
      issuer: { key: verifySlate(token("x")).issuerKey ?? "", name: "Researcher" },
      attribution: { of: { name: `e${i}` }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
      positions: 1,
      issued_at: "2026-10-20T00:00:00Z",
    }));
    const tokens = new Map(entries.map((e) => [e.path, token(e.slug)]));
    const catalog: Catalog = {
      version: 1,
      generated_at: "v1",
      entries,
      bundle: { path: "bundle.json", bytes: 1 },
    };
    const ahead = new Map<string, ReturnType<typeof verifySlate>>();
    const batches: number[] = [];
    let slow = 0;
    let clock = 0;
    const deps: CopyDeps = {
      fetchCatalog: async () => catalog,
      fetchBundle: async () => tokens,
      fetchSlate: async () => {
        throw new Error("unused");
      },
      verify(t) {
        const done = ahead.get(t);
        if (!done) slow++;
        const result = done ?? verifySlate(t);
        return result.valid ? result.payload : undefined;
      },
      async verifyAhead(list) {
        batches.push(list.length);
        for (const t of list) ahead.set(t, verifySlate(t));
      },
      readCopy: async () => undefined,
      writeCopy: async () => {},
      yieldToPage: async () => {},
      now: () => (clock += 1),
    };
    const loader = createCatalogLoader(deps);
    await loader.load("https://catalog.test/index.json");
    const status = loader.status();
    if (status.state !== "ready") throw new Error(status.state);
    expect(status.copy.slates).toHaveLength(20);
    expect(slow).toBe(0);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(20);
    expect(Math.max(...batches)).toBeLessThanOrEqual(8);
  });
});
