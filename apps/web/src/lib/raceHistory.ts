import { createLocalStore, useLocalStore } from "./localStore";
import type { ContestResult } from "./sosCa";

/**
 * Each watched race's count over time, as this browser saw it: one point per
 * report that changed the race's numbers, timed by the source. A chart of it
 * starts when the race was first watched here; nothing before that is known.
 * Kept in this browser, capped per race. Pure helpers unit-tested in
 * test/raceHistory.test.ts.
 */

export interface HistoryPoint {
  /** The source's time for the report (ms since epoch). */
  at: number;
  /** Percent of precincts reporting, when the source says. */
  p?: number;
  /** Votes per choice, in `RaceHistory.names` order (0 for a choice not in this report). */
  v: number[];
}

export interface RaceHistory {
  /** Choices in the order first seen: a choice keeps its place (and color) for good. */
  names: string[];
  points: HistoryPoint[];
}

/** Points kept per race: weeks of hourly-then-daily reports fit easily. */
export const MAX_POINTS = 300;

/** A result's choices and their votes: candidates, or Yes / No for one measure. */
export function choicesOf(result: ContestResult): { name: string; votes: number }[] | undefined {
  if (result.kind === "candidates")
    return result.candidates.map((c) => ({ name: c.name, votes: c.votes }));
  if (result.kind === "measure")
    return [
      { name: "Yes", votes: result.measure.yes },
      { name: "No", votes: result.measure.no },
    ];
  return undefined;
}

/**
 * The race's history with this report added. Unchanged (the same object) when
 * the report says what the last point says, or can't be charted.
 */
export function appendPoint(
  history: RaceHistory | undefined,
  result: ContestResult,
  at: number,
): RaceHistory | undefined {
  const choices = choicesOf(result);
  if (!choices) return history;
  const names = [...(history?.names ?? [])];
  for (const c of choices) if (!names.includes(c.name)) names.push(c.name);
  const v = names.map((n) => choices.find((c) => c.name === n)?.votes ?? 0);
  const p = result.reporting.percent;
  const point: HistoryPoint = { at, v, ...(p !== undefined ? { p } : {}) };
  const last = history?.points.at(-1);
  if (
    last &&
    last.p === point.p &&
    names.length === (history?.names.length ?? 0) &&
    last.v.every((n, i) => n === v[i])
  )
    return history;
  // An older points' votes for a newly seen choice: 0, as it wasn't in those reports.
  const points = (history?.points ?? []).map((pt) =>
    pt.v.length === names.length
      ? pt
      : { ...pt, v: [...pt.v, ...Array(names.length - pt.v.length).fill(0)] },
  );
  // The same source time twice (a corrected report): the newer replaces it.
  if (points.at(-1)?.at === at) points.pop();
  points.push(point);
  return { names, points: points.slice(-MAX_POINTS) };
}

function isHistory(raw: unknown): raw is RaceHistory {
  if (typeof raw !== "object" || raw === null) return false;
  const h = raw as RaceHistory;
  return (
    Array.isArray(h.names) &&
    h.names.every((n) => typeof n === "string") &&
    Array.isArray(h.points) &&
    h.points.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof p.at === "number" &&
        Array.isArray(p.v) &&
        p.v.every((n) => typeof n === "number") &&
        (p.p === undefined || typeof p.p === "number"),
    )
  );
}

export const raceHistoryStore = createLocalStore<Record<string, RaceHistory>>(
  "openslate.raceHistory.v1",
  {},
  (raw) =>
    typeof raw === "object" && raw !== null && Object.values(raw).every(isHistory)
      ? (raw as Record<string, RaceHistory>)
      : undefined,
);

/** Log a report for a race (nothing changes when it says what the last point says). */
export function logReport(id: string, result: ContestResult, at: number): void {
  raceHistoryStore.set((all) => {
    const next = appendPoint(all[id], result, at);
    return next === all[id] || !next ? all : { ...all, [id]: next };
  });
}

export function useRaceHistory(id: string): RaceHistory | undefined {
  const [all] = useLocalStore(raceHistoryStore);
  return all[id];
}
