import { describe, expect, test } from "bun:test";
import { createSlate, generateKeyPair } from "@openslate/core";
import { adoptedCount, adoptedCounts, adoptedEntries, expandAdoptions } from "../src/lib/adoptions";
import { collateRaces, decodeSlates } from "../src/lib/collate";
import type { CatalogEntry } from "../src/lib/query";
import { sourceIdOf } from "../src/lib/sources";

const E = "2026-11-03";
const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
const prop1 = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: E };
const mayor = { title: "Mayor", kind: "race", jurisdiction: "us/ca/x", election: E };

const researcher = generateKeyPair();
const attribution = (name: string) => ({
  of: { name, kind: "organization" },
  mode: "scraped" as const,
  retrieved_at: "2026-10-19T00:00:00Z",
});
const slate = (name: string, extra: Partial<Parameters<typeof createSlate>[0]>) =>
  createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher", kind: "researcher" },
    attribution: attribution(name),
    context: { election: E },
    positions: [],
    ...extra,
  });

const state = slate("State Party", {
  positions: [
    { subject: gov, stance: "endorse", choice: "Alice", statement: "Her record." },
    { subject: prop1, stance: "endorse", choice: "Yes" },
  ],
});
const adoption = {
  issuer: state.payload.issuer.key,
  of: "State Party",
  election: E,
  uri: "https://example.org/state.slate",
  subjects: [gov],
};
const county = slate("County Party", {
  positions: [{ subject: mayor, stance: "endorse", choice: "Carol" }],
  adopts: [adoption],
});
const decode = (...tokens: string[]) =>
  decodeSlates(tokens.map((token) => ({ token, importedAt: "2026-10-30T00:00:00Z" })));

describe("expandAdoptions", () => {
  test("adds the adopted positions after the slate's own and says where they came from", () => {
    const expanded = expandAdoptions(decode(county.token, state.token));
    const countySlate = expanded[0];
    expect(countySlate?.payload.positions.map((p) => p.subject.title)).toEqual([
      "Mayor",
      "Governor",
    ]);
    expect(countySlate?.adoptedFrom).toEqual([undefined, "State Party"]);
    expect(countySlate?.unresolved).toBeUndefined();
    expect(countySlate && adoptedCounts(countySlate)).toEqual([{ name: "State Party", count: 1 }]);
    // Only what the adoption lists: Prop 1 stays the state party's.
    expect(countySlate?.payload.positions).toHaveLength(2);
  });

  test("without the adopted slate nothing is invented, and it says so", () => {
    const [only] = expandAdoptions(decode(county.token));
    expect(only?.payload.positions.map((p) => p.subject.title)).toEqual(["Mayor"]);
    expect(only?.unresolved).toHaveLength(1);
    expect(only?.unresolved?.[0]?.of).toBe("State Party");
  });

  test("leaves slates with no adoptions alone", () => {
    const slates = decode(state.token);
    expect(expandAdoptions(slates)).toBe(slates);
  });

  test("collation shows an adopted position under the adopting source, with via", () => {
    const races = collateRaces(expandAdoptions(decode(county.token, state.token)), {
      follows: {},
      election: E,
    });
    const race = races.find((r) => r.subject.title === "Governor");
    const positions = race?.choices.find((c) => c.choice === "Alice")?.positions ?? [];
    expect(positions.map((p) => [p.source.name, p.via])).toEqual([
      ["County Party", "State Party"],
      ["State Party", undefined],
    ]);
    // Both hold the position, so both count; the statement stays the original's.
    expect(race?.choices[0]?.support).toBe(2);
    expect(positions[0]?.statement).toBe("Her record.");
  });
});

describe("adoptedEntries", () => {
  const entry = (name: string, election = E): CatalogEntry =>
    ({
      slug: name.toLowerCase().replace(/ /g, "-"),
      election,
      path: `orgs/${name}/${election}/signed.slate`,
      issuer: { key: state.payload.issuer.key },
      attribution: { ...attribution(name), mode: "scraped" },
      positions: 2,
    }) as CatalogEntry;

  test("finds the catalog entry an unresolved adoption needs, and no other", () => {
    const expanded = expandAdoptions(decode(county.token));
    const wanted = adoptedEntries(
      expanded,
      [entry("Someone Else"), entry("State Party", "2026-06-02"), entry("State Party")],
      new Set(),
    );
    expect(wanted.map((e) => e.path)).toEqual(["orgs/State Party/2026-11-03/signed.slate"]);
  });

  test("a resolved adoption needs nothing", () => {
    const expanded = expandAdoptions(decode(county.token, state.token));
    expect(adoptedEntries(expanded, [entry("State Party")], new Set())).toEqual([]);
  });

  test("a source the voter removed isn't brought back", () => {
    const expanded = expandAdoptions(decode(county.token));
    const stateEntry = entry("State Party");
    expect(adoptedEntries(expanded, [stateEntry], new Set([sourceIdOf(stateEntry)]))).toEqual([]);
  });

  test("an adoption of a slate outside the catalog is left alone", () => {
    const expanded = expandAdoptions(decode(county.token));
    expect(adoptedEntries(expanded, [entry("Someone Else")], new Set())).toEqual([]);
  });
});

describe("adoptedCount", () => {
  test("adds up what a catalog entry adopts, and is 0 for one that adopts nothing", () => {
    expect(
      adoptedCount({
        adopts: [
          { issuer: "k", subjects: 12 },
          { issuer: "k", subjects: 3 },
        ],
      }),
    ).toBe(15);
    expect(adoptedCount({})).toBe(0);
  });
});
