import { describe, expect, test } from "bun:test";
import {
  contestLabel,
  contestPath,
  countySlug,
  districtContest,
  NotOnBallot,
  normalizeContest,
  num,
  parseReporting,
} from "../src/lib/sosCa";

describe("Secretary of State results", () => {
  test("numbers with commas", () => {
    expect(num("1,234,567")).toBe(1234567);
    expect(num("52.3")).toBe(52.3);
    expect(num(undefined)).toBe(0);
    expect(num("n/a")).toBe(0);
  });

  test("reporting prose", () => {
    const r = parseReporting(
      "12.3% (2,935 of 23,860) precincts reporting",
      "November 3, 2026, 8:15 p.m.",
    );
    expect(r.percent).toBe(12.3);
    expect(r.time).toBe("November 3, 2026, 8:15 p.m.");
  });

  test("a candidate race, leader first", () => {
    const result = normalizeContest({
      raceTitle: "Governor - Statewide Results",
      Reporting: "5% (1 of 20) precincts reporting",
      ReportingTime: "November 3, 2026, 8:15 p.m.",
      candidates: [
        { Name: "A", Party: "Dem", Votes: "1,000", Percent: "40.0", incumbent: false },
        { Name: "B", Party: "Rep", Votes: "1,500", Percent: "60.0", incumbent: true },
      ],
    });
    expect(result.kind).toBe("candidates");
    if (result.kind !== "candidates") return;
    expect(result.candidates.map((c) => c.name)).toEqual(["B", "A"]);
    expect(result.candidates[0]).toEqual({
      name: "B",
      party: "Rep",
      votes: 1500,
      percent: 60,
      incumbent: true,
    });
  });

  test("a county answer is an array", () => {
    const result = normalizeContest([{ raceTitle: "Governor - Santa Clara", candidates: [] }]);
    expect(result.title).toBe("Governor - Santa Clara");
  });

  const measures = {
    raceTitle: "Ballot Measures",
    Reporting: "0.0% (0 of 1) precincts reporting",
    "ballot-measures": [
      {
        Name: "Bonds",
        Number: "01",
        yesVotes: "10",
        yesPercent: "55.0",
        noVotes: "8",
        noPercent: "45.0",
      },
      {
        Name: "Tax",
        Number: "37",
        yesVotes: "0",
        yesPercent: "0.0",
        noVotes: "0",
        noPercent: "0.0",
      },
    ],
  };

  test("one proposition out of the measures", () => {
    const result = normalizeContest(measures, "1");
    expect(result.kind).toBe("measure");
    if (result.kind === "measure") expect(result.measure).toMatchObject({ number: "1", yes: 10 });
    expect(() => normalizeContest(measures, "99")).toThrow(NotOnBallot);
    expect(normalizeContest(measures).kind).toBe("measures");
  });

  test("contest ids, paths and labels", () => {
    expect(districtContest("cd", "07")).toBe("us-rep/district/7");
    expect(contestPath("prop/37")).toEqual({ path: "ballot-measures", prop: "37" });
    expect(contestPath("governor", "Santa Clara")).toEqual({ path: "governor/county/santa-clara" });
    expect(contestPath("prop/1", "San Luis Obispo County")).toEqual({
      path: "ballot-measures/county/san-luis-obispo",
      prop: "1",
    });
    expect(contestLabel("state-assembly/district/24")).toBe("State Assembly District 24");
    expect(contestLabel("prop/50")).toBe("Proposition 50");
    expect(contestLabel("governor")).toBe("Governor");
    expect(countySlug("Contra Costa")).toBe("contra-costa");
  });
});
