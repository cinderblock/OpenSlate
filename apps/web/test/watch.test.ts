import { describe, expect, test } from "bun:test";
import {
  addPlace,
  addSingle,
  districtsOfArea,
  placeContests,
  removeContest,
  SINGLES_ID,
  STATEWIDE_ID,
  setGroupCounty,
} from "../src/lib/watch";

describe("the watch list", () => {
  test("an area's districts the Secretary of State reports on", () => {
    expect(
      districtsOfArea({
        localities: ["us/ca/sunnyvale"],
        districts: { "us/ca/cd": "16", "us/ca/sd": "13", "us/ca/ad": "026", "us/ca/unsd": "x" },
      }),
    ).toEqual({ cd: "16", sd: "13", ad: "26" });
  });

  test("a place brings its districts, and statewide once", () => {
    const one = addPlace(
      [],
      { label: "Home", districts: { cd: "16", ad: "26" } },
      ["governor"],
      "a",
    );
    expect(one.map((g) => g.id)).toEqual([STATEWIDE_ID, "a"]);
    expect(one[1]?.contests).toEqual(["us-rep/district/16", "state-assembly/district/26"]);
    const two = addPlace(
      one,
      { label: "Mom", districts: { sd: "2" }, county: "Marin" },
      ["governor"],
      "b",
    );
    expect(two.filter((g) => g.id === STATEWIDE_ID)).toHaveLength(1);
    expect(two[2]).toEqual({
      id: "b",
      label: "Mom",
      contests: ["state-senate/district/2"],
      county: "Marin",
    });
  });

  test("single races, once each", () => {
    const a = addSingle([], "prop/50");
    const b = addSingle(a, "prop/50");
    const c = addSingle(b, "governor");
    expect(c).toEqual([
      { id: SINGLES_ID, label: "Races I added", contests: ["prop/50", "governor"] },
    ]);
  });

  test("removing the last race drops the group", () => {
    const a = addSingle([], "governor");
    expect(removeContest(a, SINGLES_ID, "governor")).toEqual([]);
  });

  test("county on and off", () => {
    const a = addSingle([], "governor");
    const b = setGroupCounty(a, SINGLES_ID, "Alameda");
    expect(b[0]?.county).toBe("Alameda");
    expect(setGroupCounty(b, SINGLES_ID, undefined)[0]).not.toHaveProperty("county");
  });

  test("place contests in ballot order", () => {
    expect(placeContests({ boe: "2", cd: "1" })).toEqual([
      "us-rep/district/1",
      "board-of-equalization/district/2",
    ]);
  });
});
