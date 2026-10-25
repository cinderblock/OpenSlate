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
  /** The slate's `context.jurisdiction`: where it publishes for. */
  scope?: string;
  /**
   * Races per position jurisdiction (core's `racesByJurisdiction`; `""` for
   * none). With it the wizard matches the entry to an area without fetching
   * the slate. Older catalogs leave it out.
   */
  jurisdictions?: Record<string, number>;
  issued_at: string;
  /** The endorser's logo, relative to the catalog URL. */
  logo?: string;
  /**
   * Subjects where the endorser took the Democratic (`left`) or Republican
   * (`right`) side, counted by the catalog with core's `leanOf`.
   */
  lean?: { left: number; right: number };
}

export function catalogEntryLogoUrl(entry: CatalogEntry, catalogUrl: string): string | undefined {
  if (!entry.logo) return undefined;
  try {
    const url = new URL(entry.logo, catalogUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export interface Catalog {
  version: number;
  generated_at: string;
  entries: CatalogEntry[];
  /**
   * Every entry with its slate inline, in one file: the catalog's entries plus
   * a `token` each. `bytes` is its uncompressed size, for a progress bar when
   * the transfer is compressed.
   */
  bundle?: { path: string; bytes?: number };
}

/** One entry of a catalog bundle: the entry plus its signed slate. */
export interface CatalogBundleEntry extends CatalogEntry {
  token: string;
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
