const UPSTREAM = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi markets move on every trade. 30 s is short enough to keep the UI
// alive on election night without hammering the upstream from a busy proxy.
const FORECAST_TTL_MS = 30 * 1000;

interface CacheEntry {
  status: number;
  contentType: string;
  body: string;
  cachedAt: number;
}

export interface ForecastsProxySource {
  /** Pass-through to Kalshi's trade-api/v2 with a short in-process cache. */
  proxy(
    upstreamPath: string,
    search: string,
  ): Promise<{ status: number; contentType: string; body: string; ttlMs: number }>;
}

export function createForecastsSource(): ForecastsProxySource {
  const cache = new Map<string, CacheEntry>();
  return {
    async proxy(upstreamPath, search) {
      const key = `${upstreamPath}?${search}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.cachedAt < FORECAST_TTL_MS) {
        return {
          status: cached.status,
          contentType: cached.contentType,
          body: cached.body,
          ttlMs: FORECAST_TTL_MS,
        };
      }

      const upstream = new URL(UPSTREAM + upstreamPath);
      upstream.search = search;
      const response = await fetch(upstream.toString(), {
        headers: { accept: "application/json" },
      });
      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "application/json";

      if (response.ok) {
        cache.set(key, { status: response.status, contentType, body, cachedAt: now });
      }
      return { status: response.status, contentType, body, ttlMs: FORECAST_TTL_MS };
    },
  };
}
