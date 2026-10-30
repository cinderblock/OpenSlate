import { choiceKey, samePerson } from "@openslate/core";
import { type DraftRow, NOTE_CHOICE } from "./ballotDraft";
import { ballotChoices, isYesNo, ranksFor, voteFor } from "./ballotView";
import {
  type ContestGroup,
  contestGroup,
  type Race,
  type RacePosition,
  stanceTone,
  twoWayOptions,
} from "./collate";
import { type Area, isAreaSet, placeRace } from "./jurisdictions";
import type { Source } from "./sources";
import { subjectKey } from "./subjects";

/**
 * How a voter's picks line up with each endorser's, race by race. Pure (no
 * React, no storage, nothing sent anywhere); unit-tested in
 * test/alignment.test.ts. plans/ballot-alignment.md has the reasoning.
 *
 * The unit is a race. Every race counts once however many seats it fills, so
 * the result stays what a voter could check by hand: "agreed on 12 of 14".
 *
 * Two picks conflict only when they can't both be on one ballot. Picking A
 * while an endorser backs B is a disagreement in a vote-for-one, and nothing
 * at all in a vote-for-three: both fit. Neutral and abstain are declining to
 * weigh in, not disagreeing. Neither counts for or against anyone.
 */

const YES_NO = ["Yes", "No"] as const;

/** A voter's Maybe, or a conflict resting on a guessed seat count: half a race. */
const SOFT = 0.5;

// ---------------------------------------------------------------------------
// The voter's side

/** What a voter marked on one race. */
export interface VoterMarks {
  /** Names they back, first choice first. */
  backed: string[];
  /** Names they're against. */
  opposed: string[];
  /** Nothing firm: only Maybes (or a lean against). */
  soft: boolean;
}

/** One voter's marks by `subjectKey`, in one election. Notes and neutral stances aren't marks. */
export function marksByRace(
  rows: Record<string, DraftRow>,
  election: string,
  rankings: Record<string, string[]> = {},
): Map<string, VoterMarks> {
  const byRace = new Map<string, DraftRow[]>();
  for (const row of Object.values(rows)) {
    if (row.electionId !== election || row.choice === NOTE_CHOICE || !row.stance) continue;
    const key = subjectKey(row.subject);
    byRace.set(key, [...(byRace.get(key) ?? []), row]);
  }
  const out = new Map<string, VoterMarks>();
  for (const [key, list] of byRace) {
    const marks = marksFrom(list, rankings[`${election}|${key}`]);
    if (marks) out.set(key, marks);
  }
  return out;
}

function marksFrom(rows: DraftRow[], ranking: string[] | undefined): VoterMarks | undefined {
  const firm: string[] = [];
  const maybe: string[] = [];
  const opposed: string[] = [];
  let softAgainst = false;
  for (const { choice, stance } of rows) {
    if (!stance) continue;
    const tone = stanceTone(stance);
    if (tone === "neutral") continue;
    // A mark on a measure as a whole is a Yes (for) or a No (against).
    const name = choice ?? (tone === "for" ? "Yes" : "No");
    if (tone === "against" && choice === undefined) firm.push(name);
    else if (tone === "against") {
      opposed.push(name);
      if (stance === "lean_against") softAgainst = true;
    } else if (stance === "endorse") firm.push(name);
    else maybe.push(name);
  }
  // A Maybe beside a pick is a backup: the pick is the vote.
  const backed = firm.length > 0 ? firm : maybe;
  if (backed.length === 0 && opposed.length === 0) return undefined;
  const order = (ranking ?? []).filter((name) => backed.includes(name));
  return {
    backed: [...order, ...backed.filter((name) => !order.includes(name))],
    opposed,
    soft: firm.length === 0 && (maybe.length > 0 || softAgainst),
  };
}

// ---------------------------------------------------------------------------
// Each race, read once

/** What one source says on one race. */
interface Stand {
  source: Source;
  /** Names it backs → its rank, when it gives one. */
  backed: Map<string, number | undefined>;
  opposed: Set<string>;
  /** It said neutral or abstain, or backed both sides of a yes/no question. */
  declined: boolean;
  /** Who it took this position on from (SPEC §3.10), when it did. */
  via?: string;
  /** Its own words for the position (SPEC §3.17). */
  label?: string;
}

