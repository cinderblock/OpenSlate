import { describe, expect, test } from "bun:test";
import {
  ballotPartySide,
  contrastsFromBallot,
  contrastsFromPoles,
  leanOf,
  mergeContrasts,
} from "../src/lean";
import type { Position, Stance } from "../src/schema";

const E = "2026-11-03";
const race = (title: string) => ({ title, kind: "race", jurisdiction: "us/ca", election: E });
const measure = (title: string) => ({ title, kind: "measure", jurisdiction: "us/ca", election: E });

const gov = race("Governor");
const ag = race("Attorney General");
const sos = race("Secretary of State");
const mayor = race("Mayor");
const prop1 = measure("Prop 1");
const prop2 = measure("Prop 2");

const pos = (
  subject: Position["subject"],
  stance: Stance,
  choice?: string,
  statement?: string,
): Position => ({
  subject,
  stance,
  ...(choice === undefined ? {} : { choice }),
  ...(statement === undefined ? {} : { statement }),
});

const ballot: Position[] = [
  pos(gov, "neutral", "Alice", "Democratic · Attorney"),
  pos(gov, "neutral", "Bob", "Republican · Rancher"),
  // A top-two race between two Democrats isn't a contrast.
  pos(ag, "neutral", "Carol", "Democratic · Attorney General"),
  pos(ag, "neutral", "Dan", "Democratic · Prosecutor"),
  pos(sos, "neutral", "Erin", "Democratic · Secretary of State"),
  pos(sos, "neutral", "Frank", "Republican · Businessman"),
  pos(sos, "neutral", "Gail", "Green · Teacher"),
];

const democrats: Position[] = [
  pos(gov, "endorse", "Alice"),
  pos(ag, "endorse", "Carol"),
  pos(prop1, "endorse", "Yes"),
  pos(prop2, "endorse", "Yes"),
  pos(mayor, "endorse", "Hank"),
];
const republicans: Position[] = [
  pos(gov, "endorse", "Bob"),
  pos(ag, "endorse", "Dan"),
  pos(prop1, "endorse", "No"),
  pos(prop2, "endorse", "Yes"),
];

describe("ballotPartySide", () => {
  test("reads the party at the head of the statement", () => {
    expect(ballotPartySide(pos(gov, "neutral", "Alice", "Democratic · Attorney"))).toBe("left");
    expect(ballotPartySide(pos(gov, "neutral", "Bob", "Republican"))).toBe("right");
    expect(ballotPartySide(pos(gov, "neutral", "Gail", "Green · Teacher"))).toBeUndefined();
    expect(ballotPartySide(pos(gov, "neutral", "Ivy"))).toBeUndefined();
  });
});

describe("contrastsFromBallot", () => {
  const contrasts = contrastsFromBallot(ballot);

  test("finds the Democrat-vs-Republican races only", () => {
    expect(contrasts.size).toBe(2);
    expect([...contrasts.values()].every((c) => c.via === "ballot")).toBe(true);
  });

  test("leaves third-party candidates on neither side", () => {
    const sides = [...contrasts.values()].find((c) => c.sides.has("erin"))?.sides;
    expect(sides?.get("erin")).toBe("left");
    expect(sides?.get("frank")).toBe("right");
    expect(sides?.has("gail")).toBe(false);
  });
});

describe("contrastsFromPoles", () => {
  const contrasts = contrastsFromPoles(democrats, republicans);

  test("keeps subjects where the poles disagree", () => {
    // gov, ag, prop1 — not prop2 (both Yes) and not mayor (only one pole).
    expect(contrasts.size).toBe(3);
  });

  test("an opposed measure choice counts as backing the other", () => {
    const flipped = contrastsFromPoles(
      [pos(prop1, "endorse", "Yes")],
      [pos(prop1, "oppose", "Yes")],
    );
    const sides = [...flipped.values()][0]?.sides;
    expect(sides?.get("yes")).toBe("left");
    expect(sides?.get("no")).toBe("right");
  });
});

describe("leanOf", () => {
  const contrasts = mergeContrasts(
    contrastsFromPoles(democrats, republicans),
    contrastsFromBallot(ballot),
  );

  test("each pole lands at its own end", () => {
    expect(leanOf(democrats, contrasts)).toEqual({ left: 3, right: 0, score: -1 });
    expect(leanOf(republicans, contrasts)).toEqual({ left: 0, right: 3, score: 1 });
  });

  test("counts sides taken, ignoring uncontrasted subjects", () => {
    const endorser = [
      pos(gov, "endorse", "Alice"),
      pos(sos, "endorse", "Frank"),
      pos(prop1, "endorse", "no"),
      pos(prop2, "endorse", "Yes"),
      pos(mayor, "endorse", "Hank"),
    ];
    const lean = leanOf(endorser, contrasts);
    expect(lean.left).toBe(1);
    expect(lean.right).toBe(2);
    expect(lean.score).toBeCloseTo(1 / 3);
  });

  test("opposing a candidate takes the other side", () => {
    expect(leanOf([pos(gov, "oppose", "Bob")], contrasts)).toEqual({
      left: 1,
      right: 0,
      score: -1,
    });
  });

  test("a dual endorsement across sides counts for neither", () => {
    const dual = [pos(gov, "endorse", "Alice"), pos(gov, "endorse", "Bob")];
    expect(leanOf(dual, contrasts)).toEqual({ left: 0, right: 0, score: undefined });
  });

  test("neutral, abstain and third-party picks say nothing", () => {
    const quiet = [
      pos(gov, "neutral", "Alice"),
      pos(prop1, "abstain"),
      pos(sos, "endorse", "Gail"),
    ];
    expect(leanOf(quiet, contrasts).score).toBeUndefined();
  });

  test("the party slates win over the ballot for the same subject", () => {
    // The Republicans backing a Democrat makes her the right's choice here.
    const merged = mergeContrasts(
      contrastsFromPoles([pos(sos, "endorse", "Erin")], [pos(sos, "endorse", "Gail")]),
      contrastsFromBallot(ballot),
    );
    expect(leanOf([pos(sos, "endorse", "Gail")], merged).right).toBe(1);
  });
});
