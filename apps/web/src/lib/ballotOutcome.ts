import { type Race as CivicRace, samePerson } from "@openslate/core";
import { type DraftRow, rowIdFor } from "./ballotDraft";
import { ballotChoices, isYesNo, ranksFor, voteFor } from "./ballotView";
import { type Race, stanceTone } from "./collate";
import { measurePasses } from "./liveCount";

/**
 * My ballot against the count: what the voter marked on a race, the count as
 * any source reports it (`Standing`), and whether it's going their way. Pure
 * (no React, no fetching); unit-tested in test/ballotOutcome.test.ts.
 *
 * No race is called here. The state's and the counties' feeds say nothing
 * about calls, so a count in progress is "leading" or "trailing" until a
 * source itself names a winner (civicAPI does, `called`).
 */

// ---- What the voter marked ---------------------------------------------------

export interface MyMarks {
  /** A yes/no question: how the voter voted on it. */
  measure?: "yes" | "no";
  /** Who the voter voted for (Pick), or, with no Pick, who they leaned to (Maybe). */
  picks: string[];
  /** `picks` are Maybes, not Picks. */
  leaning: boolean;
  /** Who the voter marked Against. */
  against: string[];
  /** A ranked-choice race: `picks` is the voter's first choice only. */
  ranked: boolean;
}

/** Nothing marked that a count could go for or against. */
export function hasMarks(marks: MyMarks): boolean {
  return marks.measure !== undefined || marks.picks.length > 0 || marks.against.length > 0;
}

/**
 * What the voter marked on a race, from their draft rows. A measure folds onto
 * one vote: Pick Yes, Against No, or a stance on the measure as a whole all
 * vote Yes (and the other way round). `ranking` is the race's saved order,
 * first choice first, for a ranked-choice race.
 */
export function myMarks(
  race: Race,
  rows: Record<string, DraftRow>,
  election: string,
  ranking?: readonly string[],
): MyMarks {
  const stanceOf = (choice: string) =>
    rows[rowIdFor(election, race.subject, choice || undefined)]?.stance;
  const out: MyMarks = { picks: [], leaning: false, against: [], ranked: false };

  if (isYesNo(race)) {
    let vote = 0;
    for (const { choice } of ballotChoices(race)) {
      const stance = stanceOf(choice);
      if (!stance) continue;
      const tone = stanceTone(stance);
      const side = /^\s*no\b/i.test(choice) ? -1 : 1;
      if (tone === "for") vote += side;
      else if (tone === "against") vote -= side;
    }
    const whole = stanceOf("");
    if (whole) {
      const tone = stanceTone(whole);
      if (tone === "for") vote += 1;
      else if (tone === "against") vote -= 1;
    }
    if (vote > 0) out.measure = "yes";
    else if (vote < 0) out.measure = "no";
    return out;
  }

  const picked: string[] = [];
  const maybe: string[] = [];
  for (const { choice } of ballotChoices(race)) {
    if (choice === "") continue;
    const stance = stanceOf(choice);
    if (stance === "endorse") picked.push(choice);
    else if (stance === "lean_for") maybe.push(choice);
    else if (stance && stanceTone(stance) === "against") out.against.push(choice);
  }
  if (ranksFor(race) !== undefined) {
    // Only the first round is counted on election night: the voter's first choice.
    out.ranked = true;
    const marked = [...picked, ...maybe];
    const first =
      ranking?.find((name) => marked.includes(name)) ?? picked[0] ?? (maybe[0] as string);
    if (first !== undefined) out.picks = [first];
    out.leaning = first !== undefined && !picked.includes(first);
    return out;
  }
  out.picks = picked.length > 0 ? picked : maybe;
  out.leaning = picked.length === 0 && maybe.length > 0;
  return out;
}

/** How many the race elects: the count's word, else the ballot's, else one. */
export function seatsOf(race: Race, fromCount?: number): number {
  if (fromCount && fromCount > 0) return fromCount;
  return voteFor(race) ?? 1;
}

// ---- The count ---------------------------------------------------------------

/** Where a count came from, for the line under each race. */
export type CountSource = "state" | "county" | "civicapi";

/** A race's count, whichever source reported it. */
export type Standing = {
  source: CountSource;
  /** Who reports it: "California Secretary of State", "Santa Clara County". */
  sourceName: string;
  /** "12.3% of precincts reporting", as far as the source says. */
  reporting?: string;
  /** Percent of precincts reporting, when the source says. */
  percent?: number;
  /** When the source last changed its count, ms since epoch, when known. */
  changedAt?: number;
} & (
  | {
      kind: "candidates";
      choices: { name: string; votes: number }[];
      /** How many it elects. */
      seats: number;
      /** Who the source itself says won (civicAPI's calls); absent when it says nothing. */
      called?: string[];
    }
  | {
      kind: "measure";
      yes: number;
      no: number;
      threshold?: "55%" | "2/3";
      /** The source itself says it passed or failed. */
      called?: "passed" | "failed";
    }
);

/** civicAPI's race as a `Standing`; its `winner` flags are real calls. */
export function civicStanding(race: CivicRace, yesNo: boolean): Standing {
  const changedAt = Date.parse(race.last_updated ?? "");
  const base = {
    source: "civicapi" as const,
    sourceName: "civicAPI",
    ...(race.percent_reporting !== undefined
      ? {
          percent: race.percent_reporting,
          reporting: `${race.percent_reporting}% reporting`,
        }
      : {}),
    ...(Number.isFinite(changedAt) ? { changedAt } : {}),
  };
  const yes = race.candidates.find((c) => /^\s*yes\b/i.test(c.name));
  const no = race.candidates.find((c) => /^\s*no\b/i.test(c.name));
  if (yesNo && yes && no) {
    const called = yes.winner ? "passed" : no.winner ? "failed" : undefined;
    return {
      ...base,
      kind: "measure",
      yes: yes.votes ?? 0,
      no: no.votes ?? 0,
      ...(called ? { called } : {}),
    };
  }
  const winners = race.candidates.filter((c) => c.winner).map((c) => c.name);
  return {
    ...base,
    kind: "candidates",
    seats: Math.max(1, winners.length),
    choices: race.candidates.map((c) => ({ name: c.name, votes: c.votes ?? 0 })),
    ...(winners.length > 0 ? { called: winners } : {}),
  };
}

