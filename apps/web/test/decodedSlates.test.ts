import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair } from "@openslate/core";
import { decodeSlates, isDecoded } from "../src/lib/collate";
import { decodeSlatesInSlices } from "../src/lib/decodedSlates";

function makeRow(name: string) {
  const { token } = createSlate({
    keyPair: generateKeyPair(),
    issuer: { name, kind: "individual" },
    positions: [{ subject: { title: "Mayor" }, stance: "endorse", choice: "X" }],
  });
  return { token, importedAt: "2026-11-01T00:00:00Z" };
}

/** A clock that moves `step` ms each time it's read, so every slate fills a slice. */
function tickingClock(step: number) {
  let t = 0;
  return () => (t += step);
}

describe("decodeSlatesInSlices", () => {
  test("gives what decodeSlates would, in order, yielding between slices", async () => {
    const rows = [makeRow("A"), makeRow("B"), makeRow("C")];
    let yields = 0;
    const progress: number[] = [];
    const out = await decodeSlatesInSlices(rows, {
      yieldToPage: async () => {
        yields++;
      },
      now: tickingClock(10),
      budgetMs: 8,
      onProgress: (done, total) => {
        expect(total).toBe(3);
        progress.push(done);
      },
    });
    expect(out?.map((s) => s.payload.issuer.name)).toEqual(["A", "B", "C"]);
    expect(out).toEqual(decodeSlates(rows));
    expect(yields).toBe(3);
    expect(progress).toEqual([1, 2, 3]);
    for (const row of rows) expect(isDecoded(row.token)).toBe(true);
  });

  test("slates already verified don't cost a slice", async () => {
    const rows = [makeRow("D"), makeRow("E")];
    decodeSlates(rows);
    let yields = 0;
    const out = await decodeSlatesInSlices(rows, {
      yieldToPage: async () => {
        yields++;
      },
      now: tickingClock(10),
      budgetMs: 8,
    });
    expect(out).toHaveLength(2);
    expect(yields).toBe(0);
  });

  test("drops tokens that don't parse, as decodeSlates does", async () => {
    const good = makeRow("F");
    const out = await decodeSlatesInSlices([good, { token: "not.a.token", importedAt: "" }], {
      yieldToPage: async () => {},
      now: () => 0,
    });
    expect(out?.map((s) => s.token)).toEqual([good.token]);
  });

  test("stops when aborted", async () => {
    const rows = [makeRow("G"), makeRow("H"), makeRow("I")];
    const controller = new AbortController();
    const out = await decodeSlatesInSlices(rows, {
      yieldToPage: async () => controller.abort(),
      now: tickingClock(10),
      budgetMs: 8,
      signal: controller.signal,
    });
    expect(out).toBeUndefined();
    expect(isDecoded(rows[0]?.token ?? "")).toBe(true);
    expect(isDecoded(rows[1]?.token ?? "")).toBe(false);
  });
});
