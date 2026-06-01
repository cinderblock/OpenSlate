import type { Position, Race } from "@openslate/core";

/**
 * Pure helpers for the slate-level outcome headline ("you picked 12/15 winners").
 * No React. Lifted out of ResultsForSlate so the math can be unit-tested.
 */

export type PositionOutcome = "win" | "loss" | "pending" | "na" | "unresolved";

export interface SlateSummary {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  /** Positions whose stance has no win/loss semantics (`neutral` / `abstain`). */
  na: number;
  /** Positions for which we couldn't find a civicAPI race at all. */
  unresolved: number;
  /** Wins / (wins + losses), or `null` when nothing has been called yet. */
  winRate: number | null;
}

/** Categorise a single position given its (optional) resolved race. */
export function positionOutcome(position: Position, race: Race | undefined): PositionOutcome {
  if (position.stance === "neutral" || position.stance === "abstain") return "na";
  if (!race) return "unresolved";
  const winner = race.candidates.find((c) => c.winner);
  if (!winner) return "pending";

  // Without a choice we can't compare; the position is na for headline purposes.
  if (!position.choice) return "na";

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const pickedWinner = norm(winner.name) === norm(position.choice);

  switch (position.stance) {
    case "endorse":
    case "lean_for":
      return pickedWinner ? "win" : "loss";
    case "oppose":
    case "lean_against":
      return pickedWinner ? "loss" : "win";
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
  let wins = 0;
  let losses = 0;
  let pending = 0;
  let na = 0;
  let unresolved = 0;

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    if (!position) continue;
    const outcome = positionOutcome(position, raceByPosition[i]);
    switch (outcome) {
      case "win":
        wins++;
        break;
      case "loss":
        losses++;
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

  return { total: positions.length, wins, losses, pending, na, unresolved, winRate };
}