interface RaceFacts {
  /** A yes/no question, or two names on the ballot: picking one is against the other. */
  pair?: readonly [string, string];
  /** How many a voter may mark. Undefined in a ranked-choice race. */
  seats: number;
  /** A listing says how many, or the race is a choice between two. */
  seatsKnown: boolean;
  /** The voter may rank this many. */
  ranks?: number;
  stands: Map<string, Stand>;
  /** The spelling this race uses for a name. */
  spelled: (name: string) => string;
}

const facts = new WeakMap<Race, RaceFacts>();

function factsOf(race: Race): RaceFacts {
  const known = facts.get(race);
  if (known) return known;
  const spelled = spellings(race);
  const yesNo = isYesNo(race);
  const stands = new Map<string, Stand>();
  const groups = yesNo ? ballotChoices(race) : race.choices;
  for (const { choice, positions } of groups) {
    for (const position of positions) {
      if (position.valid) addPosition(stands, position, choice ? spelled(choice) : "");
    }
  }
  // `ballotChoices` has no row for a neutral word on a measure as a whole.
  if (yesNo) {
    for (const position of race.choices.find((c) => c.choice === "")?.positions ?? []) {
      if (position.valid && stanceTone(position.stance) === "neutral")
        addPosition(stands, position, "");
    }
  }
  const mostBacked = Math.max(1, ...[...stands.values()].map((s) => s.backed.size));
  const listed = voteFor(race);
  const ranks = ranksFor(race);
  const options = yesNo ? YES_NO : twoWayOptions(race);
  // Two names for two seats aren't a choice between them.
  const pair = !ranks && options && (listed ?? 1) === 1 ? options : undefined;
  if (pair) {
    for (const stand of stands.values()) {
      for (const name of stand.opposed) {
        const other = name === pair[0] ? pair[1] : name === pair[1] ? pair[0] : undefined;
        if (other) stand.backed.set(other, undefined);
      }
      stand.opposed.clear();
      // Both sides of the same question says nothing about either.
      if (stand.backed.has(pair[0]) && stand.backed.has(pair[1])) {
        stand.backed.clear();
        stand.declined = true;
      }
    }
  }
  const out: RaceFacts = {
    ...(pair ? { pair } : {}),
    seats: listed ?? (pair ? 1 : mostBacked),
    seatsKnown: listed !== undefined || pair !== undefined,
    ...(ranks ? { ranks } : {}),
    stands,
    spelled,
  };
  facts.set(race, out);
  return out;
}

function addPosition(stands: Map<string, Stand>, position: RacePosition, choice: string) {
  const { source, stance, rank, via, label } = position;
  const stand = stands.get(source.id) ?? {
    source,
    backed: new Map<string, number | undefined>(),
    opposed: new Set<string>(),
    declined: false,
  };
  stands.set(source.id, stand);
  const tone = stanceTone(stance);
  // A name-less "endorse" on an office names nobody to compare.
  if (tone === "neutral" || choice === "") {
    stand.declined = true;
    return;
  }
  if (tone === "for") stand.backed.set(choice, rank);
  else stand.opposed.add(choice);
  if (via) stand.via = via;
  if (label) stand.label = label;
}

/**
 * One spelling per person within a race: the first it uses for them. Slates
 * translated against a ballot listing already agree (`translateSlates`); this
 * catches a race no listing covers, and a voter's name from before one came.
 */
function spellings(race: Race): (name: string) => string {
  const names = race.choices.map((c) => c.choice).filter(Boolean);
  const memo = new Map<string, string>();
  return (name) => {
    const seen = memo.get(name);
    if (seen !== undefined) return seen;
    const key = choiceKey(name);
    const same =
      names.find((n) => choiceKey(n) === key) ?? names.find((n) => samePerson(n, name)) ?? name;
    memo.set(name, same);
    return same;
  };
}

