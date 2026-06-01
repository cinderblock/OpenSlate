import { describe, expect, test } from "bun:test";
import type { Position, Race } from "@openslate/core";
import { positionOutcome, summarizeSlate } from "../src/lib/slate-summary";

function makePosition(input: {
  title: string;
  stance: Position["stance"];
  choice?: string;
}): Position {
  return {
    subject: { title: input.title },
    stance: input.stance,
    choice: input.choice,
  };
}

function makeRace(winner: string, others: string[] = []): Race {
  return {
    id: 1,
    election_name: "test",
    candidates: [
      { name: winner, winner: true },
      ...others.map((n) => ({ name: n, winner: false })),
    ],
  };
}

describe("positionOutcome", () => {
  const endorsedJane = makePosition({ title: "Mayor", stance: "endorse", choice: "Jane" });

  test("endorse + chose winner → win", () => {
    expect(positionOutcome(endorsedJane, makeRace("Jane"))).toBe("win");
  });

  test("endorse + chose loser → loss", () => {
    expect(positionOutcome(endorsedJane, makeRace("Bob"))).toBe("loss");
  });

  test("no race → unresolved", () => {
    expect(positionOutcome(endorsedJane, undefined)).toBe("unresolved");
  });

  test("race without a declared winner → pending", () => {
    const noWinnerRace: Race = {
      id: 1,
      election_name: "test",
      candidates: [
        { name: "Jane", winner: false },
        { name: "Bob", winner: false },
      ],
    };
    expect(positionOutcome(endorsedJane, noWinnerRace)).toBe("pending");
  });

  test("neutral / abstain → na (regardless of race state)", () => {
    expect(
      positionOutcome(makePosition({ title: "X", stance: "neutral" }), makeRace("anyone")),
    ).toBe("na");
    expect(
      positionOutcome(makePosition({ title: "X", stance: "abstain" }), makeRace("anyone")),
    ).toBe("na");
  });

  test("oppose: opposed the winner → loss", () => {
    expect(
      positionOutcome(
        makePosition({ title: "M", stance: "oppose", choice: "Bob" }),
        makeRace("Bob"),
      ),
    ).toBe("loss");
  });

  test("oppose: opposed the loser → win", () => {
    expect(
      positionOutcome(
        makePosition({ title: "M", stance: "oppose", choice: "Bob" }),
        makeRace("Jane", ["Bob"]),
      ),
    ).toBe("win");
  });

  test("lean_for behaves like endorse", () => {
    expect(
      positionOutcome(
        makePosition({ title: "M", stance: "lean_for", choice: "Jane" }),
        makeRace("Jane"),
      ),
    ).toBe("win");
  });

  test("lean_against behaves like oppose", () => {
    expect(
      positionOutcome(
        makePosition({ title: "M", stance: "lean_against", choice: "Bob" }),
        makeRace("Jane", ["Bob"]),
      ),
    ).toBe("win");
  });

  test("missing choice on a comparable stance → na (we can't decide)", () => {
    expect(positionOutcome(makePosition({ title: "M", stance: "endorse" }), makeRace("Jane"))).toBe(
      "na",
    );
  });

  test("case- and whitespace-insensitive choice matching", () => {
    expect(
      positionOutcome(
        makePosition({ title: "M", stance: "endorse", choice: "  jane  " }),
        makeRace("JANE"),
      ),
    ).toBe("win");
  });
});

describe("summarizeSlate", () => {
  const positions = [
    makePosition({ title: "A", stance: "endorse", choice: "Jane" }),
    makePosition({ title: "B", stance: "oppose", choice: "Bob" }),
    makePosition({ title: "C", stance: "endorse", choice: "Carol" }),
    makePosition({ title: "D", stance: "neutral" }),
    makePosition({ title: "E", stance: "endorse", choice: "Dan" }),
  ];

  test("happy path tallies wins/losses/pending/na/unresolved", () => {
    const races: (Race | undefined)[] = [
      makeRace("Jane"), // win
      makeRace("Jane", ["Bob"]), // win (opposed Bob, he lost)
      makeRace("Other"), // loss
      makeRace("Anyone"), // na (neutral)
      undefined, // unresolved
    ];
    const summary = summarizeSlate(positions, races);
    expect(summary).toEqual({
      total: 5,
      wins: 2,
      losses: 1,
      pending: 0,
      na: 1,
      unresolved: 1,
      winRate: 2 / 3,
    });
  });

  test("nothing decided yet → winRate null", () => {
    const races: (Race | undefined)[] = [undefined, undefined, undefined, undefined, undefined];
    const summary = summarizeSlate(positions, races);
    expect(summary.winRate).toBeNull();
    // The neutral position is still `na` even when race is undefined — stance
    // is checked first.
    expect(summary.unresolved).toBe(4);
    expect(summary.na).toBe(1);
  });

  test("empty input → empty summary", () => {
    expect(summarizeSlate([], [])).toEqual({
      total: 0,
      wins: 0,
      losses: 0,
      pending: 0,
      na: 0,
      unresolved: 0,
      winRate: null,
    });
  });
});
