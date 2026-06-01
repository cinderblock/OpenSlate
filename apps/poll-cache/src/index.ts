const POLLS_UPSTREAM = "https://api.votehub.com";
const RESULTS_UPSTREAM = "https://civicapi.org/api/v2";
const FORECASTS_UPSTREAM = "https://api.elections.kalshi.com/trade-api/v2";

const POLLS_CACHE_TTL_SECONDS = 15 * 60;
const POLLS_SWR_SECONDS = 60 * 60;

// civicAPI race detail moves second-by-second on election night; the polls
// endpoints don't. The worker uses cf.cacheTtl, which is a single value per
// request, so we pick conservatively based on the path: race detail = live,
// everything else = settled.
const RESULTS_LIVE_TTL_SECONDS = 30;
const RESULTS_LIVE_SWR_SECONDS = 5 * 60;
const RESULTS_SETTLED_TTL_SECONDS = 15 * 60;
const RESULTS_SETTLED_SWR_SECONDS = 60 * 60;

// Kalshi markets trade continuously; keep cache short, SWR moderate.
const FORECASTS_TTL_SECONDS = 30;
const FORECASTS_SWR_SECONDS = 5 * 60;

const POLLS_PROXY_PATHS = ["/api/polls", "/api/pollsters", "/api/subjects", "/api/poll-types"];
const RESULTS_PREFIX = "/api/results/v2";
const FORECASTS_PREFIX = "/api/forecasts/v2";

function isPollsProxyPath(pathname: string): boolean {
  for (const prefix of POLLS_PROXY_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function isResultsProxyPath(pathname: string): boolean {
  return pathname === RESULTS_PREFIX || pathname.startsWith(`${RESULTS_PREFIX}/`);
}

function isForecastsProxyPath(pathname: string): boolean {
  return pathname === FORECASTS_PREFIX || pathname.startsWith(`${FORECASTS_PREFIX}/`);
}

function isLiveRaceDetailPath(pathname: string): boolean {
  // Matches `/api/results/v2/race/{id}` exactly (excludes /race/search and
  // /race/{id}/history).
  const inner = pathname.slice(RESULTS_PREFIX.length);
  return /^\/race\/[^/]+$/.test(inner) && !inner.startsWith("/race/search");
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
    }

    const url = new URL(req.url);

    if (url.pathname === "/api/health" || url.pathname === "/") {
      return Response.json(
        {
          status: "ok",
          service: "openslate-poll-cache",
          polls_upstream: POLLS_UPSTREAM,
          results_upstream: RESULTS_UPSTREAM,
          forecasts_upstream: FORECASTS_UPSTREAM,
        },
        { headers: corsHeaders() },
      );
    }

    if (isPollsProxyPath(url.pathname)) {
      return proxyPolls(url);
    }
    if (isResultsProxyPath(url.pathname)) {
      return proxyResults(url);
    }
    if (isForecastsProxyPath(url.pathname)) {
      return proxyForecasts(url);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};

async function proxyPolls(url: URL): Promise<Response> {
  const upstream = new URL(POLLS_UPSTREAM);
  upstream.pathname = url.pathname.replace(/^\/api/, "");
  upstream.search = url.search;

  const upstreamRes = await fetch(upstream.toString(), {
    cf: { cacheTtl: POLLS_CACHE_TTL_SECONDS, cacheEverything: true },
  });

  const headers = new Headers(upstreamRes.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  headers.set(
    "Cache-Control",
    `public, max-age=${POLLS_CACHE_TTL_SECONDS}, stale-while-revalidate=${POLLS_SWR_SECONDS}`,
  );
  headers.set("X-Data-Source", "VoteHub (CC BY 4.0)");
  headers.set("X-Data-License", "https://creativecommons.org/licenses/by/4.0/");
  headers.delete("Set-Cookie");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
}

async function proxyResults(url: URL): Promise<Response> {
  const live = isLiveRaceDetailPath(url.pathname);
  const ttl = live ? RESULTS_LIVE_TTL_SECONDS : RESULTS_SETTLED_TTL_SECONDS;
  const swr = live ? RESULTS_LIVE_SWR_SECONDS : RESULTS_SETTLED_SWR_SECONDS;

  const upstream = new URL(RESULTS_UPSTREAM);
  upstream.pathname += url.pathname.slice(RESULTS_PREFIX.length);
  upstream.search = url.search;

  const upstreamRes = await fetch(upstream.toString(), {
    cf: { cacheTtl: ttl, cacheEverything: true },
  });

  const headers = new Headers(upstreamRes.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  headers.set("Cache-Control", `public, max-age=${ttl}, stale-while-revalidate=${swr}`);
  headers.set("X-Data-Source", "civicAPI");
  headers.set("X-Data-License", "https://civicapi.org");
  headers.delete("Set-Cookie");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
}

async function proxyForecasts(url: URL): Promise<Response> {
  const upstream = new URL(FORECASTS_UPSTREAM);
  upstream.pathname += url.pathname.slice(FORECASTS_PREFIX.length);
  upstream.search = url.search;

  const upstreamRes = await fetch(upstream.toString(), {
    cf: { cacheTtl: FORECASTS_TTL_SECONDS, cacheEverything: true },
  });

  const headers = new Headers(upstreamRes.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  headers.set(
    "Cache-Control",
    `public, max-age=${FORECASTS_TTL_SECONDS}, stale-while-revalidate=${FORECASTS_SWR_SECONDS}`,
  );
  headers.set("X-Data-Source", "Kalshi");
  headers.set("X-Data-License", "https://kalshi.com/legal");
  headers.delete("Set-Cookie");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
}
