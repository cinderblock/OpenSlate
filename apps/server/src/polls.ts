const UPSTREAM = "https://api.votehub.com";
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  status: number;
  contentType: string;
  body: string;
  cachedAt: number;
}

export interface PollsSource {
  /** Pass through a request path + search string to the upstream API, with a short TTL cache. */
  proxy(
    path: string,
    search: string,
  ): Promise<{ status: number; contentType: string; body: string }>;
}

export function createPollsSource(): PollsSource {
  const cache = new Map<string, CacheEntry>();

  return {
    async proxy(path, search) {
      const key = `${path}?${search}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
        return { status: cached.status, contentType: cached.contentType, body: cached.body };
      }

      const upstream = new URL(UPSTREAM);
      upstream.pathname = path;
      upstream.search = search;

      const response = await fetch(upstream.toString(), {
        headers: { accept: "application/json" },
      });
      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "application/json";

      if (response.ok) {
        cache.set(key, { status: response.status, contentType, body, cachedAt: now });
      }
      return { status: response.status, contentType, body };
    },
  };
}
