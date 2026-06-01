const UPSTREAM = "https://civicapi.org/api/v2";
// Reporting < 100 → race may still move; keep cache short for the live tail.
export const LIVE_TTL_MS = 30 * 1000;
// Settled race / search / dates / years — change at most a few times a day.
export const SETTLED_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  status: number;
  contentType: string;
  body: string;
  cachedAt: number;
  ttlMs: number;
}

export interface ResultsProxySource {
  /** Pass through a request path + search string to civicAPI, with an adaptive cache. */
  proxy(
    upstreamPath: string,
    search: string,
  ): Promise<{ status: number; contentType: string; body: string; ttlMs: number }>;
}

export function createResultsSource(): ResultsProxySource {
  const cache = new Map<string, CacheEntry>();

  return {
    async proxy(upstreamPath, search) {
      const key = `${upstreamPath}?${search}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.cachedAt < cached.ttlMs) {
        return {
          status: cached.status,
          contentType: cached.contentType,
          body: cached.body,
          ttlMs: cached.ttlMs,
        };
      }

      const upstreamUrl = new URL(UPSTREAM + upstreamPath);
      upstreamUrl.search = search;

      const response = await fetch(upstreamUrl.toString(), {
        headers: { accept: "application/json" },
      });
      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "application/json";

      const ttlMs = response.ok ? deriveTtl(upstreamPath, body) : 0;
      if (response.ok) {
        cache.set(key, { status: response.status, contentType, body, cachedAt: now, ttlMs });
      }
      return { status: response.status, contentType, body, ttlMs };
    },
  };
}

/**
 * Pick a cache TTL based on the request path and (when JSON) the upstream's
 * `percent_reporting` signal. Race detail responses that are still mid-count
 * use the live TTL; everything else uses the settled TTL.
 */
export function deriveTtl(upstreamPath: string, body: string): number {
  // Only `/race/{id}` (with no sub-path) carries a single live `percent_reporting`.
  // `/race/search` and `/race/{id}/history` go through the settled-TTL branch.
  if (!/^\/race\/[^/]+$/.test(upstreamPath)) return SETTLED_TTL_MS;
  try {
    const parsed = JSON.parse(body) as { percent_reporting?: number };
    if (typeof parsed.percent_reporting === "number" && parsed.percent_reporting < 100) {
      return LIVE_TTL_MS;
    }
  } catch {
    // Non-JSON body (e.g. the `?generateMap` SVG) — short TTL, since these
    // are large and we shouldn't pin them long in process memory.
    return LIVE_TTL_MS;
  }
  return SETTLED_TTL_MS;
}
