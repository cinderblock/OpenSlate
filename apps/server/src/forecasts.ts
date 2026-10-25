const UPSTREAM = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi markets move on every trade. 30 s is short enough to keep the UI
// alive on election night without hammering the upstream from a busy proxy.
export const FORECAST_TTL_MS = 30 * 1000;
// How long a good answer may stand in for Kalshi when it errors (same as the
// Cloudflare relay, apps/poll-cache/src/forecasts.ts).
export const LAST_GOOD_MS = 7 * 24 * 60 * 60 * 1000;

const USER_AGENT = "OpenSlate forecasts relay (+https://openslate.us)";

interface CacheEntry {
  status: number;
  contentType: string;
  body: string;
  cachedAt: number;
}

export interface ForecastsProxyResult {
  status: number;
  contentType: string;
  body: string;
  ttlMs: number;
  /**
   * Set when Kalshi errored and this is the last good answer instead: when it
   * was fetched, and what Kalshi answered this time.
   */
  stale?: { fetchedAt: number; upstreamStatus: number };
}

export interface ForecastsProxySource {
  /** Pass-through to Kalshi's trade-api/v2 with a short in-process cache. */
  proxy(upstreamPath: string, search: string): Promise<ForecastsProxyResult>;
}

export function createForecastsSource(fetchImpl: typeof fetch = fetch): ForecastsProxySource {
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
      let response: Response | undefined;
      try {
        response = await fetchImpl(upstream.toString(), {
          headers: { accept: "application/json", "user-agent": USER_AGENT },
        });
      } catch (err) {
        if (!cached || now - cached.cachedAt >= LAST_GOOD_MS) throw err;
      }

      if (response && (response.ok || response.status === 404)) {
        const body = await response.text();
        const contentType = response.headers.get("content-type") ?? "application/json";
        if (response.ok) {
          cache.set(key, { status: response.status, contentType, body, cachedAt: now });
        }
        return { status: response.status, contentType, body, ttlMs: FORECAST_TTL_MS };
      }

      const upstreamStatus = response?.status ?? 502;
      if (cached && now - cached.cachedAt < LAST_GOOD_MS) {
        return {
          status: cached.status,
          contentType: cached.contentType,
          body: cached.body,
          ttlMs: 0,
          stale: { fetchedAt: cached.cachedAt, upstreamStatus },
        };
      }
      // response is set here: a failed fetch with nothing cached rethrew above.
      const failed = response as Response;
      return {
        status: upstreamStatus,
        contentType: failed.headers.get("content-type") ?? "application/json",
        body: await failed.text(),
        ttlMs: 0,
      };
    },
  };
}
