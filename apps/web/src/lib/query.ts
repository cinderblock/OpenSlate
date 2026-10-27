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
  /** Articles attached to ballot items (SPEC §3.15), when there are any. */
  articles?: number;
  /** The slate's `context.jurisdiction`: where it publishes for. */
  scope?: string;
  /**
   * Races per jurisdiction, by positions and articles alike (core's
   * `racesByJurisdiction`; `""` for none). With it setup matches the entry
   * to an area without fetching the slate. Older catalogs leave it out.
   */
  jurisdictions?: Record<string, number>;
  /**
   * Each region the slate's contests are filed under, with where they're
   * voted (core's `regionsOf`), so setup can tell whether a source based in a
   * region is local to a voter. Left out when there are none, and by older
   * catalogs.
   */
  regions?: Record<string, string[]>;
  issued_at: string;
  /** The endorser's logo, relative to the catalog URL. */
  logo?: string;
  /** `"dark"` when the logo is white-only and needs a dark tile (set by hand in the catalog). */
  logo_background?: "dark";
  /**
   * Subjects where the endorser took the Democratic (`left`) or Republican
   * (`right`) side, counted by the catalog with core's `leanOf`.
   */
  lean?: { left: number; right: number };
  /**
   * What the slate was built from: a page listing the captured pages and
   * notes, relative to the catalog URL. Older catalogs leave it out.
   */
  evidence?: string;
}

export function catalogEntryLogoUrl(entry: CatalogEntry, catalogUrl: string): string | undefined {
  return entry.logo ? catalogPathUrl(entry.logo, catalogUrl) : undefined;
}

export function catalogEntryEvidenceUrl(
  entry: CatalogEntry,
  catalogUrl: string,
): string | undefined {
  return entry.evidence ? catalogPathUrl(entry.evidence, catalogUrl) : undefined;
}

/** A path the catalog gives, as a URL, when it's one the app may load or link. */
function catalogPathUrl(path: string, catalogUrl: string): string | undefined {
  try {
    const url = new URL(path, catalogUrl);
    // http(s), or the catalog's own scheme: a copy built into the desktop app
    // lives at views://.
    const ok =
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === new URL(catalogUrl).protocol;
    return ok ? url.href : undefined;
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

/** The curated public-endorsements catalog, live. */
export const PUBLIC_ENDORSEMENTS_CATALOG =
  "https://cinderblock.github.io/openslate-public-endorsements/index.json";

const configuredCatalog = import.meta.env.VITE_PUBLIC_ENDORSEMENTS_CATALOG as string | undefined;

/**
 * Whether a build's catalog is a copy shipped with the app (a URL relative to
 * the page, from scripts/snapshot-catalog.ts) rather than one on the web: the
 * desktop app's offline flavor, or a self-hosted copy that works offline.
 */
export function isBuiltInCatalog(configured: string | undefined): boolean {
  return configured !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(configured);
}

export const CATALOG_BUILT_IN = isBuiltInCatalog(configuredCatalog);

/**
 * The catalog this build reads by default: the live one, unless the build
 * names another (VITE_PUBLIC_ENDORSEMENTS_CATALOG). A relative one resolves
 * against the page, since everything in a catalog is fetched relative to it.
 */
export const DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG =
  typeof location === "undefined" || !configuredCatalog
    ? (configuredCatalog ?? PUBLIC_ENDORSEMENTS_CATALOG)
    : new URL(configuredCatalog, location.href).href;

/**
 * News coverage: a slate of articles and no positions (SPEC §3.15). Like a
 * ballot list it's reference, not a recommendation, so it comes along
 * without being followed.
 */
export function isArticlesEntry(entry: CatalogEntry): boolean {
  return entry.positions === 0 && (entry.articles ?? 0) > 0;
}

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
