import { describe, expect, test } from "bun:test";
import type { Stance } from "@openslate/core";
import {
  type ChangeResult,
  type Draft,
  type MarkRequest,
  ballotPage,
  findRace,
  raceDetail,
  raceSummary,
  resolveMark,
  resolveRanking,
  shownElection,
} from "../src/lib/ballotAgent";
import { NOTE_CHOICE, applyPatch, rankingKeyFor } from "../src/lib/ballotDraft";
import type { ChoiceGroup, Race, RacePosition } from "../src/lib/collate";

const E = "2026-11-03";
const EMPTY: Draft = { rows: {}, rankings: {} };

function position(name: string, stance: Stance, statement?: string): RacePosition {
  return {
    source: { id: name.toLowerCase(), name, secondhand: false } as RacePosition["source"],
    stance,
    valid: true,
    standing: "follow",
    ...(statement ? { statement } : {}),
  };
}

function group(choice: string, extra: Partial<ChoiceGroup> = {}): ChoiceGroup {
  return {
    choice,
    positions: [],
    support: 0,
    opposition: 0,
    onBallot: true,
    writeIn: false,
    ...extra,
  };
}

function race(
  key: string,
  title: string,
  kind: string,
  choices: ChoiceGroup[],
  extra: Partial<Race> = {},
): Race {
  return {
    key,
    subject: { title, kind, jurisdiction: "us/ca/san-jose", election: E },
    choices,
    onBallot: true,
    unlisted: false,
    followedSources: 1,
    totalSources: 1,
    ...extra,
  };
}

const council = race(
  "council",
  "City Council District 3",
  "race",
  [
    group("Ana Ortiz", {
      ballotIndex: 0,
      support: 2,
      positions: [position("Sierra Club", "endorse", "Parks.")],
    }),
    group("Ben Lee", { ballotIndex: 1, opposition: 1 }),
  ],
  { ballot: { vote_for: 1 } as Race["ballot"] },
);
const board = race(
  "board",
  "School Board",
  "race",
  ["Ann", "Bo", "Cy", "Di"].map((name, i) => group(name, { ballotIndex: i })),
  { ballot: { vote_for: 2 } as Race["ballot"] },
);
const measure = race("m-a", "Measure A", "measure", [group("Yes"), group("No")]);

/** Apply a resolved change as `webmcp.ts` does: rows, then the ranking. */
function apply(draft: Draft, r: Race, result: ChangeResult): Draft {
  if ("error" in result) throw new Error(result.error);
  const rows = result.patches.reduce(
    (acc, { subject, choice, fields }) => applyPatch(acc, E, subject, choice, fields),
    draft.rows,
  );
  if (!result.order) return { rows, rankings: draft.rankings };
  return { rows, rankings: { ...draft.rankings, [rankingKeyFor(E, r.subject)]: result.order } };
}

function mark(draft: Draft, r: Race, request: MarkRequest): Draft {
  return apply(draft, r, resolveMark(r, E, draft, request));
}

/** Each choice's mark and rank, as an agent reads them. */
function marks(r: Race, draft: Draft) {
  return raceSummary(r, E, draft).choices.map((c) => [c.choice, c.mark ?? "-", c.rank ?? "-"]);
}

describe("shownElection", () => {
  const elections = [
    { date: "2026-06-02", races: 1, sources: 1, followedSources: 1 },
    { date: E, races: 1, sources: 1, followedSources: 1 },
  ];
  test("the user's choice while it's still covered", () => {
    expect(shownElection(elections, "2026-06-02", "2026-10-26")).toBe("2026-06-02");
  });
  test("else the next upcoming one", () => {
    expect(shownElection(elections, "2024-11-05", "2026-10-26")).toBe(E);
    expect(shownElection(elections, "", "2026-10-26")).toBe(E);
  });
});

