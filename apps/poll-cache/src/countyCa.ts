/**
 * California counties' own election-night results feeds, relayed so a crowd of
 * browsers costs a county one request per file per minute, not one each. Only
 * the counties and paths `@openslate/core/countyResults` lists are fetched,
 * with an honest User-Agent. The public worker and a self-hosted apps/server
 * both mount this. Stateless apart from the cache; stores and logs nothing.
 *
 * `/api/county-ca/<county>/<path under the county's feed>`, e.g.
 * `/api/county-ca/santa-clara/current_ver.txt`.
 */

import {
  CA_COUNTY_FEEDS,
  COUNTY_RESULTS_USER_AGENT,
  feedPathTtl,
} from "@openslate/core/countyResults";

export const COUNTY_CA_PREFIX = "/api/county-ca/";
/** Failures are kept briefly too, so an outage upstream isn't repeated by every visitor. */
const ERROR_TTL_SECONDS = 15;

export interface CountyUpstream {
  url: string;
  /** Seconds a good answer stays good. */
  ttl: number;
}

export function countyCaUpstream(pathname: string): CountyUpstream | null {
  if (!pathname.startsWith(COUNTY_CA_PREFIX)) return null;
  const inner = pathname.slice(COUNTY_CA_PREFIX.length);
  const slash = inner.indexOf("/");
  if (slash < 0) return null;
  const feed = Object.hasOwn(CA_COUNTY_FEEDS, inner.slice(0, slash))
    ? CA_COUNTY_FEEDS[inner.slice(0, slash)]
    : undefined;
  if (!feed) return null;
  const rest = inner.slice(slash + 1);
  const ttl = feedPathTtl(feed, rest);
  return ttl === null ? null : { url: `${feed.base}/${rest}${feed.query ?? ""}`, ttl };
}

interface Answer {
  status: number;
  contentType: string;
  lastModified: string | null;
  body: string;
}

/**
 * One upstream request per file at a time, and its answer reused until it
 * expires: what keeps a self-hosted server (no edge cache) from passing a crowd
 * straight through. On the worker the edge cache does the same across isolates.
 */
const cache = new Map<string, { until: number; answer: Promise<Answer> }>();

function ttlOf(status: number, ttl: number): number {
  return status >= 200 && status < 300 ? ttl : ERROR_TTL_SECONDS;
}

async function fetchUpstream({ url, ttl }: CountyUpstream): Promise<Answer> {
  const res = await fetch(url, {
    headers: { "User-Agent": COUNTY_RESULTS_USER_AGENT },
    // Workers only: the edge cache, errors kept briefly. Ignored elsewhere.
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": ttl, "400-599": ERROR_TTL_SECONDS },
    },
  } as RequestInit);
  return {
    status: res.status,
    contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
    lastModified: res.headers.get("Last-Modified"),
    body: await res.text(),
  };
}

function prune(now: number): void {
  for (const [key, slot] of cache) if (slot.until <= now) cache.delete(key);
}

function answerFor(upstream: CountyUpstream): Promise<Answer> {
  const now = Date.now();
  const hit = cache.get(upstream.url);
  if (hit && hit.until > now) return hit.answer;
  // Versioned files pile up over weeks of counting: drop the expired ones.
  prune(now);
  const answer = fetchUpstream(upstream);
  // In flight, concurrent asks share it; once in, it's kept for its TTL.
  const slot = { until: now + ERROR_TTL_SECONDS * 1000, answer };
  cache.set(upstream.url, slot);
  answer.then(
    (a) => {
      slot.until = Date.now() + ttlOf(a.status, upstream.ttl) * 1000;
    },
    () => {
      if (cache.get(upstream.url) === slot) cache.delete(upstream.url);
    },
  );
  return answer;
}

export function handleCountyCa(pathname: string, cors: Record<string, string>): Promise<Response> {
  return relayFeed(countyCaUpstream(pathname), cors, "County election office");
}

/**
 * An election office's file, from the cache or fetched once for everyone
 * asking: the counties' feeds here, the states' in `stateFeeds.ts`. `upstream`
 * is null for a path no registry allows.
 */
export async function relayFeed(
  upstream: CountyUpstream | null,
  cors: Record<string, string>,
  source: string,
): Promise<Response> {
  if (!upstream) return new Response("Not Found", { status: 404, headers: cors });
  let answer: Answer;
  try {
    answer = await answerFor(upstream);
  } catch {
    return new Response("Election results unreachable", { status: 502, headers: cors });
  }
  const headers = new Headers(cors);
  headers.set("Content-Type", answer.contentType);
  headers.set("Cache-Control", `public, max-age=${ttlOf(answer.status, upstream.ttl)}`);
  if (answer.lastModified) headers.set("Last-Modified", answer.lastModified);
  headers.set("X-Data-Source", source);
  return new Response(answer.body, { status: answer.status, headers });
}

/** Tests only. */
export function clearCountyCaCache(): void {
  cache.clear();
}