// ---- Going your way ----------------------------------------------------------

export type Outcome =
  /** Everything the voter marked is on the winning side. */
  | "your-way"
  /** Some of it is (a multi-seat race, or picks and againsts split). */
  | "mixed"
  /** None of it is. */
  | "not-your-way"
  /** A count, but no votes in it yet. */
  | "no-votes";

export interface ChoiceStanding {
  name: string;
  votes: number;
  /** Share of the votes cast in the race, 0–100. */
  percent: number;
  /** Within the seats on the count so far (or called a winner). */
  in: boolean;
  mine?: "pick" | "against";
}

export interface RaceOutcome {
  outcome: Outcome;
  /** The source called it: "won" and "lost", not "leading" and "trailing". */
  called: boolean;
  /**
   * How far the race is from turning, in percentage points of the votes cast:
   * a measure from its threshold, a candidate race from the last seat's line.
   * Absent with no votes.
   */
  marginPoints?: number;
  /** The candidates, most votes first, with the voter's marks. Empty for a measure. */
  choices: ChoiceStanding[];
  /** A measure: Yes's share of yes and no, 0–100, and whether it's passing. */
  measure?: { yesPercent: number; passing: boolean; need: number };
}

/** The share of yes votes a measure needs, in percent. */
export function measureNeed(threshold: "55%" | "2/3" | undefined): number {
  return threshold === "2/3" ? 200 / 3 : threshold === "55%" ? 55 : 50;
}

function same(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b) || samePerson(a, b);
}

/** Where the race stands for the voter. Undefined when they marked nothing to compare. */
export function raceOutcome(marks: MyMarks, standing: Standing): RaceOutcome | undefined {
  if (!hasMarks(marks)) return undefined;

  if (standing.kind === "measure") {
    if (marks.measure === undefined) return undefined;
    const total = standing.yes + standing.no;
    const need = measureNeed(standing.threshold);
    if (total === 0 && !standing.called) return { outcome: "no-votes", called: false, choices: [] };
    const yesPercent = total > 0 ? (standing.yes / total) * 100 : 0;
    const passing = standing.called
      ? standing.called === "passed"
      : measurePasses({ yes: standing.yes, no: standing.no, threshold: standing.threshold });
    return {
      outcome: (marks.measure === "yes") === passing ? "your-way" : "not-your-way",
      called: standing.called !== undefined,
      ...(total > 0 ? { marginPoints: Math.abs(yesPercent - need) } : {}),
      choices: [],
      measure: { yesPercent, passing, need },
    };
  }

  if (marks.picks.length === 0 && marks.against.length === 0) return undefined;
  const sorted = [...standing.choices].sort((a, b) => b.votes - a.votes);
  const total = sorted.reduce((sum, c) => sum + c.votes, 0);
  const called = Boolean(standing.called && standing.called.length > 0);
  if (total === 0 && !called) {
    return {
      outcome: "no-votes",
      called: false,
      choices: sorted.map((c) => ({ ...c, percent: 0, in: false, ...mineOf(marks, c.name) })),
    };
  }
  const seats = Math.max(1, standing.seats);
  // A tie at the last seat leaves both in: the count hasn't separated them.
  const line = sorted[seats - 1]?.votes ?? 0;
  const inSeat = (c: { name: string; votes: number }) =>
    called ? (standing.called ?? []).some((w) => same(w, c.name)) : c.votes > 0 && c.votes >= line;
  const choices: ChoiceStanding[] = sorted.map((c) => ({
    name: c.name,
    votes: c.votes,
    percent: total > 0 ? (c.votes / total) * 100 : 0,
    in: inSeat(c),
    ...mineOf(marks, c.name),
  }));

  // Every mark, right or wrong: a pick is right when it's in, an against when it's out.
  // A pick the count doesn't list (a write-in) isn't in.
  const right: boolean[] = [];
  for (const name of marks.picks) right.push(choices.some((c) => c.in && same(c.name, name)));
  for (const name of marks.against) right.push(!choices.some((c) => c.in && same(c.name, name)));
  const hits = right.filter(Boolean).length;
  const outcome: Outcome =
    hits === right.length ? "your-way" : hits === 0 ? "not-your-way" : "mixed";

  // How far from turning: the gap at the last seat's line.
  const firstOut = sorted[seats];
  const lastIn = sorted[seats - 1];
  const marginPoints =
    total > 0 && lastIn
      ? (((lastIn.votes ?? 0) - (firstOut?.votes ?? 0)) / total) * 100
      : undefined;
  return {
    outcome,
    called,
    ...(marginPoints !== undefined && !called ? { marginPoints } : {}),
    choices,
  };
}

function mineOf(marks: MyMarks, name: string): { mine?: "pick" | "against" } {
  if (marks.picks.some((p) => same(p, name))) return { mine: "pick" };
  if (marks.against.some((p) => same(p, name))) return { mine: "against" };
  return {};
}

/** A race this close (in points) is worth watching: it could still turn. */
export const CLOSE_POINTS = 2;
