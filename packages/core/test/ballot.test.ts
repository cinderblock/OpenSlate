import { describe, expect, test } from "bun:test";
import { type PositionSource, ballotListing, isBallotListing, resolveChoice } from "../src/ballot";
import type { Position } from "../src/schema";

const SOS = "Secretary of State";
const subject = (title: string, jurisdiction = "us/ca") => ({
  title,
  kind: "race",
  jurisdiction,
  election: "2026-11-03",
});

const sos: PositionSource = {
  context: { election: "2026-11-03", jurisdiction: "us/ca" },
  attribution: { of: { kind: "election-authority" } },
  positions: [
    {
      subject: subject(SOS),
      stance: "neutral",
      choice: "Shirley N. Weber",
      choice_id: "ca-sos:sos/weber",
      statement: "Democratic",
    },
    {
      subject: subject(SOS),
      stance: "neutral",
      choice: "Donald P. (Don) Wagner",
      choice_id: "ca-sos:sos/wagner",
    },
    {
      subject: subject(SOS),
      stance: "neutral",
      choice: "Jane Q. Writein",
      choice_id: "ca-sos:sos/writein",
      write_in: true,
    },
    {
      subject: subject("Proposition 1"),
      stance: "neutral",
      choice: "Yes",
      choice_id: "ca-sos:p1/yes",
    },
  ],
};
const listing = ballotListing([sos]);
const context = { context: { election: "2026-11-03" } };
const at = (choice: Partial<Position>, title = SOS, jurisdiction = "us/ca"): Position => ({
  subject: subject(title, jurisdiction),
  stance: "endorse",
  ...choice,
});

describe("ballotListing", () => {
  test("collects the races and choices of listings only, in ballot order", () => {
    const org: PositionSource = { positions: [at({ choice: "Someone Else" })] };
    const races = ballotListing([sos, org]).races;
    expect([...races.keys()]).toEqual([
      `2026-11-03|us/ca|${SOS}`,
      "2026-11-03|us/ca|Proposition 1",
    ]);
    expect(races.get(`2026-11-03|us/ca|${SOS}`)?.choices).toEqual([
      { name: "Shirley N. Weber", id: "ca-sos:sos/weber", writeIn: false, note: "Democratic" },
      { name: "Donald P. (Don) Wagner", id: "ca-sos:sos/wagner", writeIn: false },
      { name: "Jane Q. Writein", id: "ca-sos:sos/writein", writeIn: true },
    ]);
  });

  test("a firsthand election-authority slate is a listing; a secondhand report by one isn't", () => {
    expect(isBallotListing({ issuer: { kind: "election-authority" } })).toBe(true);
    expect(
      isBallotListing({
        issuer: { kind: "election-authority" },
        attribution: { of: { kind: "organization" } },
      }),
    ).toBe(false);
  });
});

describe("resolveChoice", () => {
  const resolve = (p: Position) => resolveChoice(listing, p, context);
  const status = (p: Position) => resolve(p).status;

  test("by id, even when the spelling differs", () => {
    const r = resolve(at({ choice: "Don Wagner", choice_id: "ca-sos:sos/wagner" }));
    expect(r).toMatchObject({
      status: "listed",
      by: "id",
      choice: { name: "Donald P. (Don) Wagner" },
    });
  });

  test("by exact name", () => {
    expect(resolve(at({ choice: "Shirley N. Weber" }))).toMatchObject({
      status: "listed",
      by: "name",
    });
  });

  test("the same person by rule", () => {
    expect(resolve(at({ choice: "Don Wagner" }))).toMatchObject({
      status: "listed",
      by: "rule",
      choice: { id: "ca-sos:sos/wagner" },
    });
  });

  test("an id the listing doesn't have, on a listed name, is stale", () => {
    expect(resolve(at({ choice: "Shirley N. Weber", choice_id: "ca-sos:old" }))).toMatchObject({
      status: "listed",
      staleId: true,
    });
  });

  test("an id the listing doesn't have, on a name it doesn't list, is unlisted", () => {
    expect(status(at({ choice: "Jane Doe", choice_id: "ca-sos:nobody" }))).toBe("unlisted");
  });

  test("a resemblance is only a suggestion", () => {
    expect(resolve(at({ choice: "Shirley Webber" }))).toMatchObject({
      status: "unlisted",
      suggestion: { name: "Shirley N. Weber" },
    });
  });

  test("a name the race doesn't list, with nothing like it", () => {
    const r = resolve(at({ choice: "Jane Doe" }));
    expect(r.status).toBe("unlisted");
    expect("suggestion" in r).toBe(false);
  });

  test("a certified write-in is listed, flagged as a write-in", () => {
    expect(resolve(at({ choice: "Jane Q. Writein", write_in: true }))).toMatchObject({
      status: "listed",
      choice: { writeIn: true },
    });
  });

  test("an uncertified write-in is a write-in, not unlisted", () => {
    expect(status(at({ choice: "Mickey Mouse", write_in: true }))).toBe("write-in");
  });

  test("write_in on a printed name is the printed candidate", () => {
    expect(resolve(at({ choice: "Shirley N. Weber", write_in: true }))).toMatchObject({
      status: "listed",
      choice: { writeIn: false },
    });
  });

  test("a race the listing doesn't name, in a jurisdiction it covers", () => {
    expect(status(at({ choice: "Someone" }, "Secretary of Stat"))).toBe("race-unlisted");
  });

  test("a jurisdiction no listing covers", () => {
    expect(status(at({ choice: "Someone" }, "Mayor", "us/ca/la"))).toBe("uncovered");
  });

  test("a position on the race as a whole", () => {
    expect(status(at({}))).toBe("no-choice");
  });

  test("the election and jurisdiction fall back to the slate's context", () => {
    const p: Position = { subject: { title: SOS }, stance: "endorse", choice: "Don Wagner" };
    expect(
      resolveChoice(listing, p, { context: { election: "2026-11-03", jurisdiction: "us/ca" } })
        .status,
    ).toBe("listed");
  });
});
