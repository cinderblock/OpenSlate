import { describe, expect, test } from "bun:test";
import type { ContestResult } from "../src/lib/liveCount";
import {
  type ContestFacts,
  leadOf,
  manualOrder,
  moveInOrder,
  sortContests,
} from "../src/lib/watchSort";

const race = (percents: number[], precincts?: number, votes = 100): ContestResult => ({
  kind: "candidates",
  title: "",
  reporting: { text: "", ...(precincts !== undefined ? { percent: precincts } : {}) },
  candidates: percents.map((p, i) => ({
    name: `C${i}`,
    votes: Math.round((votes * p) / 100),
    percent: p,
    incumbent: false,
  })),
});

const measure = (yes: number): ContestResult => ({
  kind: "measure",
  title: "",
  reporting: { text: "" },
  measure: { number: "1", name: "", yes, no: 100 - yes, yesPercent: yes, noPercent: 100 - yes },
});

const facts: Record<string, ContestFacts> = {
  gov: { title: "Governor", result: race([52, 48], 40), updatedAt: 3 },
  ad: { title: "Assembly 24", result: race([70, 30], 80), updatedAt: 1 },
  prop: { title: "Proposition 1", result: measure(49), updatedAt: 2 },
  none: { title: "Board of Equalization", result: race([0, 0], 0, 0) },
  loading: { title: "Controller" },
};
const ids = ["gov", "ad", "prop", "none", "loading"];
const of = (id: string) => facts[id] as ContestFacts;

describe("sorting the live count", () => {
  test("leads", () => {
    expect(leadOf(race([52, 48]))).toBeCloseTo(4);
    expect(leadOf(measure(49))).toBeCloseTo(2);
    expect(leadOf(race([0, 0], 0, 0))).toBeUndefined();
    expect(leadOf(race([100]))).toBe(100);
  });

  test("closest and clearest, races without votes last", () => {
    expect(sortContests(ids, "closest", of)).toEqual(["prop", "gov", "ad", "none", "loading"]);
    expect(sortContests(ids, "clearest", of)).toEqual(["ad", "gov", "prop", "none", "loading"]);
  });

  test("most counted, recently updated, A–Z, ballot", () => {
    expect(sortContests(ids, "counted", of).slice(0, 2)).toEqual(["ad", "gov"]);
    expect(sortContests(ids, "updated", of)).toEqual(["gov", "prop", "ad", "none", "loading"]);
    expect(sortContests(ids, "alpha", of)).toEqual(["ad", "none", "loading", "gov", "prop"]);
    expect(sortContests(ids, "ballot", of)).toEqual(ids);
  });

  test("your order: placed races first, then the rest as they were", () => {
    expect(manualOrder(ids, ["prop", "gov"])).toEqual(["prop", "gov", "ad", "none", "loading"]);
    expect(sortContests(ids, "manual", of, ["ad"])).toEqual([
      "ad",
      "gov",
      "prop",
      "none",
      "loading",
    ]);
  });

  test("moving a race up and down", () => {
    const shown = ["gov", "ad", "prop"];
    const once = moveInOrder([], shown, "prop", -1);
    expect(manualOrder(shown, once)).toEqual(["gov", "prop", "ad"]);
    const twice = moveInOrder(once, shown, "prop", -1);
    expect(manualOrder(shown, twice)).toEqual(["prop", "gov", "ad"]);
    expect(moveInOrder(twice, shown, "prop", -1)).toEqual(twice);
    // A race in another section keeps its place in the order.
    const withOther = moveInOrder(["other", "gov"], shown, "ad", -1);
    expect(withOther).toContain("other");
    expect(manualOrder(shown, withOther)).toEqual(["ad", "gov", "prop"]);
  });
});
