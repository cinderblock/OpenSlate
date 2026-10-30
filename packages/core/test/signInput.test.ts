import { describe, expect, test } from "bun:test";
import { type Position, signInputSchema } from "../src/schema";

const E = "2026-11-03";
const position: Position = {
  subject: { title: "Governor", election: E },
  stance: "endorse",
  choice: "Alice",
};

describe("signInputSchema", () => {
  test("takes a bundle object and a bare array of positions alike", () => {
    const bundle = signInputSchema.parse({
      context: { election: E },
      positions: [position],
      attribution: {
        of: { name: "State Party" },
        mode: "scraped",
        retrieved_at: "2026-10-19T00:00:00Z",
      },
    });
    expect(bundle.positions).toHaveLength(1);
    expect(bundle.attribution?.of.name).toBe("State Party");
    expect(signInputSchema.parse([position])).toEqual({ positions: [position] });
  });

  test("positions default to none", () => {
    expect(signInputSchema.parse({ context: { election: E } }).positions).toEqual([]);
  });

  test("takes a capture on the attribution, and checks it", () => {
    const attribution = {
      of: { name: "State Party" },
      mode: "scraped",
      retrieved_at: "2026-10-19T00:00:00Z",
    };
    const capture = {
      run: "2026-10-30T1700Z",
      manifest_sha256: "a".repeat(64),
      provenance: "https://example.org/provenance/state-party/2026-11-03.json",
    };
    const parsed = signInputSchema.parse({
      positions: [position],
      attribution: { ...attribution, capture },
    });
    expect(parsed.attribution?.capture).toEqual(capture);

    const accepted = (edit: Record<string, unknown>) =>
      signInputSchema.safeParse({
        attribution: { ...attribution, capture: { ...capture, ...edit } },
      }).success;
    expect(accepted({})).toBe(true);
    expect(accepted({ run: "" })).toBe(false);
    expect(accepted({ manifest_sha256: "A".repeat(64) })).toBe(false);
    expect(accepted({ manifest_sha256: "a".repeat(63) })).toBe(false);
    expect(accepted({ provenance: "http://example.org/p.json" })).toBe(false);
    expect(accepted({ provenance: "javascript:alert(1)" })).toBe(false);
    expect(accepted({ extra: true })).toBe(false);
  });

  test("is closed: a key sign doesn't know fails instead of being dropped", () => {
    const result = signInputSchema.safeParse({ positions: [position], endorsedBy: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("endorsedBy");
  });

  test("the signer's parts aren't sign input", () => {
    const result = signInputSchema.safeParse({ v: 1, positions: [] });
    expect(result.success).toBe(false);
  });

  test("checks labels the way the payload does", () => {
    const result = signInputSchema.safeParse({
      labels: [{ label: "Yes" }],
      positions: [{ ...position, label: "Strong yes" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["positions", 0, "label"]);
  });

  test("checks what sign used to pass through unchecked, like each adoption", () => {
    const result = signInputSchema.safeParse({ positions: [], adopts: [{ issuer: "k", x: 1 }] });
    expect(result.success).toBe(false);
  });
});
