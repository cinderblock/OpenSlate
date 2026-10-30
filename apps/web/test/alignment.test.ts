import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, type Stance, type Subject } from "@openslate/core";
import { expandAdoptions } from "../src/lib/adoptions";
import {
  type Alignment,
  compareBallot,
  ELSEWHERE_MIN_MARKS,
  evidenceOf,
  groupAlignments,
  MIXED_MIN_RACES,
  marksByRace,
  type RaceResult,
  seatConflicts,
  splitOf,
  wilson,
} from "../src/lib/alignment";
import { translateSlates } from "../src/lib/ballotCheck";
import { applyPatch, type DraftRow, NOTE_CHOICE, rowIdFor } from "../src/lib/ballotDraft";
import {
  type ChoiceGroup,
  collateRaces,
  decodeSlates,
  type Race,
  type RacePosition,
} from "../src/lib/collate";
import { type Area, EMPTY_AREA } from "../src/lib/jurisdictions";
import { subjectKey } from "../src/lib/subjects";

const E = "2026-11-03";

type Say = [source: string, stance: Stance, extra?: Partial<RacePosition>];

function position([source, stance, extra]: Say): RacePosition {
  return {
    source: { id: source.toLowerCase(), name: source } as RacePosition["source"],
    stance,
    valid: true,
    standing: "off",
    ...extra,
  };
}

/** `choices`: name → who says what about it; "" is the race as a whole. */
function race(
  title: string,
  choices: Record<string, Say[]>,
  extra: Partial<Race> & { kind?: string } = {},
): Race {
  const { kind = "race", ...rest } = extra;
  const subject: Subject = { title, kind: kind as Subject["kind"], jurisdiction: "us/ca" };
  const groups: ChoiceGroup[] = Object.entries(choices).map(([choice, says]) => ({
    choice,
    positions: says.map(position),
    support: 0,
    opposition: 0,
    onBallot: Boolean(rest.onBallot),
    writeIn: false,
  }));
  return {
    key: subjectKey(subject),
    subject,
    jurisdiction: "us/ca",
    choices: groups,
    onBallot: false,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
    ...rest,
  };
}

const measure = (title: string, choices: Record<string, Say[]>) =>
  race(title, choices, { kind: "measure" });
/** A race a ballot listing covers: every name in `choices` is the field. */
const listed = (title: string, choices: Record<string, Say[]>, voteFor?: number, ranks?: number) =>
  race(title, choices, {
    onBallot: true,
    ...(voteFor || ranks
      ? { ballot: { ...(voteFor ? { vote_for: voteFor } : {}), ...(ranks ? { ranks } : {}) } }
      : {}),
  });

/** Draft rows: name → stance; "" marks the race as a whole. */
function marks(of: Race, stances: Record<string, Stance>): Record<string, DraftRow> {
  const rows: Record<string, DraftRow> = {};
  for (const [name, stance] of Object.entries(stances)) {
    const choice = name || undefined;
    const id = rowIdFor(E, of.subject, choice);
    rows[id] = { id, electionId: E, subject: of.subject, choice, stance, updatedAt: "" };
  }
  return rows;
}

function compareOne(of: Race, stances: Record<string, Stance>, source = "Org") {
  const comparison = compareBallot({
    races: [of],
    rows: marks(of, stances),
    election: E,
    area: EMPTY_AREA,
  });
  const found = comparison.alignments.find((a) => a.source.name === source);
  return found?.results[0] as RaceResult;
}

const verdict = (of: Race, stances: Record<string, Stance>) => compareOne(of, stances)?.verdict;

