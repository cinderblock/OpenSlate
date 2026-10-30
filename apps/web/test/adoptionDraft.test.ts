import { describe, expect, test } from "bun:test";
import { adoptionMatches, createSlate, generateKeyPair, resolveAdoptions } from "@openslate/core";
import {
  adoptableSlates,
  adoptionFor,
  copiedPositions,
  positionsFor,
  slateUri,
} from "../src/lib/adoptionDraft";
import { decodeSlates } from "../src/lib/collate";
import type { CatalogEntry } from "../src/lib/query";

const E = "2026-11-03";
const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
const prop1 = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: E };
const old = { title: "Mayor", kind: "race", jurisdiction: "us/ca/x", election: "2026-06-02" };

const researcher = generateKeyPair();
const reported = createSlate({
  keyPair: researcher,
  issuer: { name: "Researcher", kind: "researcher" },
  attribution: {
    of: { name: "Labor Fed", uri: "https://labor.example/", kind: "organization" },
    mode: "scraped",
    retrieved_at: "2026-10-19T00:00:00Z",
  },
  context: { election: E },
  positions: [
    { subject: gov, stance: "endorse", choice: "Alice", label: "Top pick" },
    { subject: prop1, stance: "endorse", choice: "No", statement: "Bad bond." },
  ],
});
const decode = (...tokens: string[]) =>
  decodeSlates(tokens.map((token) => ({ token, importedAt: "2026-10-30T00:00:00Z" })));

describe("adoptableSlates", () => {
  test("leaves out the publisher's own slates, ballot listings and other elections", () => {
    const me = generateKeyPair();
    const mine = createSlate({
      keyPair: me,
      issuer: { name: "Me" },
      positions: [{ subject: gov, stance: "endorse", choice: "Alice" }],
    });
    const listing = createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher" },
      attribution: {
        of: { name: "SoS", kind: "election-authority" },
        mode: "scraped",
        retrieved_at: "2026-10-19T00:00:00Z",
      },
      positions: [{ subject: gov, stance: "neutral", choice: "Alice" }],
    });
    const past = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Past" },
      positions: [{ subject: old, stance: "endorse", choice: "Carol" }],
    });
    const slates = decode(mine.token, listing.token, past.token, reported.token);
    expect(adoptableSlates(slates, E, mine.payload.issuer.key).map((s) => s.source.name)).toEqual([
      "Labor Fed",
    ]);
  });
});

describe("adoptionFor", () => {
  const [slate] = decode(reported.token);
  if (!slate) throw new Error("expected a slate");
  const all = positionsFor(slate, E);

  test("all positions: no subject list, so it follows the slate", () => {
    const adoption = adoptionFor(slate, all, "reference", "https://e.org/l.slate");
    expect(adoption).toEqual({
      issuer: reported.payload.issuer.key,
      of: "Labor Fed",
      election: E,
      uri: "https://e.org/l.slate",
    });
  });

  test("some positions: lists exactly those, and it resolves to exactly those", () => {
    const adoption = adoptionFor(slate, all.slice(1), "snapshot", undefined);
    expect(adoption.subjects).toEqual([prop1]);
    expect(adoption.slate).toBe(reported.token);
    expect(adoption.uri).toBeUndefined();
    expect(adoptionMatches(adoption, reported.payload)).toBe(true);

    const mine = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Club" },
      positions: [],
      adopts: [adoption],
    });
    const resolved = resolveAdoptions(mine.payload, () => []);
    expect(resolved.positions.map((p) => p.position.subject.title)).toEqual(["Prop 1"]);
  });
});

describe("copiedPositions", () => {
  test("keeps the words, drops the other slate's label vocabulary", () => {
    const [slate] = decode(reported.token);
    const copies = copiedPositions(slate ? positionsFor(slate, E) : []);
    expect(copies[0]?.label).toBeUndefined();
    expect(copies[0]?.choice).toBe("Alice");
    expect(copies[1]?.statement).toBe("Bad bond.");
  });
});

describe("slateUri", () => {
  test("only the catalog entry for that source and election", () => {
    const [slate] = decode(reported.token);
    if (!slate) throw new Error("expected a slate");
    const entry = (election: string, name = "Labor Fed", uri = "https://labor.example/") =>
      ({
        slug: "labor",
        election,
        path: `orgs/labor/${election}/signed.slate`,
        issuer: { key: researcher.publicKey.toString() },
        attribution: { of: { name, uri }, mode: "scraped", retrieved_at: "2026-10-19T00:00:00Z" },
        positions: 2,
      }) as unknown as CatalogEntry;
    const catalog = "https://catalog.example/index.json";
    expect(slateUri(slate, E, [entry("2026-06-02"), entry(E)], catalog)).toBe(
      `https://catalog.example/orgs/labor/${E}/signed.slate`,
    );
    expect(slateUri(slate, E, [entry(E, "Other", "https://other.example/")], catalog)).toBe(
      undefined,
    );
  });
});
