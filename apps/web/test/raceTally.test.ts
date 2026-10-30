import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, type Stance } from "@openslate/core";
import { collateRaces, decodeSlates, type Race } from "../src/lib/collate";
import {
  fieldStanding,
  filterPositions,
  groupPositions,
  headlineChoices,
  isFiltering,
  NO_SLATE_FILTER,
  sourceGroup,
  tallyRace,
} from "../src/lib/raceTally";
import type { Standing } from "../src/lib/sources";

const researcher = generateKeyPair();

interface Pick {
  choice?: string;
  stance?: Stance;
}

function slate(of: string, picks: Pick[], kind = "organization", title = "Oakland Mayor") {
  return {
    token: createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher" },
      context: { election: "2026-11-03" },
      attribution: { of: { name: of, kind }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
      positions: picks.map((pick) => ({
        subject: { title, jurisdiction: "us/ca/oakland", election: "2026-11-03" },
        stance: pick.stance ?? "endorse",
        ...(pick.choice ? { choice: pick.choice } : {}),
      })),
    }).token,
    importedAt: "2026-10-20T00:00:00Z",
  };
}

function raceOf(
  slates: ReturnType<typeof slate>[],
  follows: Record<string, Standing> = {},
): Race {
  const decoded = decodeSlates(slates);
  const off = Object.fromEntries(decoded.map((s) => [s.source.id, "off" as const]));
  const races = collateRaces(decoded, {
    follows: { ...off, ...follows },
    includeUnfollowed: true,
  });
  const [race] = races;
  if (!race) throw new Error("no race");
  return race;
}

const ballot = (names: string[]) =>
  slate(
    "Alameda County Registrar",
    names.map((choice) => ({ choice, stance: "neutral" as const })),
    "election-authority",
  );

describe("sourceGroup", () => {
  test("the catalog's kind wins where it says something", () => {
    expect(sourceGroup({ name: "Anything", kind: "party" })).toBe("party");
    expect(sourceGroup({ name: "Anything", kind: "editorial_board" })).toBe("news");
    expect(sourceGroup({ name: "Anything", kind: "news_organization" })).toBe("news");
    expect(sourceGroup({ name: "Anything", kind: "individual" })).toBe("person");
    expect(sourceGroup({ name: "Anything", kind: "candidate" })).toBe("person");
  });

  // Real names from the Nov 2026 catalog, all filed as `organization`.
  test.each([
    ["Alameda County Democratic Party", "party"],
    ["Marin County Republican Central Committee", "party"],
    ["Los Angeles Times Editorial Board", "news"],
    ["The San Diego Union-Tribune Editorial Board", "news"],
    ["SEIU Local 1021", "labor"],
    ["Alameda Labor Council, AFL-CIO", "labor"],
    ["California Teachers Association", "labor"],
    ["Hayward Firefighters Local 1909", "labor"],
    ["Santee Fire Fighters Association", "labor"],
    ["San Francisco Police Officers Association", "labor"],
    ["California Federation of Labor Unions, AFL-CIO", "labor"],
    ["Union City Chamber of Commerce", "business"],
    ["California Association of REALTORS", "business"],
    ["Howard Jarvis Taxpayers Association", "business"],
    ["Harvey Milk LGBTQ Democratic Club", "club"],
    ["Coronado Republican Club", "club"],
    ["East Bay Young Democrats", "club"],
    ["Democratic Socialists of America, Los Angeles", "club"],
    ["Sierra Club California", "other"],
    ["Club for Growth PAC", "other"],
    ["Berkeley Tenants Union", "other"],
    ["League of Women Voters of Oakland", "other"],
  ])("%s", (name, group) => {
    expect(sourceGroup({ name, kind: "organization" })).toBe(group as never);
  });
});

