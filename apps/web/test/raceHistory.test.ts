import { describe, expect, test } from "bun:test";
import { niceTicks, seriesColor } from "../src/components/RaceHistoryChart";
import { appendPoint, MAX_POINTS, type RaceHistory } from "../src/lib/raceHistory";
import type { ContestResult } from "../src/lib/sosCa";

const at = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00Z`);

const measure = (yes: number, no: number, percent?: number): ContestResult => ({
  kind: "measure",
  title: "Measure O",
  reporting: { text: "", ...(percent !== undefined ? { percent } : {}) },
  measure: { number: "", name: "", yes, no, yesPercent: 0, noPercent: 0 },
});

const race = (votes: Record<string, number>): ContestResult => ({
  kind: "candidates",
  title: "Council",
  reporting: { text: "" },
  candidates: Object.entries(votes)
    .map(([name, v]) => ({ name, votes: v, percent: 0, incumbent: false }))
    .sort((a, b) => b.votes - a.votes),
});

describe("a race's history", () => {
  test("one point per report that changed the numbers", () => {
    let h = appendPoint(undefined, measure(1171, 418), at("04:15"));
    expect(h).toEqual({ names: ["Yes", "No"], points: [{ at: at("04:15"), v: [1171, 418] }] });
    const same = appendPoint(h, measure(1171, 418), at("05:00"));
    expect(same).toBe(h);
    h = appendPoint(h, measure(1329, 471, 40), at("05:59"));
    expect(h?.points.map((p) => [p.at, p.v, p.p])).toEqual([
      [at("04:15"), [1171, 418], undefined],
      [at("05:59"), [1329, 471], 40],
    ]);
  });

  test("a choice keeps its place when the order of the count changes", () => {
    let h = appendPoint(undefined, race({ Ann: 10, Bo: 5 }), at("04:00"));
    h = appendPoint(h, race({ Ann: 12, Bo: 20 }), at("05:00"));
    expect(h?.names).toEqual(["Ann", "Bo"]);
    expect(h?.points.at(-1)?.v).toEqual([12, 20]);
  });

  test("a choice first seen later counts 0 in earlier reports", () => {
    let h = appendPoint(undefined, race({ Ann: 10 }), at("04:00"));
    h = appendPoint(h, race({ Ann: 12, Cy: 3 }), at("05:00"));
    expect(h?.names).toEqual(["Ann", "Cy"]);
    expect(h?.points.map((p) => p.v)).toEqual([
      [10, 0],
      [12, 3],
    ]);
  });

  test("a corrected report at the same time replaces it; the log is capped", () => {
    let h: RaceHistory | undefined = appendPoint(undefined, measure(1, 1), at("04:00"));
    h = appendPoint(h, measure(2, 1), at("04:00"));
    expect(h?.points).toHaveLength(1);
    for (let i = 0; i < MAX_POINTS + 10; i++)
      h = appendPoint(h, measure(i + 10, 1), at("04:00") + (i + 1) * 60_000);
    expect(h?.points).toHaveLength(MAX_POINTS);
  });

  test("all the propositions at once aren't charted", () => {
    const all: ContestResult = {
      kind: "measures",
      title: "",
      reporting: { text: "" },
      measures: [],
    };
    expect(appendPoint(undefined, all, at("04:00"))).toBeUndefined();
  });
});

describe("the history chart", () => {
  test("round ticks from 0", () => {
    expect(niceTicks(1329)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(3_054_979)).toEqual([0, 2_000_000, 4_000_000]);
    expect(niceTicks(0)).toEqual([0]);
  });

  test("Yes / No keep blue / orange; candidates take the palette in order, gray past eight", () => {
    expect(seriesColor(["Yes", "No"], 0)).toBe("var(--series-1)");
    expect(seriesColor(["Yes", "No"], 1)).toBe("var(--series-2)");
    expect(seriesColor(["A", "B", "C"], 2)).toBe("var(--series-3)");
    expect(seriesColor(Array(9).fill("x"), 8)).toBe("var(--muted)");
  });
});
