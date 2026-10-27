import {
  type BallotChoice,
  type BallotContest,
  type SlatePayload,
  type Stance,
  type Subject,
  verifySlate,
} from "@openslate/core";
import type { ChoiceCheck } from "./ballotCheck";
import {
  type Area,
  answerFor,
  jurisdictionLabel,
  jurisdictionRank,
  parseJurisdiction,
  placeRace,
} from "./jurisdictions";
import {
  type Source,
  type Standing,
  isBallotSource,
  isFollowed,
  sourceOf,
  standingOf,
} from "./sources";
import { subjectKey } from "./subjects";

/**
 * Collation for the "My vote" side: imported slates → races → choices → which
 * sources back each choice. Pure (no React, no storage); unit-tested in
 * test/collate.test.ts.
 *
 * Races are keyed by `subjectKey()`, the same key RacePanel looks up, so a race
 * links to its detail page.
 */

export interface DecodedSlate {
  token: string;
  importedAt: string;
  payload: SlatePayload;
  valid: boolean;
  source: Source;
  /**
   * Where each position's choice stands against the ballot listings, by
   * position index (`translateSlates`). Absent on listings themselves, and
   * when no listing is imported.
   */
  checks?: ChoiceCheck[];
}

/**
 * Verification results by token. A token never changes, so neither does its
 * result, and every page that lists slates decodes the same few hundred.
 */
const verified = new Map<string, Omit<DecodedSlate, "token" | "importedAt"> | null>();

/** Verify and decode imported slates. Unparseable tokens are dropped. */
export function decodeSlates(rows: Array<{ token: string; importedAt: string }>): DecodedSlate[] {
  const out: DecodedSlate[] = [];
  for (const row of rows) {
    let decoded = verified.get(row.token);
    if (decoded === undefined) {
      const result = verifySlate(row.token);
      decoded = result.payload
        ? { payload: result.payload, valid: result.valid, source: sourceOf(result.payload) }
        : null;
      verified.set(row.token, decoded);
    }
    if (!decoded) continue;
    out.push({ token: row.token, importedAt: row.importedAt, ...decoded });
  }
  return out;
}

/** The election a position belongs to: its subject's, else the slate's context. */
export function electionOf(subject: Subject, payload: SlatePayload): string | undefined {
  return subject.election ?? payload.context?.election;
}

export type StanceTone = "for" | "against" | "neutral";

export function stanceTone(stance: Stance): StanceTone {
  if (stance === "endorse" || stance === "lean_for") return "for";
  if (stance === "oppose" || stance === "lean_against") return "against";
  return "neutral";
}

/**
 * How a position counts on your ballot. A source you disagree with counts the
 * other way: what it backs counts against, what it opposes counts for.
 */
export function countedTone(stance: Stance, standing: Standing): StanceTone {
  const tone = stanceTone(stance);
  if (standing !== "disagree" || tone === "neutral") return tone;
  return tone === "for" ? "against" : "for";
}

/**
 * How a position counts on the choice it's listed under. One moved to the other
 * side of a two-way race (`named`) already stands for the user's side: it
 * counts as the source said it, there.
 */
export function positionTone(
  position: Pick<RacePosition, "stance" | "standing" | "named">,
): StanceTone {
  return position.named === undefined
    ? countedTone(position.stance, position.standing)
    : stanceTone(position.stance);
}

/**
 * Where a source you disagree with counts in a two-way race (a Yes/No measure,
 * two names on the ballot). `choice`: against what it picked (it backs No, so
 * No gets one against). `side`: for the other side (it backs No, so Yes gets
 * one for). Races with more names always count against what it picked:
 * ruling one name out doesn't say who to back.
 */
export type DisagreeMode = "choice" | "side";

/** Followed to agree first, then to disagree, then the rest. */
export const STANDING_ORDER: Record<Standing, number> = { follow: 0, disagree: 1, off: 2 };