describe("raceSummary", () => {
  test("choices in ballot order, with counts, the user's marks and ranks", () => {
    const summary = raceSummary(
      council,
      E,
      mark(EMPTY, council, { choice: "Ana Ortiz", mark: "pick" }),
    );
    expect(summary.race).toBe("council");
    expect(summary.instruction).toBe("Vote for one");
    expect(summary.ranked).toBe(true);
    expect(summary.choices).toEqual([
      { choice: "Ana Ortiz", sources_for: 2, sources_against: 0, mark: "pick", rank: 1 },
      { choice: "Ben Lee", sources_for: 0, sources_against: 1 },
    ]);
    expect(summary.warning).toBeUndefined();
  });

  test("warns of more picks than the ballot allows, as an older draft can hold", () => {
    let rows = applyPatch({}, E, council.subject, "Ana Ortiz", { stance: "endorse" });
    rows = applyPatch(rows, E, council.subject, "Ben Lee", { stance: "endorse" });
    expect(raceSummary(council, E, { rows, rankings: {} }).warning).toContain(
      "2 picks, but the ballot allows 1",
    );
  });

  test("carries the private note, which isn't a choice", () => {
    const rows = applyPatch({}, E, council.subject, NOTE_CHOICE, { privateNote: "Ask Sam" });
    const summary = raceSummary(council, E, { rows, rankings: {} });
    expect(summary.note).toBe("Ask Sam");
    expect(summary.choices.every((c) => !c.mark)).toBe(true);
  });

  test("a yes/no question isn't ranked", () => {
    const summary = raceSummary(measure, E, mark(EMPTY, measure, { choice: "Yes", mark: "pick" }));
    expect(summary.ranked).toBeUndefined();
    expect(summary.choices[0]).toEqual({
      choice: "Yes",
      sources_for: 0,
      sources_against: 0,
      mark: "pick",
    });
  });
});

test("raceDetail lists every source's position and statement", () => {
  const detail = raceDetail(council, E, EMPTY);
  expect(detail.choices[0]?.positions).toEqual([
    { source: "Sierra Club", stance: "endorse", standing: "follow", statement: "Parks." },
  ]);
});

describe("findRace", () => {
  const elsewhere = race("council-sf", "City Council District 3", "race", []);
  test("by key, then by a title only one race has", () => {
    expect(findRace([[council, measure]], "m-a")).toEqual({ race: measure });
    expect(findRace([[council, measure]], "  measure a ")).toEqual({ race: measure });
  });
  test("the user's own ballot wins a shared title", () => {
    expect(findRace([[council], [council, elsewhere]], "City Council District 3")).toEqual({
      race: council,
    });
  });
  test("an ambiguous title names the keys to choose from", () => {
    const found = findRace([[council, elsewhere]], "City Council District 3");
    expect("error" in found && found.error).toContain("council, council-sf");
  });
});

describe("resolveMark", () => {
  test("a pick in a vote-for-one race makes the earlier pick a backup, as the bubble does", () => {
    let draft = mark(EMPTY, council, { choice: "Ana Ortiz", mark: "pick" });
    draft = mark(draft, council, { choice: "ben lee", mark: "pick" });
    expect(marks(council, draft)).toEqual([
      ["Ana Ortiz", "backup", 2],
      ["Ben Lee", "pick", 1],
    ]);
    expect(raceSummary(council, E, draft).warning).toBeUndefined();
  });

  test("never toggles: a repeated pick or mark changes nothing", () => {
    const once = mark(EMPTY, board, { choice: "Bo", mark: "pick" });
    const again = resolveMark(board, E, once, { choice: "Bo", mark: "pick" });
    expect(again).toEqual({ patches: [], order: ["Bo"] });
    const maybe = mark(once, board, { choice: "Cy", mark: "maybe" });
    expect(resolveMark(board, E, maybe, { choice: "Cy", mark: "maybe" })).toEqual({
      patches: [],
      order: ["Bo"],
    });
    const yes = mark(EMPTY, measure, { choice: "Yes", mark: "pick" });
    expect(marks(measure, mark(yes, measure, { choice: "Yes", mark: "pick" }))[0]).toEqual([
      "Yes",
      "pick",
      "-",
    ]);
  });

  test("against and none take a name out of the ranking and close the gap", () => {
    let draft = resolveAndApply(board, ["Ann", "Bo", "Cy"]);
    expect(marks(board, draft).map((m) => m[1])).toEqual(["pick", "pick", "backup", "-"]);
    draft = mark(draft, board, { choice: "Ann", mark: "against" });
    expect(marks(board, draft)).toEqual([
      ["Ann", "against", "-"],
      ["Bo", "pick", 1],
      ["Cy", "pick", 2],
      ["Di", "-", "-"],
    ]);
    draft = mark(draft, board, { choice: "Bo", mark: "none" });
    expect(marks(board, draft).map((m) => m[1])).toEqual(["against", "-", "pick", "-"]);
    draft = mark(draft, board, { choice: "Ann", mark: "none" });
    expect(marks(board, draft)[0]).toEqual(["Ann", "-", "-"]);
  });

  test("a yes/no question has no against and takes no write-ins", () => {
    expect(resolveMark(measure, E, EMPTY, { choice: "Yes", mark: "against" })).toHaveProperty(
      "error",
    );
    expect(
      resolveMark(measure, E, EMPTY, { choice: "Maybe so", mark: "pick", writeIn: true }),
    ).toHaveProperty("error");
    expect(marks(measure, mark(EMPTY, measure, { choice: "no", mark: "pick" }))[1]).toEqual([
      "No",
      "pick",
      "-",
    ]);
  });

  test("an unlisted name is refused unless it's a write-in, with the choices to pick from", () => {
    const refused = resolveMark(council, E, EMPTY, { choice: "Cara Diaz", mark: "pick" });
    expect("error" in refused && refused.error).toContain("Ana Ortiz; Ben Lee");
    expect(
      resolveMark(council, E, EMPTY, { choice: "Cara Diaz", mark: "maybe", writeIn: true }),
    ).toHaveProperty("error");
  });

  test("a write-in is listed, ranked, and can be cleared", () => {
    let draft = mark(EMPTY, board, { choice: "Ann", mark: "pick" });
    draft = mark(draft, board, { choice: "Cara Diaz", mark: "pick", writeIn: true });
    const summary = raceSummary(board, E, draft);
    expect(summary.choices.at(-1)).toEqual({
      choice: "Cara Diaz",
      not_on_ballot: true,
      write_in: true,
      sources_for: 0,
      sources_against: 0,
      mark: "pick",
      rank: 2,
    });
    draft = mark(draft, board, { choice: "cara diaz", mark: "none" });
    expect(raceSummary(board, E, draft).choices.map((c) => c.choice)).toEqual([
      "Ann",
      "Bo",
      "Cy",
      "Di",
    ]);
  });

  test("a write-in that's plainly a listed candidate picks them instead", () => {
    const result = resolveMark(council, E, EMPTY, {
      choice: "Ana  ORTIZ",
      mark: "pick",
      writeIn: true,
    });
    expect(result).toMatchObject({
      patches: [{ choice: "Ana Ortiz", fields: { stance: "endorse" } }],
      order: ["Ana Ortiz"],
    });
  });

  test("an unknown mark is refused", () => {
    expect(
      resolveMark(council, E, EMPTY, { choice: "Ana Ortiz", mark: "veto" as "pick" }),
    ).toHaveProperty("error");
  });
});

