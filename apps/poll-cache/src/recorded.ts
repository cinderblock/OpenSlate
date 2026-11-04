/**
 * The relay's side of the recorder (recorder.ts): answering results requests
 * from the recorder's copy, a race's recorded history, and a feed's WebSocket.
 * The worker only; a self-hosted apps/server has no recorder and passes results
 * through as before.
 */

import { countyCountPath } from "@openslate/core/countyReport";
import { CA_COUNTY_FEEDS } from "@openslate/core/countyResults";
import { sosRecordedPaths } from "@openslate/core/liveRecord";
import { isRaceHistory } from "@openslate/core/raceHistory";
import { COUNTY_CA_PREFIX, countyCaUpstream } from "./countyCa";
import { isRecordedFeed, type Latest, type RecorderEnv, recordedFeeds, SOS_FEED } from "./recorder";
import { SOS_CA_PREFIX, sosCaUpstream } from "./sosCa";

export const LIVE_PREFIX = "/api/live/";
export const HISTORY_PREFIX = "/api/history/";

/** Headers a page may read off a recorded answer. */
const EXPOSED = "X-Report-Version, X-Checked-At, X-Ready-By";
/** An answer asked for by report (`?v=`) never changes. */
const VERSIONED_TTL_S = 60 * 60;
/** Bounds on an unversioned answer's life: it's good until the next check's report is in. */
const MIN_TTL_S = 3;
const MAX_TTL_S = 60;
const CACHE_ORIGIN = "https://recorder.cache.openslate.invalid";

const SOS_RECORDED = new Set(sosRecordedPaths());

/**
 * Which feed and file a relay path is, when it's one the recorder keeps: the
 * state's whole-state documents, and each county's count (Clarity: its version
 * pointer and a versioned summary). Anything else (a contest's per-county
 * breakdown) passes through without asking the recorder.
 */
export function recordedFile(pathname: string): { feed: string; path: string } | null {
  if (pathname.startsWith(SOS_CA_PREFIX)) {
    const path = pathname.slice(SOS_CA_PREFIX.length);
    return sosCaUpstream(pathname) && SOS_RECORDED.has(path) ? { feed: SOS_FEED, path } : null;
  }
  if (pathname.startsWith(COUNTY_CA_PREFIX) && countyCaUpstream(pathname)) {
    const inner = pathname.slice(COUNTY_CA_PREFIX.length);
    const slash = inner.indexOf("/");
    const feed = inner.slice(0, slash);
    const path = inner.slice(slash + 1);
    const county = CA_COUNTY_FEEDS[feed];
    if (!county) return null;
    const kept =
      county.kind === "clarity"
        ? path === countyCountPath(county) || /^\d{1,9}\/json\/en\/summary\.json$/.test(path)
        : path === countyCountPath(county);
    return kept ? { feed, path } : null;
  }
  return null;
}

function stub(env: RecorderEnv, feed: string) {
  return env.RECORDER.get(env.RECORDER.idFromName(feed));
}

/** Seconds an answer stays good: until the recorder's next report is in, or for good by version. */
export function answerTtl(
  latest: Pick<Latest, "readyBy">,
  versioned: boolean,
  now: number,
): number {
  if (versioned) return VERSIONED_TTL_S;
  if (latest.readyBy === undefined) return MAX_TTL_S;
  return Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, Math.ceil((latest.readyBy - now) / 1000)));
}

async function bodyOf(
  env: RecorderEnv,
  r2Key: string,
  ctx: ExecutionContext,
): Promise<string | null> {
  const key = new Request(`${CACHE_ORIGIN}/r2/${encodeURI(r2Key)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.text();
  const object = await env.REPORTS.get(r2Key);
  if (!object) return null;
  const text = await object.text();
  // A kept copy never changes: the next report is a new key.
  ctx.waitUntil(
    cache.put(key, new Response(text, { headers: { "Cache-Control": "public, max-age=86400" } })),
  );
  return text;
}

/**
 * A results file from the recorder's copy, or null when it keeps none yet (the
 * caller passes the request through to the source, as before).
 */
export async function serveRecorded(
  env: RecorderEnv,
  url: URL,
  cors: Record<string, string>,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const file = recordedFile(url.pathname);
  if (!file) return null;
  const v = url.searchParams.get("v");
  const versioned = v !== null && /^\d{1,15}$/.test(v);
  const key = new Request(`${CACHE_ORIGIN}/${file.feed}/${file.path}${versioned ? `?v=${v}` : ""}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const latest = await stub(env, file.feed).latest(file.path);
  if (!latest) return null;
  const body = await bodyOf(env, latest.r2Key, ctx);
  if (body === null) return null;
  const ttl = answerTtl(latest, versioned, Date.now());
  const headers = new Headers(cors);
  headers.set("Access-Control-Expose-Headers", EXPOSED);
  headers.set("Content-Type", latest.contentType);
  headers.set("Cache-Control", `public, max-age=${ttl}`);
  if (latest.lastModified !== undefined)
    headers.set("Last-Modified", new Date(latest.lastModified).toUTCString());
  headers.set("X-Report-Version", String(latest.version));
  if (latest.checkedAt !== undefined) headers.set("X-Checked-At", String(latest.checkedAt));
  if (latest.readyBy !== undefined) headers.set("X-Ready-By", String(latest.readyBy));
  headers.set(
    "X-Data-Source",
    file.feed === SOS_FEED ? "California Secretary of State" : "County election office",
  );
  const res = new Response(body, { status: 200, headers });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/** `/api/history/<feed>/<race id>`: the recorder's history of one race. */
export async function serveHistory(
  env: RecorderEnv,
  pathname: string,
  cors: Record<string, string>,
): Promise<Response> {
  const inner = pathname.slice(HISTORY_PREFIX.length);
  const slash = inner.indexOf("/");
  const feed = slash > 0 ? inner.slice(0, slash) : "";
  const id = decodeURIComponent(inner.slice(slash + 1));
  const headers = new Headers(cors);
  if (!isRecordedFeed(feed) || !id || id.length > 300)
    return new Response("Not Found", { status: 404, headers });
  const history = await stub(env, feed).history(id);
  headers.set("Cache-Control", "public, max-age=30");
  if (!history || !isRaceHistory(history))
    return new Response("No history recorded", { status: 404, headers });
  return Response.json(history, { headers });
}

/** `/api/live/<feed>`: a WebSocket that hears each new report. */
export async function serveLive(
  env: RecorderEnv,
  request: Request,
  pathname: string,
): Promise<Response> {
  const feed = pathname.slice(LIVE_PREFIX.length);
  if (!isRecordedFeed(feed)) return new Response("Not Found", { status: 404 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("Expected a WebSocket", { status: 426 });
  return stub(env, feed).fetch(request);
}

/** The cron: every feed's recorder running, so a lost alarm is found within minutes. */
export async function startRecorders(env: RecorderEnv): Promise<void> {
  await Promise.all(recordedFeeds().map((feed) => stub(env, feed).start(feed)));
}
