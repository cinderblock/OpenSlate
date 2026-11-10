import { describe, expect, test } from "bun:test";
import { type BallotContest, createSlate, generateKeyPair, type Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "../src/lib/ballotDraft";
import { civicStanding, myMarks, raceOutcome, type Standing } from "../src/lib/ballotOutcome";
import { contestStanding } from "../src/lib/ballotResults";
import { collateRaces, decodeSlates, type Race } from "../src/lib/collate";
import { parseSosTime } from "../src/lib/regions/us-ca/sosResults";

const researcher = generateKeyPair();
const E = "2026-11-03";

interface P {
  title: string;
  choice?: string;
  kind?: string;
  ballot?: BallotContest;
}

function slate(positions: P[]) {
  const token = createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher" },
    positions: positions.map((p) => ({
      subject: {
        title: p.title,
        jurisdiction: "us/ca",
        election: E,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.ballot ? { ballot: p.ballot } : {}),
      },
      stance: "neutral" as const,
      ...(p.choice !== undefined ? { choice: p.choice } : {}),
    })),
    attribution: {
      of: { name: "Secretary of State", kind: "election-authority" },
      mode: "scraped",
      retrieved_at: "2026-01-01T00:00:00Z",
    },
  }).token;
  return { token, importedAt: "2026-10-01T00:00:00Z" };
}

const ballot = slate([
  { title: "Governor", choice: "Dee Smith" },
  { title: "Governor", choice: "Ray Jones" },
  { title: "Council", choice: "Ann Lee", ballot: { vote_for: 2 } },
  { title: "Council", choice: "Bo Park", ballot: { vote_for: 2 } },
  { title: "Council", choice: "Cy Diaz", ballot: { vote_for: 2 } },
  { title: "Mayor", choice: "Ann Lee", ballot: { ranks: 3 } },
  { title: "Mayor", choice: "Bo Park", ballot: { ranks: 3 } },
  { title: "Mayor", choice: "Cy Diaz", ballot: { ranks: 3 } },
  { title: "Prop 1", choice: "Yes", kind: "measure" },
  { title: "Prop 1", choice: "No", kind: "measure" },
]);

const races = collateRaces(decodeSlates([ballot]), { follows: {} });
const race = (title: string) => races.find((r) => r.subject.title === title) as Race;

function rows(...marks: Array<[string, string | undefined, Stance]>): Record<string, DraftRow> {
  const out: Record<string, DraftRow> = {};
  for (const [title, choice, stance] of marks) {
    const subject = race(title).subject;
    const id = rowIdFor(E, subject, choice);
    out[id] = { id, electionId: E, subject, choice, stance, updatedAt: "" };
  }
  return out;
}

const base = { source: "state" as const, sourceName: "State" };
const candidates = (seats: number, ...choices: [string, number][]): Standing => ({
  ...base,
  kind: "candidates",
  seats,
  choices: choices.map(([name, votes]) => ({ name, votes })),
});
const measure = (yes: number, no: number, threshold?: "55%" | "2/3"): Standing => ({
  ...base,
  kind: "measure",
  yes,
  no,
  ...(threshold ? { threshold } : {}),
});

describe("myMarks", () => {
  test("a Pick is a pick; Against is against", () => {
    const m = myMarks(
      race("Governor"),
      rows(["Governor", "Dee Smith", "endorse"], ["Governor", "Ray Jones", "oppose"]),
      E,
    );
    expect(m.picks).toEqual(["Dee Smith"]);
    expect(m.against).toEqual(["Ray Jones"]);
    expect(m.leaning).toBe(false);
  });

  test("with no Pick, a Maybe stands in, marked as leaning", () => {
    const m = myMarks(race("Governor"), rows(["Governor", "Ray Jones", "lean_for"]), E);
    expect(m.picks).toEqual(["Ray Jones"]);
    expect(m.leaning).toBe(true);
  });

  test("a measure folds onto one vote: Pick No, Against Yes, or against the whole measure", () => {
    const r = race("Prop 1");
    expect(myMarks(r, rows(["Prop 1", "No", "endorse"]), E).measure).toBe("no");
    expect(myMarks(r, rows(["Prop 1", "Yes", "oppose"]), E).measure).toBe("no");
    expect(myMarks(r, rows(["Prop 1", undefined, "oppose"]), E).measure).toBe("no");
    expect(myMarks(r, rows(["Prop 1", "Yes", "endorse"]), E).measure).toBe("yes");
    expect(myMarks(r, rows(), E).measure).toBeUndefined();
  });

  test("ranked choice: the first choice of the saved ranking", () => {
    const m = myMarks(
      race("Mayor"),
      rows(["Mayor", "Ann Lee", "endorse"], ["Mayor", "Bo Park", "endorse"]),
      E,
      ["Bo Park", "Ann Lee"],
    );
    expect(m.ranked).toBe(true);
    expect(m.picks).toEqual(["Bo Park"]);
  });
});

