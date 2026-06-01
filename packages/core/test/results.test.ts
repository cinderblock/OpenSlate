import { describe, expect, test } from "bun:test";
import {
  confidenceBucket,
  electionDateWindow,
  parseJurisdiction,
  scoreMatch,
  subjectToRaceQuery,
} from "../src/results";
import type { RaceSummary } from "../src/results";
import type { Subject } from "../src/schema";

describe("parseJurisdiction", () => {
  test("empty input → empty result", () => {
    expect(parseJurisdiction(undefined)).toEqual({});
    expect(parseJurisdiction("")).toEqual({});
    expect(parseJurisdiction("   ")).toEqual({});
  });

  test("country only", () => {
    expect(parseJurisdiction("us")).toEqual({ country: "US" });
  });

  test("country + province (slash)", () => {
    expect(parseJurisdiction("us/ca")).toEqual({ country: "US", province: "CA" });
  });

  test("country + province + district (slash)", () => {
    expect(parseJurisdiction("us/ca/sf")).toEqual({
      country: "US",
      province: "CA",
      district: "SF",
    });
  });

  test("dash separator (ISO 3166-2 style)", () => {
    expect(parseJurisdiction("JP-06")).toEqual({ country: "JP", province: "06" });
  });

  test("multi-segment district preserved with /", () => {
    expect(parseJurisdiction("us/ca/san-francisco/d4")).toEqual({
      country: "US",
      province: "CA",
      district: "SAN-FRANCISCO/D4",
    });
  });
});

describe("electionDateWindow", () => {
  test("returns null for undefined / non-date", () => {
    expect(electionDateWindow(undefined)).toBeNull();
    expect(electionDateWindow("not a date")).toBeNull();
  });

  test("bare YYYY-MM-DD → ±1 day window", () => {
    expect(electionDateWindow("2024-11-05")).toEqual({
      startDate: "2024-11-04",
      endDate: "2024-11-06",
    });
  });

  test("RFC 3339 datetime is accepted", () => {
    const w = electionDateWindow("2024-11-05T05:00:00.000Z");
    expect(w).not.toBeNull();
    expect(w?.startDate).toBe("2024-11-04");
    expect(w?.endDate).toBe("2024-11-06");
  });
});

describe("subjectToRaceQuery", () => {
  test("title-only subject → query alone", () => {
    const subject: Subject = { title: "Mayor of Springfield" };
    expect(subjectToRaceQuery(subject)).toEqual({
      query: "Mayor of Springfield",
      limit: 10,
    });
  });

  test("full subject → all params populated", () => {
    const subject: Subject = {
      title: "Mayor of San Francisco",
      jurisdiction: "us/ca/sf",
      election: "2024-11-05",
    };
    expect(subjectToRaceQuery(subject)).toEqual({
      query: "Mayor of San Francisco",
      country: "US",
      province: "CA",
      district: "SF",
      startDate: "2024-11-04",
      endDate: "2024-11-06",
      limit: 10,
    });
  });

  test("limit override propagates", () => {
    const subject: Subject = { title: "x" };
    expect(subjectToRaceQuery(subject, 3).limit).toBe(3);
  });
});

const baseRace: RaceSummary = {
  id: 1,
  election_name: "Mayor of San Francisco",
  election_date: "2024-11-05T05:00:00.000Z",
  country: "US",
  province: "CA",
  district: "SF",
  candidates: [],
};

describe("scoreMatch", () => {
  test("perfect alignment → high score", () => {
    const subject: Subject = {
      title: "Mayor of San Francisco",
      jurisdiction: "us/ca/sf",
      election: "2024-11-05",
    };
    const score = scoreMatch(subject, baseRace);
    expect(score).toBeGreaterThan(0.8);
    expect(confidenceBucket(score)).toBe("high");
  });

  test("wrong election year drags score down", () => {
    const subject: Subject = {
      title: "Mayor of San Francisco",
      jurisdiction: "us/ca/sf",
      election: "2020-11-05",
    };
    const score = scoreMatch(subject, baseRace);
    expect(confidenceBucket(score)).not.toBe("high");
  });

  test("title-only subject still produces a score from word overlap", () => {
    const subject: Subject = { title: "Mayor San Francisco" };
    const score = scoreMatch(subject, baseRace);
    expect(score).toBeGreaterThan(0);
  });

  test("completely unrelated subject (different date) → low score", () => {
    const subject: Subject = {
      title: "School board district 9",
      jurisdiction: "us/ny",
      election: "2018-11-06",
    };
    const score = scoreMatch(subject, baseRace);
    expect(confidenceBucket(score)).toBe("low");
  });

  test("country mismatch costs more than title overlap can recover", () => {
    const subject: Subject = {
      title: "Mayor of San Francisco",
      jurisdiction: "ca/on/toronto",
      election: "2024-11-05",
    };
    const score = scoreMatch(subject, baseRace);
    // Title matches perfectly but country/province/district all disagree.
    expect(score).toBeLessThan(0.75);
  });
});

describe("confidenceBucket", () => {
  const cases: ReadonlyArray<[number, "high" | "medium" | "low"]> = [
    [1.0, "high"],
    [0.75, "high"],
    [0.7, "medium"],
    [0.4, "medium"],
    [0.39, "low"],
    [0, "low"],
  ];
  test.each(cases)("score %f → %s", (score, expected) => {
    expect(confidenceBucket(score)).toBe(expected);
  });
});