function resolveAndApply(r: Race, names: string[], draft: Draft = EMPTY): Draft {
  return apply(draft, r, resolveRanking(r, E, draft, names));
}

describe("resolveRanking", () => {
  test("the first as many as the ballot takes are picked, the rest backups", () => {
    const draft = resolveAndApply(board, ["di", "Bo", "Ann"]);
    expect(marks(board, draft)).toEqual([
      ["Ann", "backup", 3],
      ["Bo", "pick", 2],
      ["Cy", "-", "-"],
      ["Di", "pick", 1],
    ]);
  });

  test("names left out are unranked and unmarked; an empty list clears the race", () => {
    let draft = resolveAndApply(board, ["Ann", "Bo", "Cy"]);
    draft = resolveAndApply(board, ["Cy"], draft);
    expect(marks(board, draft).map((m) => m[1])).toEqual(["-", "-", "pick", "-"]);
    draft = resolveAndApply(board, [], draft);
    expect(marks(board, draft).every((m) => m[1] === "-")).toBe(true);
  });

  test("refuses unknown and repeated names, and yes/no questions", () => {
    expect(resolveRanking(board, E, EMPTY, ["Ann", "Zed"])).toHaveProperty("error");
    expect(resolveRanking(board, E, EMPTY, ["Ann", "ann"])).toHaveProperty("error");
    expect(resolveRanking(measure, E, EMPTY, ["Yes"])).toHaveProperty("error");
  });
});

describe("ballotPage", () => {
  const races = [council, measure, race("water", "Water District", "race", [], { maybe: true })];
  test("a page at a time, places it can't tell last", () => {
    const first = ballotPage([races[2] as Race, council, measure], E, EMPTY, { limit: 2 });
    expect(first.races.map((r) => r.race)).toEqual(["council", "m-a"]);
    expect(first.total).toBe(3);
    expect(first.next_offset).toBe(2);
    const rest = ballotPage(races, E, EMPTY, { offset: 2, limit: 2 });
    expect(rest.races.map((r) => [r.race, r.maybe_on_ballot])).toEqual([["water", true]]);
    expect(rest.next_offset).toBeUndefined();
  });
  test("narrowed by search, and to marked races", () => {
    expect(ballotPage(races, E, EMPTY, { search: "ortiz" }).races.map((r) => r.race)).toEqual([
      "council",
    ]);
    const draft = mark(EMPTY, measure, { choice: "Yes", mark: "pick" });
    expect(ballotPage(races, E, draft, { markedOnly: true }).races.map((r) => r.race)).toEqual([
      "m-a",
    ]);
  });
});
