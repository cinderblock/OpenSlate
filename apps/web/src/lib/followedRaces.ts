import type { Race as ResultRace, Subject } from "@openslate/core";
import { type RacePosition, stanceTone } from "./collate";
import { createLocalStore, useLocalStore } from "./localStore";
import type { ChoiceTally, RaceTally } from "./raceTally";

/**
 * Races and candidates a voter keeps an eye on, on their ballot or not: a
 * friend running in another city. All of it stays in this browser. Following
 * one has nothing to do with following a source: it adds nothing to My ballot's
 * counts, and it's never in anything published.
 *
 * Pure helpers apart from the store; unit-tested in test/followedRaces.test.ts.
 */
export interface FollowedRace {
  /** The race's `subjectKey`. */
  key: string;
  /** Enough of the subject to show the race, and look up its results, without the catalog. */
  subject: Subject;
  /** A candidate in the race. Absent: the whole race. */
  choice?: string;
  /** When it was followed. */
  since: string;
  /**
   * Who stood where at the last look (`marksOf`), to tell what's new. Absent
   * until the catalog has been read: nothing is new about a race just followed.
   */
  seen?: string[];
  /** When `seen` was last brought up to date. */
  seenAt?: string;
}

function isFollowedRace(raw: unknown): raw is FollowedRace {
  if (typeof raw !== "object" || raw === null) return false;
  const { key, subject, choice, since, seen, seenAt } = raw as Partial<FollowedRace>;
  return (
    typeof key === "string" &&
    typeof subject === "object" &&
    subject !== null &&
    typeof subject.title === "string" &&
    (choice === undefined || typeof choice === "string") &&
    typeof since === "string" &&
    (seen === undefined || (Array.isArray(seen) && seen.every((m) => typeof m === "string"))) &&
    (seenAt === undefined || typeof seenAt === "string")
  );
}

export const followedRacesStore = createLocalStore<FollowedRace[]>(
  "openslate.followedRaces.v1",
  [],
  (raw) => (Array.isArray(raw) && raw.every(isFollowedRace) ? raw : undefined),
);

export const useFollowedRaces = () => useLocalStore(followedRacesStore);

function sameFollow(item: FollowedRace, key: string, choice: string | undefined): boolean {
  return item.key === key && item.choice === choice;
}

export function isFollowing(list: readonly FollowedRace[], key: string, choice?: string): boolean {
  return list.some((item) => sameFollow(item, key, choice));
}

