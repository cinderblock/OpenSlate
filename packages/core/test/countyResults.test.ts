import { expect, test } from "bun:test";
import {
  CA_COUNTY_FEEDS,
  feedPathTtl,
  isStateContest,
  parseClaritySummary,
  parseClarityVersion,
} from "../src/countyResults";
import summary from "./fixtures/clarity-summary-santa-clara.json";

const santaClara = CA_COUNTY_FEEDS["santa-clara"];

test("a Clarity summary reads as contests: offices, local seats, measures", () => {
  const contests = parseClaritySummary(summary);
  expect(contests.map((c) => c.key).sort()).toEqual(["1", "126", "43", "91"]);
  const governor = contests.find((c) => c.key === "1");
  expect(governor).toMatchObject({
    title: "Governor",
    category: "State and Federal",
    measure: false,
    voteFor: 1,
    precincts: { total: 708, reporting: 0 },
  });
  expect(governor?.choices[0]).toEqual({
    name: "Steve Hilton",
    party: "REP",
    votes: 0,
    percent: 0,
  });
  const measure = contests.find((c) => c.key === "126");
  expect(measure?.measure).toBe(true);
  expect(measure?.choices.map((c) => c.name)).toEqual(["YES", "NO"]);
  expect(measure?.choices[0]?.party).toBeUndefined();
  if (!governor || !measure) throw new Error("fixture lost a contest");
  expect(isStateContest(governor)).toBe(true);
  expect(isStateContest(measure)).toBe(false);
});

test("votes and percents are read as numbers", () => {
  const [c] = parseClaritySummary([
    { K: "7", C: "Mayor", VF: 1, CH: ["A", "B"], P: ["", ""], V: [1200, "800"], PCT: [60, 40] },
  ]);
  expect(c?.choices).toEqual([
    { name: "A", votes: 1200, percent: 60 },
    { name: "B", votes: 800, percent: 40 },
  ]);
  expect(c?.precincts).toBeUndefined();
});

test("anything but a contest list is refused", () => {
  expect(() => parseClaritySummary({ error: "x" })).toThrow();
});

test("the version pointer and the allowlist", () => {
  expect(parseClarityVersion("383439\r\n")).toBe("383439");
  expect(parseClarityVersion("<html>")).toBeNull();
  expect(santaClara).toBeDefined();
  if (!santaClara) return;
  expect(feedPathTtl(santaClara, "current_ver.txt")).toBe(60);
  expect(feedPathTtl(santaClara, "383439/json/en/summary.json")).toBe(3600);
  expect(feedPathTtl(santaClara, "383439/json/ALL.json")).toBeNull();
  expect(feedPathTtl(santaClara, "../x")).toBeNull();
  expect(feedPathTtl(santaClara, "383439/json/en/summary.json?x=1")).toBeNull();
});

test("state contests are known however a county words them; judges stay local", () => {
  const state = (title: string, category?: string) =>
    isStateContest({
      key: "1",
      title,
      ...(category ? { category } : {}),
      measure: false,
      voteFor: 1,
      choices: [],
    });
  expect(state("GOVERNOR", "Results")).toBe(true);
  expect(state("Prop 42 - Prohibits New State Personal Property Taxes")).toBe(true);
  expect(state("PROPOSITION 43")).toBe(true);
  expect(state("Member, State Board Equalization-District 2", "Results")).toBe(true);
  expect(state("United States Representative, 26th Congressional District")).toBe(true);
  expect(state("AJ 2nd App Dist, Div 8 - John Wiley", "State")).toBe(false);
  expect(state("Associate Justice of The Supreme Court-Kelli M Evans", "Results")).toBe(false);
  expect(state("Treasurer-Tax Collector", "County")).toBe(false);
  expect(state("Measure A - City of Novato", "Local Measures")).toBe(false);
});
