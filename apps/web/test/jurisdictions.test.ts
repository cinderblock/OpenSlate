import { describe, expect, test } from "bun:test";
import {
  EMPTY_AREA,
  allDistricts,
  inArea,
  jurisdictionLabel,
  jurisdictionRank,
  noRaceReason,
  parseJurisdiction,
} from "../src/lib/jurisdictions";

describe("parseJurisdiction", () => {
  test("recognises state, district and local paths", () => {
    expect(parseJurisdiction("us/ca")).toEqual({ kind: "state", path: "us/ca" });
    expect(parseJurisdiction("us/ca/cd-07")).toEqual({
      kind: "district",
      path: "us/ca/cd-07",
      state: "us/ca",
      family: "cd",
      number: "7",
    });
    expect(parseJurisdiction("us/ca/los-angeles-county")).toEqual({
      kind: "local",
      path: "us/ca/los-angeles-county",
      state: "us/ca",
      slug: "los-angeles-county",
    });
    expect(parseJurisdiction(undefined)).toEqual({ kind: "none" });
  });
});

describe("inArea", () => {
  const sf = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11", "us/ca/ad": "17" } };

  test("with no area set, every race is in", () => {
    expect(inArea("us/ca/cd-3", EMPTY_AREA)).toBe(true);
    expect(inArea("us/ny", EMPTY_AREA)).toBe(true);
  });

  test("statewide races of the area's state are in, other states' are not", () => {
    expect(inArea("us/ca", sf)).toBe(true);
    expect(inArea("us/ny", sf)).toBe(false);
    expect(inArea("us", sf)).toBe(true);
  });

  test("only the area's own district numbers are in", () => {
    expect(inArea("us/ca/cd-11", sf)).toBe(true);
    expect(inArea("us/ca/cd-12", sf)).toBe(false);
    expect(inArea("us/ca/ad-17", sf)).toBe(true);
    // A family the user hasn't set (State Senate) is out once the area is set.
    expect(inArea("us/ca/sd-11", sf)).toBe(false);
  });

  test("only the area's localities are in; races with no jurisdiction always are", () => {
    expect(inArea("us/ca/sf", sf)).toBe(true);
    expect(inArea("us/ca/oakland", sf)).toBe(false);
    expect(inArea(undefined, sf)).toBe(true);
  });
});

describe("labels and ranks", () => {
  test("labels read like a ballot", () => {
    expect(jurisdictionLabel("us/ca")).toBe("California");
    expect(jurisdictionLabel("us/ca/cd-11")).toBe("Congressional district 11");
    expect(jurisdictionLabel("us/ca/sf")).toBe("San Francisco");
    expect(jurisdictionLabel("us/ca/chula-vista")).toBe("Chula Vista");
  });

  test("statewide sorts before districts before local", () => {
    expect(jurisdictionRank("us/ca")).toBeLessThan(jurisdictionRank("us/ca/cd-1"));
    expect(jurisdictionRank("us/ca/cd-1")).toBeLessThan(jurisdictionRank("us/ca/ad-1"));
    expect(jurisdictionRank("us/ca/ad-1")).toBeLessThan(jurisdictionRank("us/ca/sf"));
  });
});

describe("districts with no race", () => {
  test("allDistricts lists every district, plus any extra the data uses", () => {
    expect(allDistricts("us/ca/sd", ["2", "4"])).toHaveLength(40);
    expect(allDistricts("us/ca/coa", ["7"])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(allDistricts("us/xx/cd", ["3", "1"])).toEqual(["1", "3"]);
  });

  const even = Array.from({ length: 20 }, (_, i) => String(2 * i + 2));
  test("the Senate's staggered terms, from the election year", () => {
    expect(noRaceReason("us/ca/sd", "13", [], "2026-11-03")).toBe(
      "No State Senate race in district 13 this election; only even-numbered seats are up.",
    );
    expect(noRaceReason("us/ca/sd", "14", [], "2028-11-07")).toBe(
      "No State Senate race in district 14 this election; only odd-numbered seats are up.",
    );
  });
  test("staggering worked out from the data when there is no rule", () => {
    const family = "us/ca/bart";
    expect(noRaceReason(family, "3", ["2", "4", "6", "8"])).toContain("only even-numbered");
    expect(noRaceReason(family, "3", ["2", "4"])).toBe(
      "Nothing you've imported has a BART board race in district 3 this election.",
    );
    expect(noRaceReason("us/ca/sd", "13", even)).toContain("only even-numbered");
  });
  test("an even district with no race, in an even year, is a gap in the data", () => {
    expect(noRaceReason("us/ca/sd", "12", even.slice(1), "2026-11-03")).toBe(
      "Nothing you've imported has a State Senate race in district 12 this election.",
    );
  });
});
