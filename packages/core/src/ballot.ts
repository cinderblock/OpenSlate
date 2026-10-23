import { matchBallotName } from "./names";
import type { Position, Subject } from "./schema";

/**
 * Ballot listings (SPEC §8.2) and resolving an endorser's choice against them
 * (§3.11, §3.12). Shared by the web app, which shows each choice under the
 * ballot's spelling and flags the ones it can't place, and by the
 * endorsements repo's publish gate, which refuses them.
 */

/** The entity kind of an election authority: its slates are ballot listings. */
export const ELECTION_AUTHORITY = "election-authority";

/** A slate payload, or an unsigned positions.json bundle. */
export interface PositionSource {
  issuer?: { kind?: string };
  context?: { election?: string; jurisdiction?: string };
  attribution?: { of?: { kind?: string } };
  positions: Position[];
}

export function isBallotListing(source: Pick<PositionSource, "issuer" | "attribution">): boolean {
  return (
    source.attribution?.of?.kind === ELECTION_AUTHORITY ||
    (!source.attribution && source.issuer?.kind === ELECTION_AUTHORITY)
  );
}

export interface ListedChoice {
  /** The ballot's spelling. */
  name: string;
  id?: string;
  /** A certified write-in candidate: not printed on the ballot. */
  writeIn: boolean;
  /** The ballot designation (party, occupation, measure type). */
  note?: string;
}

export interface ListedRace {
  /** The listing's own subject for the race. */
  subject: Subject;
  election: string;
  jurisdiction: string;
  /** Ballot order. */
  choices: ListedChoice[];
}

export interface BallotListing {
  /** `election|jurisdiction` pairs a listing covers. */
  covered: Set<string>;
  /** `election|jurisdiction|title` → the race. */
  races: Map<string, ListedRace>;
}

/** A position's election and jurisdiction: its subject's, else its slate's context. */
export function scopeOf(
  subject: Subject,
  source: Pick<PositionSource, "context">,
): { election: string; jurisdiction: string } {
  return {
    election: subject.election ?? source.context?.election ?? "",
    jurisdiction: subject.jurisdiction ?? source.context?.jurisdiction ?? "",
  };
}

/** Collect the races and choices of every ballot listing among `sources` (others are skipped). */
export function ballotListing(sources: Iterable<PositionSource>): BallotListing {
  const listing: BallotListing = { covered: new Set(), races: new Map() };
  for (const source of sources) {
    if (!isBallotListing(source)) continue;
    for (const position of source.positions) {
      const { election, jurisdiction } = scopeOf(position.subject, source);
      listing.covered.add(`${election}|${jurisdiction}`);
      const key = `${election}|${jurisdiction}|${position.subject.title}`;
      let race = listing.races.get(key);
      if (!race) {
        race = { subject: position.subject, election, jurisdiction, choices: [] };
        listing.races.set(key, race);
      }
      const name = position.choice;
      if (name === undefined || race.choices.some((c) => c.name === name)) continue;
      race.choices.push({
        name,
        ...(position.choice_id ? { id: position.choice_id } : {}),
        writeIn: position.write_in === true,
        ...(position.statement ? { note: position.statement } : {}),
      });
    }
  }
  return listing;
}

export type ChoiceResolution =
  /** No listing covers the position's jurisdiction in its election. */
  | { status: "uncovered" }
  /** The jurisdiction is covered, but the listing doesn't name this race. */
  | { status: "race-unlisted" }
  /** A position on the race as a whole: no choice to resolve. */
  | { status: "no-choice"; race: ListedRace }
  /**
   * The choice is on the listing, recognised by its `choice_id`, its exact
   * name, or as the same person by rule (a nickname, a missing middle
   * initial). `staleId`: the position's `choice_id` isn't the listing's.
   */
  | {
      status: "listed";
      race: ListedRace;
      choice: ListedChoice;
      by: "id" | "name" | "rule";
      staleId?: true;
    }
  /** A write-in the listing doesn't certify. */
  | { status: "write-in"; race: ListedRace; suggestion?: ListedChoice }
  /** Not on the listing. `suggestion`: the one listed name it resembles, for a human to check. */
  | { status: "unlisted"; race: ListedRace; suggestion?: ListedChoice };

/** Where a position's choice stands against the ballot listing. */
export function resolveChoice(
  listing: BallotListing,
  position: Position,
  source: Pick<PositionSource, "context">,
): ChoiceResolution {
  const { election, jurisdiction } = scopeOf(position.subject, source);
  if (!listing.covered.has(`${election}|${jurisdiction}`)) return { status: "uncovered" };
  const race = listing.races.get(`${election}|${jurisdiction}|${position.subject.title}`);
  if (!race) return { status: "race-unlisted" };
  const name = position.choice;
  if (name === undefined) return { status: "no-choice", race };

  const id = position.choice_id;
  if (id !== undefined) {
    const choice = race.choices.find((c) => c.id === id);
    if (choice) return { status: "listed", race, choice, by: "id" };
  }
  const stale = id !== undefined ? { staleId: true as const } : {};
  const exact = race.choices.find((c) => c.name === name);
  if (exact) return { status: "listed", race, choice: exact, by: "name", ...stale };

  const match = matchBallotName(
    name,
    race.choices.map((c) => c.name),
  );
  const matched = match && race.choices.find((c) => c.name === match.name);
  if (match?.sure && matched)
    return { status: "listed", race, choice: matched, by: "rule", ...stale };
  const suggestion = matched ? { suggestion: matched } : {};
  return { status: position.write_in ? "write-in" : "unlisted", race, ...suggestion };
}
