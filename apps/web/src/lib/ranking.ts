import type { Stance, Subject } from "@openslate/core";
import { type DraftRow, type RowPatch, rowIdFor } from "./ballotDraft";
import { ballotChoices, isYesNo, ranksFor, voteFor } from "./ballotView";
import type { ChoiceGroup, Race } from "./collate";

/**
 * Ranking is how a voter decides a candidate race: they put the choices they'd
 * vote for in order, and the ballot marks the first few. In a ranked-choice
 * contest those are its ranks; anywhere else the first `vote_for` of them
 * ("converts to their best pick"). Choices ranked past that line aren't marked;
 * they're the voter's backups, kept as `lean_for`.
 *
 * The order is kept per race (`rankingStore`); each choice's mark stays in its
 * draft row, which everything else (print, export, publish) reads. These pure
 * helpers keep the two in step. Yes/no questions aren't ranked.
 *
 * Unit-tested in test/ranking.test.ts.
 */

/** How many of a ranking the ballot marks: its ranks, else how many to vote for, else all. */
export function marksFor(race: Race): number {
  return ranksFor(race) ?? voteFor(race) ?? Number.POSITIVE_INFINITY;
}

/** Whether a race is decided by ranking: any race that isn't a yes/no question. */
export function isRanked(race: Race): boolean {
  return !isYesNo(race);
}

function stanceOf(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  name: string,
): Stance | undefined {
  return rows[rowIdFor(election, race.subject, name)]?.stance;
}

/**
 * The names a race's ranking can hold, in ballot order: its choices, then any
 * the user wrote in. Not the race-wide position (no name).
 */
export function rankableNames(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
): string[] {
  const names = ballotChoices(race)
    .map((c) => c.choice)
    .filter(Boolean);
  for (const row of Object.values(rows)) {
    if (
      row.writeIn &&
      row.choice &&
      row.electionId === election &&
      rowIdFor(election, race.subject, row.choice) === row.id &&
      !names.includes(row.choice)
    ) {
      names.push(row.choice);
    }
  }
  return names;
}

/**
 * The voter's ranking of a race: the saved order, kept to names that are
 * still choices and still marked for, then any pick the order doesn't have
 * yet (set some other way: Quick fill, an older version of the app) in
 * ballot order.
 */
export function rankingOf(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  saved: readonly string[] | undefined,
): string[] {
  const names = rankableNames(race, election, rows);
  const forIt = (name: string) => {
    const stance = stanceOf(race, election, rows, name);
    return stance === "endorse" || stance === "lean_for";
  };
  const order: string[] = [];
  for (const name of saved ?? []) {
    if (names.includes(name) && forIt(name) && !order.includes(name)) order.push(name);
  }
  for (const name of names) {
    if (stanceOf(race, election, rows, name) === "endorse" && !order.includes(name)) {
      order.push(name);
    }
  }
  return order;
}

/** Choices not in the ranking, in ballot order. */
export function unrankedNames(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  order: readonly string[],
): string[] {
  return rankableNames(race, election, rows).filter((name) => !order.includes(name));
}

/**
 * The row changes that make `next` the ranking, given it was `previous`:
 * the first `marksFor` names marked, the rest backups, and names dropped from
 * it unmarked.
 */
export function orderPatches(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  previous: readonly string[],
  next: readonly string[],
): RowPatch[] {
  const marks = marksFor(race);
  const patches: RowPatch[] = [];
  next.forEach((name, i) => {
    const want: Stance = i < marks ? "endorse" : "lean_for";
    if (stanceOf(race, election, rows, name) !== want) {
      patches.push({ subject: race.subject, choice: name, fields: { stance: want } });
    }
  });
  for (const name of previous) {
    if (!next.includes(name)) {
      patches.push({ subject: race.subject, choice: name, fields: { stance: undefined } });
    }
  }
  return patches;
}

/**
 * The bubble: mark a name, or unmark it. A marked name leaves the ranking. Any
 * other moves into the last marked place (first, when the race votes for one),
 * so the name it displaces becomes the first backup; with room to spare it
 * just joins the end.
 */
export function togglePick(order: readonly string[], name: string, marks: number): string[] {
  const at = order.indexOf(name);
  if (at !== -1 && at < marks) return order.filter((n) => n !== name);
  const rest = order.filter((n) => n !== name);
  const place = Math.min(rest.length, marks - 1);
  return [...rest.slice(0, place), name, ...rest.slice(place)];
}

