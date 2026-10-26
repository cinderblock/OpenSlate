import type { Stance, Subject } from "@openslate/core";
import { type DraftRow, rowIdFor } from "./ballotDraft";
import { ballotChoices } from "./ballotView";
import { type Race, optionsOf, stanceTone, twoWayOptions } from "./collate";
import type { Standing } from "./sources";

/**
 * Working through My ballot to zero: where each race stands, and the quick
 * fills (by party, by source) that decide many races at once. Pure (no React,
 * no storage); unit-tested in test/triage.test.ts.
 *
 * Stances are My ballot's buttons: Pick = `endorse`, Maybe = `lean_for`,
 * Against = `oppose`.
 */

/**
 * Where a race stands, first match wins: any choice picked; any maybe; every
 * option ruled out (a race you're skipping); else still to do, including races
 * with only some options ruled out.
 */
export type RaceStatus = "todo" | "maybe" | "picked" | "against";

/** Decided races: nothing left to do on them. */
export function isDecided(status: RaceStatus): boolean {
  return status === "picked" || status === "against";
}

type Rows = Record<string, DraftRow>;

function stanceOn(rows: Rows, election: string, race: Race, choice: string): Stance | undefined {
  return rows[rowIdFor(election, race.subject, choice || undefined)]?.stance;
}

export function raceStatus(race: Race, rows: Rows, election: string): RaceStatus {
  // The choices as the ballot shows them: a measure's Yes and No even when no
  // source named them.
  const stances = ballotChoices(race).map((c) => stanceOn(rows, election, race, c.choice));
  if (stances.includes("endorse")) return "picked";
  // "Against" on a measure as a whole is a No vote, not a skip.
  if (
    race.subject.kind === "measure" &&
    stanceTone(stanceOn(rows, election, race, "") ?? "neutral") === "against"
  )
    return "picked";
  if (stances.includes("lean_for")) return "maybe";
  const ruledOut = optionsOf(race).every(
    (choice) => stanceTone(stanceOn(rows, election, race, choice) ?? "neutral") === "against",
  );
  return ruledOut ? "against" : "todo";
}

