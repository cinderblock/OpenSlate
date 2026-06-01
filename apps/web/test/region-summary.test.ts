import { describe, expect, test } from "bun:test";
import type { RegionResult } from "@openslate/core";
import { aggregateRegions, normalizeRegions, sortRegions } from "../src/lib/region-summary";

const sample: Record<string, RegionResult> = {
  adair: {
    name: "Adair",
    type: "County",
    fill: "#c6606b",
    percent_reporting: 100,
    candidates: [
      { name: "Jane", percent: 60, votes: 2094 },
      { name: "Bob", percent: 40, votes: 934 },
    ],
  },
  benton: {
    name: "Benton",
    type: "County",
    percent_reporting: 78,
    candidates: [
      { name: "Bob", percent: 51, votes: 5100 },
      { name: "Jane", percent: 49, votes: 4900 },
    ],
  },
  cedar: {
    name: "Cedar",
    type: "County",
    percent_reporting: 100,
    candidates: [
      { name: "Jane", percent: 90, votes: 10000 },
      { name: "Bob", percent: 10, votes: 1111 },
    ],
  },
};

describe("normalizeRegions", () => {
  test("computes leader + runner-up + margin + totals", () => {
    const out = normalizeRegions(sample);
    expect(out).toHaveLength(3);

    const adair = out.find((r) => r.slug === "adair");
    expect(adair?.leader?.name).toBe("Jane");
    expect(adair?.runnerUp?.name).toBe("Bob");
    expect(adair?.margin).toBeCloseTo(20, 5);
    expect(adair?.totalVotes).toBe(2094 + 934);
  });

  test("undefined input → empty array", () => {
    expect(normalizeRegions(undefined)).toEqual([]);
  });

  test("preserves slug, name, fill, type", () => {
    const out = normalizeRegions({
      foo: { name: "Foo", type: "Town", fill: "#abcdef", candidates: [] },
    });
    expect(out[0]).toMatchObject({
      slug: "foo",
      name: "Foo",
      type: "Town",
      fill: "#abcdef",
    });
  });

  test("region with no candidates → leader undefined, margin NaN", () => {
    const out = normalizeRegions({ empty: { name: "Empty", candidates: [] } });
    expect(out[0]?.leader).toBeUndefined();
    expect(Number.isNaN(out[0]?.margin ?? 0)).toBe(true);
  });
});

describe("sortRegions", () => {
  const norm = normalizeRegions(sample);

  test("votes_desc: highest totals first", () => {
    const out = sortRegions(norm, "votes_desc");
    expect(out.map((r) => r.slug)).toEqual(["cedar", "benton", "adair"]);
  });

  test("margin_asc: closest race first", () => {
    const out = sortRegions(norm, "margin_asc");
    expect(out[0]?.slug).toBe("benton"); // 2pp margin
  });

  test("margin_desc: widest blowout first", () => {
    const out = sortRegions(norm, "margin_desc");
    expect(out[0]?.slug).toBe("cedar"); // 80pp margin
  });

  test("reporting_asc: least-reported first", () => {
    const out = sortRegions(norm, "reporting_asc");
    expect(out[0]?.slug).toBe("benton"); // 78%
  });

  test("name_asc: alphabetical", () => {
    const out = sortRegions(norm, "name_asc");
    expect(out.map((r) => r.name)).toEqual(["Adair", "Benton", "Cedar"]);
  });

  test("name_asc collates numerics naturally", () => {
    const norm = normalizeRegions({
      a: { name: "District 2", candidates: [] },
      b: { name: "District 10", candidates: [] },
      c: { name: "District 1", candidates: [] },
    });
    expect(sortRegions(norm, "name_asc").map((r) => r.name)).toEqual([
      "District 1",
      "District 2",
      "District 10",
    ]);
  });
});

describe("aggregateRegions", () => {
  test("tallies leaders across regions", () => {
    const out = aggregateRegions(normalizeRegions(sample));
    expect(out.totalRegions).toBe(3);
    expect(out.fullyReporting).toBe(2);
    expect(out.totalVotes).toBe(2094 + 934 + 5100 + 4900 + 10000 + 1111);
    expect(out.leaderTally.get("Jane")).toBe(2);
    expect(out.leaderTally.get("Bob")).toBe(1);
  });

  test("empty input → zeroed aggregate", () => {
    const out = aggregateRegions([]);
    expect(out.totalRegions).toBe(0);
    expect(out.totalVotes).toBe(0);
    expect(out.leaderTally.size).toBe(0);
  });
});
