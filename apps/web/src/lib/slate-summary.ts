import type { Position, Race } from "@openslate/core";
import { civicStanding, type MyMarks, raceOutcome, type Standing } from "./ballotOutcome";

/**
 * Pure helpers for the slate-level outcome headline ("you picked 12/15 winners").
 * No React. Lifted out of ResultsForSlate so the math can be unit-tested.
 */

/**
 * `win` / `loss`: the source called the race. `leading` / `trailing`: votes
 * are in but nobody has called it (the Secretary of State and the counties
 * never do), so the position is on the winning or losing side of the count so far.
 */
export type PositionOutcome =
  | "win"
  | "loss"
  | "leading"
  | "trailing"
  | "pending"
  | "na"
  | "unresolved";

export interface SlateSummary {
  total: number;
  wins: number;
  losses: number;
  leading: number;
  trailing: number;
  pending: number;
  /** Positions whose stance has no win/loss semantics (`neutral` / `abstain`). */
  na: number;
  /** Positions for which we couldn't find a race at all. */
  unresolved: number;
  /** Wins / (wins + losses), or `null` when nothing has been called yet. */
  winRate: number | null;
}

/** Categorise a single position given its (optional) resolved civicAPI-shaped race. */
export function positionOutcome(position: Position, race: Race | undefined): PositionOutcome {
  if (!race) return standingOutcome(position, undefined);
  const yesNo =
    race.candidates.length === 2 && race.candidates.every((c) => /^\s*(yes|no)\b/i.test(c.name));
  return standingOutcome(position, civicStanding(race, yesNo));
}

/**
 * Categorise a single position given its count from any source (`raceOutcome`'s
 * rules): a called race is a win or loss, one with votes in leading or trailing.
 */
export function standingOutcome(
  position: Position,
  standing: Standing | undefined,
): PositionOutcome {
  if (position.stance === "neutral" || position.stance === "abstain") return "na";
  if (!standing) return "unresolved";
  const tone =
    position.stance === "endorse" || position.stance === "lean_for"
      ? 1
      : position.stance === "oppose" || position.stance === "lean_against"
        ? -1
        : 0;
  if (tone === 0) return "na";

  const marks: MyMarks = { picks: [], leaning: false, against: [], ranked: false };
  if (standing.kind === "measure") {
    // A stance on the measure with no choice named is a stance on Yes.
    const side = position.choice && /^\s*no\b/i.test(position.choice) ? -1 : 1;
    marks.measure = side * tone > 0 ? "yes" : "no";
  } else {
    // Without a choice we can't compare; the position is na for headline purposes.
    if (!position.choice) return "na";
    if (tone > 0) marks.picks.push(position.choice);
    else marks.against.push(position.choice);
  }
  const outcome = raceOutcome(marks, standing);
  if (!outcome) return "na";
  switch (outcome.outcome) {
    case "your-way":
      return outcome.called ? "win" : "leading";
    case "not-your-way":
      return outcome.called ? "loss" : "trailing";
    case "no-votes":
      return "pending";
    default:
      return "na";
  }
}

/**
 * Combine outcomes across a position list into a headline summary. Accepts a
 * partial race lookup: positions whose race hasn't resolved yet count as
 * `unresolved`, which keeps the headline meaningful while data streams in.
 */
export function summarizeSlate(
  positions: Position[],
  raceByPosition: (Race | undefined)[],
): SlateSummary {
  return summarizeOutcomes(
    positions.map((position, i) => positionOutcome(position, raceByPosition[i])),
  );
}

/** The headline summary of outcomes already worked out, one per position. */
export function summarizeOutcomes(outcomes: readonly PositionOutcome[]): SlateSummary {
  let wins = 0;
  let losses = 0;
  let leading = 0;
  let trailing = 0;
  let pending = 0;
  let na = 0;
  let unresolved = 0;

  for (const outcome of outcomes) {
    switch (outcome) {
      case "win":
        wins++;
        break;
      case "loss":
        losses++;
        break;
      case "leading":
        leading++;
        break;
      case "trailing":
        trailing++;
        break;
      case "pending":
        pending++;
        break;
      case "na":
        na++;
        break;
      case "unresolved":
        unresolved++;
        break;
    }
  }

  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : null;

  return {
    total: outcomes.length,
    wins,
    losses,
    leading,
    trailing,
    pending,
    na,
    unresolved,
    winRate,
  };
}
