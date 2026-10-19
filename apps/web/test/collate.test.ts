import { describe, expect, test } from "bun:test";
import { type KeyPair, type Stance, createSlate, generateKeyPair } from "@openslate/core";
import {
  areaOptionsOf,
  collateRaces,
  decodeSlates,
  defaultElection,
  electionsOf,
  positionJurisdictions,
} from "../src/lib/collate";

const researcher = generateKeyPair();

interface P {
  title: string;
  choice?: string;
  stance?: Stance;
  jurisdiction?: string;
  election?: string;
  kind?: string;
}

function slate(input: {
  of?: string;
  name?: string;
  keyPair?: KeyPair;
  election?: string;
  issuedAt?: string;
  positions: P[];
}): { token: string; importedAt: string } {
  const token = createSlate({
    keyPair: input.keyPair ?? (input.of ? researcher : generateKeyPair()),
    issuer: { name: input.of ? "Researcher" : (input.name ?? "Someone") },
    ...(input.election ? { context: { election: input.election } } : {}),
    ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
    positions: input.positions.map((p) => ({
      subject: {
        title: p.title,
        ...(p.jurisdiction ? { jurisdiction: p.jurisdiction } : {}),
        ...(p.election ? { election: p.election } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
      },
      stance: p.stance ?? "endorse",
      ...(p.choice ? { choice: p.choice } : {}),
    })),
    ...(input.of
      ? {
          attribution: {
            of: { name: input.of },
            mode: "scraped" as const,
            retrieved_at: "2026-01-01T00:00:00Z",
          },
        }
      : {}),
  }).token;
  return { token, importedAt: "2026-10-01T00:00:00Z" };
}

const E = "2026-11-03";

describe("collateRaces", () => {
  const slates = decodeSlates([
    slate({
      of: "SPUR",
      positions: [
        { title: "Governor", choice: "A", election: E, jurisdiction: "us/ca" },
        { title: "Prop 1", choice: "Yes", election: E, jurisdiction: "us/ca", kind: "measure" },
      ],
    }),
    slate({
      of: "GrowSF",
      positions: [
        { title: "Governor", choice: "A", election: E, jurisdiction: "us/ca" },
        { title: "Prop 1", choice: "No", election: E, jurisdiction: "us/ca", kind: "measure" },
      ],
    }),
    slate({
      of: "Tenants Union",
      positions: [
        { title: "Governor", choice: "B", election: E, jurisdiction: "us/ca" },
        { title: "Governor", choice: "A", stance: "oppose", election: E, jurisdiction: "us/ca" },
      ],
    }),
  ]);

  test("lines up every source's choice per race, most-backed choice first", () => {
    const races = collateRaces(slates, { follows: {} });
    const governor = races.find((r) => r.subject.title === "Governor");
    expect(governor?.followedSources).toBe(3);
    expect(governor?.choices.map((c) => [c.choice, c.support, c.opposition])).toEqual([
      ["A", 2, 1],
      ["B", 1, 0],
    ]);
  });

  test("unfollowed sources drop out, or stay marked when asked for", () => {
    const follows = { "of:growsf": false };
    const followedOnly = collateRaces(slates, { follows });
    const prop = followedOnly.find((r) => r.subject.title === "Prop 1");
    expect(prop?.choices.map((c) => c.choice)).toEqual(["Yes"]);

    const all = collateRaces(slates, { follows, includeUnfollowed: true });
    const propAll = all.find((r) => r.subject.title === "Prop 1");
    expect(propAll?.totalSources).toBe(2);
    expect(propAll?.followedSources).toBe(1);
    const no = propAll?.choices.find((c) => c.choice === "No");
    expect(no?.support).toBe(0);
    expect(no?.positions[0]?.followed).toBe(false);
  });

  test("offices sort before measures", () => {
    const races = collateRaces(slates, { follows: {} });
    expect(races.map((r) => r.subject.title)).toEqual(["Governor", "Prop 1"]);
  });

  test("filters by election, falling back to the slate's context election", () => {
    const mixed = decodeSlates([
      slate({ name: "A", election: "2026-06-02", positions: [{ title: "Primary race" }] }),
      slate({ name: "B", positions: [{ title: "General race", election: E }] }),
    ]);
    const june = collateRaces(mixed, { follows: {}, election: "2026-06-02" });
    expect(june.map((r) => r.subject.title)).toEqual(["Primary race"]);
    expect(june[0]?.election).toBe("2026-06-02");
  });

  test("filters by area", () => {
    const local = decodeSlates([
      slate({
        name: "A",
        positions: [
          { title: "Mayor", jurisdiction: "us/ca/sf" },
          { title: "Mayor", jurisdiction: "us/ca/oakland" },
          { title: "House", jurisdiction: "us/ca/cd-11" },
          { title: "House", jurisdiction: "us/ca/cd-12" },
        ],
      }),
    ]);
    const races = collateRaces(local, {
      follows: {},
      area: { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } },
    });
    expect(races.map((r) => r.jurisdiction)).toEqual(["us/ca/cd-11", "us/ca/sf"]);
  });

  test("a source's newer slate replaces its older one on the same race", () => {
    const keyPair = generateKeyPair();
    const reissued = decodeSlates([
      slate({
        name: "Alice",
        keyPair,
        issuedAt: "2026-09-01T00:00:00Z",
        positions: [{ title: "Mayor", choice: "Old pick" }],
      }),
      slate({
        name: "Alice",
        keyPair,
        issuedAt: "2026-10-01T00:00:00Z",
        positions: [{ title: "Mayor", choice: "New pick" }],
      }),
    ]);
    const races = collateRaces(reissued, { follows: {} });
    expect(races[0]?.choices.map((c) => c.choice)).toEqual(["New pick"]);
  });
});

