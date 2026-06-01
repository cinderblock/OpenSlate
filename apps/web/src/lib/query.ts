import type { Subject } from "@openslate/core";
import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

const CACHE_KEY = "openslate.query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: 1000 * 60 * 60 * 24, staleTime: 1000 * 60, retry: 1 },
  },
});

// Persist the query cache to IndexedDB so fetched data survives reloads / offline.
export const persister: Persister = {
  persistClient: (client: PersistedClient) => set(CACHE_KEY, client),
  restoreClient: () => get<PersistedClient>(CACHE_KEY),
  removeClient: () => del(CACHE_KEY),
};

/** Fetch raw slate text from a URL, cached by URL. Used on demand via fetchQuery. */
export function slateFromUrlOptions(url: string) {
  return {
    queryKey: ["slate-url", url] as const,
    queryFn: async (): Promise<string> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      return (await response.text()).trim();
    },
  };
}

/** One entry in a public-endorsements catalog (index.json from `openslate sign --batch`). */
export interface CatalogEntry {
  slug: string;
  election: string;
  /** Slate file path, relative to the catalog URL. */
  path: string;
  issuer: { key: string; name?: string; kind?: string };
  attribution?: {
    of: { name: string; uri?: string; kind?: string };
    mode: "scraped" | "transcribed" | "inferred";
    retrieved_at: string;
    sources?: string[];
  };
  positions: number;
  issued_at: string;
}

export interface Catalog {
  version: number;
  generated_at: string;
  entries: CatalogEntry[];
}

/** Default URL for the curated public-endorsements catalog. Override per build via Vite env. */
export const DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG =
  (import.meta.env.VITE_PUBLIC_ENDORSEMENTS_CATALOG as string | undefined) ??
  "https://cinderblock.github.io/openslate-public-endorsements/index.json";

/** Fetch a catalog (index.json) listing publicly-attributed slates available for import. */
export function catalogQueryOptions(catalogUrl: string) {
  return {
    queryKey: ["catalog", catalogUrl] as const,
    queryFn: async (): Promise<Catalog> => {
      const response = await fetch(catalogUrl);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      return (await response.json()) as Catalog;
    },
    staleTime: 1000 * 60 * 5,
  };
}

export interface Election {
  id: string;
  name: string;
  electionDay: string;
  ocdDivisionId?: string;
}

export interface Candidate {
  name: string;
  party?: string;
}

export interface BallotContest {
  subject: Subject;
  candidates: Candidate[];
  /** "Vote for up to N" — if set, the user may select at most N candidates/responses. */
  voteFor?: number;
}

/** Fetch the list of elections the Civic Information API currently exposes. */
export function electionsQueryOptions() {
  return {
    queryKey: ["elections"] as const,
    queryFn: async (): Promise<Election[]> => {
      const response = await fetch("/api/elections");
      if (response.status === 501) {
        throw new Error(
          "Ballot lookup isn't configured on the server (set GOOGLE_API_KEY in .env).",
        );
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Elections lookup failed: HTTP ${response.status}`);
      }
      const data = (await response.json()) as { elections: Election[] };
      return [...data.elections].sort((a, b) => a.electionDay.localeCompare(b.electionDay));
    },
    staleTime: 1000 * 60 * 60,
  };
}

/**
 * Fetch the ballot for an address (proxied to the GOOGLE_API_KEY-backed VIP data).
 * Cached aggressively (the same address rarely changes). Server returns 501 when no
 * API key is configured; we surface that as a friendly error so the UI can show a
 * "ballot lookup isn't set up" hint without breaking the rest of the page.
 */
export function ballotQueryOptions(address: string, electionId?: string) {
  const addr = address.trim();
  return {
    queryKey: ["ballot", addr, electionId ?? ""] as const,
    queryFn: async (): Promise<BallotContest[]> => {
      const params = new URLSearchParams({ address: addr });
      if (electionId) params.set("electionId", electionId);
      const response = await fetch(`/api/ballot?${params.toString()}`);
      if (response.status === 501) {
        throw new Error(
          "Ballot lookup isn't configured on the server (set GOOGLE_API_KEY in .env).",
        );
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Ballot lookup failed: HTTP ${response.status}`);
      }
      const data = (await response.json()) as { contests: BallotContest[] };
      return data.contests;
    },
    enabled: addr.length > 0,
    staleTime: 1000 * 60 * 60,
  };
}
