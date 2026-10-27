import { matchBallotName, type Stance } from "@openslate/core";
import { type DraftRow, NOTE_CHOICE, type RowPatch, rankingKeyFor, rowIdFor } from "./ballotDraft";
import {
  ballotChoices,
  designation,
  instructionLine,
  isYesNo,
  picksIn,
  raceHeading,
  voteFor,
  writeInRows,
} from "./ballotView";
import { type ChoiceGroup, defaultElection, type ElectionSummary, type Race } from "./collate";
import {
  isRanked,
  markChange,
  marksFor,
  orderPatches,
  pickChange,
  rankingOf,
  reorderChange,
  writeInGroup,
} from "./ranking";
import { matchesSearch, raceSearchText, searchTerms } from "./search";

/**
 * What a browser agent sees of My ballot and how its marks become ballot-draft
 * changes (plans/webmcp.md). Pure: `webmcp.ts` gathers the state and registers
 * the tools. Unit-tested in test/ballotAgent.test.ts.
 *
 * The shapes here are the tools' output, read by a model: plain words, no
 * internal stance names, nothing an agent has to look up elsewhere.
 *
 * A candidate race is decided by ranking (lib/ranking.ts), and its marks go
 * through the same helpers My ballot's buttons use, so the order and the marks
 * stay in step. Unlike the bubble, an agent's mark never toggles: "pick" on a
 * picked name leaves it picked, so a retried call can't undo itself.
 */

type Rows = Record<string, DraftRow>;

/** The user's marks and rankings: everything the tools read and change. */
export interface Draft {
  rows: Rows;
  rankings: Record<string, string[]>;
}

/** The marks an agent can set, named as My ballot names them. */
export const MARKS = ["pick", "maybe", "against", "none"] as const;
export type Mark = (typeof MARKS)[number];

const STANCE_OF: Record<Exclude<Mark, "none">, Stance> = {
  pick: "endorse",
  maybe: "lean_for",
  against: "oppose",
};

/** The election My ballot shows: the one the user chose if it's still covered, else the default. */
export function shownElection(
  elections: ElectionSummary[],
  chosen: string,
  today: string,
): string | undefined {
  return elections.some((e) => e.date === chosen) ? chosen : defaultElection(elections, today);
}

function savedRanking(race: Race, election: string, draft: Draft): string[] | undefined {
  return draft.rankings[rankingKeyFor(election, race.subject)];
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
  mark?: "pick" | "backup" | "maybe" | "against";
  /** Place in the user's ranking of a candidate race, 1 first. */
  rank?: number;
}

export interface RaceSummary {
  race: string;
  heading: string;
  label?: string;
  jurisdiction?: string;
  district?: string;
  /** "Vote for one", "Rank up to five choices". */
  instruction?: string;
  /** Decided by ranking: rank_choices sets its order. */
  ranked?: true;
  /** The area can't tell whether this race is on the user's ballot. */
  maybe_on_ballot?: true;
  choices: ChoiceSummary[];
  /** The user's private note on the race. */
  note?: string;
  warning?: string;
}

function markOf(stance: Stance | undefined, ranked: boolean): ChoiceSummary["mark"] {
  if (stance === "endorse") return "pick";
  // In a ranking, past the picks: a backup, not a maybe.
  if (stance === "lean_for") return ranked ? "backup" : "maybe";
  if (stance === "oppose") return "against";
  return undefined;
}

/** More picks than the ballot allows: the real ballot wouldn't count the race. */
export function overvoteWarning(race: Race, election: string, rows: Rows): string | undefined {
  const seats = voteFor(race);
  const picked = picksIn(race, election, rows);
  if (seats === undefined || picked <= seats) return undefined;
  return `${picked} picks, but the ballot allows ${seats}: marking more than that on the real ballot spoils this race. Clear ${picked - seats}.`;
}

