import { type Stance, matchBallotName } from "@openslate/core";
import { type DraftRow, NOTE_CHOICE, type RowPatch, rowIdFor } from "./ballotDraft";
import {
  ballotChoices,
  designation,
  instructionLine,
  isYesNo,
  picksIn,
  raceHeading,
  voteFor,
  writeInGroup,
  writeInRows,
} from "./ballotView";
import { type ChoiceGroup, type ElectionSummary, type Race, defaultElection } from "./collate";
import { matchesSearch, raceSearchText, searchTerms } from "./search";

/**
 * What a browser agent sees of My ballot and how its marks become ballot-draft
 * patches (plans/webmcp.md). Pure: `webmcp.ts` gathers the state and registers
 * the tools. Unit-tested in test/ballotAgent.test.ts.
 *
 * The shapes here are the tools' output, read by a model: plain words, no
 * internal stance names, nothing an agent has to look up elsewhere.
 */

type Rows = Record<string, DraftRow>;

/** The marks an agent can set, named as My ballot names them. */
export const MARKS = ["pick", "maybe", "against", "none"] as const;
export type Mark = (typeof MARKS)[number];

const STANCE_OF: Record<Exclude<Mark, "none">, Stance> = {
  pick: "endorse",
  maybe: "lean_for",
  against: "oppose",
};

function markOf(stance: Stance | undefined): Exclude<Mark, "none"> | undefined {
  if (stance === "endorse") return "pick";
  if (stance === "lean_for") return "maybe";
  if (stance === "oppose") return "against";
  return undefined;
}

/** The election My ballot shows: the one the user chose if it's still covered, else the default. */
export function shownElection(
  elections: ElectionSummary[],
  chosen: string,
  today: string,
): string | undefined {
  return elections.some((e) => e.date === chosen) ? chosen : defaultElection(elections, today);
}

/** The race's choices as My ballot lists them: the ballot's, then names the user wrote in. */
function choicesOn(race: Race, election: string, rows: Rows): ChoiceGroup[] {
  const written = writeInRows(rows, race, election).map((row) => writeInGroup(row.choice ?? ""));
  return [...ballotChoices(race), ...written];
}

/** How a choice is named to an agent: "" (a stance on the race as a whole) gets a word. */
const OVERALL = "(the race as a whole)";

function choiceName(group: ChoiceGroup): string {
  return group.choice || OVERALL;
}

export interface ChoiceSummary {
  choice: string;
  /** Party, ballot designation, incumbency, as the ballot prints them. */
  designation?: string;
  /** Not printed on the ballot listing: only sources name it. */
  not_on_ballot?: true;
  write_in?: true;
  /** Followed sources for and against this choice. */
  sources_for: number;
  sources_against: number;
  /** The user's own mark. Absent: unmarked. */
  mark?: Exclude<Mark, "none">;
}

export interface RaceSummary {
  race: string;
  heading: string;
  label?: string;
  jurisdiction?: string;
  district?: string;
  /** "Vote for one", "Rank up to five choices". */
  instruction?: string;
  /** The area can't tell whether this race is on the user's ballot. */
  maybe_on_ballot?: true;
  choices: ChoiceSummary[];
  /** The user's private note on the race. */
  note?: string;
  warning?: string;
}

function choiceSummary(race: Race, group: ChoiceGroup, election: string, rows: Rows) {
  const row = rows[rowIdFor(election, race.subject, group.choice || undefined)];
  const note = designation(group);
  const mark = markOf(row?.stance);
  const summary: ChoiceSummary = {
    choice: choiceName(group),
    ...(note ? { designation: note } : {}),
    ...(group.onBallot ? {} : { not_on_ballot: true as const }),
    ...(group.writeIn || row?.writeIn ? { write_in: true as const } : {}),
    sources_for: group.support,
    sources_against: group.opposition,
    ...(mark ? { mark } : {}),
  };
  return summary;
}

/** More picks than the ballot allows: the real ballot wouldn't count the race. */
export function overvoteWarning(race: Race, election: string, rows: Rows): string | undefined {
  const seats = voteFor(race);
  const picked = picksIn(race, election, rows);
  if (seats === undefined || picked <= seats) return undefined;
  return `${picked} picks, but the ballot allows ${seats}: marking more than that on the real ballot spoils this race. Clear ${picked - seats}.`;
}

export function raceSummary(race: Race, election: string, rows: Rows): RaceSummary {
  const { heading, label } = raceHeading(race);
  const instruction = instructionLine(race);
  const note = rows[rowIdFor(election, race.subject, NOTE_CHOICE)]?.privateNote;
  const warning = overvoteWarning(race, election, rows);
  return {
    race: race.key,
    heading,
    ...(label ? { label } : {}),
    ...(race.jurisdiction ? { jurisdiction: race.jurisdiction } : {}),
    ...(race.district ? { district: race.district } : {}),
    ...(instruction ? { instruction } : {}),
    ...(race.maybe ? { maybe_on_ballot: true as const } : {}),
    choices: choicesOn(race, election, rows).map((group) =>
      choiceSummary(race, group, election, rows),
    ),
    ...(note ? { note } : {}),
    ...(warning ? { warning } : {}),
  };
}

/** How many races `ballotPage` returns unless asked: enough to work through, small enough to read. */
export const PAGE_SIZE = 40;