/** Move `names` (dragged together) to just before or after `target`, or to the end. */
export function moveNames(
  order: readonly string[],
  names: readonly string[],
  target: string | undefined,
  position: "before" | "after",
): string[] {
  const rest = order.filter((n) => !names.includes(n));
  if (target === undefined || names.includes(target)) {
    return target === undefined ? [...rest, ...names] : [...order];
  }
  const at = rest.indexOf(target);
  if (at === -1) return [...rest, ...names];
  const place = position === "before" ? at : at + 1;
  return [...rest.slice(0, place), ...names, ...rest.slice(place)];
}

/** What the user did, as the race's new ranking and the row changes that go with it. */
export interface RankChange {
  order: string[];
  patches: RowPatch[];
}

/** Put the ranking in a new order. */
export function reorderChange(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  saved: readonly string[] | undefined,
  next: readonly string[],
): RankChange {
  const order = rankingOf(race, election, rows, saved);
  return { order: [...next], patches: orderPatches(race, election, rows, order, next) };
}

/** The bubble (`togglePick`). A name written in is recorded as one. */
export function pickChange(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  saved: readonly string[] | undefined,
  name: string,
  { writeIn = false }: { writeIn?: boolean } = {},
): RankChange {
  const order = rankingOf(race, election, rows, saved);
  const next = togglePick(order, name, marksFor(race));
  const patches = orderPatches(race, election, rows, order, next);
  if (writeIn) {
    const own = patches.find((p) => p.choice === name);
    if (own) own.fields = { ...own.fields, writeIn: true };
    else patches.push({ subject: race.subject, choice: name, fields: { writeIn: true } });
  }
  return { order: next, patches };
}

/**
 * Maybe or Against. On a name not ranked it toggles, as on any choice; on a
 * ranked one it takes the name out of the ranking.
 */
export function markChange(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  saved: readonly string[] | undefined,
  name: string,
  stance: Stance,
): RankChange {
  const order = rankingOf(race, election, rows, saved);
  if (!order.includes(name)) {
    const current = stanceOf(race, election, rows, name);
    return {
      order,
      patches: [
        {
          subject: race.subject,
          choice: name,
          fields: { stance: current === stance ? undefined : stance },
        },
      ],
    };
  }
  const next = order.filter((n) => n !== name);
  const patches = orderPatches(race, election, rows, order, next).filter((p) => p.choice !== name);
  patches.push({ subject: race.subject, choice: name, fields: { stance } });
  return { order: next, patches };
}

/** Names in the order the card shows them: ranked first, then the rest in ballot order. */
export function shownNames(
  race: Race,
  election: string,
  rows: Record<string, DraftRow>,
  saved: readonly string[] | undefined,
): string[] {
  if (!isRanked(race)) return ballotChoices(race).map((c) => c.choice);
  const order = rankingOf(race, election, rows, saved);
  return [...order, ...unrankedNames(race, election, rows, order)];
}

/** Saves a ranking change: the race's order, and the marks that go with it. */
export type ApplyRank = (election: string, subject: Subject, change: RankChange) => void;

/** A name the user wrote in, as a choice nobody else named. */
export function writeInGroup(name: string): ChoiceGroup {
  return { choice: name, positions: [], support: 0, opposition: 0, onBallot: false, writeIn: true };
}

/**
 * The ranks to publish (SPEC §3.16) on one race's marks: its saved ranking,
 * kept to names still marked for, then picks the ranking doesn't have yet.
 * None when the user never ranked the race: a pick alone says nothing about
 * order.
 */
export function publishedRanks(
  saved: readonly string[] | undefined,
  marks: ReadonlyArray<{ choice?: string; stance?: Stance }>,
): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!saved || saved.length === 0) return ranks;
  const forIt = new Set(
    marks
      .filter((m) => m.choice && (m.stance === "endorse" || m.stance === "lean_for"))
      .map((m) => m.choice as string),
  );
  for (const name of saved)
    if (forIt.has(name) && !ranks.has(name)) ranks.set(name, ranks.size + 1);
  for (const m of marks) {
    if (m.choice && m.stance === "endorse" && !ranks.has(m.choice)) {
      ranks.set(m.choice, ranks.size + 1);
    }
  }
  return ranks;
}
