/**
 * Kalshi forecasts relay. Kalshi refuses cross-origin browser calls (403 from
 * its CloudFront to any Origin but kalshi.com), so the web app reads market
 * prices through here.
 *
 * Kalshi also rate-limits hard, and an error must never be what everyone gets
 * served for the next while: only 2xx and 404 (no such event, a real answer)
 * are cached, and every good answer is kept as a "last good" copy in this
 * datacenter's cache. When Kalshi errors, the relay serves that copy, marked
 * stale (`X-OpenSlate-Stale`, with when it was fetched), rather than the error.
 * See plans/kalshi-forecasts-429.md.
 */

export const FORECASTS_PREFIX = "/api/forecasts/v2";
export const FORECASTS_UPSTREAM = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi markets trade continuously; keep cache short, SWR moderate.
const FORECASTS_TTL_SECONDS = 30;
const FORECASTS_SWR_SECONDS = 5 * 60;
// A 404 means the ticker doesn't exist. The web app guesses up to four tickers
// per race, most of which don't, so those answers are worth keeping longer.
const FORECASTS_MISSING_TTL_SECONDS = 15 * 60;
// How long a last good copy may stand in for Kalshi. Long enough to ride out
// a day of refusals; the reader sees how old it is.
const LAST_GOOD_SECONDS = 7 * 24 * 60 * 60;

const USER_AGENT = "OpenSlate forecasts relay (+https://openslate.us)";

/** Response headers the web app reads to tell a stale copy from a fresh one. */
export const STALE_HEADER = "X-OpenSlate-Stale";
export const FETCHED_AT_HEADER = "X-OpenSlate-Fetched-At";
export const UPSTREAM_STATUS_HEADER = "X-OpenSlate-Upstream-Status";

export interface ForecastsDeps {
  /** Where last good copies live: `caches.default` in the worker. Absent → none kept. */
  cache?: Cache;
  /** Lets cache writes finish after the response is sent (`ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function isForecastsPath(pathname: string): boolean {
  return pathname === FORECASTS_PREFIX || pathname.startsWith(`${FORECASTS_PREFIX}/`);
}

export async function handleForecasts(
  url: URL,
  cors: Record<string, string>,
  deps: ForecastsDeps = {},
): Promise<Response> {
  const upstream = new URL(FORECASTS_UPSTREAM);
  upstream.pathname += url.pathname.slice(FORECASTS_PREFIX.length);
  upstream.search = url.search;
  const lastGoodKey = `${url.origin}/__last-good${url.pathname}${url.search}`;

  const headers = new Headers(cors);
  headers.set(
    "Access-Control-Expose-Headers",
    [STALE_HEADER, FETCHED_AT_HEADER, UPSTREAM_STATUS_HEADER].join(", "),
  );
  headers.set("X-Data-Source", "Kalshi");
  headers.set("X-Data-License", "https://kalshi.com/legal");

  let upstreamRes: Response | undefined;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          "200-299": FORECASTS_TTL_SECONDS,
          "404": FORECASTS_MISSING_TTL_SECONDS,
          "300-399": -1,
          "400-403": -1,
          "405-599": -1,
        },
      },
    });
  } catch {
    // Network failure: treated like an upstream error below.
  }

  if (upstreamRes?.ok || upstreamRes?.status === 404) {
    const body = await upstreamRes.arrayBuffer();
    const contentType = upstreamRes.headers.get("Content-Type") ?? "application/json";
    headers.set("Content-Type", contentType);
    if (upstreamRes.ok) {
      headers.set(
        "Cache-Control",
        `public, max-age=${FORECASTS_TTL_SECONDS}, stale-while-revalidate=${FORECASTS_SWR_SECONDS}`,
      );
      // An edge-cache hit is a copy we already kept when it was fetched.
      if (deps.cache && upstreamRes.headers.get("CF-Cache-Status") !== "HIT") {
        const write = deps.cache
          .put(
            lastGoodKey,
            new Response(body, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": `public, max-age=${LAST_GOOD_SECONDS}`,
                [FETCHED_AT_HEADER]: new Date().toISOString(),
              },
            }),
          )
          .catch(() => {});
        if (deps.waitUntil) deps.waitUntil(write);
        else await write;
      }
    } else {
      headers.set("Cache-Control", `public, max-age=${FORECASTS_MISSING_TTL_SECONDS}`);
    }
    return new Response(body, { status: upstreamRes.status, headers });
  }

  // Kalshi errored (429, 5xx, …) or didn't answer. Nothing here may be cached:
  // the next request should ask Kalshi again.
  const upstreamStatus = upstreamRes?.status ?? 502;
  headers.set("Cache-Control", "no-store");
  headers.set(UPSTREAM_STATUS_HEADER, String(upstreamStatus));

  const lastGood = await deps.cache?.match(lastGoodKey).catch(() => undefined);
  if (lastGood) {
    headers.set("Content-Type", lastGood.headers.get("Content-Type") ?? "application/json");
    headers.set(STALE_HEADER, "true");
    const fetchedAt = lastGood.headers.get(FETCHED_AT_HEADER);
    if (fetchedAt) headers.set(FETCHED_AT_HEADER, fetchedAt);
    return new Response(lastGood.body, { status: 200, headers });
  }

  const retryAfter = upstreamRes?.headers.get("Retry-After");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  if (!upstreamRes) {
    return Response.json(
      { error: { code: "upstream_unreachable", message: "Kalshi didn't answer" } },
      { status: 502, headers },
    );
  }
  headers.set("Content-Type", upstreamRes.headers.get("Content-Type") ?? "application/json");
  return new Response(upstreamRes.body, { status: upstreamStatus, headers });
}
