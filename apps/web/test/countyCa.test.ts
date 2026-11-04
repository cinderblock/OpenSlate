import { describe, expect, test } from "bun:test";
import { type CountyContest, parseClaritySummary } from "@openslate/core";
import {
  contestEntity,
  contestsForPlace,
  coreName,
  countyContestId,
  countyContestResult,
  countyFeed,
  localContests,
  parseCountyContestId,
} from "../src/lib/countyCa";

function contest(key: string, title: string, category = "Local", choices = ["A", "B"]) {
  return parseClaritySummary([
    {
      K: key,
      C: title,
      CAT: category,
      VF: 1,
      TP: 10,
      PR: 4,
      CH: choices,
      P: [],
      V: [3, 1],
      PCT: [75, 25],
    },
  ])[0] as CountyContest;
}

const SANTA_CLARA = [
  contest("1", "Governor", "State and Federal"),
  contest("101", "State Proposition 1 - Housing", "Propositions", ["YES", "NO"]),
  contest("21", "Associate Justice of Supreme Court JOSHUA GROBAN", "Judicial", ["YES", "NO"]),
  contest("93", "City of Sunnyvale Council, District 1"),
  contest("94", "City of Sunnyvale Council, District 3"),
  contest("89", "Mayor, City of Santa Clara"),
  contest("43", "San José Unified SD, Trustee Area 2", "School"),
  contest("67", "Sunnyvale SD, Trustee Area 3", "School"),
  contest("48", "Fremont Union HSD, TA 3", "School"),
  contest("28", "Santa Clara County BOE, Trustee Area 7", "School"),
  contest(
    "122",
    "Measure G - City of Sunnyvale, Charter Amendment - Majority Vote Required",
    "Measures",
    ["YES", "NO"],
  ),
  contest(
    "128",
    "Measure M - Gilroy Unified School District, School Bond - 55% Vote Required",
    "Measures",
    ["YES", "NO"],
  ),
  contest("96", "Santa Clara Valley Water, District 1"),
];

describe("county results", () => {
  test("contest ids round-trip", () => {
    expect(countyContestId("santa-clara", "91")).toBe("county-ca/santa-clara/91");
    expect(parseCountyContestId("county-ca/santa-clara/91")).toEqual({
      county: "santa-clara",
      key: "91",
    });
    expect(parseCountyContestId("governor")).toBeNull();
  });

  test("a county with a feed is found by name or slug", () => {
    expect(countyFeed("Santa Clara")?.slug).toBe("santa-clara");
    expect(countyFeed("santa-clara")?.slug).toBe("santa-clara");
    expect(countyFeed("Nowhere")).toBeNull();
    expect(countyFeed(undefined)).toBeNull();
  });

  test("state and federal contests and statewide props aren't local", () => {
    const keys = localContests(SANTA_CLARA).map((c) => c.key);
    expect(keys).not.toContain("1");
    expect(keys).not.toContain("101");
    expect(keys).toContain("93");
  });

  test("a contest becomes the Live page's shape", () => {
    const r = countyContestResult(contest("93", "City of Sunnyvale Council, District 1"));
    expect(r.kind).toBe("candidates");
    expect(r.reporting.percent).toBe(40);
    expect(r.reporting.text).toBe("4 of 10 precincts reporting");
    const m = countyContestResult(SANTA_CLARA[10] as CountyContest);
    expect(m.kind === "measure" && m.measure).toMatchObject({ yes: 3, no: 1, yesPercent: 75 });
  });

  test("names compare without the generic words or accents", () => {
    expect(coreName("San José Unified SD")).toBe("san jose");
    expect(coreName("San Jose Unified School District")).toBe("san jose");
    expect(coreName("City of Sunnyvale Council")).toBe("sunnyvale");
    expect(contestEntity("City of Sunnyvale Council, District 3")).toEqual({
      entity: "City of Sunnyvale Council",
      district: "3",
    });
    expect(contestEntity("Mayor, City of Santa Clara")).toEqual({ entity: "City of Santa Clara" });
    expect(contestEntity("Fremont Union HSD, TA 3").district).toBe("3");
    expect(contestEntity("Measure G - City of Sunnyvale, Charter Amendment").entity).toBe(
      "City of Sunnyvale",
    );
  });

  test("a Sunnyvale voter's local contests", () => {
    const area = {
      localities: ["us/ca/sunnyvale", "us/ca/santa-clara-county"],
      districts: { "us/ca/sunnyvale/council": "3" },
      labels: {
        "us/ca/sunnyvale/council": "Sunnyvale council district 3",
        "us/ca/elsd": "Sunnyvale School District",
        "us/ca/hsd": "Fremont Union High School District",
      },
    };
    const keys = contestsForPlace(SANTA_CLARA, area, "Santa Clara").map((c) => c.key);
    expect(keys.sort()).toEqual(["122", "21", "28", "48", "67", "94"].sort());
  });

  test("council seats all stay when the place's council district isn't known", () => {
    const keys = contestsForPlace(
      SANTA_CLARA,
      { localities: ["us/ca/sunnyvale"], districts: {} },
      "Santa Clara",
    ).map((c) => c.key);
    expect(keys).toContain("93");
    expect(keys).toContain("94");
  });
});
