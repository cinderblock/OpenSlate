import { describe, expect, test } from "bun:test";
import { type SlatePayload, createSlate, generateKeyPair } from "@openslate/core";
import { firsthandSubjectKeys, payloadsFromTokens, supersessionFor } from "../src/lib/supersession";

function makeToken(input: {
  name: string;
  positions: Array<{ title: string; jurisdiction?: string; election?: string }>;
  attributionOf?: string;
}): string {
  return createSlate({
    keyPair: generateKeyPair(),
    issuer: { name: input.name, kind: "individual" },
    positions: input.positions.map((p) => ({
      subject: {
        title: p.title,
        jurisdiction: p.jurisdiction,
        election: p.election,
      },
      stance: "endorse" as const,
      choice: "X",
    })),
    attribution: input.attributionOf
      ? {
          of: { name: input.attributionOf },
          mode: "scraped" as const,
          retrieved_at: "2026-01-01T00:00:00Z",
        }
      : undefined,
  }).token;
}

describe("payloadsFromTokens", () => {
  test("skips unparseable tokens", () => {
    const good = makeToken({ name: "A", positions: [{ title: "M" }] });
    const out = payloadsFromTokens([good, "not.a.token", ""]);
    expect(out).toHaveLength(1);
    expect(out[0]?.issuer.name).toBe("A");
  });
});

describe("firsthandSubjectKeys", () => {
  test("ignores secondhand payloads entirely", () => {
    const first = makeToken({ name: "A", positions: [{ title: "Mayor" }] });
    const second = makeToken({
      name: "Researcher",
      positions: [{ title: "Council" }],
      attributionOf: "Sierra Club",
    });
    const payloads = payloadsFromTokens([first, second]);
    const keys = firsthandSubjectKeys(payloads);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain("Mayor");
  });

  test("collects subject keys across multiple firsthand slates", () => {
    const a = makeToken({ name: "A", positions: [{ title: "Mayor" }, { title: "Prop 12" }] });
    const b = makeToken({ name: "B", positions: [{ title: "Council" }] });
    const keys = firsthandSubjectKeys(payloadsFromTokens([a, b]));
    expect(keys.size).toBe(3);
  });
});

describe("supersessionFor", () => {
  const mayorSubj = { title: "Mayor" };
  const propSubj = { title: "Prop 12" };

  test("returns null for firsthand payloads", () => {
    const payload = payloadsFromTokens([
      makeToken({ name: "A", positions: [mayorSubj] }),
    ])[0] as SlatePayload;
    expect(supersessionFor(payload, new Set())).toBeNull();
  });

  test("counts overlap when firsthand covers the same subject", () => {
    const secondhand = payloadsFromTokens([
      makeToken({
        name: "Researcher",
        positions: [mayorSubj, propSubj],
        attributionOf: "Sierra Club",
      }),
    ])[0] as SlatePayload;
    const firstKeys = firsthandSubjectKeys(
      payloadsFromTokens([makeToken({ name: "A", positions: [mayorSubj] })]),
    );
    const info = supersessionFor(secondhand, firstKeys);
    expect(info).not.toBeNull();
    expect(info?.total).toBe(2);
    expect(info?.coveredFirsthand).toBe(1);
    expect(info?.coveredSubjects[0]?.title).toBe("Mayor");
  });

  test("zero overlap when no firsthand covers any subject", () => {
    const secondhand = payloadsFromTokens([
      makeToken({
        name: "Researcher",
        positions: [mayorSubj],
        attributionOf: "Sierra Club",
      }),
    ])[0] as SlatePayload;
    const info = supersessionFor(secondhand, new Set());
    expect(info?.coveredFirsthand).toBe(0);
    expect(info?.total).toBe(1);
  });

  test("full overlap when every secondhand position has a firsthand counterpart", () => {
    const secondhand = payloadsFromTokens([
      makeToken({
        name: "Researcher",
        positions: [mayorSubj, propSubj],
        attributionOf: "Sierra Club",
      }),
    ])[0] as SlatePayload;
    const firstKeys = firsthandSubjectKeys(
      payloadsFromTokens([
        makeToken({ name: "A", positions: [mayorSubj] }),
        makeToken({ name: "B", positions: [propSubj] }),
      ]),
    );
    const info = supersessionFor(secondhand, firstKeys);
    expect(info?.coveredFirsthand).toBe(info?.total);
  });
});
