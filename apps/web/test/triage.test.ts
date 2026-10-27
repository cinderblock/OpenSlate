import { describe, expect, test } from "bun:test";
import { type BallotChoice, createSlate, generateKeyPair, type Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "../src/lib/ballotDraft";
import { collateRaces, decodeSlates, type Race } from "../src/lib/collate";
import {
  type FillEdit,
  partiesOn,
  partyFill,
  partyOf,
  partyPlural,
  raceStatus,
  sourceFill,
  sourcesOn,
  stepThrough,
} from "../src/lib/triage";

const researcher = generateKeyPair();
const E = "2026-11-03";

interface P {
  title: string;
  choice?: string;
  stance?: Stance;
  kind?: string;
  ballot?: BallotChoice;
  measureType?: string;
}

function slate(of: string, positions: P[], ofKind?: string) {
  const token = createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher" },
    positions: positions.map((p) => ({
      subject: {
        title: p.title,
        jurisdiction: "us/ca",
        election: E,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.measureType ? { ballot: { measure_type: p.measureType } } : {}),
      },
      stance: p.stance ?? "endorse",
      ...(p.choice !== undefined ? { choice: p.choice } : {}),
      ...(p.ballot ? { ballot: p.ballot } : {}),
    })),
    attribution: {
      of: { name: of, ...(ofKind ? { kind: ofKind } : {}) },
      mode: "scraped",
      retrieved_at: "2026-01-01T00:00:00Z",
    },
  }).token;
  return { token, importedAt: "2026-10-01T00:00:00Z" };
}

/** The official list: each candidate's party in `ballot`, measures as Yes / No. */
const ballot = slate(
  "Secretary of State",
  [
    { title: "Governor", choice: "Dee", ballot: { party: "Democratic", designation: "Attorney" } },
    { title: "Governor", choice: "Ray", ballot: { party: "Republican", designation: "Rancher" } },
    { title: "Treasurer", choice: "Dana", ballot: { party: "Democratic" } },
    {
      title: "Treasurer",
      choice: "Dora",
      ballot: { party: "Democratic", designation: "Treasurer", incumbent: true },
    },
    { title: "Controller", choice: "Rob", ballot: { party: "Republican" } },
    { title: "Controller", choice: "Gwen", ballot: { party: "Green", designation: "Teacher" } },
    { title: "Controller", choice: "Nia", ballot: { party: "No Party Preference" } },
    {
      title: "Justice",
      choice: "Judge J",
      ballot: { designation: "Associate Justice of the Supreme Court" },
    },
    { title: "Prop 1", choice: "Yes", kind: "measure", measureType: "Initiative Statute" },
    { title: "Prop 1", choice: "No", kind: "measure", measureType: "Initiative Statute" },
    { title: "Prop 2", choice: "Yes", kind: "measure" },
    { title: "Prop 2", choice: "No", kind: "measure" },
  ].map((p) => ({ ...p, stance: "neutral" as const })),
  "election-authority",
);

const gop = slate("County GOP", [
  { title: "Governor", choice: "Ray" },
  { title: "Controller", choice: "Rob" },
  { title: "Controller", choice: "Gwen", stance: "oppose" },
  { title: "Prop 1", choice: "No", kind: "measure" },
  // A bare stance on the measure as a whole: against = No.
  { title: "Prop 2", stance: "oppose", kind: "measure" },
]);

const races = collateRaces(decodeSlates([ballot, gop]), { follows: {} });
const race = (title: string) => races.find((r) => r.subject.title === title) as Race;

/** Draft rows from `[title, choice, stance]` marks. */
function rows(...marks: Array<[string, string | undefined, Stance]>): Record<string, DraftRow> {
  const out: Record<string, DraftRow> = {};
  for (const [title, choice, stance] of marks) {
    const subject = race(title).subject;
    const id = rowIdFor(E, subject, choice);
    out[id] = { id, electionId: E, subject, choice, stance, updatedAt: "" };
  }
  return out;
}

const brief = (edits: FillEdit[]) =>
  edits.map((e) => `${e.subject.title}:${e.choice ?? ""}=${e.stance}`).sort();

describe("partyOf", () => {
  test("reads the ballot's party field, with the usual spellings made one", () => {
    expect(partyOf({ ballot: { party: "Democratic" } })).toBe("Democratic");
    expect(partyOf({ ballot: { party: "Democratic Party" } })).toBe("Democratic");
    expect(partyOf({ ballot: { party: "democrat" } })).toBe("Democratic");
    expect(partyOf({ ballot: { party: "No Party Preference" } })).toBe("No Party Preference");
    // Any party name counts, known or not.
    expect(partyOf({ ballot: { party: "Common Sense" } })).toBe("Common Sense");
  });

  test("no party field, no party: a designation is never read as one", () => {
    expect(partyOf({})).toBeUndefined();
    expect(partyOf({ ballot: { designation: "Republican" } })).toBeUndefined();
  });

  test("partyPlural", () => {
    expect(partyPlural("Democratic")).toBe("Democrats");
    expect(partyPlural("Peace and Freedom")).toBe("Peace and Freedom candidates");
  });
});

describe("partiesOn", () => {
  test("counts candidates per party, most first; measures and judges don't count", () => {
    expect(partiesOn(races)).toEqual([
      { party: "Democratic", candidates: 3 },
      { party: "Republican", candidates: 2 },
      { party: "Green", candidates: 1 },
      { party: "No Party Preference", candidates: 1 },
    ]);
  });
});

