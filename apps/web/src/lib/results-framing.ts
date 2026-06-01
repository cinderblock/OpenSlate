import type { Stance } from "@openslate/core";

/**
 * Copy helpers for the per-position outcome line. Lifted out of ResultsPanel so
 * the wording can be unit-tested directly.
 *
 * Tone targets:
 * - Past-tense verbs ("endorsed", "opposed", "leaned toward") — these read
 *   alongside an already-decided election outcome.
 * - The actor is "You" by default and `attributedTo` for secondhand slates,
 *   matching SPEC §3.9's "Sierra Club's reported pick" framing.
 * - Returns `null` for stances where success/failure isn't meaningful
 *   (`neutral`, `abstain`).
 */

export type Actor = { kind: "self" } | { kind: "attributed"; name: string };

export interface OutcomeFrame {
  success: boolean;
  label: string;
}

export function actorSubject(actor: Actor): string {
  return actor.kind === "self" ? "You" : actor.name;
}

export function actorVerbSubject(actor: Actor): string {
  return actor.kind === "self" ? "you" : actor.name;
}

/** Possessive form: "your" for self, "<Name>'s" for attributed. */
export function actorPossessive(actor: Actor): string {
  return actor.kind === "self" ? "your" : `${actor.name}'s`;
}

const STANCE_PAST: Record<Stance, string | null> = {
  endorse: "endorsed",
  oppose: "opposed",
  lean_for: "leaned toward",
  lean_against: "leaned against",
  neutral: null,
  abstain: null,
};

/** Phrasing for an outcome that isn't yet known. */
export function pendingLine(actor: Actor, stance: Stance, choice: string): string | null {
  const verb = STANCE_PAST[stance];
  if (!verb) return null;
  return `${actorSubject(actor)} ${verb} ${choice} — no winner declared yet.`;
}

/**
 * Phrasing for a known outcome. `pickedWinner` is true when `choice` matches
 * the declared winner; for `oppose`/`lean_against` we invert the success
 * relationship (opposing the winner is a loss; opposing the loser is a win).
 *
 * Returns `null` for stances where success/failure has no meaning.
 */
export function outcomeLine(
  actor: Actor,
  stance: Stance,
  choice: string,
  winner: string,
  pickedWinner: boolean,
): OutcomeFrame | null {
  const possessive = actorPossessive(actor);
  const verbSubject = actorVerbSubject(actor);
  switch (stance) {
    case "endorse":
    case "lean_for":
      return pickedWinner
        ? { success: true, label: `${choice} (${possessive} pick) won.` }
        : { success: false, label: `${choice} (${possessive} pick) lost — winner: ${winner}.` };
    case "oppose":
    case "lean_against":
      return pickedWinner
        ? { success: false, label: `What ${verbSubject} opposed won (${winner}).` }
        : {
            success: true,
            label: `${choice} (${verbSubject} opposed) lost — winner: ${winner}.`,
          };
    case "neutral":
    case "abstain":
      return null;
  }
}
