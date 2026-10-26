import { describe, expect, test } from "bun:test";
import type { ChoiceGroup, Race } from "../src/lib/collate";
import {
  foldText,
  matchesSearch,
  positionSearchText,
  raceSearchText,
  searchTerms,
  sourceSearchText,
} from "../src/lib/search";
import type { Source } from "../src/lib/sources";

const sierra: Source = {
  id: "of:https://sierraclub.org",
  name: "Sierra Club California",
  uri: "https://sierraclub.org",
  secondhand: true,
  signerKey: "k",
  signerName: "OpenSlate Research",
};

function choice(name: string, extra: Partial<ChoiceGroup> = {}): ChoiceGroup {
  return {
    choice: name,
    positions: [],
    support: 0,
    opposition: 0,
    onBallot: true,
    writeIn: false,
    ...extra,
  };
}

function race(title: string, choices: ChoiceGroup[], extra: Partial<Race> = {}): Race {
  return {
    key: title,
    subject: { title },
    choices,
    onBallot: true,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
    ...extra,
  };
}

const mayor = race(
  "Mayor",
  [
    choice("José Núñez", { ballotNote: "Small Business Owner" }),
    choice("Barbara Lee", {
      positions: [{ source: sierra, stance: "endorse", valid: true, standing: "follow" }],
    }),
  ],
  { jurisdiction: "us/ca/oakland" },
);
const prop = race("Prop 50", [choice("Yes"), choice("No")], { jurisdiction: "us/ca" });

function finds(item: Race, query: string): boolean {
  return matchesSearch(raceSearchText(item), searchTerms(query));
}

describe("searchTerms", () => {
  test("splits on any whitespace, folded, with no empty words", () => {
    expect(searchTerms("  Prop\t50  ")).toEqual(["prop", "50"]);
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  test("folds case and accents", () => {
    expect(foldText("José NÚÑEZ")).toBe("jose nunez");
  });
});

describe("race search", () => {
  test("no terms matches everything", () => {
    expect(finds(mayor, "")).toBe(true);
  });

  test("finds a race by its title, in any case", () => {
    expect(finds(prop, "prop 50")).toBe(true);
    expect(finds(prop, "PROP")).toBe(true);
    expect(finds(prop, "prop 51")).toBe(false);
  });

  test("finds a race by a candidate, without typing the accents", () => {
    expect(finds(mayor, "jose nunez")).toBe(true);
    expect(finds(mayor, "núñez")).toBe(true);
  });

  test("finds a race by where it's voted on, combined with the title", () => {
    expect(finds(mayor, "oakland mayor")).toBe(true);
    expect(finds(mayor, "berkeley mayor")).toBe(false);
  });

  test("finds a race by a ballot designation or an endorser", () => {
    expect(finds(mayor, "business owner")).toBe(true);
    expect(finds(mayor, "sierra club")).toBe(true);
    expect(finds(prop, "sierra")).toBe(false);
  });

  test("a number matches a whole number, not part of one", () => {
    const district2 = race("State Senate, District 2", [choice("Ann")], { election: "2026-11-03" });
    const district20 = race("State Senate, District 20", [choice("Bo")], {
      election: "2026-11-03",
    });
    expect(finds(district2, "senate 2")).toBe(true);
    expect(finds(district20, "senate 2")).toBe(false);
    expect(finds(prop, "prop 5")).toBe(false);
    expect(finds(prop, "prop 50")).toBe(true);
    // Not a number on its own: still matches inside a word or a longer number.
    expect(finds(district20, "district 20")).toBe(true);
  });

  test("a term doesn't match across the seam of two fields", () => {
    // "Mayor" then "Oakland": joined without a separator, "oroak" would match.
    expect(finds(mayor, "oroak")).toBe(false);
  });
});

describe("source search", () => {
  const text = sourceSearchText(sierra, ["2026-11-03"]);

  test("finds a source by name, reporter, link or election date", () => {
    expect(matchesSearch(text, searchTerms("sierra"))).toBe(true);
    expect(matchesSearch(text, searchTerms("openslate research"))).toBe(true);
    expect(matchesSearch(text, searchTerms("sierraclub.org"))).toBe(true);
    expect(matchesSearch(text, searchTerms("2026-11"))).toBe(true);
    expect(matchesSearch(text, searchTerms("teamsters"))).toBe(false);
  });
});

describe("position search", () => {
  const text = positionSearchText({
    subject: { title: "Mayor", jurisdiction: "us/ca/oakland", election: "2026-11-03" },
    choice: "Barbara Lee",
    statement: "Housing first.",
  });

  test("finds a position by race, choice, place, election or statement", () => {
    expect(matchesSearch(text, searchTerms("oakland lee"))).toBe(true);
    expect(matchesSearch(text, searchTerms("2026-11-03"))).toBe(true);
    expect(matchesSearch(text, searchTerms("housing"))).toBe(true);
    expect(matchesSearch(text, searchTerms("governor"))).toBe(false);
  });
});
