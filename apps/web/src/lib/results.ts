import {
  type Race,
  type RaceHistoryResult,
  type RaceSearchParams,
  type RaceSearchResult,
  type ResultsSource,
  type Subject,
  scoreMatch,
  subjectToRaceQuery,
} from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { type SubjectRaceMapping, getSubjectRace, putSubjectRace } from "./db";
import { subjectKey } from "./subjects";

export { subjectKey };

// Build-time configurable upstream. Defaults to civicAPI directly because their
// CORS allows browser fetches and no API key is required. Self-hosters can
// point this at a Hono server or the poll-cache Worker.
//
// Path convention: callers append `/race/...`, `/getElectionYears`, etc.
// civicAPI exposes `/api/v2/<x>`; the worker exposes `/api/results/v2/<x>`;
// both produce the same shapes from the client's perspective.
const DEFAULT_BASE = "https://civicapi.org/api/v2";
const BASE: string = (
  (import.meta.env.VITE_RESULTS_BASE as string | undefined) ?? DEFAULT_BASE
).replace(/\/+$/, "");

const PROVIDER = "civicapi";

// ---- ResultsSource -----------------------------------------------------------

function buildSearchUrl(params: RaceSearchParams): string {
  const usp = new URLSearchParams();
  if (params.query) usp.set("query", params.query);
  if (params.country) usp.set("country", params.country);
  if (params.province) usp.set("province", params.province);
  if (params.district) usp.set("district", params.district);
  if (params.election_type) usp.set("election_type", params.election_type);
  if (params.startDate) usp.set("startDate", params.startDate);
  if (params.endDate) usp.set("endDate", params.endDate);
  if (params.limit !== undefined) usp.set("limit", String(params.limit));
  return `${BASE}/race/search?${usp.toString()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`results upstream ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function createCivicApiSource(): ResultsSource {
  return {
    async search(params) {
      return fetchJson<RaceSearchResult>(buildSearchUrl(params));
    },
    async get(raceId) {
      return fetchJson<Race>(`${BASE}/race/${encodeURIComponent(String(raceId))}`);
    },
    async history(raceId, timestamp) {
      const path = `${BASE}/race/${encodeURIComponent(String(raceId))}/history${
        timestamp ? `/${encodeURIComponent(timestamp)}` : ""
      }`;
      const data = await fetchJson<unknown>(path);
      // civicAPI returns an array of timestamps when no ts is provided, and a
      // full race snapshot when one is.
      if (Array.isArray(data)) {
        return { kind: "timestamps", timestamps: data as string[] } satisfies RaceHistoryResult;
      }
      return { kind: "snapshot", race: data as Race } satisfies RaceHistoryResult;
    },
  };
}

export const resultsSource: ResultsSource = createCivicApiSource();

// ---- Subject ↔ race mapping --------------------------------------------------

export async function resolveSubjectRace(
  subject: Subject,
): Promise<{ raceId: string; source: SubjectRaceMapping["source"] } | null> {
  const stored = await getSubjectRace(subjectKey(subject));
  if (!stored || stored.provider !== PROVIDER) return null;
  return { raceId: stored.raceId, source: stored.source };
}

export async function saveSubjectRace(
  subject: Subject,
  raceId: string | number,
  source: SubjectRaceMapping["source"],
): Promise<void> {
  await putSubjectRace({
    subjectKey: subjectKey(subject),
    provider: PROVIDER,
    raceId: String(raceId),
    source,
    setAt: new Date().toISOString(),
  });
}

// ---- TanStack Query options --------------------------------------------------

function isLiveRace(race?: Pick<Race, "percent_reporting">): boolean {
  return race?.percent_reporting !== undefined && race.percent_reporting < 100;
}

/**
 * Fan out search + detail queries for every position on a slate, returning a
 * `Race | undefined` per position (in the same order). Shares the TanStack
 * cache with each ResultsPanel's own queries, so per-position panels see
 * warm cache when they mount.
 *
 * Uses the top auto-match per subject; pinned manual overrides on individual
 * panels won't reflow until refresh. That's acceptable for headline / filter
 * use cases — the per-panel UI is authoritative.
 */
export function useResolvedRaces(subjects: Subject[]): (Race | undefined)[] {
  const searches = useQueries({
    queries: subjects.map((s) => raceSearchQueryOptions(s)),
  });
  const raceIds = searches.map((q) => q.data?.ranked[0]?.race.id);
  const details = useQueries({
    queries: raceIds.map((id) => raceQueryOptions(id)),
  });
  return details.map((q) => q.data);
}

export function raceSearchQueryOptions(subject: Subject) {
  const params = subjectToRaceQuery(subject);
  return {
    queryKey: ["results", "search", params] as const,
    queryFn: async () => {
      const data = await resultsSource.search(params);
      const ranked = [...data.races]
        .map((r) => ({ race: r, score: scoreMatch(subject, r) }))
        .sort((a, b) => b.score - a.score);
      return { ...data, ranked };
    },
    staleTime: 1000 * 60 * 5,
  };
}

export function raceQueryOptions(raceId: string | number | undefined) {
  return {
    queryKey: ["results", "race", raceId] as const,
    queryFn: async (): Promise<Race> => {
      if (raceId === undefined) throw new Error("raceId required");
      return resultsSource.get(raceId);
    },
    enabled: raceId !== undefined,
    // Picked dynamically by `refetchInterval` below; staleTime is a floor.
    staleTime: 1000 * 30,
    refetchInterval: (query: { state: { data?: Race } }) =>
      isLiveRace(query.state.data) ? 1000 * 30 : false,
  };
}

export function raceHistoryListQueryOptions(raceId: string | number | undefined) {
  return {
    queryKey: ["results", "history-list", raceId] as const,
    queryFn: async (): Promise<string[]> => {
      if (raceId === undefined) throw new Error("raceId required");
      const result = await resultsSource.history(raceId);
      return result.kind === "timestamps" ? result.timestamps : [];
    },
    enabled: raceId !== undefined,
    staleTime: 1000 * 30,
  };
}

export function raceHistorySnapshotQueryOptions(
  raceId: string | number | undefined,
  timestamp: string | undefined,
) {
  return {
    queryKey: ["results", "history-snapshot", raceId, timestamp] as const,
    queryFn: async (): Promise<Race | null> => {
      if (raceId === undefined || !timestamp) return null;
      const result = await resultsSource.history(raceId, timestamp);
      return result.kind === "snapshot" ? result.race : null;
    },
    enabled: raceId !== undefined && Boolean(timestamp),
    // Historical snapshots are immutable once produced.
    staleTime: 1000 * 60 * 60 * 24,
  };
}