export function raceSummary(race: Race, election: string, draft: Draft): RaceSummary {
  const { rows } = draft;
  const { heading, label } = raceHeading(race);
  const instruction = instructionLine(race);
  const note = rows[rowIdFor(election, race.subject, NOTE_CHOICE)]?.privateNote;
  const warning = overvoteWarning(race, election, rows);
  const ranked = isRanked(race);
  const order = ranked ? rankingOf(race, election, rows, savedRanking(race, election, draft)) : [];
  const choices = choicesOn(race, election, rows).map((group): ChoiceSummary => {
    const row = rows[rowIdFor(election, race.subject, group.choice || undefined)];
    const shown = designation(group);
    const at = group.choice ? order.indexOf(group.choice) : -1;
    const mark = markOf(row?.stance, at !== -1);
    return {
      choice: choiceName(group),
      ...(shown ? { designation: shown } : {}),
      ...(group.onBallot ? {} : { not_on_ballot: true as const }),
      ...(group.writeIn || row?.writeIn ? { write_in: true as const } : {}),
      sources_for: group.support,
      sources_against: group.opposition,
      ...(mark ? { mark } : {}),
      ...(at !== -1 ? { rank: at + 1 } : {}),
    };
  });
  return {
    race: race.key,
    heading,
    ...(label ? { label } : {}),
    ...(race.jurisdiction ? { jurisdiction: race.jurisdiction } : {}),
    ...(race.district ? { district: race.district } : {}),
    ...(instruction ? { instruction } : {}),
    ...(ranked ? { ranked: true as const } : {}),
    ...(race.maybe ? { maybe_on_ballot: true as const } : {}),
    choices,
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
export function ballotPage(races: Race[], election: string, draft: Draft, request: PageRequest) {
  const terms = searchTerms(request.search ?? "");
  const ordered = [...races.filter((r) => !r.maybe), ...races.filter((r) => r.maybe)];
  const matched = ordered
    .filter((race) => matchesSearch(raceSearchText(race), terms))
    .map((race) => raceSummary(race, election, draft))
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
export function raceDetail(race: Race, election: string, draft: Draft) {
  const summary = raceSummary(race, election, draft);
  const groups = choicesOn(race, election, draft.rows);
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
const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

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

/**
 * The choice an agent named: as listed (case and spacing aside), else the one
 * listed name it plainly means (`matchBallotName`, as a write-in field does).
 */
function findChoice(
  groups: ChoiceGroup[],
  typed: string,
): { group: ChoiceGroup; said?: string } | undefined {
  const want = fold(typed);
  const listed =
    groups.find((g) => g.choice === typed) ?? groups.find((g) => fold(choiceName(g)) === want);
  if (listed) return { group: listed };
  const named = groups.filter((g) => g.choice);
  const match = typed
    ? matchBallotName(
        typed,
        named.map((g) => g.choice),
      )
    : undefined;
  const same = match?.sure ? named.find((g) => g.choice === match.name) : undefined;
  return same
    ? { group: same, said: `"${typed}" is ${same.choice}, so that's who was meant.` }
    : undefined;
}

function noSuchChoice(race: Race, groups: ChoiceGroup[], typed: string, writeInHint: boolean) {
  const options = groups.map(choiceName).join("; ");
  const hint = writeInHint && !isYesNo(race) ? ' To write in a name, set "write_in": true.' : "";
  return { error: `No choice "${typed}" in this race. Choices: ${options}.${hint}` };
}

/** What an agent's request changes: draft rows, and a candidate race's ranking. */
export interface AgentChange {
  patches: RowPatch[];
  /** The race's ranking after the change. Absent for a race that isn't ranked. */
  order?: string[];
  said?: string;
}

export type ChangeResult = AgentChange | { error: string };

export interface MarkRequest {
  choice: string;
  mark: Mark;
  /** A name not on the list, written in. */
  writeIn?: boolean;
}

/** One mark, by the rules My ballot's buttons follow, except that nothing toggles. */
export function resolveMark(
  race: Race,
  election: string,
  draft: Draft,
  request: MarkRequest,
): ChangeResult {
  const { rows } = draft;
  if (!MARKS.includes(request.mark)) {
    return { error: `mark must be one of ${MARKS.join(", ")}` };
  }
  const yesNo = isYesNo(race);
  if (yesNo && request.mark === "against") {
    return { error: 'A yes/no question has no "against": pick the other answer.' };
  }
  const groups = choicesOn(race, election, rows);
  const typed = tidy(request.choice);
  const found = findChoice(groups, typed);
  let name: string;
  if (found) {
    name = found.group.choice;
  } else if (!request.writeIn || request.mark === "none") {
    return noSuchChoice(race, groups, typed, true);
  } else if (yesNo) {
    return { error: "A yes/no question takes no write-ins." };
  } else if (!typed) {
    return { error: "Write in a name." };
  } else if (request.mark !== "pick") {
    return { error: 'A write-in can only be a "pick".' };
  } else {
    name = typed;
  }
  const said = found?.said ? { said: found.said } : {};
  // Picked as a write-in: a name sources mention that isn't printed, or a new one.
  const writeIn = request.writeIn === true && request.mark === "pick" && !found?.group.onBallot;
  const stance = request.mark === "none" ? undefined : STANCE_OF[request.mark];

  // A yes/no answer, or a stance on the race as a whole: one row, no ranking.
  if (!isRanked(race) || !name) {
    const fields = { stance, ...(writeIn ? { writeIn: true as const } : {}) };
    return { patches: [{ subject: race.subject, choice: name || undefined, fields }], ...said };
  }

  const saved = savedRanking(race, election, draft);
  const order = rankingOf(race, election, rows, saved);
  const at = order.indexOf(name);
  const current = rows[rowIdFor(election, race.subject, name)]?.stance;
  if (request.mark === "pick") {
    if (at !== -1 && at < marksFor(race)) return { patches: [], order, ...said };
    return { ...pickChange(race, election, rows, saved, name, { writeIn }), ...said };
  }
  if (request.mark === "none") {
    if (at === -1) {
      return {
        patches: [{ subject: race.subject, choice: name, fields: { stance } }],
        order,
        ...said,
      };
    }
    const next = order.filter((n) => n !== name);
    return { patches: orderPatches(race, election, rows, order, next), order: next, ...said };
  }
  // Maybe or against: the name leaves the ranking. Already so: nothing to do.
  if (at === -1 && current === stance) return { patches: [], order, ...said };
  return { ...markChange(race, election, rows, saved, name, stance as Stance), ...said };
}

/**
 * A candidate race's whole ranking, first choice first: the first as many as
 * the ballot takes are picked, the rest backups, and names left out unranked.
 */
export function resolveRanking(
  race: Race,
  election: string,
  draft: Draft,
  names: readonly string[],
): ChangeResult {
  if (!isRanked(race)) return { error: "A yes/no question isn't ranked: mark Yes or No." };
  const groups = choicesOn(race, election, draft.rows).filter((g) => g.choice);
  const next: string[] = [];
  const said: string[] = [];
  for (const typed of names.map(tidy)) {
    const found = findChoice(groups, typed);
    if (!found) return noSuchChoice(race, groups, typed, false);
    if (next.includes(found.group.choice)) {
      return { error: `${found.group.choice} is in the ranking twice.` };
    }
    next.push(found.group.choice);
    if (found.said) said.push(found.said);
  }
  const saved = savedRanking(race, election, draft);
  return {
    ...reorderChange(race, election, draft.rows, saved, next),
    ...(said.length > 0 ? { said: said.join(" ") } : {}),
  };
}
