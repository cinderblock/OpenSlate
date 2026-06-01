import { describe, expect, test } from "bun:test";
import type { Actor } from "../src/lib/results-framing";
import { outcomeLine, pendingLine } from "../src/lib/results-framing";

const SELF: Actor = { kind: "self" };
const ORG: Actor = { kind: "attributed", name: "Sierra Club" };

describe("pendingLine", () => {
  test("self / endorse → 'You endorsed X — ...'", () => {
    expect(pendingLine(SELF, "endorse", "Jane Candidate")).toBe(
      "You endorsed Jane Candidate — no winner declared yet.",
    );
  });

  test("attributed / oppose → '<name> opposed X — ...'", () => {
    expect(pendingLine(ORG, "oppose", "Prop 12")).toBe(
      "Sierra Club opposed Prop 12 — no winner declared yet.",
    );
  });

  test("lean_for past-tense uses 'leaned toward'", () => {
    expect(pendingLine(SELF, "lean_for", "Issue A")).toBe(
      "You leaned toward Issue A — no winner declared yet.",
    );
  });

  test("neutral / abstain produce null", () => {
    expect(pendingLine(SELF, "neutral", "X")).toBeNull();
    expect(pendingLine(SELF, "abstain", "X")).toBeNull();
  });
});

describe("outcomeLine — endorse / lean_for", () => {
  test("self picked the winner → success", () => {
    const f = outcomeLine(SELF, "endorse", "Jane", "Jane", true);
    expect(f?.success).toBe(true);
    expect(f?.label).toBe("Jane (your pick) won.");
  });

  test("self picked the loser → failure with winner named", () => {
    const f = outcomeLine(SELF, "endorse", "Jane", "Bob", false);
    expect(f?.success).toBe(false);
    expect(f?.label).toBe("Jane (your pick) lost — winner: Bob.");
  });

  test("attributed actor uses possessive name in the parenthetical", () => {
    const f = outcomeLine(ORG, "endorse", "Jane", "Jane", true);
    expect(f?.success).toBe(true);
    expect(f?.label).toBe("Jane (Sierra Club's pick) won.");
  });

  test("lean_for behaves like endorse", () => {
    const f = outcomeLine(SELF, "lean_for", "Jane", "Jane", true);
    expect(f?.success).toBe(true);
  });
});

describe("outcomeLine — oppose / lean_against", () => {
  test("self opposed the winner → failure", () => {
    const f = outcomeLine(SELF, "oppose", "Bob", "Bob", true);
    expect(f?.success).toBe(false);
    expect(f?.label).toBe("What you opposed won (Bob).");
  });

  test("self opposed the loser → success", () => {
    const f = outcomeLine(SELF, "oppose", "Bob", "Jane", false);
    expect(f?.success).toBe(true);
    expect(f?.label).toBe("Bob (you opposed) lost — winner: Jane.");
  });

  test("attributed actor name surfaces in opposed-failure copy", () => {
    const f = outcomeLine(ORG, "oppose", "Bob", "Bob", true);
    expect(f?.label).toBe("What Sierra Club opposed won (Bob).");
  });

  test("attributed actor name surfaces in opposed-success copy", () => {
    const f = outcomeLine(ORG, "lean_against", "Bob", "Jane", false);
    expect(f?.success).toBe(true);
    expect(f?.label).toBe("Bob (Sierra Club opposed) lost — winner: Jane.");
  });
});

describe("outcomeLine — neutral / abstain", () => {
  test("returns null for both", () => {
    expect(outcomeLine(SELF, "neutral", "X", "X", true)).toBeNull();
    expect(outcomeLine(SELF, "abstain", "X", "X", true)).toBeNull();
  });
});