/** The voter's marks in the race's spelling, with a two-way "against A" made "for B". */
function normalized(marks: VoterMarks, race: RaceFacts): VoterMarks {
  const backed = marks.backed.map(race.spelled);
  let opposed = marks.opposed.map(race.spelled);
  const { pair } = race;
  if (pair) {
    for (const name of opposed) {
      const other = name === pair[0] ? pair[1] : name === pair[1] ? pair[0] : undefined;
      if (other && !backed.includes(other)) backed.push(other);
    }
    opposed = [];
  }
  return { backed, opposed, soft: marks.soft };
}

// ---------------------------------------------------------------------------
// One race, one source

/**
 * How one race came out against one source. `agree`, `partly` and `differ` are
 * scored. `compatible`: both spoke, but what they said fits on one ballot.
 * `declined`: the source took no position (neutral, abstain).
 */
export type Verdict = "agree" | "partly" | "differ" | "compatible" | "declined";

export interface RaceResult {
  race: Race;
  verdict: Verdict;
  /** The share of this race agreed on, 0 to 1. */
  score: number;
  /** What the race counts for: 1, or less for a voter's Maybe or a guessed seat count. */
  weight: number;
  /** The voter's names. */
  mine: string[];
  /** Names the voter is against. */
  against: string[];
  /** The source's names. */
  theirs: string[];
  /** Names the source opposes. */
  theirsAgainst: string[];
  /** The source's own word for its position. */
  label?: string;
  /** Who the source took this position on from. */
  via?: string;
  /** It counts half because the voter's mark is a Maybe. */
  maybe?: true;
  /** It counts half because no listing says how many seats there are. */
  guessedSeats?: true;
}

function sizeOfCommon(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) if (b.has(item)) count++;
  return count;
}

/**
 * Names that can't share a ballot: everyone named, less the seats there are,
 * and never more than the smaller side's unshared names (a list longer than
 * the seats, like a dual endorsement, doesn't conflict with itself).
 */
export function seatConflicts(mine: Set<string>, theirs: Set<string>, seats: number): number {
  const common = sizeOfCommon(mine, theirs);
  const mineOnly = mine.size - common;
  const theirsOnly = theirs.size - common;
  const everyone = mine.size + theirs.size - common;
  return Math.max(0, Math.min(everyone - seats, mineOnly, theirsOnly));
}

/** A source's first choices: its lowest rank, or everything it backs when it doesn't rank. */
function firstChoices(backed: Map<string, number | undefined>): string[] {
  const ranks = [...backed.values()].filter((rank): rank is number => rank !== undefined);
  if (ranks.length === 0) return [...backed.keys()];
  const first = Math.min(...ranks);
  return [...backed].filter(([, rank]) => rank === first).map(([name]) => name);
}