export interface RacePosition {
  source: Source;
  stance: Stance;
  statement?: string;
  /** Where the source ranks this choice, 1 being its first (SPEC §3.16). */
  rank?: number;
  valid: boolean;
  /** How the user takes the source; `off` positions don't count on My ballot. */
  standing: Standing;
  /** The source's own spelling, when it's shown under the ballot's. */
  written?: string;
  /**
   * Listed on the other side of a two-way race from the one the source named
   * (a source you disagree with, `DisagreeMode` `side`): the choice it named.
   */
  named?: string;
}

export interface ChoiceGroup {
  /** Candidate or option; "" for a stance on the subject as a whole. */
  choice: string;
  /** Endorsement-type positions, followed sources first. Ballot listings aren't positions. */
  positions: RacePosition[];
  /** Followed sources counting for / against this choice (`positionTone`). */
  support: number;
  opposition: number;
  /** Listed by a ballot source: this choice is on the ballot even if nobody backs it. */
  onBallot: boolean;
  /** Not printed on the ballot: a voter writes the name in (SPEC §3.12). */
  writeIn: boolean;
  /**
   * Not on the ballot listing: the listed name it most likely means, for a
   * human to check (a likely typo, an unusual short form).
   */
  suggestion?: string;
  /** Position on the official ballot (0 first), when a ballot source lists the choice. */
  ballotIndex?: number;
  /** How the ballot prints the choice (SPEC §3.14): a ballot source's, else any slate's. */
  ballot?: BallotChoice;
}

export interface Race {
  key: string;
  subject: Subject;
  election?: string;
  jurisdiction?: string;
  /** Who votes on it, when narrower than `jurisdiction` (SPEC §3.3): a ballot source's, else any slate's. */
  district?: string;
  /** The jurisdictions that vote on a regional race (SPEC §3.3 `voted_in`): a ballot source's, else any slate's. */
  votedIn?: string[];
  /** How the ballot prints the contest (SPEC §3.14): a ballot source's, else any slate's. */
  ballot?: BallotContest;
  /**
   * The area can't tell whether the race is on the user's ballot (`placeRace`
   * "unknown"): a district it has no boundaries for. Absent: it is.
   */
  maybe?: true;
  /** On the ballot because the user said so, where the area alone couldn't tell (`answerPlacement`). */
  answered?: true;
  /** Ballot order when a ballot source lists the race, else most-backed first. */
  choices: ChoiceGroup[];
  /** A ballot source lists this race, so `choices` is the whole field. */
  onBallot: boolean;
  /** A ballot source covers this race's jurisdiction but doesn't list it. */
  unlisted: boolean;
  /** Distinct followed sources (to agree or disagree) with a position here; ballot sources excluded. */
  followedSources: number;
  totalSources: number;
}

export interface CollateOptions {
  follows: Record<string, Standing>;
  /** Only races in this election (date string as slates use it). */
  election?: string;
  /** Only races on the ballot for this area. */
  area?: Area;
  /**
   * Also list races that only unfollowed sources cover. Positions from
   * unfollowed sources always stay on a listed race (marked `followed: false`),
   * so a race never hides part of its field.
   */
  includeUnfollowed?: boolean;
  /**
   * Where sources you disagree with count in two-way races. Default `choice`:
   * every position stays under the choice its source named, as a race page
   * shows them.
   */
  disagree?: DisagreeMode;
}

type Field = Pick<Race, "choices" | "onBallot" | "subject">;

/**
 * The options a voter chooses between: the official field when a ballot
 * source lists the race, else every named choice, else the race itself.
 */
export function optionsOf(race: Field): string[] {
  const named = race.choices.filter((c) => c.choice !== "" && (!race.onBallot || c.onBallot));
  return named.length > 0 ? named.map((c) => c.choice) : [""];
}

/** A race with exactly two known options: a Yes/No measure, or a two-name ballot. */
export function twoWayOptions(race: Field): [string, string] | undefined {
  if (!race.onBallot && race.subject.kind !== "measure") return undefined;
  const options = optionsOf(race);
  return options.length === 2 ? [options[0] as string, options[1] as string] : undefined;
}