describe("raceStatus", () => {
  test("nothing marked is to do", () => {
    expect(raceStatus(race("Governor"), {}, E)).toBe("todo");
  });

  test("a pick decides the race, whatever else is marked", () => {
    const marks = rows(["Governor", "Dee", "endorse"], ["Governor", "Ray", "lean_for"]);
    expect(raceStatus(race("Governor"), marks, E)).toBe("picked");
  });

  test("a maybe without a pick is maybe", () => {
    expect(raceStatus(race("Governor"), rows(["Governor", "Dee", "lean_for"]), E)).toBe("maybe");
  });

  test("ruling out some candidates leaves it to do; ruling out all is a skip", () => {
    const some = rows(["Controller", "Rob", "oppose"]);
    expect(raceStatus(race("Controller"), some, E)).toBe("todo");
    const all = rows(
      ["Controller", "Rob", "oppose"],
      ["Controller", "Gwen", "oppose"],
      ["Controller", "Nia", "oppose"],
    );
    expect(raceStatus(race("Controller"), all, E)).toBe("against");
  });

  test("against a measure as a whole is a No vote, so decided", () => {
    expect(raceStatus(race("Prop 2"), rows(["Prop 2", undefined, "oppose"]), E)).toBe("picked");
  });
});

describe("partyFill", () => {
  test("pick: the party's only candidate is picked; two of them get Maybe", () => {
    expect(brief(partyFill(races, {}, E, "Democratic", "pick"))).toEqual([
      "Governor:Dee=endorse",
      "Treasurer:Dana=lean_for",
      "Treasurer:Dora=lean_for",
    ]);
  });

  test("pick: one of two already ruled out leaves one in the running, so it's picked", () => {
    const marks = rows(["Treasurer", "Dana", "oppose"]);
    expect(brief(partyFill(races, marks, E, "Democratic", "pick"))).toEqual([
      "Governor:Dee=endorse",
      "Treasurer:Dora=endorse",
    ]);
  });

  test("pick: skips races that already have a pick, and never overwrites", () => {
    const marks = rows(["Governor", "Ray", "endorse"], ["Treasurer", "Dora", "lean_for"]);
    expect(brief(partyFill(races, marks, E, "Democratic", "pick"))).toEqual([
      "Treasurer:Dana=lean_for",
    ]);
  });

  test("against: rules out every unmarked candidate of the party", () => {
    const marks = rows(["Controller", "Rob", "lean_for"]);
    expect(brief(partyFill(races, marks, E, "Republican", "against"))).toEqual([
      "Governor:Ray=oppose",
    ]);
  });
});

describe("sourcesOn", () => {
  test("lists recommending sources, not the ballot source", () => {
    expect(sourcesOn(races)).toEqual([
      { id: "of:county gop", name: "County GOP", standing: "follow", races: 4 },
    ]);
  });
});

describe("sourceFill", () => {
  const id = "of:county gop";

  test("agree: two-way races pick their side, elsewhere their stances are copied", () => {
    expect(brief(sourceFill(races, {}, E, id, "agree"))).toEqual([
      "Controller:Gwen=oppose",
      "Controller:Rob=endorse",
      "Governor:Ray=endorse",
      "Prop 1:No=endorse",
      "Prop 2:No=endorse",
    ]);
  });

  test("go against: two-way races pick the other side; elsewhere their picks are ruled out", () => {
    expect(brief(sourceFill(races, {}, E, id, "against"))).toEqual([
      "Controller:Rob=oppose",
      "Governor:Dee=endorse",
      "Prop 1:Yes=endorse",
      "Prop 2:Yes=endorse",
    ]);
  });

  test("never overwrites a mark or adds a second pick", () => {
    const marks = rows(["Governor", "Ray", "endorse"], ["Prop 1", "Yes", "oppose"]);
    expect(brief(sourceFill(races, marks, E, id, "against"))).toEqual([
      "Controller:Rob=oppose",
      "Prop 2:Yes=endorse",
    ]);
  });

  test("reads what the source named, even when My ballot lists it on the other side", () => {
    const moved = collateRaces(decodeSlates([ballot, gop]), {
      follows: { [id]: "disagree" },
      disagree: "side",
    });
    // The GOP's Ray and No are listed under Dee and Yes here.
    expect(
      moved.find((r) => r.subject.title === "Governor")?.choices.find((c) => c.choice === "Dee")
        ?.positions[0]?.named,
    ).toBe("Ray");
    for (const mode of ["agree", "against"] as const) {
      expect(brief(sourceFill(moved, {}, E, id, mode))).toEqual(
        brief(sourceFill(races, {}, E, id, mode)),
      );
    }
  });
});

describe("stepThrough", () => {
  const items = ["a", "b", "c", "d"];

  test("a plain step stops at the ends", () => {
    expect(stepThrough(items, 1, 1)).toBe(2);
    expect(stepThrough(items, 3, 1)).toBe(-1);
    expect(stepThrough(items, 0, -1)).toBe(-1);
  });

  test("moving on skips what's done and wraps to anything left behind", () => {
    const live = new Set(["a", "d"]);
    expect(stepThrough(items, 1, 1, (x) => live.has(x))).toBe(3);
    expect(stepThrough(items, 3, 1, (x) => live.has(x))).toBe(0);
    expect(stepThrough(items, 0, 1, (x) => x === "a")).toBe(-1);
    expect(stepThrough(items, 2, -1, (x) => live.has(x))).toBe(0);
  });
});