function compare(race: Race, info: RaceFacts, marks: VoterMarks, stand: Stand): RaceResult {
  const mine = new Set(marks.backed);
  const against = new Set(marks.opposed);
  const theirs = new Set(stand.backed.keys());
  const base = {
    race,
    mine: marks.backed,
    against: marks.opposed,
    theirs: [...theirs],
    theirsAgainst: [...stand.opposed],
    ...(stand.label ? { label: stand.label } : {}),
    ...(stand.via ? { via: stand.via } : {}),
  };
  if (theirs.size === 0 && stand.opposed.size === 0) {
    return { ...base, verdict: "declined", score: 0, weight: 0 };
  }

  let agreements = sizeOfCommon(against, stand.opposed);
  let conflicts = sizeOfCommon(mine, stand.opposed) + sizeOfCommon(against, theirs);
  if (info.ranks) {
    // A ranked ballot fits everyone, so what matters is who comes first.
    if (mine.size > 0 && theirs.size > 0) {
      if (firstChoices(stand.backed).includes(marks.backed[0] as string)) agreements += 1;
      else if (sizeOfCommon(mine, theirs) > 0) {
        agreements += 0.5;
        conflicts += 0.5;
      } else conflicts += 1;
    }
  } else {
    agreements += sizeOfCommon(mine, theirs);
    conflicts += seatConflicts(mine, theirs, info.seats);
  }

  const total = agreements + conflicts;
  if (total === 0) return { ...base, verdict: "compatible", score: 0, weight: 0 };
  const score = agreements / total;
  const guessedSeats = conflicts > 0 && !info.seatsKnown && !info.ranks;
  return {
    ...base,
    verdict: score === 1 ? "agree" : score === 0 ? "differ" : "partly",
    score,
    weight: (marks.soft ? SOFT : 1) * (guessedSeats ? SOFT : 1),
    ...(marks.soft ? { maybe: true as const } : {}),
    ...(guessedSeats ? { guessedSeats: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// Confidence

/**
 * The Wilson score interval for `agreed` out of `total`, at about 95%. It's
 * what stops two races at 100% outranking forty at 90%: 2 of 2 could easily be
 * luck, 36 of 40 can't. Races aren't independent draws (an org's picks run
 * together), so this ranks; it isn't a probability to quote.
 */
export function wilson(agreed: number, total: number): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = agreed / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

// ---------------------------------------------------------------------------
// One source, every race

export interface GroupCount {
  agree: number;
  /** Scored races: agree, partly, differ. */
  total: number;
}

/** A source's record against the voter. */
export interface Alignment {
  source: Source;
  /** Every marked race the source spoke to. */
  results: RaceResult[];
  agree: number;
  partly: number;
  differ: number;
  /** Agree + partly + differ: the races the score rests on. */
  shared: number;
  /** Both spoke, and both fit on one ballot. */
  compatible: number;
  /** Marked races where the source took no position. */
  declined: number;
  /** Weighted races agreed on, and weighted races in all. */
  agreed: number;
  weight: number;
  /** agreed / weight. */
  share: number;
  /** The Wilson interval around `share`. */
  low: number;
  high: number;
  /** Races on the voter's ballot the source took a side on and the voter hasn't marked. */
  open: number;
  /** Races the source took a side on anywhere in this election. */
  reach: number;
  /** Scored races by what they ask. */
  byGroup: Partial<Record<ContestGroup, GroupCount>>;
  /** Scored races it took on from one entity, when that's most of them. */
  repeats?: { of: string; count: number };
}

export interface CompareInput {
  /** Collated races of the election, every source included. */
  races: Race[];
  rows: Record<string, DraftRow>;
  election: string;
  rankings?: Record<string, string[]>;
  area: Area;
  /** Sources not to compare with: the voter's own identities. */
  skip?: ReadonlySet<string>;
}

export interface Comparison {
  /** Races the voter marked. */
  marked: number;
  /** Of those, races at least one source spoke to. */
  matched: number;
  /** Everyone with something to say about the voter's ballot. */
  alignments: Alignment[];
}

function emptyAlignment(source: Source): Alignment {
  return {
    source,
    results: [],
    agree: 0,
    partly: 0,
    differ: 0,
    shared: 0,
    compatible: 0,
    declined: 0,
    agreed: 0,
    weight: 0,
    share: 0,
    low: 0,
    high: 1,
    open: 0,
    reach: 0,
    byGroup: {},
  };
}

/** Compare the voter's marks with every source in `races`. */
export function compareBallot({
  races,
  rows,
  election,
  rankings,
  area,
  skip,
}: CompareInput): Comparison {
  const marks = marksByRace(rows, election, rankings);
  const by = new Map<string, Alignment>();
  const entry = (source: Source) => {
    const known = by.get(source.id);
    if (known) return known;
    const fresh = emptyAlignment(source);
    by.set(source.id, fresh);
    return fresh;
  };

  // With no area set, "your ballot" is wherever the voter has marked something.
  const marked = races.filter((race) => marks.has(race.key));
  const places = new Set(marked.map((race) => race.jurisdiction));
  const onBallot = (race: Race) =>
    isAreaSet(area)
      ? placeRace(race.jurisdiction, race.district, area, race.votedIn) === "in"
      : places.has(race.jurisdiction);

  let matched = 0;
  for (const race of races) {
    const info = factsOf(race);
    const mark = marks.get(race.key);
    const mine = mark ? normalized(mark, info) : undefined;
    const open = !mine && onBallot(race);
    let spoken = false;
    for (const stand of info.stands.values()) {
      if (skip?.has(stand.source.id)) continue;
      const sided = stand.backed.size > 0 || stand.opposed.size > 0;
      if (sided) entry(stand.source).reach++;
      if (mine) {
        const result = compare(race, info, mine, stand);
        record(entry(stand.source), result);
        if (result.verdict !== "declined") spoken = true;
      } else if (sided && open) entry(stand.source).open++;
    }
    if (spoken) matched++;
  }

  const alignments = [...by.values()].filter(
    (a) => a.shared + a.compatible + a.declined + a.open > 0,
  );
  for (const alignment of alignments) finish(alignment);
  return { marked: marks.size, matched, alignments };
}

function record(alignment: Alignment, result: RaceResult) {
  alignment.results.push(result);
  const { verdict } = result;
  if (verdict === "compatible" || verdict === "declined") {
    alignment[verdict]++;
    return;
  }
  alignment[verdict]++;
  alignment.shared++;
  alignment.agreed += result.score * result.weight;
  alignment.weight += result.weight;
  const group = contestGroup(result.race);
  const count = alignment.byGroup[group] ?? { agree: 0, total: 0 };
  alignment.byGroup[group] = count;
  count.total++;
  if (verdict === "agree") count.agree++;
}

function finish(alignment: Alignment) {
  const { agreed, weight, shared } = alignment;
  alignment.share = weight > 0 ? agreed / weight : 0;
  const { low, high } = wilson(agreed, weight);
  alignment.low = low;
  alignment.high = high;
  const from = new Map<string, number>();
  for (const { via, verdict } of alignment.results) {
    if (via && verdict !== "compatible" && verdict !== "declined") {
      from.set(via, (from.get(via) ?? 0) + 1);
    }
  }
  const [top] = [...from].sort((a, b) => b[1] - a[1]);
  if (top && top[1] * 2 > shared) alignment.repeats = { of: top[0], count: top[1] };
}

// ---------------------------------------------------------------------------
// The groups

/** Fewest scored races before anyone is called mixed: 1 of 2 is no signal at all. */
export const MIXED_MIN_RACES = 6;
/** How far from an even split still counts as mixed. */
export const MIXED_BAND = 0.15;
/** Fewest marked races before there's a "what this voter cares about" to look away from. */
export const ELSEWHERE_MIN_MARKS = 5;
/** Fewest unmarked races before an endorser counts as looking elsewhere. */
export const ELSEWHERE_MIN_OPEN = 3;
/** The most of the voter's races an endorser can speak to and still be looking elsewhere. */
export const ELSEWHERE_MAX_COVERAGE = 0.25;

/** An endorser, with any others that come to the same thing on the voter's races. */
export interface AlignmentRow extends Alignment {
  /** Endorsers with this record on every race, and ones repeating this endorser's list. */
  folded: Alignment[];
}

export interface AlignmentGroups {
  /** Agrees more than not, surest first. */
  aligned: AlignmentRow[];
  /** Disagrees more than not, surest first. */
  opposed: AlignmentRow[];
  /** About half and half on enough races to say so, the most even and surest first. */
  mixed: AlignmentRow[];
  /** Active on the voter's ballot, on races other than the ones they've marked. */
  elsewhere: AlignmentRow[];
}

/** One record: the races scored and how each came out, so identical ones can fold together. */
function recordOf(alignment: Alignment): string {
  return alignment.results
    .filter((r) => r.verdict !== "compatible" && r.verdict !== "declined")
    .map((r) => `${r.race.key}\u0000${r.verdict}\u0000${[...r.theirs].sort().join("\u0001")}`)
    .sort()
    .join("\u0002");
}

/**
 * One row per record, then any that mostly repeat a list (`repeats`) under the
 * endorser they repeat, when it's there: a republished list is one opinion.
 * The sort decides which of several shows.
 */
function foldRows(
  alignments: Alignment[],
  first: (a: Alignment, b: Alignment) => number,
): AlignmentRow[] {
  const records = new Map<string, Alignment[]>();
  for (const alignment of alignments) {
    const record = recordOf(alignment);
    records.set(record, [...(records.get(record) ?? []), alignment]);
  }
  const rows = [...records.values()].map((same): AlignmentRow => {
    // Whoever's list it is shows, never one repeating it.
    const names = new Set(same.map((a) => a.source.name));
    const repeater = (a: Alignment) => Number(names.has(a.repeats?.of ?? ""));
    const [top, ...rest] = [...same].sort((a, b) => repeater(a) - repeater(b) || first(a, b));
    return { ...(top as Alignment), folded: rest };
  });
  const byEntity = new Map(rows.map((row) => [row.source.name, row]));
  return rows.filter((row) => {
    const target = row.repeats ? byEntity.get(row.repeats.of) : undefined;
    if (!target || target === row) return true;
    target.folded.push(row, ...row.folded);
    return false;
  });
}

/**
 * Sort a comparison into its groups. An endorser sits in one at most.
 *
 * "Orthogonal" turns out to be two different things, and each gets a group:
 * `mixed` is an endorser that speaks to the voter's races and comes out even;
 * `elsewhere` is one whose attention is on other races. Neither is a verdict
 * on a few races: 1 of 2 isn't mixed, and with 3 marks nobody is elsewhere.
 *
 * `prefer` breaks ties, and picks the name shown for a shared record.
 */
export function groupAlignments(
  { alignments, matched }: Pick<Comparison, "alignments" | "matched">,
  prefer: (a: Alignment) => boolean = () => false,
): AlignmentGroups {
  const tie = (a: Alignment, b: Alignment) =>
    Number(prefer(b)) - Number(prefer(a)) ||
    b.reach - a.reach ||
    a.source.name.localeCompare(b.source.name);

  const isElsewhere = (a: Alignment) =>
    matched >= ELSEWHERE_MIN_MARKS &&
    a.open >= ELSEWHERE_MIN_OPEN &&
    a.shared + a.compatible <= ELSEWHERE_MAX_COVERAGE * matched;
  const isMixed = (a: Alignment) =>
    a.shared >= MIXED_MIN_RACES && Math.abs(a.share - 0.5) <= MIXED_BAND;
  /** How far from even it could be: smaller is surer it's mixed. */
  const spread = (a: Alignment) => Math.max(a.high - 0.5, 0.5 - a.low);

  const rows = foldRows(
    alignments.filter((a) => a.shared > 0 && !isElsewhere(a)),
    tie,
  );
  const placed = rows.filter((a) => !isMixed(a));
  return {
    aligned: placed.filter((a) => a.share > 0.5).sort((a, b) => b.low - a.low || tie(a, b)),
    opposed: placed.filter((a) => a.share < 0.5).sort((a, b) => a.high - b.high || tie(a, b)),
    mixed: rows.filter(isMixed).sort((a, b) => spread(a) - spread(b) || tie(a, b)),
    // Nothing to fold: having next to no record in common doesn't make two the same.
    elsewhere: alignments
      .filter(isElsewhere)
      .map((a) => ({ ...a, folded: [] }))
      .sort((a, b) => b.open - a.open || tie(a, b)),
  };
}

/**
 * Where a source's record splits by what's being asked: its best and worst
 * groups, when each has enough races and they're far apart. It's how a mixed
 * record says it's about something ("measures yes, candidates no").
 */
export function splitOf(
  alignment: Alignment,
): { high: [ContestGroup, GroupCount]; low: [ContestGroup, GroupCount] } | undefined {
  const groups = (Object.entries(alignment.byGroup) as Array<[ContestGroup, GroupCount]>)
    .filter(([, count]) => count.total >= 3)
    .sort(([, a], [, b]) => b.agree / b.total - a.agree / a.total);
  const high = groups[0];
  const low = groups.at(-1);
  if (!high || !low || high === low) return undefined;
  const gap = high[1].agree / high[1].total - low[1].agree / low[1].total;
  return gap >= 0.5 ? { high, low } : undefined;
}

/** How much a comparison rests on, for its headline. */
export type Evidence = "early" | "building" | "solid";

export function evidenceOf(matched: number): Evidence {
  if (matched < 5) return "early";
  return matched < 15 ? "building" : "solid";
}