describe("raceOutcome", () => {
  const pickDee = myMarks(race("Governor"), rows(["Governor", "Dee Smith", "endorse"]), E);

  test("nothing marked, nothing to compare", () => {
    const none = myMarks(race("Governor"), rows(), E);
    expect(raceOutcome(none, candidates(1, ["Dee Smith", 10]))).toBeUndefined();
  });

  test("your pick leading is your way, by the margin to second", () => {
    const o = raceOutcome(pickDee, candidates(1, ["Ray Jones", 400], ["Dee Smith", 600]));
    expect(o?.outcome).toBe("your-way");
    expect(o?.called).toBe(false);
    expect(o?.marginPoints).toBeCloseTo(20);
    expect(o?.choices.map((c) => [c.name, c.in, c.mine])).toEqual([
      ["Dee Smith", true, "pick"],
      ["Ray Jones", false, undefined],
    ]);
  });

  test("your pick trailing is not your way; names match however the count spells them", () => {
    const o = raceOutcome(pickDee, candidates(1, ["RAY JONES", 600], ["DEE SMITH", 400]));
    expect(o?.outcome).toBe("not-your-way");
    expect(o?.choices.find((c) => c.mine === "pick")?.name).toBe("DEE SMITH");
  });

  test("no votes in yet", () => {
    expect(raceOutcome(pickDee, candidates(1, ["Dee Smith", 0], ["Ray Jones", 0]))?.outcome).toBe(
      "no-votes",
    );
  });

  test("against a candidate who's losing is your way", () => {
    const m = myMarks(race("Governor"), rows(["Governor", "Ray Jones", "oppose"]), E);
    expect(raceOutcome(m, candidates(1, ["Dee Smith", 6], ["Ray Jones", 4]))?.outcome).toBe(
      "your-way",
    );
  });

  test("multi-seat: the top seats are in; one of two picks in is partly your way", () => {
    const m = myMarks(
      race("Council"),
      rows(["Council", "Ann Lee", "endorse"], ["Council", "Cy Diaz", "endorse"]),
      E,
    );
    const o = raceOutcome(m, candidates(2, ["Ann Lee", 50], ["Bo Park", 30], ["Cy Diaz", 20]));
    expect(o?.outcome).toBe("mixed");
    // The last seat (Bo, 30) is 10 of 100 votes ahead of the next (Cy, 20).
    expect(o?.marginPoints).toBeCloseTo(10);
  });

  test("a source's own call is used, and says won", () => {
    const o = raceOutcome(pickDee, {
      ...candidates(1, ["Dee Smith", 40], ["Ray Jones", 60]),
      called: ["Dee Smith"],
    } as Standing);
    expect(o?.called).toBe(true);
    expect(o?.outcome).toBe("your-way");
  });

  test("measures pass on their threshold, not a bare majority", () => {
    const yes = myMarks(race("Prop 1"), rows(["Prop 1", "Yes", "endorse"]), E);
    expect(raceOutcome(yes, measure(60, 40))?.outcome).toBe("your-way");
    const twoThirds = raceOutcome(yes, measure(60, 40, "2/3"));
    expect(twoThirds?.outcome).toBe("not-your-way");
    expect(twoThirds?.measure?.passing).toBe(false);
    expect(twoThirds?.marginPoints).toBeCloseTo(200 / 3 - 60);
    const no = myMarks(race("Prop 1"), rows(["Prop 1", "No", "endorse"]), E);
    expect(raceOutcome(no, measure(56, 44, "2/3"))?.outcome).toBe("your-way");
  });
});

describe("standings from each source", () => {
  test("a county measure keeps its threshold and the county's file time", () => {
    const s = contestStanding(
      {
        kind: "measure",
        title: "Measure O",
        reporting: { text: "", changedAt: 1_700_000_000_000 },
        measure: {
          number: "",
          name: "",
          yes: 7,
          no: 3,
          yesPercent: 70,
          noPercent: 30,
          threshold: "2/3",
        },
      },
      "county",
      "San Mateo County",
    );
    expect(s).toMatchObject({ kind: "measure", yes: 7, no: 3, threshold: "2/3" });
    expect(s?.changedAt).toBe(1_700_000_000_000);
  });

  test("the state's reporting time is read the way its source words it (California: Pacific time)", () => {
    const s = contestStanding(
      {
        kind: "candidates",
        title: "Governor",
        reporting: { text: "50% reporting", percent: 50, time: "November 3, 2026, 8:15 p.m." },
        candidates: [{ name: "Dee Smith", votes: 5, percent: 100, incumbent: false }],
      },
      "state",
      "State",
      1,
      parseSosTime,
    );
    expect(s?.changedAt).toBe(Date.parse("2026-11-04T04:15:00Z"));
    expect(s).toMatchObject({ kind: "candidates", seats: 1, percent: 50 });
  });

  test("civicAPI's winner flags are calls; a Yes/No race is a measure", () => {
    const race = {
      id: 1,
      election_name: "Prop 9",
      candidates: [
        { name: "Yes", votes: 10, winner: true },
        { name: "No", votes: 5 },
      ],
    };
    expect(civicStanding(race, true)).toMatchObject({ kind: "measure", called: "passed" });
    const people = civicStanding(
      {
        id: 2,
        election_name: "Senate",
        candidates: [
          { name: "A", votes: 10, winner: true },
          { name: "B", votes: 5 },
        ],
      },
      false,
    );
    expect(people).toMatchObject({ kind: "candidates", called: ["A"], seats: 1 });
  });
});
