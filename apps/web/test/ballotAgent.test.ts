import { describe, expect, test } from "bun:test";
import type { Stance } from "@openslate/core";
import {
  ballotPage,
  findRace,
  raceDetail,
  raceSummary,
  resolveMark,
  shownElection,
} from "../src/lib/ballotAgent";
import {
  type DraftRow,
  NOTE_CHOICE,
  type RowPatch,
  applyPatch,
  rowIdFor,
} from "../src/lib/ballotDraft";
import type { ChoiceGroup, Race, RacePosition } from "../src/lib/collate";

const E = "2026-11-03";

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
const measure = race("m-a", "Measure A", "measure", [group("Yes"), group("No")]);

function apply(rows: Record<string, DraftRow>, patch: RowPatch) {
  return applyPatch(rows, E, patch.subject, patch.choice, patch.fields);
}

function patchOf(result: ReturnType<typeof resolveMark>): RowPatch {
  if ("error" in result) throw new Error(result.error);
  return result.patch;
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
  test("choices in ballot order, with counts and the user's marks", () => {
    const rows = apply(
      {},
      patchOf(resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "pick" })),
    );
    const summary = raceSummary(council, E, rows);
    expect(summary.race).toBe("council");
    expect(summary.instruction).toBe("Vote for one");
    expect(summary.choices).toEqual([
      { choice: "Ana Ortiz", sources_for: 2, sources_against: 0, mark: "pick" },
      { choice: "Ben Lee", sources_for: 0, sources_against: 1 },
    ]);
    expect(summary.warning).toBeUndefined();
  });

  test("warns of more picks than the ballot allows", () => {
    let rows = apply(
      {},
      patchOf(resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "pick" })),
    );
    rows = apply(rows, patchOf(resolveMark(council, E, {}, { choice: "Ben Lee", mark: "pick" })));
    expect(raceSummary(council, E, rows).warning).toContain("2 picks, but the ballot allows 1");
  });

  test("carries the private note, which isn't a choice", () => {
    const rows = applyPatch({}, E, council.subject, NOTE_CHOICE, { privateNote: "Ask Sam" });
    const summary = raceSummary(council, E, rows);
    expect(summary.note).toBe("Ask Sam");
    expect(summary.choices.every((c) => !c.mark)).toBe(true);
  });
});

test("raceDetail lists every source's position and statement", () => {
  const detail = raceDetail(council, E, {});
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
  test("marks as My ballot's buttons do, matching case loosely", () => {
    expect(patchOf(resolveMark(council, E, {}, { choice: "ben lee", mark: "against" }))).toEqual({
      subject: council.subject,
      choice: "Ben Lee",
      fields: { stance: "oppose" },
    });
    expect(
      patchOf(resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "maybe" })).fields,
    ).toEqual({
      stance: "lean_for",
    });
    expect(
      patchOf(resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "none" })).fields,
    ).toEqual({
      stance: undefined,
    });
  });

  test("a yes/no question has no against and takes no write-ins", () => {
    expect(resolveMark(measure, E, {}, { choice: "Yes", mark: "against" })).toHaveProperty("error");
    expect(
      resolveMark(measure, E, {}, { choice: "Maybe so", mark: "pick", writeIn: true }),
    ).toHaveProperty("error");
    expect(patchOf(resolveMark(measure, E, {}, { choice: "no", mark: "pick" })).choice).toBe("No");
  });

  test("an unlisted name is refused unless it's a write-in, with the choices to pick from", () => {
    const refused = resolveMark(council, E, {}, { choice: "Cara Diaz", mark: "pick" });
    expect("error" in refused && refused.error).toContain("Ana Ortiz; Ben Lee");
    expect(
      patchOf(resolveMark(council, E, {}, { choice: "Cara Diaz", mark: "pick", writeIn: true })),
    ).toEqual({
      subject: council.subject,
      choice: "Cara Diaz",
      fields: { stance: "endorse", writeIn: true },
    });
    expect(
      resolveMark(council, E, {}, { choice: "Cara Diaz", mark: "maybe", writeIn: true }),
    ).toHaveProperty("error");
  });

  test("a write-in that's plainly a listed candidate picks them instead", () => {
    const result = resolveMark(
      council,
      E,
      {},
      { choice: "Ana  ORTIZ", mark: "pick", writeIn: true },
    );
    expect(patchOf(result)).toEqual({
      subject: council.subject,
      choice: "Ana Ortiz",
      fields: { stance: "endorse" },
    });
  });

  test("an unknown mark is refused", () => {
    expect(
      resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "veto" as "pick" }),
    ).toHaveProperty("error");
  });
});

describe("ballotPage", () => {
  const races = [council, measure, race("water", "Water District", "race", [], { maybe: true })];
  test("a page at a time, places it can't tell last", () => {
    const first = ballotPage([races[2] as Race, council, measure], E, {}, { limit: 2 });
    expect(first.races.map((r) => r.race)).toEqual(["council", "m-a"]);
    expect(first.total).toBe(3);
    expect(first.next_offset).toBe(2);
    const rest = ballotPage(races, E, {}, { offset: 2, limit: 2 });
    expect(rest.races.map((r) => [r.race, r.maybe_on_ballot])).toEqual([["water", true]]);
    expect(rest.next_offset).toBeUndefined();
  });
  test("narrowed by search, and to marked races", () => {
    expect(ballotPage(races, E, {}, { search: "ortiz" }).races.map((r) => r.race)).toEqual([
      "council",
    ]);
    const rows = apply({}, patchOf(resolveMark(measure, E, {}, { choice: "Yes", mark: "pick" })));
    expect(ballotPage(races, E, rows, { markedOnly: true }).races.map((r) => r.race)).toEqual([
      "m-a",
    ]);
  });
});

test("a name the user wrote in is listed, counted and can be cleared", () => {
  let rows = apply({}, patchOf(resolveMark(council, E, {}, { choice: "Ana Ortiz", mark: "pick" })));
  rows = apply(
    rows,
    patchOf(resolveMark(council, E, rows, { choice: "Cara Diaz", mark: "pick", writeIn: true })),
  );
  const summary = raceSummary(council, E, rows);
  expect(summary.choices.at(-1)).toEqual({
    choice: "Cara Diaz",
    not_on_ballot: true,
    write_in: true,
    sources_for: 0,
    sources_against: 0,
    mark: "pick",
  });
  expect(summary.warning).toContain("2 picks");
  rows = apply(rows, patchOf(resolveMark(council, E, rows, { choice: "cara diaz", mark: "none" })));
  expect(raceSummary(council, E, rows).choices.map((c) => c.choice)).toEqual([
    "Ana Ortiz",
    "Ben Lee",
  ]);
});
