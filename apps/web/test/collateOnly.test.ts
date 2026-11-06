import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, type Position } from "@openslate/core";
import { translateSlates } from "../src/lib/ballotCheck";
import { collateRaces, decodeSlates } from "../src/lib/collate";
import { subjectKey } from "../src/lib/subjectKey";

const researcher = generateKeyPair();
const E = "2026-11-03";
const mayor = { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: E };
const council = {
  title: "Oakland City Council",
  jurisdiction: "us/ca/oakland",
  district: "us/ca/oakland/council-2",
  election: E,
};
const measure = { title: "Measure A", jurisdiction: "us/ca/alameda", election: E };

function slate(of: string, kind: string, positions: Position[], issuedAt = "2026-10-20T00:00:00Z") {
  return createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher" },
    context: { election: E },
    issuedAt,
    attribution: { of: { name: of, kind }, mode: "scraped", retrieved_at: "2026-10-20T00:00:00Z" },
    positions,
  }).token;
}

describe("collateRaces with `only`", () => {
  test("gives each race exactly as collating everything does", () => {
    const tokens = [
      slate("County Registrar", "election-authority", [
        { subject: mayor, stance: "neutral", choice: "Loren Taylor" },
        { subject: mayor, stance: "neutral", choice: "Barbara Lee" },
        { subject: council, stance: "neutral", choice: "Zac Unger" },
        { subject: measure, stance: "neutral", choice: "Yes" },
        { subject: measure, stance: "neutral", choice: "No" },
      ]),
      slate("Sierra Club", "organization", [
        { subject: mayor, stance: "endorse", choice: "Barbara Lee" },
        { subject: measure, stance: "endorse", choice: "Yes" },
      ]),
      // An older slate from the same source: the newer one speaks for it.
      slate(
        "Sierra Club",
        "organization",
        [{ subject: mayor, stance: "endorse", choice: "Loren Taylor" }],
        "2026-09-01T00:00:00Z",
      ),
      slate("SEIU Local 1021", "organization", [
        { subject: mayor, stance: "oppose", choice: "Loren Taylor" },
        { subject: council, stance: "endorse", choice: "Zac Ungar" },
      ]),
    ];
    const slates = translateSlates(
      decodeSlates(tokens.map((token) => ({ token, importedAt: "x" }))),
    );
    const follows = {};
    const everything = collateRaces(slates, { follows, includeUnfollowed: true });
    expect(everything.map((race) => race.key).sort()).toEqual(
      [mayor, council, measure].map(subjectKey).sort(),
    );
    for (const race of everything) {
      expect(collateRaces(slates, { follows, includeUnfollowed: true, only: race.key })).toEqual([
        race,
      ]);
    }
    expect(collateRaces(slates, { follows, includeUnfollowed: true, only: "nope" })).toEqual([]);
  });
});
