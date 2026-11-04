import { appendChoices, isRaceHistory, type RaceHistory } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { feedState, SOS_FEED, useFeedStates, useRecorder, viaRelay } from "./liveFeed";
import { createLocalStore, useLocalStore } from "./localStore";
import { apiBase } from "./routing";
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

/** The results feed a race's id belongs to: a county's slug, or the Secretary of State's. */
export function historyFeed(id: string): string {
  return id.match(/^county-ca\/([a-z-]+)\//)?.[1] ?? SOS_FEED;
}

/**
 * The relay recorder's history of a race (every report since it started, not
 * just those this browser saw), fetched only when asked for (`enabled`) and
 * when results come through the relay. Asked again when a new report is
 * announced. Null when the recorder has none.
 */
export function useRecordedHistory(id: string, enabled: boolean): RaceHistory | null | undefined {
  const recorder = useRecorder();
  useFeedStates();
  const feed = historyFeed(id);
  const version = feedState(feed).version ?? 0;
  const query = useQuery({
    queryKey: ["race-history", id, version],
    queryFn: async (): Promise<RaceHistory | null> => {
      const path = id.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`${apiBase()}/api/history/${feed}/${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`The relay answered ${res.status}`);
      const body: unknown = await res.json();
      return isRaceHistory(body) ? body : null;
    },
    enabled: enabled && recorder && viaRelay(feed),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    retry: 1,
  });
  return query.data;
}
