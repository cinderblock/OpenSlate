import { describe, expect, test } from "bun:test";
import type { BallotContest, Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "../src/lib/ballotDraft";
import type { ChoiceGroup, Race } from "../src/lib/collate";
import {
  isRanked,
  marksFor,
  moveNames,
  orderPatches,
  rankingOf,
  togglePick,
  unrankedNames,
} from "../src/lib/ranking";

const E = "2026-11-03";

function group(choice: string, ballotIndex: number): ChoiceGroup {
  return {
    choice,
    positions: [],
    support: 0,
    opposition: 0,
    onBallot: true,
    writeIn: false,
    ballotIndex,
  };
}

function race(names: string[], ballot?: BallotContest): Race {
  return {
    key: "k",
    subject: { title: "Mayor", kind: "race" },
    choices: names.map(group),
    onBallot: true,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
    ...(ballot ? { ballot } : {}),
  };
}

function rows(r: Race, marks: Record<string, Stance>, writeIns: string[] = []) {
  const out: Record<string, DraftRow> = {};
  for (const [choice, stance] of Object.entries(marks)) {
    const id = rowIdFor(E, r.subject, choice);
    out[id] = {
      id,
      electionId: E,
      subject: r.subject,
      choice,
      stance,
      ...(writeIns.includes(choice) ? { writeIn: true as const } : {}),
      updatedAt: "",
    };
  }
  return out;
}

const mayor = race(["Ann", "Bo", "Cy", "Di"], { vote_for: 1 });
const board = race(["Ann", "Bo", "Cy", "Di"], { vote_for: 2 });
const rcv = race(["Ann", "Bo", "Cy", "Di"], { ranks: 3 });

describe("marksFor", () => {
  test("ranks, else vote for, else every ranked name", () => {
    expect(marksFor(rcv)).toBe(3);
    expect(marksFor(board)).toBe(2);
    expect(marksFor(race(["Ann"]))).toBe(Number.POSITIVE_INFINITY);
  });

  test("yes/no questions aren't ranked", () => {
    const measure = { ...race(["Yes", "No"]), subject: { title: "Prop 1", kind: "measure" } };
    expect(isRanked(measure)).toBe(false);
    expect(isRanked(mayor)).toBe(true);
  });
});

describe("rankingOf", () => {
  test("the saved order, kept to names still marked for", () => {
    const r = rows(mayor, { Cy: "endorse", Ann: "lean_for", Bo: "oppose" });
    expect(rankingOf(mayor, E, r, ["Cy", "Bo", "Ann", "Zed"])).toEqual(["Cy", "Ann"]);
  });

  test("picks set some other way join the end, in ballot order", () => {
    const r = rows(board, { Di: "endorse", Bo: "endorse", Ann: "lean_for" });
    // Ann is a maybe, not ranked: nothing put her in the order.
    expect(rankingOf(board, E, r, undefined)).toEqual(["Bo", "Di"]);
    expect(rankingOf(board, E, r, ["Di"])).toEqual(["Di", "Bo"]);
  });

  test("a write-in can be ranked", () => {
    const r = rows(mayor, { Zoe: "endorse" }, ["Zoe"]);
    expect(rankingOf(mayor, E, r, ["Zoe"])).toEqual(["Zoe"]);
    expect(unrankedNames(mayor, E, r, ["Zoe"])).toEqual(["Ann", "Bo", "Cy", "Di"]);
  });
});

describe("orderPatches", () => {
  const stances = (patches: ReturnType<typeof orderPatches>) =>
    Object.fromEntries(patches.map((p) => [p.choice, p.fields.stance]));

  test("vote for one: the first is the pick, the rest backups", () => {
    const r = rows(mayor, {});
    expect(stances(orderPatches(mayor, E, r, [], ["Cy", "Ann", "Bo"]))).toEqual({
      Cy: "endorse",
      Ann: "lean_for",
      Bo: "lean_for",
    });
  });

  test("ranked choice: the first `ranks` are marked", () => {
    const r = rows(rcv, {});
    expect(stances(orderPatches(rcv, E, r, [], ["Di", "Cy", "Bo", "Ann"]))).toEqual({
      Di: "endorse",
      Cy: "endorse",
      Bo: "endorse",
      Ann: "lean_for",
    });
  });

  test("only what changes, and names dropped from the order are unmarked", () => {
    const r = rows(board, { Ann: "endorse", Bo: "endorse", Cy: "lean_for" });
    expect(stances(orderPatches(board, E, r, ["Ann", "Bo", "Cy"], ["Cy", "Ann"]))).toEqual({
      Cy: "endorse",
      Bo: undefined,
    });
  });

  test("an unknown count marks every ranked name", () => {
    const open = race(["Ann", "Bo"]);
    expect(stances(orderPatches(open, E, rows(open, {}), [], ["Bo", "Ann"]))).toEqual({
      Bo: "endorse",
      Ann: "endorse",
    });
  });
});

describe("togglePick", () => {
  test("vote for one: a new pick goes first and the old one becomes the backup", () => {
    expect(togglePick(["Ann"], "Cy", 1)).toEqual(["Cy", "Ann"]);
    expect(togglePick(["Ann", "Bo"], "Bo", 1)).toEqual(["Bo", "Ann"]);
  });

  test("with room to spare it joins the marked ones at the end", () => {
    expect(togglePick(["Ann"], "Cy", 3)).toEqual(["Ann", "Cy"]);
    expect(togglePick(["Ann", "Bo", "Cy"], "Di", 2)).toEqual(["Ann", "Di", "Bo", "Cy"]);
    expect(togglePick(["Ann"], "Bo", Number.POSITIVE_INFINITY)).toEqual(["Ann", "Bo"]);
  });

  test("a marked name leaves the ranking", () => {
    expect(togglePick(["Ann", "Bo"], "Ann", 1)).toEqual(["Bo"]);
    expect(togglePick(["Ann", "Bo", "Cy"], "Bo", 3)).toEqual(["Ann", "Cy"]);
  });
});

describe("moveNames", () => {
  test("before or after a name", () => {
    expect(moveNames(["Ann", "Bo", "Cy"], ["Cy"], "Ann", "before")).toEqual(["Cy", "Ann", "Bo"]);
    expect(moveNames(["Ann", "Bo", "Cy"], ["Ann"], "Bo", "after")).toEqual(["Bo", "Ann", "Cy"]);
  });

  test("names from outside the order join it", () => {
    expect(moveNames(["Ann", "Bo"], ["Di"], "Bo", "before")).toEqual(["Ann", "Di", "Bo"]);
    expect(moveNames(["Ann"], ["Di"], undefined, "after")).toEqual(["Ann", "Di"]);
  });

  test("dropped on itself, nothing moves", () => {
    expect(moveNames(["Ann", "Bo"], ["Bo"], "Bo", "before")).toEqual(["Ann", "Bo"]);
  });
});
