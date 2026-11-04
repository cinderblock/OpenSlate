import { describe, expect, test } from "bun:test";
import {
  addLocalOnce,
  addPlace,
  addSingle,
  districtsOfArea,
  placeContests,
  removeContest,
  removeFromGroups,
  SINGLES_ID,
  STATEWIDE_ID,
  setGroupCounty,
  skipContest,
  type WatchGroup,
  watchSections,
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

  const two: WatchGroup[] = [
    { id: STATEWIDE_ID, label: "Statewide", contests: ["governor"] },
    {
      id: "a",
      label: "Home",
      contests: ["us-rep/district/16", "state-senate/district/13", "state-assembly/district/24"],
    },
    {
      id: "b",
      label: "Mom",
      contests: ["us-rep/district/16", "state-senate/district/13", "state-assembly/district/26"],
    },
  ];

  test("a race two places share shows once, under both", () => {
    expect(watchSections(two).map((s) => [s.groups.map((g) => g.label), s.contests])).toEqual([
      [["Statewide"], ["governor"]],
      [
        ["Home", "Mom"],
        ["us-rep/district/16", "state-senate/district/13"],
      ],
      [["Home"], ["state-assembly/district/24"]],
      [["Mom"], ["state-assembly/district/26"]],
    ]);
  });

  test("a race not on the ballot leaves every place, which notes it", () => {
    const next = skipContest(two, "state-senate/district/13");
    expect(next.flatMap((g) => g.contests)).not.toContain("state-senate/district/13");
    expect(next[1]?.skipped).toEqual(["state-senate/district/13"]);
    expect(next[2]?.skipped).toEqual(["state-senate/district/13"]);
    expect(skipContest(next, "state-senate/district/13")).toBe(next);
  });

  test("removing a shared race removes it from both places", () => {
    const next = removeFromGroups(two, ["a", "b"], "us-rep/district/16");
    expect(next.flatMap((g) => g.contests)).not.toContain("us-rep/district/16");
  });
});

describe("local races added on their own", () => {
  const place: WatchGroup = {
    id: "p",
    label: "Where I vote",
    contests: ["us-rep/district/16"],
    county: "San Mateo",
  };
  test("once: a race the voter removes isn't added back", () => {
    const once = addLocalOnce([place], "p", ["county-ca/san-mateo/a", "county-ca/san-mateo/b"]);
    expect(once[0]?.contests).toEqual([
      "us-rep/district/16",
      "county-ca/san-mateo/a",
      "county-ca/san-mateo/b",
    ]);
    expect(once[0]?.localAdded).toBe(true);
    const removed = removeContest(once, "p", "county-ca/san-mateo/a");
    expect(addLocalOnce(removed, "p", ["county-ca/san-mateo/a"])[0]?.contests).not.toContain(
      "county-ca/san-mateo/a",
    );
  });
  test("an empty match still counts as done", () => {
    expect(addLocalOnce([place], "p", [])[0]?.localAdded).toBe(true);
  });
  test("a new county adds its races again", () => {
    const done = addLocalOnce([place], "p", []);
    expect(setGroupCounty(done, "p", "Santa Clara")[0]?.localAdded).toBeUndefined();
  });
});
