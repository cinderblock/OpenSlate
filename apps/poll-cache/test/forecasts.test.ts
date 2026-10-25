import { afterEach, describe, expect, test } from "bun:test";
import {
  FETCHED_AT_HEADER,
  STALE_HEADER,
  UPSTREAM_STATUS_HEADER,
  handleForecasts,
} from "../src/forecasts";
import worker from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  init?: RequestInit & { cf?: RequestInitCfProperties };
}

/** Stub Kalshi: answer each request with the next response; return the requests made. */
function stubKalshi(...responses: Array<Response | Error>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return seen;
}

/** Enough of the Cache API for the relay: an in-memory map of keys to bodies. */
function memoryCache(): Cache & { keys: string[] } {
  const store = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  return {
    get keys() {
      return [...store.keys()];
    },
    async put(key: RequestInfo | URL, res: Response) {
      store.set(String(key), { body: await res.arrayBuffer(), headers: [...res.headers] });
    },
    async match(key: RequestInfo | URL) {
      const hit = store.get(String(key));
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
  } as unknown as Cache & { keys: string[] };
}

const event = { event: { event_ticker: "KXGOVCA-26", title: "Governor of California" } };
const tooMany = () =>
  new Response(JSON.stringify({ error: { code: "too_many_requests" } }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "10" },
  });
const ok = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(event), {
    headers: { "Content-Type": "application/json", ...headers },
  });

const url = new URL("https://api.example/api/forecasts/v2/events/KXGOVCA-26?include_markets=true");

describe("handleForecasts", () => {
  test("relays to Kalshi with a User-Agent, caching only good answers at the edge", async () => {
    const seen = stubKalshi(ok());
    const res = await handleForecasts(url, {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(event);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30, stale-while-revalidate=300");
    expect(res.headers.get(STALE_HEADER)).toBeNull();

    expect(seen[0]?.url).toBe(
      "https://api.elections.kalshi.com/trade-api/v2/events/KXGOVCA-26?include_markets=true",
    );
    expect(new Headers(seen[0]?.init?.headers).get("User-Agent")).toContain("openslate.us");
    const ttls = seen[0]?.init?.cf?.cacheTtlByStatus ?? {};
    expect(ttls["200-299"]).toBeGreaterThan(0);
    expect(ttls["404"]).toBeGreaterThan(0);
    for (const range of ["300-399", "400-403", "405-599"]) expect(ttls[range]).toBeLessThan(0);
    expect(seen[0]?.init?.cf?.cacheTtl).toBeUndefined();
  });

  test("never lets a browser keep a 429, and passes Retry-After on", async () => {
    stubKalshi(tooMany());
    const res = await handleForecasts(url, {}, { cache: memoryCache() });
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(res.headers.get(UPSTREAM_STATUS_HEADER)).toBe("429");
  });

  test("serves the last good copy, marked stale, when Kalshi refuses", async () => {
    const cache = memoryCache();
    stubKalshi(ok(), tooMany());
    await handleForecasts(url, {}, { cache });
    expect(cache.keys).toEqual([
      "https://api.example/__last-good/api/forecasts/v2/events/KXGOVCA-26?include_markets=true",
    ]);

    const res = await handleForecasts(url, {}, { cache });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(event);
    expect(res.headers.get(STALE_HEADER)).toBe("true");
    expect(res.headers.get(UPSTREAM_STATUS_HEADER)).toBe("429");
    expect(Date.parse(res.headers.get(FETCHED_AT_HEADER) ?? "")).not.toBeNaN();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain(STALE_HEADER);
  });

  test("falls back when Kalshi doesn't answer at all", async () => {
    const cache = memoryCache();
    stubKalshi(ok(), new TypeError("network down"), new TypeError("network down"));
    await handleForecasts(url, {}, { cache });
    const stale = await handleForecasts(url, {}, { cache });
    expect(stale.status).toBe(200);
    expect(stale.headers.get(STALE_HEADER)).toBe("true");

    const none = await handleForecasts(new URL(`${url.origin}/api/forecasts/v2/events/X`), {}, {});
    expect(none.status).toBe(502);
    expect(none.headers.get("Cache-Control")).toBe("no-store");
  });

  test("doesn't rewrite the last good copy from an edge-cache hit", async () => {
    const cache = memoryCache();
    stubKalshi(ok({ "CF-Cache-Status": "HIT" }));
    await handleForecasts(url, {}, { cache });
    expect(cache.keys).toEqual([]);
  });

  test("a missing event is a real answer: relayed as 404 and cacheable", async () => {
    stubKalshi(new Response('{"error":{"code":"not_found"}}', { status: 404 }));
    const res = await handleForecasts(url, {}, { cache: memoryCache() });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=900");
    expect(res.headers.get(STALE_HEADER)).toBeNull();
  });

  test("hands the cache write to waitUntil when there is one", async () => {
    const cache = memoryCache();
    const pending: Promise<unknown>[] = [];
    stubKalshi(ok());
    await handleForecasts(url, {}, { cache, waitUntil: (p) => pending.push(p) });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(cache.keys).toHaveLength(1);
  });
});

describe("worker routing", () => {
  test("forecast routes go through the relay with CORS", async () => {
    stubKalshi(tooMany());
    const res = await worker.fetch(new Request(url));
    expect(res.status).toBe(429);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
