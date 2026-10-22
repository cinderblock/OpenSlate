import { subjectIdentity } from "./adopts";
import type { Position } from "./schema";

/**
 * Where an endorser sits between two poles (in practice the Democratic and
 * Republican parties), computed only from its picks. Nothing here is a judgement
 * about the endorser: it counts the subjects where the two poles want different
 * things and asks which side the endorser took.
 *
 * Two kinds of evidence give a subject its two sides (a "contrast"):
 * - the poles' own slates disagree on it (the parties endorse different
 *   candidates, or opposite sides of a measure);
 * - the ballot lists a candidate of each pole's party (a Democrat-vs-Republican
 *   race): backing either candidate is backing a side.
 */
export type Side = "left" | "right";

/** Which side backing each choice on one subject puts you on. */
export interface Contrast {
  /** Normalized choice (see `choiceKey`) → the side backing it takes. */
  sides: Map<string, Side>;
  /** What set the sides: the poles' slates, or the candidates' parties on the ballot. */
  via: "poles" | "ballot";
}

/** Contrasts keyed by `subjectIdentity`. */
export type Contrasts = Map<string, Contrast>;

export interface Lean {
  /** Subjects where the endorser took the left side. */
  left: number;
  /** Subjects where the endorser took the right side. */
  right: number;
  /**
   * From -1 (always the left side) to 1 (always the right side); `(right - left) /
   * (left + right)`. Undefined with no evidence at all; check `LEAN_MIN_EVIDENCE`
   * before showing it.
   */
  score: number | undefined;
}

/** Fewer sided subjects than this is too little to place an endorser. */
export const LEAN_MIN_EVIDENCE = 5;

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** Case- and space-insensitive choice, so "Yes" and "yes " match. */
export function choiceKey(choice: string): string {
  return choice.trim().replace(/\s+/g, " ").toLowerCase();
}

const MEASURE_SIDES: Record<string, string> = { yes: "no", no: "yes" };

/**
 * A position as "supports these choices": backing a choice supports it, and
 * opposing a measure's Yes supports its No. Opposing a candidate supports no one
 * in particular, so it comes back as an opposition. Neutral and abstain say
 * nothing.
 */
function supportOf(position: Position): { supports?: string; opposes?: string } | undefined {
  if (position.choice === undefined) return undefined;
  const choice = choiceKey(position.choice);
  switch (position.stance) {
    case "endorse":
    case "lean_for":
      return { supports: choice };
    case "oppose":
    case "lean_against": {
      const flipped = MEASURE_SIDES[choice];
      return flipped ? { supports: flipped } : { opposes: choice };
    }
    default:
      return undefined;
  }
}

/** Supported and opposed choices per subject. */
function picksBySubject(positions: Position[]) {
  const out = new Map<string, { supports: Set<string>; opposes: Set<string> }>();
  for (const position of positions) {
    const pick = supportOf(position);
    if (!pick) continue;
    const key = subjectIdentity(position.subject);
    let entry = out.get(key);
    if (!entry) {
      entry = { supports: new Set(), opposes: new Set() };
      out.set(key, entry);
    }
    if (pick.supports) entry.supports.add(pick.supports);
    if (pick.opposes) entry.opposes.add(pick.opposes);
  }
  return out;
}

/**
 * Subjects where the two poles' slates disagree. A choice one pole backs (or the
 * other opposes) is on that pole's side; a choice both poles back is on neither,
 * and a subject only one pole spoke to isn't a contrast.
 */
export function contrastsFromPoles(left: Position[], right: Position[]): Contrasts {
  const leftPicks = picksBySubject(left);
  const rightPicks = picksBySubject(right);
  const out: Contrasts = new Map();
  for (const [key, l] of leftPicks) {
    const r = rightPicks.get(key);
    if (!r) continue;
    const leftChoices = new Set([...l.supports, ...r.opposes]);
    const rightChoices = new Set([...r.supports, ...l.opposes]);
    const sides = new Map<string, Side>();
    for (const choice of leftChoices) if (!rightChoices.has(choice)) sides.set(choice, "left");
    for (const choice of rightChoices) if (!leftChoices.has(choice)) sides.set(choice, "right");
    const values = new Set(sides.values());
    if (values.has("left") && values.has("right")) out.set(key, { sides, via: "poles" });
  }
  return out;
}

/**
 * Democrat-vs-Republican races on a ballot: every subject listing at least one
 * candidate of each party. `sideOf` reads a ballot position's party (see
 * `ballotPartySide`); candidates of other parties are on neither side.
 */
export function contrastsFromBallot(
  ballot: Position[],
  sideOf: (position: Position) => Side | undefined = ballotPartySide,
): Contrasts {
  const bySubject = new Map<string, Map<string, Side>>();
  for (const position of ballot) {
    if (position.choice === undefined) continue;
    const side = sideOf(position);
    if (!side) continue;
    const key = subjectIdentity(position.subject);
    let sides = bySubject.get(key);
    if (!sides) {
      sides = new Map();
      bySubject.set(key, sides);
    }
    sides.set(choiceKey(position.choice), side);
  }
  const out: Contrasts = new Map();
  for (const [key, sides] of bySubject) {
    const values = new Set(sides.values());
    if (values.has("left") && values.has("right")) out.set(key, { sides, via: "ballot" });
  }
  return out;
}

const LEFT_PARTIES = new Set(["democratic", "democrat", "democratic party"]);
const RIGHT_PARTIES = new Set(["republican", "republican party"]);

/**
 * The side of a ballot-data position's candidate: ballot sources put the party
 * first in the statement (`"Democratic · Attorney"`).
 */
export function ballotPartySide(position: Position): Side | undefined {
  const head = position.statement?.split(" · ")[0]?.trim().toLowerCase();
  if (!head) return undefined;
  if (LEFT_PARTIES.has(head)) return "left";
  if (RIGHT_PARTIES.has(head)) return "right";
  return undefined;
}

/** All contrasts from several sources; for a subject in more than one, the first wins. */
export function mergeContrasts(...sources: Contrasts[]): Contrasts {
  const out: Contrasts = new Map();
  for (const source of sources) {
    for (const [key, contrast] of source) if (!out.has(key)) out.set(key, contrast);
  }
  return out;
}

/**
 * Count the contrasted subjects where `positions` took a side. A subject counts
 * once, and one where the endorser backed both sides (a dual endorsement)
 * counts for neither.
 */
export function leanOf(positions: Position[], contrasts: Contrasts): Lean {
  let left = 0;
  let right = 0;
  for (const [key, picks] of picksBySubject(positions)) {
    const contrast = contrasts.get(key);
    if (!contrast) continue;
    const taken = new Set<Side>();
    for (const choice of picks.supports) {
      const side = contrast.sides.get(choice);
      if (side) taken.add(side);
    }
    for (const choice of picks.opposes) {
      const side = contrast.sides.get(choice);
      if (side) taken.add(other(side));
    }
    if (taken.size !== 1) continue;
    if (taken.has("left")) left++;
    else right++;
  }
  const total = left + right;
  return { left, right, score: total === 0 ? undefined : (right - left) / total };
}
