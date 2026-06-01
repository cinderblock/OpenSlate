import type { Position, Race, SlatePayload } from "@openslate/core";
import { positionOutcome } from "./slate-summary";

/**
 * Build a CSV representation of a slate's results comparison. One row per
 * position with the user / reported entity's stance, the resolved race,
 * civicAPI's declared winner, and a win/loss/pending/unresolved column.
 *
 * Pure — no DOM, no fetch — so the caller decides how to deliver the bytes
 * (download, clipboard, anywhere).
 */
export function slateToCsv(payload: SlatePayload, races: (Race | undefined)[]): string {
  const header = [
    "subject_title",
    "subject_id",
    "jurisdiction",
    "election",
    "stance",
    "choice",
    "civicapi_race_id",
    "civicapi_race_name",
    "winner",
    "winner_percent",
    "reporting_percent",
    "outcome",
  ];

  const rows = payload.positions.map((position, i) => {
    const race = races[i];
    const winner = race?.candidates.find((c) => c.winner);
    return [
      position.subject.title,
      position.subject.id ?? "",
      position.subject.jurisdiction ?? "",
      position.subject.election ?? "",
      position.stance,
      position.choice ?? "",
      race ? String(race.id) : "",
      race?.election_name ?? "",
      winner?.name ?? "",
      winner?.percent !== undefined ? winner.percent.toFixed(2) : "",
      race?.percent_reporting !== undefined ? race.percent_reporting.toFixed(1) : "",
      outcomeColumn(position, race),
    ];
  });

  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

function outcomeColumn(position: Position, race: Race | undefined): string {
  return positionOutcome(position, race);
}

/**
 * Quote a CSV field per RFC 4180 §2.6: wrap in double quotes and escape
 * embedded quotes by doubling them. Only quote when needed — clean fields
 * stay readable in a casual spreadsheet view.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Suggest a stable filename for the export — `<issuer-or-reported>-<date>.csv`.
 * Lowercased, non-ASCII removed; falls back to a generic stem.
 */
export function suggestCsvFilename(payload: SlatePayload): string {
  const stem = payload.attribution?.of.name ?? payload.issuer.name ?? "slate";
  const slug =
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "slate";
  const date = (payload.context?.election ?? payload.issued_at).slice(0, 10);
  return `openslate-${slug}-${date}.csv`;
}
