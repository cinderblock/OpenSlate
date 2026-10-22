import { describe, expect, test } from "bun:test";
import { type GuideEntry, guideListUrl, guidesFor } from "../src/lib/guides";

const CA: GuideEntry = {
  election: "2026-11-03",
  jurisdiction: "us/ca",
  url: "https://example.org/ca/guide.jws",
  key: "ed25519:test",
};

describe("voter guides", () => {
  test("the list sits beside the catalog's index.json", () => {
    expect(
      guideListUrl("https://cinderblock.github.io/openslate-public-endorsements/index.json"),
    ).toBe("https://cinderblock.github.io/openslate-public-endorsements/guides.json");
  });

  test("a guide covers its own area and the areas inside it, for its election", () => {
    const statewide = {
      title: "Governor of California",
      jurisdiction: "us/ca",
      election: "2026-11-03",
    };
    const local = {
      title: "San Francisco — Measure A",
      jurisdiction: "us/ca/sf",
      election: "2026-11-03",
    };
    expect(guidesFor([CA], statewide)).toEqual([CA]);
    expect(guidesFor([CA], local)).toEqual([CA]);
  });

  test("not another election, nor an area that only shares a prefix", () => {
    expect(
      guidesFor([CA], { title: "Governor", jurisdiction: "us/ca", election: "2026-06-02" }),
    ).toEqual([]);
    expect(guidesFor([CA], { title: "X", jurisdiction: "us/cap", election: "2026-11-03" })).toEqual(
      [],
    );
    expect(guidesFor([CA], { title: "X", election: "2026-11-03" })).toEqual([]);
  });
});