/**
 * `DisagreeMode` `side`: in a two-way race, list what a source you disagree
 * with says about one side under the other, marked with the side it named.
 */
function moveToOtherSide(race: Field): void {
  const pair = twoWayOptions(race);
  if (!pair) return;
  const groups = pair.map((choice) => race.choices.find((c) => c.choice === choice));
  const [first, second] = groups;
  if (!first || !second) return;
  const moving = groups.map((g) => g?.positions.filter((p) => p.standing === "disagree") ?? []);
  first.positions = first.positions
    .filter((p) => p.standing !== "disagree")
    .concat((moving[1] ?? []).map((p) => ({ ...p, named: second.choice })));
  second.positions = second.positions
    .filter((p) => p.standing !== "disagree")
    .concat((moving[0] ?? []).map((p) => ({ ...p, named: first.choice })));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Imported slates → races → choices → who backs each. Ballot sources (election
 * authorities) contribute the field and its order but never count as sources;
 * follow state doesn't apply to them.
 */
export function collateRaces(slates: DecodedSlate[], options: CollateOptions): Race[] {
  // A source can have several slates covering the same race (a reissue, or a
  // firsthand slate imported twice). Only its newest slate speaks for it.
  const newest = new Map<string, { issuedAt: string; slate: DecodedSlate }>();
  for (const slate of slates) {
    for (const position of slate.payload.positions) {
      const id = `${subjectKey(position.subject)}\u0000${slate.source.id}`;
      const current = newest.get(id);
      if (!current || slate.payload.issued_at > current.issuedAt) {
        newest.set(id, { issuedAt: slate.payload.issued_at, slate });
      }
    }
  }

  interface Building extends Race {
    sourceIds: Set<string>;
    followedIds: Set<string>;
    /** Choice → position on the ballot, for ballot order. */
    ballotOrder: Map<string, number>;
  }
  const districts = placesOf(slates, (subject) => subject.district);
  const votedIns = placesOf(slates, (subject) => subject.voted_in);
  const races = new Map<string, Building>();
  for (const slate of slates) {
    const ballot = isBallotSource(slate.source);
    const standing = standingOf(options.follows, slate.source.id);
    const followed = ballot || standing !== "off";
    for (const [index, position] of slate.payload.positions.entries()) {
      const check = slate.checks?.[index];
      const key = subjectKey(position.subject);
      if (newest.get(`${key}\u0000${slate.source.id}`)?.slate !== slate) continue;
      const election = electionOf(position.subject, slate.payload);
      if (options.election && election !== options.election) continue;
      const jurisdiction = position.subject.jurisdiction ?? slate.payload.context?.jurisdiction;
      const district = districts.get(key);
      const votedIn = votedIns.get(key);
      const placement = options.area
        ? placeRace(jurisdiction, district, options.area, votedIn)
        : "in";
      if (placement === "out") continue;

      let race = races.get(key);
      if (!race) {
        race = {
          key,
          subject: position.subject,
          ...(election ? { election } : {}),
          ...(jurisdiction ? { jurisdiction } : {}),
          ...(district ? { district } : {}),
          ...(votedIn ? { votedIn } : {}),
          ...(placement === "unknown" ? { maybe: true as const } : {}),
          ...(placement === "in" && options.area && answerFor(options.area, district)
            ? { answered: true as const }
            : {}),
          choices: [],
          onBallot: false,
          unlisted: false,
          followedSources: 0,
          totalSources: 0,
          sourceIds: new Set(),
          followedIds: new Set(),
          ballotOrder: new Map(),
        };
        races.set(key, race);
      }

      const choiceName = position.choice ?? "";
      let group = race.choices.find((c) => c.choice === choiceName);
      if (!group) {
        group = {
          choice: choiceName,
          positions: [],
          support: 0,
          opposition: 0,
          onBallot: false,
          writeIn: false,
        };
        race.choices.push(group);
      }
      if (position.write_in) group.writeIn = true;
      // How the ballot prints it: a ballot source's wins over whatever came first.
      if (position.subject.ballot && (ballot || !race.ballot))
        race.ballot = position.subject.ballot;
      if (position.ballot && (ballot || !group.ballot)) group.ballot = position.ballot;
      if (check?.resolution.status === "race-unlisted") race.unlisted = true;
      if (
        !group.suggestion &&
        (check?.resolution.status === "unlisted" || check?.resolution.status === "write-in") &&
        check.resolution.suggestion
      )
        group.suggestion = check.resolution.suggestion.name;

      if (ballot) {
        race.onBallot = true;
        group.onBallot = true;
        if (!race.ballotOrder.has(choiceName))
          race.ballotOrder.set(choiceName, race.ballotOrder.size);
        continue;
      }

      race.sourceIds.add(slate.source.id);
      if (followed) race.followedIds.add(slate.source.id);
      group.positions.push({
        source: slate.source,
        stance: position.stance,
        ...(position.statement ? { statement: position.statement } : {}),
        ...(position.rank !== undefined ? { rank: position.rank } : {}),
        valid: slate.valid,
        standing,
        ...(check?.written ? { written: check.written } : {}),
      });
    }
  }

  return [...races.values()]
    .filter((race) => race.onBallot || race.followedIds.size > 0 || options.includeUnfollowed)
    .map(({ sourceIds, followedIds, ballotOrder, ...race }) => {
      if (options.disagree === "side") moveToOtherSide(race);
      // Tallied once every position is where it counts.
      for (const group of race.choices) {
        for (const position of group.positions) {
          if (position.standing === "off") continue;
          const tone = positionTone(position);
          if (tone === "for") group.support++;
          else if (tone === "against") group.opposition++;
        }
      }
      return { race, followedIds, sourceIds, ballotOrder };
    })
    .map(({ race, followedIds, sourceIds, ballotOrder }) => ({
      ...race,
      followedSources: followedIds.size,
      totalSources: sourceIds.size,
      choices: race.choices
        .map((group) => ({
          ...group,
          ...(ballotOrder.has(group.choice) ? { ballotIndex: ballotOrder.get(group.choice) } : {}),
          positions: [...group.positions].sort(
            (a, b) =>
              STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
              collator.compare(a.source.name, b.source.name),
          ),
        }))
        .sort(
          (a, b) =>
            b.support - a.support ||
            a.opposition - b.opposition ||
            (ballotOrder.get(a.choice) ?? Number.POSITIVE_INFINITY) -
              (ballotOrder.get(b.choice) ?? Number.POSITIVE_INFINITY) ||
            collator.compare(a.choice, b.choice),
        ),
    }))
    .sort(compareRaces);
}

/**
 * Each race's `district` or `voted_in` (`field`), by subject key: a ballot
 * source's (it says what's on whose ballot, SPEC §8.2), else the first slate's
 * that gives one.
 */
function placesOf<T>(
  slates: DecodedSlate[],
  field: (subject: Subject) => T | undefined,
): Map<string, T> {
  const out = new Map<string, T>();
  const fromBallot = new Set<string>();
  for (const slate of slates) {
    const ballot = isBallotSource(slate.source);
    for (const { subject } of slate.payload.positions) {
      const value = field(subject);
      if (value === undefined) continue;
      const key = subjectKey(subject);
      if (fromBallot.has(key) || (!ballot && out.has(key))) continue;
      out.set(key, value);
      if (ballot) fromBallot.add(key);
    }
  }
  return out;
}

/** Ballot order: by jurisdiction (statewide, districts, local), offices before measures, then title. */
export function compareRaces(a: Race, b: Race): number {
  return (
    jurisdictionRank(a.jurisdiction) - jurisdictionRank(b.jurisdiction) ||
    collator.compare(jurisdictionLabel(a.jurisdiction), jurisdictionLabel(b.jurisdiction)) ||
    Number(a.subject.kind === "measure") - Number(b.subject.kind === "measure") ||
    collator.compare(a.subject.title, b.subject.title)
  );
}

export interface ElectionSummary {
  date: string;
  races: number;
  sources: number;
  followedSources: number;
}

/** Every election the imported slates cover, oldest first. Ballot sources count as races, not sources. */
export function electionsOf(
  slates: DecodedSlate[],
  follows: Record<string, Standing>,
): ElectionSummary[] {
  const by = new Map<string, { races: Set<string>; sources: Set<string>; followed: Set<string> }>();
  for (const slate of slates) {
    const ballot = isBallotSource(slate.source);
    for (const position of slate.payload.positions) {
      const date = electionOf(position.subject, slate.payload);
      if (!date) continue;
      const entry = by.get(date) ?? { races: new Set(), sources: new Set(), followed: new Set() };
      entry.races.add(subjectKey(position.subject));
      if (!ballot) {
        entry.sources.add(slate.source.id);
        if (isFollowed(follows, slate.source.id)) entry.followed.add(slate.source.id);
      }
      by.set(date, entry);
    }
  }
  return [...by.entries()]
    .map(([date, e]) => ({
      date,
      races: e.races.size,
      sources: e.sources.size,
      followedSources: e.followed.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The election to show when the user hasn't picked one: the next upcoming one
 * their followed sources cover, else the next upcoming one, else the latest.
 */
export function defaultElection(elections: ElectionSummary[], today: string): string | undefined {
  const upcoming = elections.filter((e) => e.date >= today);
  return (
    upcoming.find((e) => e.followedSources > 0)?.date ?? upcoming[0]?.date ?? elections.at(-1)?.date
  );
}

export interface AreaOptions {
  /** Locality paths, most races first (the big cities lead), then by label. */
  localities: string[];
  /** `<state>/<family>` → district numbers present, ascending. */
  districts: Record<string, string[]>;
}

/**
 * The localities and districts that races in these slates (optionally one
 * election) cover. Each item counts once, or `count` times when it stands for
 * several races (a catalog's per-jurisdiction summary).
 */
export function areaOptionsOf(
  positions: Iterable<{ jurisdiction?: string; count?: number }>,
): AreaOptions {
  const localities = new Map<string, number>();
  const districts = new Map<string, Set<string>>();
  for (const { jurisdiction, count = 1 } of positions) {
    const part = parseJurisdiction(jurisdiction);
    if (part.kind === "local") {
      localities.set(part.path, (localities.get(part.path) ?? 0) + count);
    }
    if (part.kind === "district") {
      const family = `${part.state}/${part.family}`;
      const set = districts.get(family) ?? new Set();
      set.add(part.number);
      districts.set(family, set);
    }
  }
  return {
    localities: [...localities.entries()]
      .sort(
        ([a, an], [b, bn]) =>
          bn - an || collator.compare(jurisdictionLabel(a), jurisdictionLabel(b)),
      )
      .map(([path]) => path),
    districts: Object.fromEntries(
      [...districts.entries()]
        .sort(([a], [b]) => jurisdictionRank(`${a}-1`) - jurisdictionRank(`${b}-1`))
        .map(([family, numbers]) => [family, [...numbers].sort((a, b) => Number(a) - Number(b))]),
    ),
  };
}

/**
 * Position jurisdictions of some slates, for `areaOptionsOf`: where each is
 * voted, so a regional race offers the counties that vote on it
 * (`voted_in`), not the region as a place to live.
 */
export function positionJurisdictions(
  slates: DecodedSlate[],
  election?: string,
): Array<{ jurisdiction?: string }> {
  const out: Array<{ jurisdiction?: string }> = [];
  for (const slate of slates) {
    for (const position of slate.payload.positions) {
      if (election && electionOf(position.subject, slate.payload) !== election) continue;
      const { subject } = position;
      for (const jurisdiction of subject.voted_in ?? [
        subject.jurisdiction ?? slate.payload.context?.jurisdiction,
      ]) {
        out.push({ jurisdiction });
      }
    }
  }
  return out;
}
