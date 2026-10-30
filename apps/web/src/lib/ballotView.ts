import type { Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "./ballotDraft";
import {
  type ChoiceGroup,
  CONTEST_GROUPS,
  type ContestGroup,
  comparePositions,
  contestGroup,
  positionTone,
  type Race,
  stanceTone,
  tallyPositions,
} from "./collate";

/**
 * A race laid out the way the printed ballot shows it: the official order,
 * Yes / No for every measure, and how many to vote for. Pure; unit-tested in
 * test/ballotView.test.ts.
 *
 * `collateRaces` orders choices by support (what the card's "your sources
 * agree" line wants); this is the order a voter sees in the booth.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const MEASURE_CHOICES = ["Yes", "No"] as const;

/** The same stance, said about the other side of a yes/no question. */
const FLIPPED: Partial<Record<Stance, Stance>> = {
  endorse: "oppose",
  oppose: "endorse",
  lean_for: "lean_against",
  lean_against: "lean_for",
};

function isYesNoChoice(choice: string): boolean {
  return MEASURE_CHOICES.some((c) => c.toLowerCase() === choice.toLowerCase());
}

/**
 * A yes/no question: a measure, or a race whose only choices are Yes and No
 * (a judge's retention: "Retain Justice …?"). The ballot shows two bubbles.
 */
export function isYesNo(race: Race): boolean {
  if (race.subject.kind === "measure") return true;
  const named = race.choices.filter((c) => c.choice !== "");
  return named.length > 0 && named.every((c) => isYesNoChoice(c.choice));
}

/**
 * A measure's positions, folded onto Yes and No: "oppose No" backs Yes, and a
 * stance on the measure with no choice named ("endorse Prop 1") is a Yes or a
 * No. So the number by each bubble is everyone who'd fill that bubble.
 */
function measureChoices(race: Race): ChoiceGroup[] {
  const rows = new Map<string, ChoiceGroup>(
    MEASURE_CHOICES.map((choice) => [
      choice,
      { choice, positions: [], support: 0, opposition: 0, onBallot: race.onBallot, writeIn: false },
    ]),
  );
  const extra: ChoiceGroup[] = [];
  for (const group of race.choices) {
    const named = MEASURE_CHOICES.find((c) => c.toLowerCase() === group.choice.toLowerCase());
    if (!named && group.choice !== "") {
      extra.push(group);
      continue;
    }
    const own = named ? rows.get(named) : undefined;
    if (own) {
      own.onBallot ||= group.onBallot;
      if (group.ballotIndex !== undefined) own.ballotIndex = group.ballotIndex;
    }
    for (const position of group.positions) {
      const tone = stanceTone(position.stance);
      const flipped = FLIPPED[position.stance];
      if (named) {
        // "against Yes" is "for No"; anything else stays where it was said.
        if (tone === "against" && flipped) {
          rows
            .get(named === "Yes" ? "No" : "Yes")
            ?.positions.push({ ...position, stance: flipped });
        } else own?.positions.push(position);
      } else if (tone === "for") rows.get("Yes")?.positions.push(position);
      else if (tone === "against" && flipped) {
        rows.get("No")?.positions.push({ ...position, stance: flipped });
      }
      // A neutral word on the measure as a whole has no bubble to sit by.
    }
  }
  const folded = [...rows.values()].map((row) => {
    // A source that said "Yes" and also endorsed the measure counts once.
    const positions = row.positions
      .filter((p, i) => row.positions.findIndex((q) => q.source.id === p.source.id) === i)
      .sort(comparePositions);
    return { ...row, ...tallyPositions(positions), positions };
  });
  return [...folded, ...extra];
}

/** Choices in the order the ballot prints them. */
export function ballotChoices(race: Race): ChoiceGroup[] {
  if (isYesNo(race)) return measureChoices(race);
  // On the ballot list first, as listed; then names only sources mention
  // (most backed first); a stance on the race as a whole last.
  return [...race.choices].sort(
    (a, b) =>
      Number(a.choice === "") - Number(b.choice === "") ||
      (a.ballotIndex ?? Number.POSITIVE_INFINITY) - (b.ballotIndex ?? Number.POSITIVE_INFINITY) ||
      b.support - a.support ||
      a.opposition - b.opposition ||
      collator.compare(a.choice, b.choice),
  );
}

/** What a section's subheading calls each group: people to elect, judges to keep, measures. */
export const CONTEST_GROUP_LABEL: Record<ContestGroup, string> = {
  office: "Candidates",
  retention: "Judges",
  measure: "Measures",
};

/**
 * A section's races split into candidates, judges and measures, in that
 * order, each keeping the races' own order. Empty groups are left out.
 */
export function contestGroups<R extends Race>(
  races: R[],
): Array<{ group: ContestGroup; label: string; races: R[] }> {
  return CONTEST_GROUPS.map((group) => ({
    group,
    label: CONTEST_GROUP_LABEL[group],
    races: races.filter((race) => contestGroup(race) === group),
  })).filter((g) => g.races.length > 0);
}

/** How the ballot heads a race. */
export interface RaceHeading {
  /** "Proposition 43", "Attorney General". */
  heading: string;
  /** Printed under it: a measure's label, a retention question. */
  label?: string;
  /** "Initiative Statute". */
  measureType?: string;
  /** A measure's number or letter: "43", "A". */
  number?: string;
}

/**
 * How the ballot heads a race: the listing's `ballot` (SPEC §3.14), else the
 * race's title. Nothing is read out of the title's wording.
 */
export function raceHeading(race: Pick<Race, "subject" | "ballot">): RaceHeading {
  const ballot = race.ballot;
  if (!ballot?.heading) {
    return {
      heading: race.subject.title,
      ...(ballot?.label ? { label: ballot.label } : {}),
      ...(ballot?.measure_type ? { measureType: ballot.measure_type } : {}),
      ...(ballot?.number ? { number: ballot.number } : {}),
    };
  }
  // A measure the listing gives no label for (only "Measure N") keeps its title as the
  // line under the heading, so it still says what it's about.
  const label = ballot.label ?? (race.subject.kind === "measure" ? race.subject.title : undefined);
  return {
    heading: ballot.heading,
    ...(label ? { label } : {}),
    ...(ballot.measure_type ? { measureType: ballot.measure_type } : {}),
    ...(ballot.number ? { number: ballot.number } : {}),
  };
}

/** What the print card offers: the whole ballot, or only the races I marked. */
export type PrintScope = "ballot" | "marked";

/** Whether the user marked anything on this race (a pick, maybe, against). */
export function isMarked(race: Race, election: string, rows: Record<string, DraftRow>): boolean {
  return ballotChoices(race).some(
    (c) => rows[rowIdFor(election, race.subject, c.choice || undefined)]?.stance,
  );
}

/**
 * How many choices a voter may mark in this race: the ballot's "Vote for
 * One" line, from `ballot.vote_for` (SPEC §3.14). None for a yes/no
 * question, whose two bubbles say it, or a ranked-choice race (`ranksFor`).
 * Unknown when no listing says: a board race can fill several seats, so
 * guessing one would mislead.
 */
export function voteFor(race: Race): number | undefined {
  if (isYesNo(race) || race.ballot?.ranks) return undefined;
  return race.ballot?.vote_for;
}

/** A ranked-choice race: how many choices a voter may rank (`ballot.ranks`). */
export function ranksFor(race: Race): number | undefined {
  return isYesNo(race) ? undefined : race.ballot?.ranks;
}

/**
 * One line on where a voter's sources stand, for a race on My ballot. "Leaning"
 * needs a source the voter counts more or less than once to be taking a side,
 * so a ballot with no numbers set reads as it always has, and a race with one
 * winner: in a vote-for-three, several choices can all be right.
 */
export function sourcesVerdict(race: Race): string {
  const [top, next] = race.choices
    .filter((c) => c.support > 0)
    .sort((a, b) => b.support - a.support);
  if (!top) return "";
  const name = top.choice || "for";
  if (!next) return `your sources agree: ${name}`;
  const oneWinner = isYesNo(race) || ranksFor(race) !== undefined || voteFor(race) === 1;
  const weighted = race.choices.some((c) =>
    c.positions.some((p) => p.times !== undefined && positionTone(p) !== "neutral"),
  );
  return oneWinner && weighted && top.support > next.support
    ? `your sources split, leaning ${name}`
    : "your sources split";
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** The line a California ballot prints under the office: "Vote for one", "Vote for no more than three". */
export function voteForLine(count: number): string {
  const word = NUMBER_WORDS[count] ?? String(count);
  return count === 1 ? "Vote for one" : `Vote for no more than ${word}`;
}

/** The line for a ranked-choice race: "Rank up to ten choices". */
export function ranksLine(count: number): string {
  return `Rank up to ${NUMBER_WORDS[count] ?? String(count)} choices`;
}

/** The race's instruction line, if the ballot prints one. */
export function instructionLine(race: Race): string | undefined {
  const ranks = ranksFor(race);
  if (ranks) return ranksLine(ranks);
  const seats = voteFor(race);
  return seats === undefined ? undefined : voteForLine(seats);
}

/**
 * What the ballot prints with a candidate's name: party, designation, and
 * whether they're the incumbent (`ballot`, SPEC §3.14).
 */
export function designation(choice: Pick<ChoiceGroup, "ballot">): string | undefined {
  const ballot = choice.ballot;
  if (!ballot) return undefined;
  const parts = [ballot.party, ballot.designation, ballot.incumbent ? "incumbent" : undefined];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** Names the user wrote in on this race that no source or listing names. */
export function writeInRows(
  rows: Record<string, DraftRow>,
  race: Race,
  election: string,
): DraftRow[] {
  const prefix = rowIdFor(election, race.subject, "");
  const named = new Set(race.choices.map((c) => c.choice));
  return Object.values(rows).filter(
    (row) => row.writeIn && row.choice && row.id.startsWith(prefix) && !named.has(row.choice),
  );
}

/** How many choices on this race the user picked (filled bubbles), names they wrote in included. */
export function picksIn(race: Race, election: string, rows: Record<string, DraftRow>): number {
  const listed = ballotChoices(race).filter(
    (c) => rows[rowIdFor(election, race.subject, c.choice || undefined)]?.stance === "endorse",
  ).length;
  const written = writeInRows(rows, race, election).filter((row) => row.stance === "endorse");
  return listed + written.length;
}

/** The class a choice's row takes: picked, ruled out, a backup. */
export function choiceRowClass(stance: Stance | undefined, backup = false): string {
  return `choice-row${stance === "endorse" ? " picked" : ""}${stance === "oppose" ? " ruled-out" : ""}${backup ? " backup" : ""}`;
}

/** "1st", "2nd", "3rd", "11th": a rank as it's read. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