describe("wilson", () => {
  test("two races at 100% rank below forty at 90%", () => {
    expect(wilson(2, 2).low).toBeLessThan(wilson(36, 40).low);
    expect(wilson(2, 2).low).toBeCloseTo(0.342, 2);
    expect(wilson(36, 40).low).toBeCloseTo(0.769, 2);
  });
  test("the interval holds the share, and tightens with more races", () => {
    const few = wilson(3, 6);
    const many = wilson(30, 60);
    expect(few.low).toBeLessThan(0.5);
    expect(few.high).toBeGreaterThan(0.5);
    expect(many.high - many.low).toBeLessThan(few.high - few.low);
  });
  test("no races say nothing", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
  test("handles fractional counts", () => {
    const { low, high } = wilson(1.5, 2.5);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });
});

describe("seatConflicts", () => {
  const conflicts = (mine: string, theirs: string, seats: number) =>
    seatConflicts(new Set(mine), new Set(theirs), seats);

  test.each([
    // Vote for one.
    ["A", "A", 1, 0],
    ["A", "B", 1, 1],
    // A dual endorsement is no conflict with one of its names.
    ["A", "AB", 1, 0],
    ["AB", "A", 1, 0],
    ["A", "BC", 1, 1],
    // Vote for three: both fit.
    ["A", "C", 3, 0],
    ["AB", "C", 3, 0],
    // No room left.
    ["AB", "CD", 3, 1],
    ["ABC", "D", 3, 1],
    ["A", "DEF", 3, 1],
    ["ABC", "ADE", 3, 2],
    ["ABC", "DEF", 3, 3],
    ["A", "ABC", 3, 0],
  ] as Array<[string, string, number, number]>)("%s vs %s, %d seats: %d", (a, b, seats, want) => {
    expect(conflicts(a, b, seats)).toBe(want);
  });
});

describe("marksByRace", () => {
  const one = race("R", { A: [], B: [], C: [] });
  const key = one.key;

  test("a Maybe beside a pick is a backup, not a mark", () => {
    const got = marksByRace(marks(one, { A: "endorse", B: "lean_for" }), E).get(key);
    expect(got).toEqual({ backed: ["A"], opposed: [], soft: false });
  });
  test("only Maybes back those names, softly", () => {
    const got = marksByRace(marks(one, { A: "lean_for", B: "lean_for" }), E).get(key);
    expect(got).toEqual({ backed: ["A", "B"], opposed: [], soft: true });
  });
  test("Against is against", () => {
    const got = marksByRace(marks(one, { A: "oppose" }), E).get(key);
    expect(got).toEqual({ backed: [], opposed: ["A"], soft: false });
  });
  test("keeps the voter's ranking, picks it lacks after it", () => {
    const rows = marks(one, { A: "endorse", B: "endorse", C: "endorse" });
    const got = marksByRace(rows, E, { [`${E}|${key}`]: ["C", "gone", "A"] }).get(key);
    expect(got?.backed).toEqual(["C", "A", "B"]);
  });
  test("private notes, neutral marks and other elections aren't marks", () => {
    const rows = {
      ...marks(one, { [NOTE_CHOICE]: "endorse", A: "neutral", B: "abstain" }),
      other: { ...Object.values(marks(one, { C: "endorse" }))[0], electionId: "2026-06-02" },
    } as Record<string, DraftRow>;
    expect(marksByRace(rows, E).size).toBe(0);
  });
  test("a stance on a measure as a whole is a Yes or a No", () => {
    const m = measure("M", { Yes: [], No: [] });
    expect(marksByRace(marks(m, { "": "endorse" }), E).get(m.key)?.backed).toEqual(["Yes"]);
    expect(marksByRace(marks(m, { "": "oppose" }), E).get(m.key)?.backed).toEqual(["No"]);
  });
});

describe("yes/no questions", () => {
  test("same side agrees, the other differs", () => {
    const m = measure("M", { Yes: [["Org", "endorse"]] });
    expect(verdict(m, { Yes: "endorse" })).toBe("agree");
    expect(verdict(m, { No: "endorse" })).toBe("differ");
  });
  test('"No on X" is stored as endorse + choice No', () => {
    const m = measure("M", { No: [["Org", "endorse"]] });
    expect(verdict(m, { No: "endorse" })).toBe("agree");
    expect(verdict(m, { Yes: "endorse" })).toBe("differ");
  });
  test("opposing Yes is a No", () => {
    const m = measure("M", { Yes: [["Org", "oppose"]] });
    expect(verdict(m, { No: "endorse" })).toBe("agree");
    expect(verdict(m, { Yes: "endorse" })).toBe("differ");
  });
  test("a stance on the measure as a whole is a side", () => {
    expect(verdict(measure("M", { "": [["Org", "endorse"]] }), { Yes: "endorse" })).toBe("agree");
    expect(verdict(measure("M", { "": [["Org", "oppose"]] }), { Yes: "endorse" })).toBe("differ");
    expect(verdict(measure("M", { "": [["Org", "oppose"]] }), { No: "endorse" })).toBe("agree");
  });
  test("the voter's Against on Yes is a No", () => {
    const m = measure("M", { Yes: [["Org", "endorse"]] });
    expect(verdict(m, { Yes: "oppose" })).toBe("differ");
    expect(verdict(measure("M", { No: [["Org", "endorse"]] }), { Yes: "oppose" })).toBe("agree");
  });
  test("a lean counts the same as an endorsement", () => {
    expect(verdict(measure("M", { Yes: [["Org", "lean_for"]] }), { Yes: "endorse" })).toBe("agree");
    expect(verdict(measure("M", { Yes: [["Org", "lean_against"]] }), { Yes: "endorse" })).toBe(
      "differ",
    );
  });
  test("backing both sides says nothing", () => {
    const m = measure("M", { Yes: [["Org", "endorse"]], No: [["Org", "endorse"]] });
    expect(verdict(m, { Yes: "endorse" })).toBe("declined");
  });
  test.each(["neutral", "abstain"] as Stance[])("%s isn't disagreement", (stance) => {
    const whole = measure("M", { "": [["Org", stance]] });
    expect(verdict(whole, { Yes: "endorse" })).toBe("declined");
    const named = measure("M", { Yes: [["Org", stance]] });
    expect(verdict(named, { No: "endorse" })).toBe("declined");
  });
  test("a retention question works the same way", () => {
    const judge = race("Retain Justice", { Yes: [["Org", "endorse"]], No: [] });
    expect(verdict(judge, { Yes: "endorse" })).toBe("agree");
    expect(verdict(judge, { No: "endorse" })).toBe("differ");
  });
});

describe("two names on the ballot", () => {
  const two = (say: Record<string, Say[]>) => listed("R", { A: [], B: [], ...say });

  test("A against B is a disagreement", () => {
    expect(verdict(two({ B: [["Org", "endorse"]] }), { A: "endorse" })).toBe("differ");
    expect(verdict(two({ A: [["Org", "endorse"]] }), { A: "endorse" })).toBe("agree");
  });
  test("against one is for the other, on both sides", () => {
    expect(verdict(two({ B: [["Org", "endorse"]] }), { A: "oppose" })).toBe("agree");
    expect(verdict(two({ A: [["Org", "endorse"]] }), { A: "oppose" })).toBe("differ");
    expect(verdict(two({ B: [["Org", "oppose"]] }), { A: "endorse" })).toBe("agree");
    expect(verdict(two({ A: [["Org", "oppose"]] }), { A: "endorse" })).toBe("differ");
  });
  test("two names for two seats aren't a choice between them", () => {
    const both = listed("R", { A: [], B: [["Org", "endorse"]] }, 2);
    expect(verdict(both, { A: "endorse" })).toBe("compatible");
  });
});

describe("several names, one seat", () => {
  const field = (say: Record<string, Say[]>) => listed("R", { A: [], B: [], C: [], ...say }, 1);

  test("a different name is a disagreement", () => {
    expect(verdict(field({ B: [["Org", "endorse"]] }), { A: "endorse" })).toBe("differ");
  });
  test("ruling one out doesn't say who to back", () => {
    expect(verdict(field({ B: [["Org", "endorse"]] }), { A: "oppose" })).toBe("compatible");
    expect(verdict(field({ B: [["Org", "oppose"]] }), { A: "endorse" })).toBe("compatible");
  });
  test("backing what the other opposes conflicts, both ways round", () => {
    expect(verdict(field({ A: [["Org", "endorse"]] }), { A: "oppose" })).toBe("differ");
    expect(verdict(field({ A: [["Org", "oppose"]] }), { A: "endorse" })).toBe("differ");
  });
  test("both against the same name agree", () => {
    expect(verdict(field({ A: [["Org", "oppose"]] }), { A: "oppose" })).toBe("agree");
  });
  test("a dual endorsement including the pick agrees", () => {
    const dual = field({ A: [["Org", "endorse"]], B: [["Org", "endorse"]] });
    expect(verdict(dual, { A: "endorse" })).toBe("agree");
    expect(verdict(dual, { C: "endorse" })).toBe("differ");
  });
  test("two Maybes and an endorser choosing one of them agree", () => {
    expect(verdict(field({ A: [["Org", "endorse"]] }), { A: "lean_for", B: "lean_for" })).toBe(
      "agree",
    );
  });
});

describe("several seats", () => {
  const board = (backs: string[]) =>
    listed(
      "Board",
      Object.fromEntries(
        ["A", "B", "C", "D", "E", "F"].map((n) => [
          n,
          backs.includes(n) ? ([["Org", "endorse"]] as Say[]) : [],
        ]),
      ),
      3,
    );

  test("the user's example: C endorsed in a vote-for-3 isn't disagreement with A", () => {
    expect(verdict(board(["C"]), { A: "endorse" })).toBe("compatible");
  });
  test("a shared name agrees, however many else either backs", () => {
    expect(verdict(board(["A", "B", "C"]), { A: "endorse" })).toBe("agree");
    expect(verdict(board(["A"]), { A: "endorse", B: "endorse", C: "endorse" })).toBe("agree");
  });
  test("full lists scoring one name in three", () => {
    const result = compareOne(board(["A", "D", "E"]), { A: "endorse", B: "endorse", C: "endorse" });
    expect(result.verdict).toBe("partly");
    expect(result.score).toBeCloseTo(1 / 3);
    expect(result.weight).toBe(1);
  });
  test("no room for their pick beside a full list is a disagreement", () => {
    expect(verdict(board(["D"]), { A: "endorse", B: "endorse", C: "endorse" })).toBe("differ");
    expect(verdict(board(["D", "E", "F"]), { A: "endorse" })).toBe("differ");
  });
  test("counts as one race, not one per seat", () => {
    const comparison = compareBallot({
      races: [board(["A", "B", "C"])],
      rows: marks(board([]), { A: "endorse", B: "endorse", C: "endorse" }),
      election: E,
      area: EMPTY_AREA,
    });
    expect(comparison.alignments[0]?.shared).toBe(1);
    expect(comparison.alignments[0]?.weight).toBe(1);
  });
});

describe("a seat count no listing gives", () => {
  test("assumes the most names any source backs", () => {
    const council = race("Council", {
      A: [],
      B: [["Org", "endorse"]],
      C: [["Slate", "endorse"]],
      D: [["Slate", "endorse"]],
      E: [["Slate", "endorse"]],
    });
    expect(verdict(council, { A: "endorse" })).toBe("compatible");
  });
  test("a name that doesn't fit beside the voter's picks is a conflict all the same", () => {
    const council = race("Council", { A: [], B: [], C: [["Org", "endorse"]] });
    expect(compareOne(council, { A: "endorse", B: "endorse" })).toMatchObject({
      verdict: "differ",
      weight: 0.5,
    });
  });
  test("a conflict resting on the guess counts half", () => {
    const seat = race("Seat", { A: [], B: [["Org", "endorse"]] });
    const result = compareOne(seat, { A: "endorse" });
    expect(result.verdict).toBe("differ");
    expect(result.weight).toBe(0.5);
  });
  test("an agreement doesn't rest on the guess", () => {
    const seat = race("Seat", { A: [["Org", "endorse"]], B: [] });
    expect(compareOne(seat, { A: "endorse" }).weight).toBe(1);
  });
});

describe("ranked choice", () => {
  const ranked = (say: Record<string, Say[]>) => listed("Mayor", say, undefined, 5);
  const rankings = (of: Race, order: string[]) => ({ [`${E}|${of.key}`]: order });

  function rankedResult(of: Race, order: string[]) {
    const stances = Object.fromEntries(order.map((n) => [n, "endorse" as Stance]));
    return compareBallot({
      races: [of],
      rows: marks(of, stances),
      rankings: rankings(of, order),
      election: E,
      area: EMPTY_AREA,
    }).alignments.find((a) => a.source.name === "Org")?.results[0];
  }

  test("the same first choice agrees", () => {
    const of = ranked({
      A: [["Org", "endorse", { rank: 1 }]],
      B: [["Org", "endorse", { rank: 2 }]],
    });
    expect(rankedResult(of, ["A", "B"])?.verdict).toBe("agree");
  });
  test("the voter's order decides who's first", () => {
    const of = ranked({ A: [["Org", "endorse", { rank: 1 }]], B: [] });
    const result = rankedResult(of, ["B", "A"]);
    expect(result?.verdict).toBe("partly");
    expect(result?.score).toBe(0.5);
  });
  test("no names in common differ, though a ranked ballot fits both", () => {
    const of = ranked({ A: [["Org", "endorse", { rank: 1 }]], B: [] });
    expect(rankedResult(of, ["B"])?.verdict).toBe("differ");
  });
  test("an unranked endorsement counts every name as first", () => {
    const of = ranked({ A: [["Org", "endorse"]], B: [["Org", "endorse"]], C: [] });
    expect(rankedResult(of, ["B", "C"])?.verdict).toBe("agree");
  });
  test("a seat count isn't guessed, so a difference counts in full", () => {
    const of = ranked({ A: [["Org", "endorse"]], B: [] });
    expect(rankedResult(of, ["B"])?.weight).toBe(1);
  });
});

describe("what a race counts for", () => {
  test("a voter's Maybe counts half", () => {
    const m = measure("M", { Yes: [["Org", "endorse"]] });
    expect(compareOne(m, { Yes: "lean_for" }).weight).toBe(0.5);
    expect(compareOne(m, { Yes: "endorse" }).weight).toBe(1);
  });
  test("a Maybe beside a pick doesn't soften it", () => {
    const of = listed("R", { A: [["Org", "endorse"]], B: [], C: [] }, 1);
    expect(compareOne(of, { A: "endorse", B: "lean_for" }).weight).toBe(1);
  });
  test("keeps the source's label and who it adopted from", () => {
    const m = measure("M", { Yes: [["Org", "lean_for", { label: "Recommended", via: "State" }]] });
    const result = compareOne(m, { Yes: "endorse" });
    expect(result.label).toBe("Recommended");
    expect(result.via).toBe("State");
  });
});

describe("names", () => {
  test("a spelling that's plainly the same person matches", () => {
    const of = race("R", { "Malia M. Cohen": [["Org", "endorse"]], Other: [] });
    expect(verdict(of, { "Malia Cohen": "endorse" })).toBe("agree");
  });
  test("case and spacing don't matter", () => {
    const of = race("R", { "Rob Bonta": [["Org", "endorse"]] });
    expect(verdict(of, { "rob  bonta": "endorse" })).toBe("agree");
  });
  test("a name written in is compared like any other", () => {
    const of = listed("R", { A: [["Org", "endorse"]], B: [], C: [] }, 1);
    expect(verdict(of, { Write: "endorse" })).toBe("differ");
  });
});

/** `count` measures on which Org lands `agree`, then disagrees on the rest. */
function record(source: string, agree: number, total: number, prefix = "M") {
  const races = Array.from({ length: total }, (_, i) =>
    measure(`${prefix}${i}`, { [i < agree ? "Yes" : "No"]: [[source, "endorse"]] }),
  );
  return races;
}

/** Merge several sources' race lists into one, by title. */
function merge(...lists: Race[][]): Race[] {
  const by = new Map<string, Race>();
  for (const race of lists.flat()) {
    const known = by.get(race.key);
    if (!known) {
      by.set(race.key, { ...race, choices: [...race.choices] });
      continue;
    }
    for (const group of race.choices) {
      const same = known.choices.find((c) => c.choice === group.choice);
      if (same) same.positions = [...same.positions, ...group.positions];
      else known.choices.push(group);
    }
  }
  return [...by.values()];
}

function yesOnAll(races: Race[]): Record<string, DraftRow> {
  return Object.assign({}, ...races.map((r) => marks(r, { Yes: "endorse" })));
}

function compared(races: Race[], rows = yesOnAll(races), area: Area = EMPTY_AREA) {
  return compareBallot({ races, rows, election: E, area });
}

describe("compareBallot", () => {
  test("counts the races the score rests on, and those it doesn't", () => {
    const races = [
      measure("A", { Yes: [["Org", "endorse"]] }),
      measure("B", { No: [["Org", "endorse"]] }),
      measure("C", { "": [["Org", "abstain"]] }),
    ];
    const [org] = compared(races).alignments;
    expect(org).toMatchObject({ agree: 1, differ: 1, declined: 1, shared: 2, share: 0.5 });
  });
  test("a race nobody spoke to is marked but not matched", () => {
    const races = [
      measure("A", { Yes: [["Org", "endorse"]] }),
      measure("B", { Yes: [] }),
      measure("C", { "": [["Org", "neutral"]] }),
    ];
    expect(compared(races)).toMatchObject({ marked: 3, matched: 1 });
  });
  test("a slate that didn't verify isn't compared", () => {
    const of = measure("A", { Yes: [["Org", "endorse", { valid: false }]] });
    expect(compared([of]).alignments).toEqual([]);
  });
  test("skips the voter's own identities", () => {
    const of = measure("A", { Yes: [["Me", "endorse"]] });
    const comparison = compareBallot({
      races: [of],
      rows: yesOnAll([of]),
      election: E,
      area: EMPTY_AREA,
      skip: new Set(["me"]),
    });
    expect(comparison.alignments).toEqual([]);
  });
  test("no marks, no comparison", () => {
    expect(compared(record("Org", 2, 2), {})).toMatchObject({ marked: 0, matched: 0 });
  });
  test("is pure: the same input twice gives the same result", () => {
    const races = record("Org", 3, 4);
    expect(compared(races).alignments[0]).toEqual(compared(races).alignments[0]);
  });
});

describe("open races", () => {
  const here = race("Here", { A: [["Org", "endorse"]] }, { jurisdiction: "us/ca/sf" });
  const there = race("There", { A: [["Org", "endorse"]] }, { jurisdiction: "us/ca/la" });
  const marked = measure("Marked", { Yes: [["Org", "endorse"]] });
  const sf: Area = { localities: ["us/ca/sf"], districts: {} };

  test("with an area: races on the ballot the voter hasn't marked", () => {
    const [org] = compared([here, there, marked], yesOnAll([marked]), sf).alignments;
    expect(org?.open).toBe(1);
    expect(org?.reach).toBe(3);
  });
  test("with none: wherever the voter has marked something", () => {
    const rows = marks(here, { A: "endorse" });
    const near = race("Near", { A: [["Org", "endorse"]] }, { jurisdiction: "us/ca/sf" });
    const [org] = compared([here, near, there], rows).alignments;
    expect(org?.open).toBe(1);
  });
});

function grouped(races: Race[], prefer?: (a: Alignment) => boolean) {
  return groupAlignments(compared(races), prefer);
}

const names = (rows: Alignment[]) => rows.map((row) => row.source.name);

describe("groupAlignments", () => {
  test("36 of 40 outranks 2 of 2", () => {
    const races = merge(record("Big", 36, 40), record("Small", 2, 2));
    expect(names(grouped(races).aligned)).toEqual(["Big", "Small"]);
  });
  test("4 of 40 is more opposed than 0 of 2", () => {
    const races = merge(record("Big", 4, 40), record("Small", 0, 2));
    expect(names(grouped(races).opposed)).toEqual(["Big", "Small"]);
  });
  test("an even record on many races is mixed, and neither aligned nor opposed", () => {
    const races = record("Even", 11, 20);
    const groups = grouped(races);
    expect(names(groups.mixed)).toEqual(["Even"]);
    expect(groups.aligned).toEqual([]);
    expect(groups.opposed).toEqual([]);
  });
  test("1 of 2 isn't mixed: it's too little to say", () => {
    const groups = grouped(record("Thin", 3, MIXED_MIN_RACES - 1));
    expect(groups.mixed).toEqual([]);
    expect(names(groups.aligned)).toEqual(["Thin"]);
  });
  test("the surest mixed record comes first", () => {
    const races = merge(record("Many", 20, 40), record("Few", 3, 6));
    expect(names(grouped(races).mixed)).toEqual(["Many", "Few"]);
  });
  test("exactly half on too few races is in no group", () => {
    const groups = grouped(record("Thin", 1, 2));
    expect(groups.aligned).toEqual([]);
    expect(groups.opposed).toEqual([]);
    expect(groups.mixed).toEqual([]);
  });
  test("stays sensible with three picks", () => {
    const races = merge(record("Agrees", 3, 3), record("Differs", 0, 3));
    const groups = grouped(races);
    expect(names(groups.aligned)).toEqual(["Agrees"]);
    expect(names(groups.opposed)).toEqual(["Differs"]);
    expect(groups.elsewhere).toEqual([]);
  });

  test("identical records fold onto one row, the established one shown", () => {
    const races = merge(record("Small", 3, 3), record("Big", 3, 3), [
      measure("Elsewhere", { Yes: [["Big", "endorse"]] }),
    ]);
    const { rows } = { rows: yesOnAll(record("Small", 3, 3)) };
    const [row] = groupAlignments(compared(races, rows)).aligned;
    expect(row?.source.name).toBe("Big");
    expect(names(row?.folded ?? [])).toEqual(["Small"]);
  });
  test("the preferred endorser is the one shown", () => {
    const races = merge(record("Big", 3, 3), record("Followed", 3, 3));
    const [row] = grouped(races, (a) => a.source.name === "Followed").aligned;
    expect(row?.source.name).toBe("Followed");
  });
  test("different picks that land alike don't fold", () => {
    const one = race(
      "R",
      { A: [["Org", "endorse"]], B: [["Other", "endorse"]] },
      { onBallot: true },
    );
    const rows = marks(one, { A: "endorse" });
    const groups = groupAlignments(compared([one], rows));
    expect(names(groups.aligned)).toEqual(["Org"]);
    expect(names(groups.opposed)).toEqual(["Other"]);
  });
  test("a list that's mostly another's sits under it, with its own record kept", () => {
    const state = record("State", 5, 5);
    const copier = state.map((r) =>
      measure(r.subject.title, { Yes: [["County", "endorse", { via: "State" }]] }),
    );
    const own = measure("Own", { No: [["County", "endorse"]] });
    const races = merge(state, copier, [own]);
    const rows = yesOnAll(races);
    const groups = groupAlignments(compared(races, rows));
    expect(names(groups.aligned)).toEqual(["State"]);
    const [county] = groups.aligned[0]?.folded ?? [];
    expect(county?.source.name).toBe("County");
    expect(county?.repeats).toEqual({ of: "State", count: 5 });
    expect(county).toMatchObject({ agree: 5, differ: 1 });
  });
  test("with one record between them, the original shows, not the one repeating it", () => {
    const original = record("Zed State", 3, 3);
    const copier = original.map((r) =>
      measure(r.subject.title, { Yes: [["Ada County", "endorse", { via: "Zed State" }]] }),
    );
    const groups = grouped(merge(original, copier));
    expect(names(groups.aligned)).toEqual(["Zed State"]);
    expect(names(groups.aligned[0]?.folded ?? [])).toEqual(["Ada County"]);
  });
  test("a list that's only partly another's keeps its own row", () => {
    const state = record("State", 5, 5);
    const copier = state
      .slice(0, 2)
      .map((r) => measure(r.subject.title, { Yes: [["County", "endorse", { via: "State" }]] }));
    const own = record("County", 4, 4, "N");
    const races = merge(state, copier, own);
    const rows = yesOnAll(races);
    const groups = groupAlignments(compared(races, rows));
    expect(names(groups.aligned).sort()).toEqual(["County", "State"]);
    expect(groups.aligned.find((r) => r.source.name === "County")?.repeats).toBeUndefined();
  });
  test("a repeated source that isn't compared stays on its own row", () => {
    const races = [measure("A", { Yes: [["County", "endorse", { via: "Gone" }]] })];
    expect(names(grouped(races).aligned)).toEqual(["County"]);
  });
});

describe("the elsewhere group", () => {
  const sf: Area = { localities: ["us/ca/sf"], districts: {} };
  const local = (n: number, source: string) =>
    Array.from({ length: n }, (_, i) =>
      race(`Local ${i}`, { A: [[source, "endorse"]] }, { jurisdiction: "us/ca/sf" }),
    );
  const picks = record("Broad", 8, 8);
  const rows = yesOnAll(picks);

  test("active on the ballot, on races the voter hasn't marked", () => {
    const races = merge(picks, local(6, "Local Group"));
    const comparison = compared(races, rows, sf);
    const groups = groupAlignments(comparison);
    expect(names(groups.elsewhere)).toEqual(["Local Group"]);
    expect(groups.elsewhere[0]?.open).toBe(6);
  });
  test("speaking to the voter's races keeps an endorser out, whatever else it covers", () => {
    const races = merge(picks, local(30, "Broad"));
    expect(groupAlignments(compared(races, rows, sf)).elsewhere).toEqual([]);
  });
  test("a few races aren't a focus", () => {
    const races = merge(picks, local(2, "Local Group"));
    expect(groupAlignments(compared(races, rows, sf)).elsewhere).toEqual([]);
  });
  test("a few marks can't show what the voter cares about", () => {
    const few = picks.slice(0, ELSEWHERE_MIN_MARKS - 1);
    const races = merge(few, local(6, "Local Group"));
    expect(groupAlignments(compared(races, yesOnAll(few), sf)).elsewhere).toEqual([]);
  });
  test("endorsers looking elsewhere leave the other groups and don't fold", () => {
    const narrow = merge(picks, local(6, "One"), local(6, "Two"));
    const groups = groupAlignments(compared(narrow, rows, sf));
    expect(names(groups.elsewhere).sort()).toEqual(["One", "Two"]);
    expect(groups.elsewhere.every((row) => row.folded.length === 0)).toBe(true);
  });
  test("a finished ballot has nobody looking elsewhere", () => {
    const races = merge(picks, local(6, "Local Group"));
    const all = {
      ...rows,
      ...Object.assign({}, ...local(6, "x").map((r) => marks(r, { A: "endorse" }))),
    };
    expect(groupAlignments(compared(races, all, sf)).elsewhere).toEqual([]);
  });
});

describe("splitOf", () => {
  test("names where a mixed record parts ways", () => {
    const races = merge(record("Org", 6, 6), [
      ...["X", "Y", "Z"].map((t) => listed(t, { A: [], B: [["Org", "endorse"]] })),
    ]);
    const rows = { ...yesOnAll(record("Org", 6, 6)) };
    for (const t of ["X", "Y", "Z"]) {
      Object.assign(rows, marks(listed(t, { A: [] }), { A: "endorse" }));
    }
    const [org] = compared(races, rows).alignments;
    const split = org ? splitOf(org) : undefined;
    expect(split?.high[0]).toBe("measure");
    expect(split?.low[0]).toBe("office");
  });
  test("nothing when one kind of race is all there is, or the gap's small", () => {
    const [org] = compared(record("Org", 3, 6)).alignments;
    expect(org ? splitOf(org) : "none").toBeUndefined();
  });
});

describe("evidenceOf", () => {
  test("says how much a result rests on", () => {
    expect(evidenceOf(0)).toBe("early");
    expect(evidenceOf(4)).toBe("early");
    expect(evidenceOf(5)).toBe("building");
    expect(evidenceOf(14)).toBe("building");
    expect(evidenceOf(15)).toBe("solid");
  });
});

describe("from signed slates", () => {
  const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E } as Subject;
  const prop = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: E } as Subject;
  const researcher = generateKeyPair();
  const report = (name: string, kind: string, extra: Partial<Parameters<typeof createSlate>[0]>) =>
    createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher", kind: "researcher" },
      attribution: { of: { name, kind }, mode: "scraped", retrieved_at: "2026-10-19T00:00:00Z" },
      context: { election: E },
      positions: [],
      ...extra,
    });
  const listing = report("Secretary of State", "election-authority", {
    positions: [
      { subject: gov, stance: "neutral", choice: "Alice A. Adams" },
      { subject: gov, stance: "neutral", choice: "Bob Brown" },
    ],
  });
  const state = report("State Party", "party", {
    positions: [
      { subject: gov, stance: "endorse", choice: "Alice Adams" },
      { subject: prop, stance: "endorse", choice: "Yes" },
    ],
  });
  const county = report("County Party", "party", {
    adopts: [
      {
        issuer: state.payload.issuer.key,
        of: "State Party",
        election: E,
        uri: "https://example.org/state.slate",
      },
    ],
  });
  const slates = translateSlates(
    expandAdoptions(
      decodeSlates(
        [listing, state, county].map(({ token }) => ({
          token,
          importedAt: "2026-10-30T00:00:00Z",
        })),
      ),
    ),
  );
  const races = collateRaces(slates, { follows: {}, election: E, includeUnfollowed: true });

  test("a pick lines up under the ballot's spelling, and a republished list folds", () => {
    const rows = applyPatch({}, E, gov, "Alice A. Adams", { stance: "endorse" });
    const comparison = compareBallot({ races, rows, election: E, area: EMPTY_AREA });
    const { aligned } = groupAlignments(comparison);
    expect(aligned.map((row) => row.source.name)).toEqual(["State Party"]);
    expect(aligned[0]?.folded.map((a) => a.source.name)).toEqual(["County Party"]);
    expect(aligned[0]?.folded[0]?.repeats).toEqual({ of: "State Party", count: 1 });
  });
  test("an election authority's listing is never an endorser", () => {
    const rows = applyPatch({}, E, gov, "Bob Brown", { stance: "endorse" });
    const comparison = compareBallot({ races, rows, election: E, area: EMPTY_AREA });
    expect(comparison.alignments.map((a) => a.source.name).sort()).toEqual([
      "County Party",
      "State Party",
    ]);
  });
});
