import type { BallotChoice, BallotContest, Stance } from "@openslate/core";
import { type DraftRow, NOTE_CHOICE, rowIdFor } from "./ballotDraft";
import type { ChoiceGroup, Race } from "./collate";

/**
 * My ballot as a file: the collated races (field, who backs whom) with the
 * user's picks laid over them. Pure; unit-tested in test/ballotExport.test.ts.
 * Private notes are opt-in: they never leave the browser otherwise.
 */

export interface BallotExportInput {
  /** Election date as My ballot keys it, e.g. `2026-11-03`. */
  election: string | undefined;
  /** "Where you vote", described; empty when unset. */
  area: string;
  races: Race[];
  /** Every draft row; only the election's rows are read. */
  rows: Record<string, DraftRow>;
  exportedAt: string;
}

export interface BallotExportOptions {
  privateNotes: boolean;
}

interface ExportedSource {
  name: string;
  /** What the source said; a source you disagree with isn't rewritten. */
  stance: Stance;
  followed: boolean;
  /** Followed to disagree: counted the other way in `for` / `against`. */
  disagree?: true;
  /**
   * Listed under the other side of a two-way race (a source you disagree
   * with, counted for the other side): the choice the source named.
   */
  named?: string;
  statement?: string;
}

interface ExportedChoice {
  choice: string;
  onBallot: boolean;
  /** Not printed on the ballot: written in (SPEC §3.12). */
  writeIn?: true;
  /** How the ballot prints it: party, designation, incumbency (SPEC §3.14). */
  ballot?: BallotChoice;
  /** Followed sources counting for / against, a disagreed source the other way. */
  for: number;
  against: number;
  sources: ExportedSource[];
  myPick?: Stance;
  myStatement?: string;
}

interface ExportedRace {
  title: string;
  kind?: string;
  jurisdiction?: string;
  onBallot: boolean;
  /** How the ballot prints it: heading, label, how many to vote for (SPEC §3.14). */
  ballot?: BallotContest;
  myNote?: string;
  choices: ExportedChoice[];
}

/** Names the user wrote in that no source or listing names, as choices of their own. */
function writtenIn(rows: Record<string, DraftRow>, race: Race, election: string): ChoiceGroup[] {
  const prefix = `${election}|${race.key}|`;
  const named = new Set(race.choices.map((c) => c.choice));
  return Object.values(rows)
    .filter(
      (row) => row.writeIn && row.choice && row.id.startsWith(prefix) && !named.has(row.choice),
    )
    .map((row) => ({
      choice: row.choice ?? "",
      positions: [],
      support: 0,
      opposition: 0,
      onBallot: false,
      writeIn: true,
    }));
}

function racesOf(input: BallotExportInput, options: BallotExportOptions): ExportedRace[] {
  const election = input.election ?? "";
  return input.races.map((race) => {
    const note = options.privateNotes
      ? input.rows[rowIdFor(election, race.subject, NOTE_CHOICE)]?.privateNote?.trim()
      : undefined;
    return {
      title: race.subject.title,
      ...(race.subject.kind ? { kind: race.subject.kind } : {}),
      ...(race.jurisdiction ? { jurisdiction: race.jurisdiction } : {}),
      onBallot: race.onBallot,
      ...(race.ballot ? { ballot: race.ballot } : {}),
      ...(note ? { myNote: note } : {}),
      choices: [...race.choices, ...writtenIn(input.rows, race, election)].map((group) => {
        const mine = input.rows[rowIdFor(election, race.subject, group.choice || undefined)];
        const statement = mine?.statement?.trim();
        return {
          choice: group.choice,
          onBallot: group.onBallot,
          ...(group.writeIn ? { writeIn: true as const } : {}),
          ...(group.ballot ? { ballot: group.ballot } : {}),
          for: group.support,
          against: group.opposition,
          sources: group.positions.map((p) => ({
            name: p.source.name,
            stance: p.stance,
            followed: p.standing !== "off",
            ...(p.standing === "disagree" ? { disagree: true as const } : {}),
            ...(p.named ? { named: p.named } : {}),
            ...(p.statement ? { statement: p.statement } : {}),
          })),
          ...(mine?.stance ? { myPick: mine.stance } : {}),
          ...(statement ? { myStatement: statement } : {}),
        };
      }),
    };
  });
}

export function ballotToJson(input: BallotExportInput, options: BallotExportOptions): string {
  return JSON.stringify(
    {
      election: input.election,
      ...(input.area ? { area: input.area } : {}),
      exportedAt: input.exportedAt,
      races: racesOf(input, options),
    },
    null,
    2,
  );
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** One line per choice. Sources read "Name: stance", unfollowed and disagreed-with ones marked. */
export function ballotToCsv(input: BallotExportInput, options: BallotExportOptions): string {
  const headers = [
    "Election",
    "Jurisdiction",
    "Race",
    "Kind",
    "Choice",
    "OnBallot",
    "WriteIn",
    "Party",
    "Designation",
    "Incumbent",
    "For",
    "Against",
    "Sources",
    "MyPick",
    "MyStatement",
    ...(options.privateNotes ? ["MyNote"] : []),
  ];
  const lines = [headers];
  for (const race of racesOf(input, options)) {
    for (const choice of race.choices) {
      lines.push([
        input.election ?? "",
        race.jurisdiction ?? "",
        race.title,
        race.kind ?? "",
        choice.choice,
        choice.onBallot ? "yes" : "",
        choice.writeIn ? "yes" : "",
        choice.ballot?.party ?? "",
        choice.ballot?.designation ?? "",
        choice.ballot?.incumbent ? "yes" : "",
        String(choice.for),
        String(choice.against),
        choice.sources
          .map(
            (s) =>
              `${s.name}: ${s.stance}${s.named ? ` ${s.named}` : ""}${s.disagree ? " (you disagree)" : s.followed ? "" : " (not followed)"}`,
          )
          .join("; "),
        choice.myPick ?? "",
        choice.myStatement ?? "",
        ...(options.privateNotes ? [race.myNote ?? ""] : []),
      ]);
    }
  }
  return lines.map((line) => line.map(csvCell).join(",")).join("\n");
}

export function ballotFileName(election: string | undefined, format: "json" | "csv"): string {
  return `openslate.ballot.${election ?? "all"}.${format}`;
}
