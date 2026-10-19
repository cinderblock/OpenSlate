import { describe, expect, test } from "bun:test";
import {
  EMPTY_AREA,
  inArea,
  jurisdictionLabel,
  jurisdictionRank,
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
