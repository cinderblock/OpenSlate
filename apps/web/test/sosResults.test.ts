import { describe, expect, test } from "bun:test";
import {
  candidatesByContest,
  contestToRace,
  isSosRaceId,
  parseSosTime,
  sosContestForSubject,
  sosRaceId,
} from "../src/lib/regions/us-ca/sosResults";

const nov = (title: string, jurisdiction = "us/ca", kind = "race") => ({
  title,
  jurisdiction,
  kind,
  election: "2026-11-03",
});

describe("which races the Secretary of State counts", () => {
  test("statewide offices, as the catalog titles them", () => {
    expect(sosContestForSubject(nov("Governor of California"))).toBe("governor");
    expect(sosContestForSubject(nov("Lieutenant Governor of California"))).toBe(
      "lieutenant-governor",
    );
    expect(sosContestForSubject(nov("California Secretary of State"))).toBe("secretary-of-state");
    expect(sosContestForSubject(nov("California Superintendent of Public Instruction"))).toBe(
      "superintendent-of-public-instruction",
    );
    expect(sosContestForSubject(nov("California Insurance Commissioner"))).toBe(
      "insurance-commissioner",
    );
  });

  test("a Supreme Court justice's retention vote", () => {
    expect(
      sosContestForSubject(
        nov("California Supreme Court — Retain Justice Joshua Groban", "us/ca", "measure"),
      ),
    ).toBe("supreme-court/joshua-groban");
  });

  test("measures and districts", () => {
    expect(
      sosContestForSubject(
        nov("California — Proposition 5 (Changes Recall Election Process)", "us/ca", "measure"),
      ),
    ).toBe("prop/5");
    expect(sosContestForSubject(nov("Board of Equalization Member District 1"))).toBe(
      "board-of-equalization/district/1",
    );
    expect(sosContestForSubject(nov("Governor"))).toBe("governor");
    expect(sosContestForSubject(nov("California State Board of Equalization, District 2"))).toBe(
      "board-of-equalization/district/2",
    );
    expect(
      sosContestForSubject(
        nov("US House of Representatives, California District 11", "us/ca/cd-11"),
      ),
    ).toBe("us-rep/district/11");
    expect(sosContestForSubject(nov("California State Assembly, District 79", "us/ca/ad-79"))).toBe(
      "state-assembly/district/79",
    );
  });

  test("not another election, and not local races", () => {
    expect(
      sosContestForSubject({ ...nov("Governor of California"), election: "2026-06-02" }),
    ).toBeUndefined();
    expect(sosContestForSubject(nov("Mayor", "us/ca/sf"))).toBeUndefined();
    expect(sosContestForSubject(nov("Measure A", "us/ca/santa-clara-county"))).toBeUndefined();
    expect(sosContestForSubject(nov("US Senate", "us/ny"))).toBeUndefined();
  });
});

describe("the state's count as a results race", () => {
  test("Pacific time, standard or daylight", () => {
    expect(parseSosTime("November 3, 2026, 8:15 p.m.")).toBe("2026-11-04T04:15:00.000Z");
    expect(parseSosTime("June 2, 2026, 11:05 p.m.")).toBe("2026-06-03T06:05:00.000Z");
    expect(parseSosTime("November 4, 2026, 12:30 a.m.")).toBe("2026-11-04T08:30:00.000Z");
    expect(parseSosTime("soon")).toBeUndefined();
  });

  test("candidates and measures", () => {
    const race = contestToRace("governor", {
      kind: "candidates",
      title: "Governor - Statewide Results",
      reporting: { text: "", percent: 12.5, time: "November 3, 2026, 8:15 p.m." },
      candidates: [{ name: "A", party: "Dem", votes: 10, percent: 60, incumbent: false }],
    });
    expect(race.id).toBe(sosRaceId("governor"));
    expect(isSosRaceId(race.id)).toBe(true);
    expect(isSosRaceId(123)).toBe(false);
    expect(race.election_name).toBe("Governor");
    expect(race.percent_reporting).toBe(12.5);
    expect(race.last_updated).toBe("2026-11-04T04:15:00.000Z");
    expect(race.candidates[0]).toMatchObject({ name: "A", party: "Dem", votes: 10, percent: 60 });

    const measure = contestToRace("prop/5", {
      kind: "measure",
      title: "Ballot Measures - Statewide Results",
      reporting: { text: "" },
      measure: { number: "5", name: "Recall", yes: 3, no: 1, yesPercent: 75, noPercent: 25 },
    });
    expect(measure.candidates.map((c) => [c.name, c.votes])).toEqual([
      ["Yes", 3],
      ["No", 1],
    ]);
  });
});

describe("finding a race by who's running", () => {
  test("names by the state's contest, once each, local races left out", () => {
    const byContest = candidatesByContest([
      {
        subject: nov("United States Representative District 12", "us/ca/cd-12"),
        choice: "Jamie Joyce",
      },
      {
        subject: nov("United States Representative District 12", "us/ca/cd-12"),
        choice: "Lateefah Simon",
      },
      {
        subject: nov("United States Representative District 12", "us/ca/cd-12"),
        choice: "Jamie Joyce",
      },
      { subject: nov("Governor of California"), choice: "Xavier Becerra" },
      { subject: nov("Governor of California") },
      { subject: nov("Mayor", "us/ca/sf"), choice: "Someone" },
    ]);
    expect(Object.fromEntries(byContest)).toEqual({
      "us-rep/district/12": ["Jamie Joyce", "Lateefah Simon"],
      governor: ["Xavier Becerra"],
    });
  });
});