export interface PageRequest {
  search?: string;
  markedOnly?: boolean;
  offset?: number;
  limit?: number;
}

/**
 * A page of the ballot: races on it first, then ones the area can't place,
 * narrowed by the same search My ballot's search box does. A whole statewide
 * ballot runs to hundreds of races, too many to hand an agent at once.
 */
export function ballotPage(races: Race[], election: string, rows: Rows, request: PageRequest) {
  const terms = searchTerms(request.search ?? "");
  const ordered = [...races.filter((r) => !r.maybe), ...races.filter((r) => r.maybe)];
  const matched = ordered
    .filter((race) => matchesSearch(raceSearchText(race), terms))
    .map((race) => raceSummary(race, election, rows))
    .filter((race) => !request.markedOnly || race.note || race.choices.some((c) => c.mark));
  const offset = Math.max(0, request.offset ?? 0);
  const end = offset + Math.max(1, request.limit ?? PAGE_SIZE);
  return {
    total: matched.length,
    offset,
    races: matched.slice(offset, end),
    ...(end < matched.length ? { next_offset: end } : {}),
  };
}

/** One race in full: every source's position and statement on every choice. */
export function raceDetail(race: Race, election: string, rows: Rows) {
  const summary = raceSummary(race, election, rows);
  const groups = choicesOn(race, election, rows);
  return {
    ...summary,
    choices: summary.choices.map((choice, i) => ({
      ...choice,
      positions: (groups[i]?.positions ?? []).map((p) => ({
        source: p.source.name,
        ...(p.source.kind ? { source_kind: p.source.kind } : {}),
        // Reported by someone else, not signed by the source itself.
        ...(p.source.secondhand ? { secondhand: true as const } : {}),
        stance: p.stance,
        // How the user takes this source (see the get_race description).
        standing: p.standing,
        ...(p.valid ? {} : { signature_invalid: true as const }),
        ...(p.named && p.named !== groups[i]?.choice ? { named: p.named } : {}),
        ...(p.statement ? { statement: p.statement } : {}),
      })),
    })),
  };
}

const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The race an agent means: its key, else a title or ballot heading that only
 * one race has. `lists` in order of preference (the user's ballot first), so a
 * "City Council District 3" means the user's own.
 */
export function findRace(lists: Race[][], query: string): { race: Race } | { error: string } {
  for (const list of lists) {
    const race = list.find((r) => r.key === query);
    if (race) return { race };
  }
  const want = fold(query);
  for (const list of lists) {
    const named = list.filter(
      (r) => fold(r.subject.title) === want || fold(raceHeading(r).heading) === want,
    );
    if (named.length === 1 && named[0]) return { race: named[0] };
    if (named.length > 1) {
      return {
        error: `"${query}" names ${named.length} races; use one's "race" key: ${named.map((r) => r.key).join(", ")}`,
      };
    }
  }
  return { error: `No race "${query}". Use a "race" key from get_ballot.` };
}

export interface MarkRequest {
  choice: string;
  mark: Mark;
  /** A name not on the list, written in. */
  writeIn?: boolean;
}

export type MarkResult = { patch: RowPatch; said?: string } | { error: string };

/** The draft patch an agent's mark makes, by the rules My ballot's buttons follow. */
export function resolveMark(
  race: Race,
  election: string,
  rows: Rows,
  request: MarkRequest,
): MarkResult {
  const groups = choicesOn(race, election, rows);
  const yesNo = isYesNo(race);
  if (!MARKS.includes(request.mark)) {
    return { error: `mark must be one of ${MARKS.join(", ")}` };
  }
  if (yesNo && request.mark === "against") {
    return { error: 'A yes/no question has no "against": pick the other answer.' };
  }
  const typed = request.choice.trim().replace(/\s+/g, " ");
  const want = fold(typed);
  const listed =
    groups.find((g) => g.choice === typed) ?? groups.find((g) => fold(choiceName(g)) === want);
  const stance = request.mark === "none" ? undefined : STANCE_OF[request.mark];
  if (listed) {
    return {
      patch: { subject: race.subject, choice: listed.choice || undefined, fields: { stance } },
    };
  }

  const named = groups.filter((g) => g.choice);
  const match = typed
    ? matchBallotName(
        typed,
        named.map((g) => g.choice),
      )
    : undefined;
  const same = match?.sure ? named.find((g) => g.choice === match.name) : undefined;
  if (same) {
    // Someone sources name who isn't printed: still a write-in when picked as one.
    const writeIn = request.writeIn && stance && !same.onBallot ? { writeIn: true as const } : {};
    return {
      patch: { subject: race.subject, choice: same.choice, fields: { stance, ...writeIn } },
      said: `"${typed}" is ${same.choice}, so that's who was marked.`,
    };
  }
  if (!request.writeIn || request.mark === "none") {
    const options = groups.map(choiceName).join("; ");
    const hint = yesNo ? "" : ' To write in a name, set "write_in": true.';
    return { error: `No choice "${typed}" in this race. Choices: ${options}.${hint}` };
  }
  if (yesNo) return { error: "A yes/no question takes no write-ins." };
  if (!typed) return { error: "Write in a name." };
  if (request.mark !== "pick") return { error: 'A write-in can only be a "pick".' };
  return {
    patch: {
      subject: race.subject,
      choice: typed,
      fields: { stance: "endorse", writeIn: true },
    },
  };
}
