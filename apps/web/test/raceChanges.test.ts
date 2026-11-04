import { describe, expect, test } from "bun:test";
import { nextRaceChange, raceFingerprint } from "../src/lib/raceChanges";
import type { ContestResult } from "../src/lib/sosCa";

const measure = (yes: number, no: number, percent?: number): ContestResult => ({
  kind: "measure",
  title: "Measure O",
  reporting: { text: "", ...(percent !== undefined ? { percent } : {}) },
  measure: { number: "", name: "", yes, no, yesPercent: 0, noPercent: 0 },
});

const at = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00Z`);

describe("when a race's own numbers changed", () => {
  test("a new report with the same numbers leaves the race's time alone", () => {
    const first = nextRaceChange(undefined, raceFingerprint(measure(1171, 418)), at("04:15"));
    expect(first).toEqual({
      fp: raceFingerprint(measure(1171, 418)),
      at: at("04:15"),
      exact: false,
    });
    const same = nextRaceChange(first, raceFingerprint(measure(1171, 418)), at("05:00"));
    expect(same).toBe(first);
  });

  test("new numbers take the report's time, and it's exact", () => {
    const first = nextRaceChange(undefined, raceFingerprint(measure(1171, 418)), at("04:15"));
    const moved = nextRaceChange(first, raceFingerprint(measure(1500, 520)), at("05:00"));
    expect(moved).toMatchObject({ at: at("05:00"), exact: true });
  });

  test("precincts reporting count as the race's numbers too", () => {
    expect(raceFingerprint(measure(10, 5, 20))).not.toBe(raceFingerprint(measure(10, 5, 40)));
  });

  test("candidates' votes, by name", () => {
    const race = (a: number, b: number): ContestResult => ({
      kind: "candidates",
      title: "Mayor",
      reporting: { text: "" },
      candidates: [
        { name: "A", votes: a, percent: 0, incumbent: false },
        { name: "B", votes: b, percent: 0, incumbent: false },
      ],
    });
    expect(raceFingerprint(race(3, 4))).toBe(raceFingerprint(race(3, 4)));
    expect(raceFingerprint(race(3, 4))).not.toBe(raceFingerprint(race(3, 5)));
  });
});
