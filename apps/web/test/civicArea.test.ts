import { describe, expect, test } from "bun:test";
import { areaFromLookup } from "../src/lib/civicArea";
import { localityPathFor } from "../src/lib/jurisdictions";

const known = { localities: ["us/ca/sf", "us/ca/oakland"], districts: {} };

describe("areaFromLookup", () => {
  test("maps district scopes and numbers onto the area, and named localities it knows", () => {
    const result = areaFromLookup(
      {
        state: "ca",
        contests: [
          { subject: { title: "Governor" }, candidates: [], district: { scope: "statewide" } },
          {
            subject: { title: "House" },
            candidates: [],
            district: { scope: "congressional", id: "11" },
          },
          {
            subject: { title: "Senate" },
            candidates: [],
            district: { scope: "stateUpper", id: "011" },
          },
          {
            subject: { title: "Assembly" },
            candidates: [],
            district: { scope: "stateLower", id: "17" },
          },
          {
            subject: { title: "Prop A" },
            candidates: [],
            district: { scope: "citywide", name: "San Francisco" },
          },
          {
            subject: { title: "School board" },
            candidates: [],
            district: { scope: "schoolBoard", name: "SFUSD", id: "3" },
          },
          {
            subject: { title: "County measure" },
            candidates: [],
            district: { scope: "countywide", name: "Alameda County" },
          },
        ],
      },
      known,
    );
    expect(result).toEqual({
      area: {
        localities: ["us/ca/sf"],
        districts: { "us/ca/cd": "11", "us/ca/sd": "11", "us/ca/ad": "17" },
      },
      unknownLocalities: ["Alameda County"],
    });
  });

  test("needs the state", () => {
    expect(areaFromLookup({ contests: [] }, known)).toBeNull();
  });
});

describe("localityPathFor", () => {
  test("goes through the known labels, else slugifies", () => {
    expect(localityPathFor("us/ca", "San Francisco")).toBe("us/ca/sf");
    expect(localityPathFor("us/ca", "Chula Vista")).toBe("us/ca/chula-vista");
    expect(localityPathFor("us/ca", "San José")).toBe("us/ca/san-jose");
  });
});
