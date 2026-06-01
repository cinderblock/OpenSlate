import type { Subject } from "@openslate/core";

/**
 * Pure helpers for classifying where a Subject sits in the election lifecycle.
 * Drives "election scheduled for X" copy on future races and adds a countdown
 * chip pre-election.
 */

export type ElectionPhase =
  | { kind: "upcoming"; date: Date; daysUntil: number }
  | { kind: "today"; date: Date }
  | { kind: "past"; date: Date; daysAgo: number }
  | { kind: "unknown" };

/**
 * Classify a subject's election date relative to `now`. Accepts both bare
 * `YYYY-MM-DD` and full RFC 3339 strings.
 *
 * Days-until / days-ago counts at UTC-day granularity so they don't flicker
 * across the user's local midnight on race day.
 */
export function electionPhase(subject: Subject, now: Date = new Date()): ElectionPhase {
  const raw = subject.election;
  if (!raw) return { kind: "unknown" };
  const date = parseDateLoose(raw);
  if (!date) return { kind: "unknown" };

  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / dayMs);

  if (diffDays > 0) return { kind: "upcoming", date, daysUntil: diffDays };
  if (diffDays < 0) return { kind: "past", date, daysAgo: -diffDays };
  return { kind: "today", date };
}

function parseDateLoose(text: string): Date | null {
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compact label for the panel-header chip when an election is upcoming or
 * today. Returns `null` for past or unknown — the existing `percent_reporting`
 * chip carries that information for completed races.
 */
export function upcomingChipLabel(phase: ElectionPhase): string | null {
  switch (phase.kind) {
    case "upcoming":
      if (phase.daysUntil === 1) return "Election tomorrow";
      if (phase.daysUntil <= 7) return `Election in ${phase.daysUntil} days`;
      if (phase.daysUntil <= 60) return `Election in ${phase.daysUntil} days`;
      return `Scheduled ${phase.date.toISOString().slice(0, 10)}`;
    case "today":
      return "Election today";
    case "past":
    case "unknown":
      return null;
  }
}
