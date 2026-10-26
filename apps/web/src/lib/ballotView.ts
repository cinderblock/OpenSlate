import type { Stance } from "@openslate/core";
import { type DraftRow, rowIdFor } from "./ballotDraft";
import {
  type ChoiceGroup,
  type Race,
  type RacePosition,
  STANDING_ORDER,
  positionTone,
  stanceTone,
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

/** As `collateRaces` tallies: followed sources, a disagreed one counting the other way. */
function count(positions: RacePosition[]): Pick<ChoiceGroup, "support" | "opposition"> {
  let support = 0;
  let opposition = 0;
  for (const position of positions) {
    if (position.standing === "off") continue;
    const tone = positionTone(position);
    if (tone === "for") support++;
    else if (tone === "against") opposition++;
  }
  return { support, opposition };
}

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
      .sort(
        (a, b) =>
          STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
          collator.compare(a.source.name, b.source.name),
      );
    return { ...row, ...count(positions), positions };
  });
  return [...folded, ...extra];
}

/**
 * An older ballot listing's note on a measure ("Initiative Statute"), which it
 * repeats on Yes and on No. Only until every listing has `measure_type`
 * (plan C5).
 */
function legacyMeasureNote(race: Race): string | undefined {
  if (!isYesNo(race)) return undefined;
  return race.choices.find((c) => c.ballotNote && isYesNoChoice(c.choice))?.ballotNote;
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
 * How the ballot heads a race: the listing's `ballot` (SPEC §3.14). Until
 * every listing carries it (plan C5), what an older listing put in the title
 * and its notes.
 */
export function raceHeading(race: Pick<Race, "subject" | "ballot" | "choices">): RaceHeading {
  const ballot = race.ballot;
  const old =
    race.subject.kind === "measure"
      ? splitMeasureTitle(race.subject.title)
      : { heading: race.subject.title };
  // A measure the listing gives no label for (only "Measure N") keeps its title as the
  // line under the heading, so it still says what it's about.
  const label = ballot?.heading
    ? (ballot.label ?? (race.subject.kind === "measure" ? race.subject.title : undefined))
    : (ballot?.label ?? old.detail);
  const measureType = ballot?.measure_type ?? legacyMeasureNote(race as Race);
  const number = ballot?.number ?? old.number;
  return {
    heading: ballot?.heading ?? old.heading,
    ...(label ? { label } : {}),
    ...(measureType ? { measureType } : {}),
    ...(number ? { number } : {}),
  };
}

export interface MeasureTitle {
  /** "Proposition 43", or the whole title when it isn't in that shape. */
  heading: string;
  /** The ballot label in the parentheses, if any. */
  detail?: string;
  /** The measure's number or letter ("43", "A"). */
  number?: string;
}

/**
 * Split "California – Proposition 43 (Limits Voters' Ability …)" into the
 * part a ballot prints large and the part it prints small. Only for listings
 * without `ballot` (plan C5).
 */
export function splitMeasureTitle(title: string): MeasureTitle {
  // Case-sensitive on purpose: "Measure on …" isn't Measure ON.
  const match =
    /(?:^|[\s–—-])([Pp]rop(?:osition|\.)?|[Mm]easure)\s*([0-9]+[A-Z]?|[A-Z]{1,2}[0-9]{0,4})\b\s*(?:[(:–—-]\s*(.*?)\)?\s*)?$/.exec(
      title,
    );
  if (!match) return { heading: title };
  const [, word = "", number = "", detail] = match;
  const kind = word.toLowerCase().startsWith("prop") ? "Proposition" : "Measure";
  return {
    heading: `${kind} ${number}`,
    number,
    ...(detail ? { detail: detail.trim() } : {}),
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

/** An older listing's "3 seats" note on each candidate. Only until plan C5. */
const SEATS = /(?:^|\s*·\s*)(\d+) seats?\b/i;

/**
 * How many choices a voter may mark in this race: the ballot's "Vote for
 * One" line, from `ballot.vote_for` (SPEC §3.14). None for a yes/no
 * question, whose two bubbles say it, or a ranked-choice race (`ranksFor`).
 *
 * Until every listing carries `vote_for` (plan C5): an older listing's "N
 * seats" note, else one for an office it lists. Unknown when no ballot
 * source lists the race, since a board race can fill several seats.
 */
export function voteFor(race: Race): number | undefined {
  if (isYesNo(race) || race.ballot?.ranks) return undefined;
  if (race.ballot?.vote_for) return race.ballot.vote_for;
  for (const choice of race.choices) {
    const seats = choice.ballotNote && SEATS.exec(choice.ballotNote)?.[1];
    if (seats) return Number(seats);
  }
  return race.onBallot ? 1 : undefined;
}

/** A ranked-choice race: how many choices a voter may rank (`ballot.ranks`). */
export function ranksFor(race: Race): number | undefined {
  return isYesNo(race) ? undefined : race.ballot?.ranks;
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
 * whether they're the incumbent (`ballot`, SPEC §3.14). Until every listing
 * carries it (plan C5), an older listing's note, minus the seat count (that
 * goes in the race's "Vote for" line rather than under every name).
 */
export function designation(choice: ChoiceGroup): string | undefined {
  const ballot = choice.ballot;
  if (ballot) {
    const parts = [ballot.party, ballot.designation, ballot.incumbent ? "incumbent" : undefined];
    return parts.filter(Boolean).join(" · ") || undefined;
  }
  return choice.ballotNote?.replace(SEATS, "").trim() || undefined;
}

/** How many choices on this race the user picked (filled bubbles). */
export function picksIn(race: Race, election: string, rows: Record<string, DraftRow>): number {
  return ballotChoices(race).filter(
    (c) => rows[rowIdFor(election, race.subject, c.choice || undefined)]?.stance === "endorse",
  ).length;
}
