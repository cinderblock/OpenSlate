import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CA_COUNTY_FEEDS,
  feedPathTtl,
  isStateContest,
  lvtSummaryPath,
  parseClaritySummary,
  parseClarityVersion,
  parseLvtCsv,
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

test("a livevoterturnout.com summary CSV reads as contests", () => {
  const text = readFileSync(join(import.meta.dir, "fixtures/lvt-summary-orange.csv"), "utf8");
  const contests = parseLvtCsv(text);
  expect(contests.map((c) => c.title)).toEqual([
    "Governor",
    "A – Laguna Beach Unified School District, Bond Measure",
    "CITY OF ALISO VIEJO Member, City Council District 2",
    "CITY OF ALISO VIEJO Member, City Council District 3, Short Term",
  ]);
  const [governor, bond, council] = contests;
  expect(governor?.key).toBe("governor");
  expect(governor?.choices.map((c) => [c.name, c.party])).toEqual([
    ["XAVIER BECERRA", "DEM"],
    ["STEVE HILTON", "REP"],
  ]);
  expect(governor?.precincts).toEqual({ total: 2377, reporting: 0 });
  expect(governor?.voteFor).toBe(1);
  expect(bond?.measure).toBe(true);
  expect(bond?.voteFor).toBe(0);
  expect(bond?.key).toBe("a-laguna-beach-unified-school-district-bond-measure");
  expect(council?.choices[1]).toEqual({
    name: "MAX DUNCAN",
    votes: 0,
    percent: 0,
    incumbent: true,
  });
});

test("livevoterturnout votes become percents of the contest; columns are found by name", () => {
  const text = [
    "Unofficial Election Results",
    "San Mateo",
    "Contest Name,Candidate Name,Party,Vote by Mail Ballots Votes,Total Votes,Number Of Precincts,Precincts Reported",
    '"Total Precincts Reported","3"',
    '"Measure X, ""quoted""","YES","","-","300","10","3"',
    '"Measure X, ""quoted""","NO","","-","100","10","3"',
  ].join("\r\n");
  const [m] = parseLvtCsv(text);
  expect(m?.title).toBe('Measure X, "quoted"');
  expect(m?.choices.map((c) => [c.name, c.votes, c.percent])).toEqual([
    ["YES", 300, 75],
    ["NO", 100, 25],
  ]);
  expect(m?.precincts).toEqual({ total: 10, reporting: 3 });
  expect(() => parseLvtCsv("<html>Not found</html>")).toThrow();
});

test("a livevoterturnout county reads only its summary file, and never directly", () => {
  const orange = CA_COUNTY_FEEDS.orange;
  if (!orange) throw new Error("Orange missing");
  expect(orange.cors).toBe(false);
  expect(lvtSummaryPath(orange)).toBe("summary_24.csv");
  expect(feedPathTtl(orange, "summary_24.csv")).toBe(60);
  expect(feedPathTtl(orange, "summary_23.csv")).toBeNull();
  expect(feedPathTtl(orange, "current_ver.txt")).toBeNull();
  expect(
    isStateContest({
      key: "x",
      title: "State of California Governor",
      measure: false,
      voteFor: 1,
      choices: [],
    }),
  ).toBe(true);
  expect(
    isStateContest({
      key: "x",
      title: "San Bernardino County PROPOSITION 42",
      measure: true,
      voteFor: 0,
      choices: [],
    }),
  ).toBe(true);
  expect(
    isStateContest({
      key: "x",
      title: "11th Assembly District",
      measure: false,
      voteFor: 1,
      choices: [],
    }),
  ).toBe(true);
  expect(
    isStateContest({
      key: "x",
      title: "City of Fontana City Treasurer",
      measure: false,
      voteFor: 1,
      choices: [],
    }),
  ).toBe(false);
});
