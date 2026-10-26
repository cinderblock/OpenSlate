import { describe, expect, test } from "bun:test";
import type { Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "../src/lib/ballotDraft";
import {
  ballotChoices,
  designation,
  instructionLine,
  isMarked,
  isYesNo,
  picksIn,
  raceHeading,
  ranksFor,
  splitMeasureTitle,
  voteFor,
  voteForLine,
} from "../src/lib/ballotView";
import type { ChoiceGroup, Race, RacePosition } from "../src/lib/collate";
import type { Standing } from "../src/lib/sources";

function position(name: string, stance: Stance, standing: Standing = "follow"): RacePosition {
  return {
    source: { id: name.toLowerCase(), name } as RacePosition["source"],
    stance,
    valid: true,
    standing,
  };
}

function group(choice: string, positions: RacePosition[], extra: Partial<ChoiceGroup> = {}) {
  return {
    choice,
    positions,
    support: 0,
    opposition: 0,
    onBallot: false,
    writeIn: false,
    ...extra,
  };
}

function race(kind: string, choices: ChoiceGroup[], onBallot = false): Race {
  return {
    key: "k",
    subject: { title: "T", kind },
    choices,
    onBallot,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
  };
}

const E = "2026-11-03";

const view = (r: Race) =>
  ballotChoices(r).map((c) => [c.choice, c.support, c.opposition, c.positions.length]);

describe("ballotChoices", () => {
  test("candidates in ballot order, then names only sources mention", () => {
    const r = race(
      "race",
      [
        group("A", [position("X", "endorse")], { support: 2, ballotIndex: 1, onBallot: true }),
        group("Z", [position("Y", "endorse")], { support: 5 }),
        group("C", [], { ballotIndex: 0, onBallot: true }),
        group("W", [position("Q", "endorse")], { support: 1 }),
        group("", [position("R", "neutral")]),
      ],
      true,
    );
    expect(ballotChoices(r).map((c) => c.choice)).toEqual(["C", "A", "Z", "W", ""]);
  });

  test("measures always show Yes then No, even with no positions", () => {
    expect(view(race("measure", []))).toEqual([
      ["Yes", 0, 0, 0],
      ["No", 0, 0, 0],
    ]);
  });

  test("measure stances fold onto the bubble they'd fill", () => {
    const r = race("measure", [
      group("No", [position("A", "endorse"), position("B", "oppose")]),
      group("Yes", [position("C", "endorse"), position("D", "endorse", "off")]),
      group("", [
        position("E", "endorse"),
        position("F", "oppose"),
        position("G", "neutral"),
        // Already counted under Yes: once is enough.
        position("C", "endorse"),
      ]),
    ]);
    const [yes, no] = ballotChoices(r);
    expect(yes?.positions.map((p) => [p.source.name, p.stance])).toEqual([
      ["B", "endorse"],
      ["C", "endorse"],
      ["E", "endorse"],
      ["D", "endorse"],
    ]);
    // D isn't followed: shown, not counted.
    expect([yes?.support, yes?.opposition]).toEqual([3, 0]);
    expect(no?.positions.map((p) => [p.source.name, p.stance])).toEqual([
      ["A", "endorse"],
      ["F", "endorse"],
    ]);
    expect(no?.support).toBe(2);
  });

  test("a measure's ballot note goes under the title; other options are kept", () => {
    const r = race(
      "measure",
      [
        group("yes", [], { onBallot: true, ballotNote: "Approve", ballotIndex: 0 }),
        group("Option C", [position("A", "endorse")], { support: 1 }),
      ],
      true,
    );
    const choices = ballotChoices(r);
    expect(choices.map((c) => c.choice)).toEqual(["Yes", "No", "Option C"]);
    // Said of Yes and No alike, so it moves under the title.
    expect(choices[0]?.ballotNote).toBeUndefined();
    expect(raceHeading(r).measureType).toBe("Approve");
    expect(choices[0]?.onBallot).toBe(true);
  });
});

describe("splitMeasureTitle", () => {
  test("statewide proposition", () => {
    expect(
      splitMeasureTitle(
        "California – Proposition 43 (Limits Voters' Ability to Raise Revenues for Local Government Services)",
      ),
    ).toEqual({
      heading: "Proposition 43",
      number: "43",
      detail: "Limits Voters' Ability to Raise Revenues for Local Government Services",
    });
  });

  test("local measures, letters and odd numbering", () => {
    expect(
      splitMeasureTitle(
        "San Francisco – Proposition H (Parcel Tax to Fund Public Muni Operations)",
      ),
    ).toMatchObject({ heading: "Proposition H", number: "H" });
    expect(
      splitMeasureTitle(
        "Isla Vista Community Services District – Measure F2026 (Establishment of an Appropriations Limit)",
      ),
    ).toMatchObject({
      heading: "Measure F2026",
      detail: "Establishment of an Appropriations Limit",
    });
    expect(splitMeasureTitle("Prop 1")).toEqual({ heading: "Proposition 1", number: "1" });
  });

  test("anything else is left whole", () => {
    expect(splitMeasureTitle("Measure on the city charter")).toEqual({
      heading: "Measure on the city charter",
    });
    expect(splitMeasureTitle("Governor of California")).toEqual({
      heading: "Governor of California",
    });
  });
});

describe("isMarked", () => {
  const prop: Race = { ...race("measure", []), subject: { title: "Prop 1", kind: "measure" } };
  test("a mark on Yes or No counts, even with no one's position on it", () => {
    expect(isMarked(prop, E, {})).toBe(false);
    const id = rowIdFor(E, prop.subject, "No");
    const row = { id, electionId: E, subject: prop.subject, choice: "No", stance: "lean_for" };
    expect(isMarked(prop, E, { [id]: row as DraftRow })).toBe(true);
  });
});

describe("voteFor", () => {
  const listed = (note?: string) =>
    group("A", [], { onBallot: true, ballotIndex: 0, ...(note ? { ballotNote: note } : {}) });

  test("one, for an office the ballot source lists", () => {
    expect(voteFor(race("race", [listed("Democratic · Attorney")], true))).toBe(1);
  });

  test("the ballot source's seat count, which then leaves the designation", () => {
    const board = race("race", [listed("3 seats"), listed("Teacher · 3 seats")], true);
    expect(voteFor(board)).toBe(3);
    expect(board.choices.map(designation)).toEqual([undefined, "Teacher"]);
  });

  test("unknown without a ballot source: a board may fill several seats", () => {
    expect(voteFor(race("race", [group("A", [])]))).toBeUndefined();
  });

  test("none for yes/no questions, retention races included", () => {
    expect(voteFor(race("measure", [], true))).toBeUndefined();
    const retain = race("race", [group("Yes", [position("A", "endorse")]), group("No", [])]);
    expect(isYesNo(retain)).toBe(true);
    expect(ballotChoices(retain).map((c) => c.choice)).toEqual(["Yes", "No"]);
    expect(voteFor(retain)).toBeUndefined();
  });

  test("the ballot's wording", () => {
    expect(voteForLine(1)).toBe("Vote for one");
    expect(voteForLine(3)).toBe("Vote for no more than three");
    expect(voteForLine(12)).toBe("Vote for no more than 12");
  });
});

describe("the ballot's own fields (SPEC §3.14)", () => {
  test("vote_for, over any older note", () => {
    const board = race("race", [group("A", [], { onBallot: true, ballotNote: "3 seats" })], true);
    expect(voteFor({ ...board, ballot: { vote_for: 2 } })).toBe(2);
    expect(instructionLine({ ...board, ballot: { vote_for: 2 } })).toBe(
      "Vote for no more than two",
    );
  });

  test("ranked choice: a rank line, no vote-for line", () => {
    const mayor = { ...race("race", [group("A", [])], true), ballot: { ranks: 10 } };
    expect(voteFor(mayor)).toBeUndefined();
    expect(ranksFor(mayor)).toBe(10);
    expect(instructionLine(mayor)).toBe("Rank up to ten choices");
  });

  test("heading, label, type and number, not read out of the title", () => {
    const prop = {
      ...race("measure", []),
      subject: { title: "Some catalog title", kind: "measure" },
      ballot: {
        heading: "Proposition 50",
        number: "50",
        label: "Election Rigging Response Act",
        measure_type: "Legislative Constitutional Amendment",
      },
    };
    expect(raceHeading(prop)).toEqual({
      heading: "Proposition 50",
      number: "50",
      label: "Election Rigging Response Act",
      measureType: "Legislative Constitutional Amendment",
    });
  });

  test("a measure with no label from the listing keeps its title under the heading", () => {
    const m = {
      ...race("measure", []),
      subject: { title: "Alameda — Measure N (Leases and Sales)", kind: "measure" },
      ballot: { heading: "Measure N", number: "N" },
    };
    expect(raceHeading(m)).toEqual({
      heading: "Measure N",
      number: "N",
      label: "Alameda — Measure N (Leases and Sales)",
    });
  });

  test("an office's heading; the title when the listing has none", () => {
    const ag = race("race", [], true);
    expect(raceHeading({ ...ag, ballot: { heading: "Attorney General", vote_for: 1 } })).toEqual({
      heading: "Attorney General",
    });
    expect(raceHeading({ ...ag, ballot: { vote_for: 1 } }).heading).toBe("T");
  });

  test("a candidate's party, designation and incumbency", () => {
    const a = group("A", [], {
      ballot: { party: "Democratic", designation: "Attorney General", incumbent: true },
      ballotNote: "ignored once the fields are there",
    });
    expect(designation(a)).toBe("Democratic · Attorney General · incumbent");
    expect(designation(group("B", [], { ballot: { designation: "Teacher" } }))).toBe("Teacher");
  });
});

describe("picksIn", () => {
  test("counts filled bubbles only", () => {
    const r = race("race", [group("A", []), group("B", []), group("C", [])], true);
    const rows: Record<string, DraftRow> = {};
    for (const [choice, stance] of [
      ["A", "endorse"],
      ["B", "endorse"],
      ["C", "lean_for"],
    ] as const) {
      const id = rowIdFor(E, r.subject, choice);
      rows[id] = { id, electionId: E, subject: r.subject, choice, stance } as DraftRow;
    }
    expect(picksIn(r, E, rows)).toBe(2);
  });
});
