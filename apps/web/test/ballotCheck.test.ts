import { describe, expect, test } from "bun:test";
import { type Position, createSlate, generateKeyPair } from "@openslate/core";
import {
  ballotProblems,
  describeProblem,
  problemReport,
  translateSlates,
} from "../src/lib/ballotCheck";
import { collateRaces, decodeSlates } from "../src/lib/collate";

const E = "2026-11-03";
const researcher = generateKeyPair();
const SOS = { title: "Secretary of State", kind: "race", jurisdiction: "us/ca", election: E };
const GOV = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };

function slate(of: string, positions: Position[], kind = "organization") {
  const { token } = createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher", kind: "researcher" },
    positions,
    attribution: { of: { name: of, kind }, mode: "scraped", retrieved_at: "2026-10-01T00:00:00Z" },
  });
  return { token, importedAt: "2026-10-02T00:00:00Z" };
}

const listing = slate(
  "California Secretary of State",
  [
    {
      subject: SOS,
      stance: "neutral",
      choice: "Shirley N. Weber",
      choice_id: "ca-sos:sos/weber",
      statement: "Democratic",
    },
    {
      subject: SOS,
      stance: "neutral",
      choice: "Donald P. (Don) Wagner",
      choice_id: "ca-sos:sos/wagner",
      statement: "Republican",
    },
    {
      subject: SOS,
      stance: "neutral",
      choice: "Jane Q. Writein",
      choice_id: "ca-sos:sos/writein",
      write_in: true,
    },
    { subject: GOV, stance: "neutral", choice: "Xavier Becerra", choice_id: "ca-sos:gov/becerra" },
  ],
  "election-authority",
);

const cagop = slate("California Republican Party", [
  { subject: SOS, stance: "endorse", choice: "Don Wagner" },
  { subject: GOV, stance: "endorse", choice: "Xavier Becera" },
  { subject: { ...SOS, title: "Secretary of Stat" }, stance: "endorse", choice: "Someone" },
]);
const writeins = slate("Write-in Club", [
  { subject: SOS, stance: "endorse", choice: "Jane Q. Writein", write_in: true },
  { subject: SOS, stance: "endorse", choice: "Mickey Mouse", write_in: true },
]);

const translated = () => translateSlates(decodeSlates([listing, cagop, writeins]));

describe("translateSlates", () => {
  test("shows a plainly-listed choice under the listing's spelling and id", () => {
    const party = translated()[1];
    expect(party?.payload.positions[0]).toMatchObject({
      choice: "Donald P. (Don) Wagner",
      choice_id: "ca-sos:sos/wagner",
    });
    expect(party?.checks?.[0]?.written).toBe("Don Wagner");
  });

  test("leaves a resemblance as written, with the suggestion in its check", () => {
    const party = translated()[1];
    expect(party?.payload.positions[1]?.choice).toBe("Xavier Becera");
    expect(party?.checks?.[1]?.resolution).toMatchObject({
      status: "unlisted",
      suggestion: { name: "Xavier Becerra" },
    });
  });

  test("doesn't check the listing itself, and changes nothing without one", () => {
    expect(translated()[0]?.checks).toBeUndefined();
    const alone = decodeSlates([cagop]);
    expect(translateSlates(alone)).toBe(alone);
  });

  test("the signed token is untouched", () => {
    expect(translated()[1]?.token).toBe(cagop.token);
  });
});

describe("collateRaces with translated slates", () => {
  const races = () => collateRaces(translated(), { follows: {}, election: E });

  test("one candidate, not two, under the ballot's spelling", () => {
    const sos = races().find((r) => r.subject.title === "Secretary of State");
    const wagner = sos?.choices.filter((c) => c.choice.includes("Wagner"));
    expect(wagner?.map((c) => c.choice)).toEqual(["Donald P. (Don) Wagner"]);
    expect(wagner?.[0]?.onBallot).toBe(true);
    expect(wagner?.[0]?.positions[0]?.written).toBe("Don Wagner");
  });

  test("an off-ballot name stays its own row, not on the ballot, with a suggestion", () => {
    const gov = races().find((r) => r.subject.title === "Governor");
    expect(gov?.choices.find((c) => c.choice === "Xavier Becera")).toMatchObject({
      onBallot: false,
      suggestion: "Xavier Becerra",
    });
  });

  test("write-ins are marked, certified or not", () => {
    const sos = races().find((r) => r.subject.title === "Secretary of State");
    expect(sos?.choices.find((c) => c.choice === "Jane Q. Writein")).toMatchObject({
      onBallot: true,
      writeIn: true,
    });
    expect(sos?.choices.find((c) => c.choice === "Mickey Mouse")).toMatchObject({
      onBallot: false,
      writeIn: true,
    });
  });

  test("a race the listing doesn't name, in a covered jurisdiction, is marked unlisted", () => {
    const race = collateRaces(translated(), { follows: {}, includeUnfollowed: true }).find(
      (r) => r.subject.title === "Secretary of Stat",
    );
    expect(race?.unlisted).toBe(true);
  });
});

describe("ballotProblems", () => {
  test("lists what the ballot doesn't have, and nothing it does", () => {
    const problems = ballotProblems(translated());
    expect(problems.map((p) => [p.sourceName, p.kind, p.choice ?? null])).toEqual([
      ["California Republican Party", "unlisted", "Xavier Becera"],
      ["California Republican Party", "race-unlisted", null],
      ["Write-in Club", "write-in", "Mickey Mouse"],
    ]);
  });

  test("describes each for a report", () => {
    const [typo, race, writeIn] = ballotProblems(translated());
    expect(typo && describeProblem(typo)).toBe(
      'California Republican Party: "Xavier Becera" in "Governor" (us/ca) isn\'t on the official ballot list; maybe "Xavier Becerra"?',
    );
    expect(race && describeProblem(race)).toContain('race "Secretary of Stat"');
    expect(writeIn && describeProblem(writeIn)).toContain("isn't a certified write-in candidate");
    expect(problemReport(ballotProblems(translated())).split("\n")).toHaveLength(5);
  });
});
