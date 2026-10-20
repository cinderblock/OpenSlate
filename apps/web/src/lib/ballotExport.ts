import type { Stance } from "@openslate/core";
import { type DraftRow, NOTE_CHOICE, rowIdFor } from "./ballotDraft";
import type { Race } from "./collate";

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
  stance: Stance;
  followed: boolean;
  statement?: string;
}

interface ExportedChoice {
  choice: string;
  onBallot: boolean;
  ballotNote?: string;
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
  myNote?: string;
  choices: ExportedChoice[];
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
      ...(note ? { myNote: note } : {}),
      choices: race.choices.map((group) => {
        const mine = input.rows[rowIdFor(election, race.subject, group.choice || undefined)];
        const statement = mine?.statement?.trim();
        return {
          choice: group.choice,
          onBallot: group.onBallot,
          ...(group.ballotNote ? { ballotNote: group.ballotNote } : {}),
          for: group.support,
          against: group.opposition,
          sources: group.positions.map((p) => ({
            name: p.source.name,
            stance: p.stance,
            followed: p.followed,
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

/** One line per choice. Sources read "Name: stance", unfollowed ones marked. */
export function ballotToCsv(input: BallotExportInput, options: BallotExportOptions): string {
  const headers = [
    "Election",
    "Jurisdiction",
    "Race",
    "Kind",
    "Choice",
    "OnBallot",
    "BallotNote",
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
        choice.ballotNote ?? "",
        String(choice.for),
        String(choice.against),
        choice.sources
          .map((s) => `${s.name}: ${s.stance}${s.followed ? "" : " (not followed)"}`)
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
