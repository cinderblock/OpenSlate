import { appendChoices, isRaceHistory, type RaceHistory } from "@openslate/core";
import { createLocalStore, useLocalStore } from "./localStore";
import type { ContestResult } from "./sosCa";

/**
 * Each watched race's count over time, as this browser saw it: one point per
 * report that changed the race's numbers, timed by the source. A chart of it
 * starts when the race was first watched here; nothing before that is known.
 * Kept in this browser, capped per race. Pure helpers unit-tested in
 * test/raceHistory.test.ts.
 */

export type { HistoryPoint, RaceHistory } from "@openslate/core";

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
  return appendChoices(history, choices, result.reporting.percent, at, MAX_POINTS);
}

export const raceHistoryStore = createLocalStore<Record<string, RaceHistory>>(
  "openslate.raceHistory.v1",
  {},
  (raw) =>
    typeof raw === "object" && raw !== null && Object.values(raw).every(isRaceHistory)
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
