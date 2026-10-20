import { describe, expect, test } from "bun:test";
import type { DraftRow } from "../src/lib/ballotDraft";
import { ballotFileName, ballotToCsv, ballotToJson } from "../src/lib/ballotExport";
import type { Race } from "../src/lib/collate";
import type { Source } from "../src/lib/sources";

const E = "2026-11-03";

function source(name: string): Source {
  return {
    id: `key:${name}`,
    name,
    kind: "organization",
    secondhand: false,
    signerKey: `ed25519:${name}`,
  };
}

const governor: Race = {
  key: `t:Governor|j:us/ca|e:${E}`,
  subject: { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E },
  election: E,
  jurisdiction: "us/ca",
  onBallot: true,
  followedSources: 2,
  totalSources: 3,
  choices: [
    {
      choice: "Ada",
      onBallot: true,
      ballotNote: "Democratic · Engineer",
      support: 2,
      opposition: 0,
      positions: [
        { source: source("Sierra Club"), stance: "endorse", valid: true, followed: true },
        {
          source: source("Chronicle"),
          stance: "endorse",
          statement: "Steady hand",
          valid: true,
          followed: true,
        },
        { source: source("Someone"), stance: "oppose", valid: true, followed: false },
      ],
    },
    { choice: "Bob", onBallot: true, support: 0, opposition: 0, positions: [] },
  ],
};

const rows: Record<string, DraftRow> = {
  [`${E}|${governor.key}|Ada`]: {
    id: `${E}|${governor.key}|Ada`,
    electionId: E,
    subject: governor.subject,
    choice: "Ada",
    stance: "endorse",
    statement: "  My reasons  ",
    updatedAt: "",
  },
  [`${E}|${governor.key}|\u0000note`]: {
    id: `${E}|${governor.key}|\u0000note`,
    electionId: E,
    subject: governor.subject,
    choice: "\u0000note",
    privateNote: "ask Sam",
    updatedAt: "",
  },
};

const input = { election: E, area: "San Francisco", races: [governor], rows, exportedAt: "now" };

describe("ballotToJson", () => {
  test("lays picks over the collated field; private notes only when asked", () => {
    const out = JSON.parse(ballotToJson(input, { privateNotes: false }));
    expect(out.election).toBe(E);
    expect(out.area).toBe("San Francisco");
    expect(out.races).toHaveLength(1);
    const [race] = out.races;
    expect(race.myNote).toBeUndefined();
    expect(race.choices[0]).toEqual({
      choice: "Ada",
      onBallot: true,
      ballotNote: "Democratic · Engineer",
      for: 2,
      against: 0,
      sources: [
        { name: "Sierra Club", stance: "endorse", followed: true },
        { name: "Chronicle", stance: "endorse", followed: true, statement: "Steady hand" },
        { name: "Someone", stance: "oppose", followed: false },
      ],
      myPick: "endorse",
      myStatement: "My reasons",
    });
    expect(race.choices[1].myPick).toBeUndefined();

    const withNotes = JSON.parse(ballotToJson(input, { privateNotes: true }));
    expect(withNotes.races[0].myNote).toBe("ask Sam");
  });
});

describe("ballotToCsv", () => {
  test("one quoted line per choice, notes column only when asked", () => {
    const lines = ballotToCsv(input, { privateNotes: false }).split("\n");
    expect(lines[0]).toBe(
      '"Election","Jurisdiction","Race","Kind","Choice","OnBallot","BallotNote","For","Against","Sources","MyPick","MyStatement"',
    );
    expect(lines[1]).toBe(
      `"${E}","us/ca","Governor","race","Ada","yes","Democratic · Engineer","2","0","Sierra Club: endorse; Chronicle: endorse; Someone: oppose (not followed)","endorse","My reasons"`,
    );
    expect(lines[2]).toBe(`"${E}","us/ca","Governor","race","Bob","yes","","0","0","","",""`);

    const noted = ballotToCsv(input, { privateNotes: true }).split("\n");
    expect(noted[0]?.endsWith(',"MyNote"')).toBe(true);
    expect(noted[1]?.endsWith(',"ask Sam"')).toBe(true);
  });
});

test("ballotFileName", () => {
  expect(ballotFileName(E, "csv")).toBe("openslate.ballot.2026-11-03.csv");
  expect(ballotFileName(undefined, "json")).toBe("openslate.ballot.all.json");
});