/** What the user has marked on a race, for its one-line summary. */
export function marksOn(
  race: Race,
  rows: Rows,
  election: string,
): { picked: string[]; maybe: string[]; against: string[] } {
  const out = { picked: [] as string[], maybe: [] as string[], against: [] as string[] };
  for (const { choice } of ballotChoices(race)) {
    const stance = stanceOn(rows, election, race, choice);
    const name = choice || race.subject.title;
    if (stance === "endorse") out.picked.push(name);
    else if (stance === "lean_for") out.maybe.push(name);
    else if (stance && stanceTone(stance) === "against") out.against.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parties

/** Party names as ballot sources print them, keyed by a lowercase spelling. */
const PARTIES: Record<string, string> = {
  democratic: "Democratic",
  democrat: "Democratic",
  "democratic party": "Democratic",
  republican: "Republican",
  "republican party": "Republican",
  green: "Green",
  "green party": "Green",
  libertarian: "Libertarian",
  "libertarian party": "Libertarian",
  "peace and freedom": "Peace and Freedom",
  "american independent": "American Independent",
  "no party preference": "No Party Preference",
  independent: "Independent",
  "working families": "Working Families",
  conservative: "Conservative",
  constitution: "Constitution",
  reform: "Reform",
};

const PLURAL: Record<string, string> = {
  Democratic: "Democrats",
  Republican: "Republicans",
  Green: "Greens",
  Libertarian: "Libertarians",
  Independent: "Independents",
};

/**
 * The party in a ballot source's note on a candidate: its first ` · ` part,
 * when that's a known party (`"Democratic · Attorney"` → `"Democratic"`).
 * Judges' offices, measure types and job titles aren't parties.
 */
export function partyOf(ballotNote: string | undefined): string | undefined {
  const head = ballotNote?.split(" · ")[0]?.trim().toLowerCase();
  return head ? PARTIES[head] : undefined;
}

/** "Democrats", "Peace and Freedom candidates". */
export function partyPlural(party: string): string {
  return PLURAL[party] ?? `${party} candidates`;
}

/** Parties with candidates on these races, most candidates first. */
export function partiesOn(races: Race[]): Array<{ party: string; candidates: number }> {
  const counts = new Map<string, number>();
  for (const race of races) {
    if (race.subject.kind === "measure") continue;
    for (const group of race.choices) {
      const party = group.choice ? partyOf(group.ballotNote) : undefined;
      if (party) counts.set(party, (counts.get(party) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([party, candidates]) => ({ party, candidates }))
    .sort((a, b) => b.candidates - a.candidates || a.party.localeCompare(b.party));
}

// ---------------------------------------------------------------------------
// Quick fill

/** One mark a quick fill makes. `choice` undefined = the race as a whole. */
export interface FillEdit {
  raceKey: string;
  subject: Subject;
  choice: string | undefined;
  stance: Stance;
}

function edit(race: Race, choice: string, stance: Stance): FillEdit {
  return { raceKey: race.key, subject: race.subject, choice: choice || undefined, stance };
}

function hasPick(race: Race, rows: Rows, election: string): boolean {
  return race.choices.some((c) => stanceOn(rows, election, race, c.choice) === "endorse");
}

/**
 * Pick, or rule out, every candidate of one party. Only fills choices the user
 * hasn't marked. Pick skips races that already have a pick, and where several
 * of the party's candidates are still in the running (a top-two race between
 * two Democrats) marks them Maybe rather than choosing for the user.
 */
export function partyFill(
  races: Race[],
  rows: Rows,
  election: string,
  party: string,
  action: "pick" | "against",
): FillEdit[] {
  const out: FillEdit[] = [];
  for (const race of races) {
    if (race.subject.kind === "measure") continue;
    const theirs = race.choices
      .filter((c) => c.choice && partyOf(c.ballotNote) === party)
      .map((c) => ({ choice: c.choice, stance: stanceOn(rows, election, race, c.choice) }));
    const open = theirs.filter((c) => !c.stance);
    if (open.length === 0) continue;
    if (action === "against") {
      for (const c of open) out.push(edit(race, c.choice, "oppose"));
      continue;
    }
    if (hasPick(race, rows, election)) continue;
    const inRunning = theirs.filter((c) => !c.stance || stanceTone(c.stance) !== "against");
    const stance: Stance = inRunning.length === 1 ? "endorse" : "lean_for";
    for (const c of open) out.push(edit(race, c.choice, stance));
  }
  return out;
}

export interface SourceSummary {
  id: string;
  name: string;
  standing: Standing;
  /** Races (of the ones given) the source takes a position on. */
  races: number;
}

/** Every source with a position on these races: followed, then disagreed with, then the rest; by name within each. */
export function sourcesOn(races: Race[]): SourceSummary[] {
  const by = new Map<string, SourceSummary>();
  for (const race of races) {
    const seen = new Set<string>();
    for (const group of race.choices) {
      for (const position of group.positions) {
        const id = position.source.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const entry = by.get(id);
        if (entry) entry.races++;
        else
          by.set(id, {
            id,
            name: position.source.name,
            standing: position.standing,
            races: 1,
          });
      }
    }
  }
  const order: Record<Standing, number> = { follow: 0, disagree: 1, off: 2 };
  return [...by.values()].sort(
    (a, b) => order[a.standing] - order[b.standing] || a.name.localeCompare(b.name),
  );
}

/**
 * One source's stances on a race, on the choices it named (a position listed
 * on the other side keeps the one it named). A stance on a Yes/No measure as a
 * whole becomes a stance on Yes (for) or No (against).
 */
function stancesOf(race: Race, sourceId: string): Array<{ choice: string; stance: Stance }> {
  const out: Array<{ choice: string; stance: Stance }> = [];
  const options = optionsOf(race);
  const yes = options.find((o) => o.toLowerCase() === "yes");
  const no = options.find((o) => o.toLowerCase() === "no");
  for (const group of race.choices) {
    const position = group.positions.find((p) => p.source.id === sourceId);
    if (!position) continue;
    if (group.choice === "" && race.subject.kind === "measure" && yes && no) {
      const tone = stanceTone(position.stance);
      const lean = position.stance === "lean_for" || position.stance === "lean_against";
      if (tone === "for") out.push({ choice: yes, stance: lean ? "lean_for" : "endorse" });
      if (tone === "against") out.push({ choice: no, stance: lean ? "lean_for" : "endorse" });
      continue;
    }
    out.push({ choice: position.named ?? group.choice, stance: position.stance });
  }
  return out;
}

/**
 * Take one source's recommendations wholesale, or do the opposite. Only fills
 * choices the user hasn't marked, and never adds a pick beside an existing one.
 *
 * - Two-way races (Yes/No measures, two names on the ballot): agree picks the
 *   source's side, go against picks the other side.
 * - Elsewhere: agree copies the source (endorse → Pick, lean_for → Maybe,
 *   against → Against); go against rules out what the source backs and leaves
 *   what it opposes alone, since opposing one of many names doesn't say who
 *   to vote for.
 */
export function sourceFill(
  races: Race[],
  rows: Rows,
  election: string,
  sourceId: string,
  mode: "agree" | "against",
): FillEdit[] {
  const out: FillEdit[] = [];
  for (const race of races) {
    const stances = stancesOf(race, sourceId);
    if (stances.length === 0) continue;
    const picked = hasPick(race, rows, election);
    const unmarked = (choice: string) => !stanceOn(rows, election, race, choice);

    const pair = twoWayOptions(race);
    if (pair) {
      if (picked) continue;
      const other = (choice: string) => (choice === pair[0] ? pair[1] : pair[0]);
      const sides = new Set<string>();
      let strong = false;
      for (const { choice, stance } of stances) {
        if (!pair.includes(choice)) continue;
        const tone = stanceTone(stance);
        if (tone === "neutral") continue;
        sides.add(tone === "for" ? choice : other(choice));
        if (stance === "endorse" || stance === "oppose") strong = true;
      }
      // Silent, or on both sides at once.
      if (sides.size !== 1) continue;
      const side = [...sides][0] as string;
      const target = mode === "agree" ? side : other(side);
      if (unmarked(target)) out.push(edit(race, target, strong ? "endorse" : "lean_for"));
      continue;
    }

    for (const { choice, stance } of stances) {
      if (!unmarked(choice)) continue;
      const tone = stanceTone(stance);
      if (mode === "against") {
        if (tone === "for") out.push(edit(race, choice, "oppose"));
      } else if (tone === "against") {
        out.push(edit(race, choice, "oppose"));
      } else if (stance === "lean_for") {
        out.push(edit(race, choice, "lean_for"));
      } else if (stance === "endorse" && !picked) {
        out.push(edit(race, choice, "endorse"));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Focus mode

/**
 * Where to go from `current` in a list of races, one at a time. Without
 * `isLive`: one step either way, stopping at the ends. With it (moving on
 * after a race is dealt with): the next live race after `current`, wrapping
 * to the start for any left behind. -1 when there's nowhere to go.
 */
export function stepThrough<T>(
  items: readonly T[],
  current: number,
  direction: 1 | -1,
  isLive?: (item: T) => boolean,
): number {
  if (!isLive) {
    const next = current + direction;
    return next >= 0 && next < items.length ? next : -1;
  }
  const order =
    direction === 1
      ? [...items.keys()]
          .slice(current + 1)
          .concat([...items.keys()].slice(0, Math.max(current, 0)))
      : [...items.keys()].slice(0, Math.max(current, 0)).reverse();
  return order.find((i) => isLive(items[i] as T)) ?? -1;
}