/** The fields of a race's subject a followed race keeps, its election and place resolved. */
export function followedSubject(race: {
  subject: Subject;
  jurisdiction?: string;
  election?: string;
}): Subject {
  const { subject } = race;
  const jurisdiction = race.jurisdiction ?? subject.jurisdiction;
  const election = race.election ?? subject.election;
  return {
    title: subject.title,
    ...(subject.id ? { id: subject.id } : {}),
    ...(subject.kind ? { kind: subject.kind } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(election ? { election } : {}),
  };
}

export function followRace(
  key: string,
  subject: Subject,
  choice: string | undefined,
  now = new Date().toISOString(),
): void {
  followedRacesStore.set((current) =>
    isFollowing(current, key, choice)
      ? current
      : [...current, { key, subject, ...(choice ? { choice } : {}), since: now }],
  );
}

export function unfollowRace(key: string, choice: string | undefined): void {
  followedRacesStore.set((current) => current.filter((item) => !sameFollow(item, key, choice)));
}

/** A choice's tally, or the race's: what a followed item covers. */
function coveredBy(tally: RaceTally, item: Pick<FollowedRace, "choice">): ChoiceTally[] {
  return item.choice === undefined
    ? tally.choices
    : tally.choices.filter((c) => c.group.choice === item.choice);
}

/** Who stands where, one line a stance: a change of mind reads as a new mark. */
function markOf(position: RacePosition, choice: string): string {
  return [position.source.id, choice, stanceTone(position.stance)].join("\u0000");
}

export function marksOf(tally: RaceTally, item: Pick<FollowedRace, "choice">): string[] {
  return coveredBy(tally, item).flatMap(({ group }) =>
    group.positions.map((position) => markOf(position, group.choice)),
  );
}

/** A source that's taken a position, or changed one, since the last look. */
export interface NewPosition {
  position: RacePosition;
  choice: string;
}

export interface Changes {
  added: NewPosition[];
  /** Positions at the last look that aren't there now. */
  gone: number;
}

export const NO_CHANGES: Changes = { added: [], gone: 0 };

export function changesSince(tally: RaceTally, item: FollowedRace): Changes {
  if (!item.seen) return NO_CHANGES;
  const seen = new Set(item.seen);
  const added = coveredBy(tally, item).flatMap(({ group }) =>
    group.positions
      .filter((position) => !seen.has(markOf(position, group.choice)))
      .map((position) => ({ position, choice: group.choice })),
  );
  const now = new Set(marksOf(tally, item));
  return { added, gone: item.seen.filter((mark) => !now.has(mark)).length };
}

/**
 * The list with what's there now as "seen", for `item` (every item without a
 * `seen` yet when it's left out). The same list when nothing changes, so a
 * store that's up to date isn't written.
 */
export function withSeen(
  list: FollowedRace[],
  tallyOf: (key: string) => RaceTally | undefined,
  now: string,
  item?: Pick<FollowedRace, "key" | "choice">,
): FollowedRace[] {
  let changed = false;
  const next = list.map((entry) => {
    const due = item ? sameFollow(entry, item.key, item.choice) : !entry.seen;
    const tally = due ? tallyOf(entry.key) : undefined;
    if (!tally) return entry;
    changed = true;
    return { ...entry, seen: marksOf(tally, entry), seenAt: now };
  });
  return changed ? next : list;
}

/** A name as a results feed and a ballot might each write it, without case or spacing. */
function sameName(a: string, b: string): boolean {
  const norm = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

type ResultCandidate = ResultRace["candidates"][number];

function votesOf(candidate: ResultCandidate): number {
  return candidate.percent ?? candidate.votes ?? 0;
}

function shareOf(candidate: ResultCandidate): string {
  return candidate.percent === undefined
    ? `${(candidate.votes ?? 0).toLocaleString()} votes`
    : `${candidate.percent.toFixed(1)}%`;
}

/**
 * One line on where a race's count stands: the followed candidate's place in
 * it when there is one, else the top two. Undefined before any votes are in, or
 * when the feed doesn't name the candidate: no number beats someone else's.
 */
export function resultLine(race: ResultRace, choice?: string): string | undefined {
  const field = [...race.candidates].sort((a, b) => votesOf(b) - votesOf(a));
  const leader = field[0];
  if (!leader || votesOf(leader) === 0) return undefined;
  const counted = race.percent_reporting;
  const reporting =
    counted !== undefined && counted < 100 ? ` · ${counted.toFixed(1)}% reporting` : "";
  const winner = field.find((candidate) => candidate.winner);
  if (choice === undefined) {
    if (winner) return `${winner.name} won, ${shareOf(winner)}`;
    const second = field[1];
    const rest = second ? `, ${second.name} ${shareOf(second)}` : "";
    return `${leader.name} ${shareOf(leader)}${rest}${reporting}`;
  }
  const own = field.find((candidate) => sameName(candidate.name, choice));
  if (!own) return undefined;
  if (winner) {
    return winner === own
      ? `${own.name} won, ${shareOf(own)}`
      : `${winner.name} won, ${shareOf(winner)}; ${own.name} ${shareOf(own)}`;
  }
  const place = own === leader ? "leading" : `behind ${leader.name}'s ${shareOf(leader)}`;
  return `${own.name} ${shareOf(own)}, ${place}${reporting}`;
}
