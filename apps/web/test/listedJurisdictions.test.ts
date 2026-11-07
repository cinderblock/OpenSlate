import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair, type Position } from "@openslate/core";
import { translateSlates } from "../src/lib/ballotCheck";
import { collateRaces, decodeSlates, listedJurisdictions } from "../src/lib/collate";
import { memoByString } from "../src/lib/memoByString";
import type { Follows } from "../src/lib/sources";

const researcher = generateKeyPair();
const E = "2026-11-03";
const mayor = { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: E };
const assembly = { title: "State Assembly District 18", jurisdiction: "us/ca/ad-18", election: E };
const measure = { title: "Measure Z", jurisdiction: "us/ca/alameda", election: E };
const lastYear = { title: "Measure Q", jurisdiction: "us/ca/alameda", election: "2025-11-04" };

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

const tokens = [
  slate("County Registrar", "election-authority", [
    { subject: mayor, stance: "neutral", choice: "Barbara Lee" },
  ]),
  slate("Sierra Club", "organization", [
    { subject: mayor, stance: "endorse", choice: "Barbara Lee" },
    { subject: assembly, stance: "endorse", choice: "Mia Bonta" },
  ]),
  // Only an older slate of the Sierra Club's covers Measure Q: it still counts.
  slate(
    "Sierra Club",
    "organization",
    [{ subject: lastYear, stance: "endorse", choice: "Yes" }],
    "2026-09-01T00:00:00Z",
  ),
  // Only an unfollowed source covers Measure Z.
  slate("SEIU Local 1021", "organization", [
    { subject: measure, stance: "oppose", choice: "No" },
    { subject: assembly, stance: "oppose", choice: "Mia Bonta" },
  ]),
];
const slates = translateSlates(decodeSlates(tokens.map((token) => ({ token, importedAt: "x" }))));
const sierra = slates.find((s) => s.source.name === "Sierra Club")?.source.id ?? "";

describe("listedJurisdictions", () => {
  const cases: Array<[string, Follows, boolean, string | undefined]> = [
    ["nothing followed", {}, false, undefined],
    ["nothing followed, unfollowed included", {}, true, undefined],
    ["one source followed", { [sierra]: 1 }, false, undefined],
    ["one source disagreed with", { [sierra]: -1 }, false, undefined],
    ["one election", { [sierra]: 1 }, true, E],
  ];
  test("the test's source is found", () => expect(sierra).not.toBe(""));
  for (const [name, follows, includeUnfollowed, election] of cases) {
    test(`lists what collating does: ${name}`, () => {
      const options = { follows, includeUnfollowed, ...(election ? { election } : {}) };
      const collated = collateRaces(slates, options);
      expect(listedJurisdictions(slates, options)).toEqual(
        new Map(collated.map((race) => [race.key, race.jurisdiction])),
      );
    });
  }
});

describe("memoByString", () => {
  test("asks once per value, and forgets past its limit", () => {
    const asked: string[] = [];
    const upper = memoByString((s) => {
      asked.push(s);
      return { s: s.toUpperCase() };
    }, 2);
    expect(upper("a")).toEqual({ s: "A" });
    expect(upper("a")).toBe(upper("a"));
    expect(Object.isFrozen(upper("a"))).toBe(true);
    upper("b");
    upper("c"); // past the limit: starts over
    upper("a");
    expect(asked).toEqual(["a", "b", "c", "a"]);
  });

  test("remembers an undefined answer too", () => {
    let calls = 0;
    const nothing = memoByString(() => {
      calls++;
      return undefined;
    });
    nothing("x");
    nothing("x");
    expect(calls).toBe(1);
  });
});