describe("tallyRace", () => {
  test("counts every source, followed or not, and never a ballot listing", () => {
    const race = raceOf([
      ballot(["Barbara Lee", "Julius Robinson", "Mindy Pechenuk"]),
      slate("Sierra Club", [{ choice: "Barbara Lee" }]),
      slate("SEIU Local 1021", [{ choice: "Barbara Lee" }]),
      slate("Some PAC", [{ choice: "Barbara Lee", stance: "oppose" }]),
      slate("Abstainer", [{ choice: "Julius Robinson", stance: "abstain" }]),
    ]);
    const tally = tallyRace(race);
    expect(tally.sources).toBe(4);
    expect(tally.followed).toBe(0);
    expect(tally.tones).toEqual({ for: 2, against: 1, neutral: 1 });
    expect(tally.groups).toEqual({ other: 3, labor: 1 });
    expect(tally.choices.map((c) => [c.group.choice, c.for, c.against])).toEqual([
      ["Barbara Lee", 2, 1],
      ["Julius Robinson", 0, 0],
      ["Mindy Pechenuk", 0, 0],
    ]);
  });

  test("a source disagreed with is still for what it says it's for", () => {
    const sierra = slate("Sierra Club", [{ choice: "Barbara Lee" }]);
    const race = raceOf([sierra], { "of:sierra club": "disagree" });
    const tally = tallyRace(race);
    expect(tally.followed).toBe(1);
    expect(tally.tones.for).toBe(1);
    expect(tally.choices[0]?.for).toBe(1);
  });

  test("a measure folds onto Yes and No, and keeps a neutral word on the whole", () => {
    const race = raceOf([
      slate("Yes Group", [{ choice: "Yes" }]),
      slate("Against Yes", [{ choice: "Yes", stance: "oppose" }]),
      slate("Whole Measure", [{ stance: "endorse" }]),
      slate("Neutral On It", [{ stance: "neutral" }]),
    ]);
    const tally = tallyRace(race);
    expect(tally.yesNo).toBe(true);
    expect(tally.choices.map((c) => [c.group.choice, c.for, c.neutral])).toEqual([
      ["Yes", 2, 0],
      ["No", 1, 0],
      ["", 0, 1],
    ]);
    expect(tally.sources).toBe(4);
    // On a yes/no question the filter's "for" is Yes and "against" is No.
    const [yes, no] = tally.choices;
    if (!yes || !no) throw new Error("no choices");
    const against = { ...NO_SLATE_FILTER, tone: "against" as const };
    expect(filterPositions(yes, true, against)).toEqual([]);
    expect(filterPositions(no, true, against).map((p) => p.source.name)).toEqual(["Against Yes"]);
  });
});

describe("filters and groups", () => {
  const race = raceOf(
    [
      slate("Sierra Club", [{ choice: "Barbara Lee" }]),
      slate("SEIU Local 1021", [{ choice: "Barbara Lee" }]),
      slate("Alameda County Republican Party", [{ choice: "Barbara Lee", stance: "oppose" }]),
    ],
    { "of:sierra club": "follow" },
  );
  const tally = tallyRace(race);
  const choice = tally.choices[0];
  if (!choice) throw new Error("no choice");
  const names = (filter: Parameters<typeof filterPositions>[2]) =>
    filterPositions(choice, false, filter).map((p) => p.source.name);

  test("isFiltering says when anything narrows the list", () => {
    expect(isFiltering(NO_SLATE_FILTER)).toBe(false);
    expect(isFiltering({ ...NO_SLATE_FILTER })).toBe(false);
    expect(isFiltering({ ...NO_SLATE_FILTER, followedOnly: true })).toBe(true);
    expect(isFiltering({ ...NO_SLATE_FILTER, terms: ["sie"] })).toBe(true);
  });

  test("by stance, by kind, by name, by who you follow", () => {
    expect(names(NO_SLATE_FILTER)).toHaveLength(3);
    expect(names({ ...NO_SLATE_FILTER, tone: "against" })).toEqual([
      "Alameda County Republican Party",
    ]);
    expect(names({ ...NO_SLATE_FILTER, group: "labor" })).toEqual(["SEIU Local 1021"]);
    expect(names({ ...NO_SLATE_FILTER, terms: ["sierra"] })).toEqual(["Sierra Club"]);
    expect(names({ ...NO_SLATE_FILTER, followedOnly: true })).toEqual(["Sierra Club"]);
  });

  test("followed sources under their own heading, then each kind, in order, with counts", () => {
    const groups = groupPositions(choice.group.positions);
    expect(groups.map((g) => [g.id, g.positions.length])).toEqual([
      ["followed", 1],
      ["party", 1],
      ["labor", 1],
    ]);
    expect(groups[1]?.tones).toEqual({ for: 0, against: 1, neutral: 0 });
  });
});

describe("fieldStanding", () => {
  const race = raceOf([
    ballot(["Barbara Lee", "Julius Robinson", "Mindy Pechenuk"]),
    slate("A", [{ choice: "Barbara Lee" }]),
    slate("B", [{ choice: "Barbara Lee" }]),
    slate("C", [{ choice: "Julius Robinson" }]),
  ]);
  const tally = tallyRace(race);

  test("the most backed has no leader above it", () => {
    expect(fieldStanding(tally, "Barbara Lee")).toEqual({ place: 1, of: 3, tied: false });
  });

  test("anyone else is told who leads", () => {
    const standing = fieldStanding(tally, "Julius Robinson");
    expect(standing?.place).toBe(2);
    expect(standing?.leader?.group.choice).toBe("Barbara Lee");
  });

  test("a name the race doesn't have has no standing", () => {
    expect(fieldStanding(tally, "Nobody")).toBeUndefined();
  });

  test("two with the same count are tied, and no one leads them", () => {
    const even = tallyRace(
      raceOf([
        slate("A", [{ choice: "Barbara Lee" }]),
        slate("B", [{ choice: "Julius Robinson" }]),
      ]),
    );
    const standing = fieldStanding(even, "Julius Robinson");
    expect(standing?.tied).toBe(true);
    expect(standing?.leader).toBeUndefined();
  });

  test("headlineChoices leads with the most backed", () => {
    expect(headlineChoices(tally, 2).map((c) => c.group.choice)).toEqual([
      "Barbara Lee",
      "Julius Robinson",
    ]);
  });
});