describe("elections", () => {
  const slates = decodeSlates([
    slate({ of: "SPUR", positions: [{ title: "X", election: "2026-06-02" }] }),
    slate({ of: "GrowSF", positions: [{ title: "Y", election: E }] }),
  ]);

  test("summarises each election the slates cover", () => {
    expect(electionsOf(slates, { "of:growsf": false })).toEqual([
      { date: "2026-06-02", races: 1, sources: 1, followedSources: 1 },
      { date: E, races: 1, sources: 1, followedSources: 0 },
    ]);
  });

  test("defaults to the next upcoming election with followed sources", () => {
    const summaries = electionsOf(slates, {});
    expect(defaultElection(summaries, "2026-10-19")).toBe(E);
    expect(defaultElection(summaries, "2026-05-01")).toBe("2026-06-02");
    // Election day itself still counts as upcoming.
    expect(defaultElection(summaries, E)).toBe(E);
    // Everything past: show the latest.
    expect(defaultElection(summaries, "2027-01-01")).toBe(E);
    expect(defaultElection([], "2026-10-19")).toBeUndefined();
  });

  test("prefers an upcoming election the user follows over an earlier unfollowed one", () => {
    const summaries = electionsOf(slates, { "of:spur": false });
    expect(defaultElection(summaries, "2026-05-01")).toBe(E);
  });
});

describe("areaOptionsOf", () => {
  test("collects localities and district numbers", () => {
    const slates = decodeSlates([
      slate({
        name: "A",
        positions: [
          { title: "1", jurisdiction: "us/ca/sf" },
          { title: "2", jurisdiction: "us/ca/cd-12" },
          { title: "3", jurisdiction: "us/ca/cd-2" },
          { title: "4", jurisdiction: "us/ca/ad-17" },
          { title: "5", jurisdiction: "us/ca" },
          { title: "6", jurisdiction: "us/ca/chula-vista" },
          { title: "7", jurisdiction: "us/ca/sf" },
        ],
      }),
    ]);
    expect(areaOptionsOf(positionJurisdictions(slates))).toEqual({
      // San Francisco has more races here, so it leads.
      localities: ["us/ca/sf", "us/ca/chula-vista"],
      districts: { "us/ca/cd": ["2", "12"], "us/ca/ad": ["17"] },
    });
  });
});
