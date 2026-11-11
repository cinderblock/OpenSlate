import {
  CIVIC_ELECTIONS_PATH,
  CIVIC_VOTERINFO_PATH,
  civicCors,
  handleCivicElections,
  handleCivicVoterInfo,
} from "./civic";
import { COUNTY_CA_PREFIX, handleCountyCa } from "./countyCa";
import { GEOCODE_PATH, handleGeocode } from "./geocode";
import {
  HISTORY_PREFIX,
  LIVE_PREFIX,
  RECORDER_STATUS_PATH,
  serveHistory,
  serveLive,
  serveRecorded,
  serveStatus,
  startRecorders,
} from "./recorded";
import type { Recorder } from "./recorder";
import { handleSosCa, SOS_CA_PREFIX, SOS_CA_UPSTREAM } from "./sosCa";
import { handleStateFeed, STATE_FEEDS_PREFIX } from "./stateFeeds";

export interface Env {
  /** Secret: OpenSlate's Google Civic Information API key. Unset → the civic routes answer 501. */
  GOOGLE_CIVIC_API_KEY?: string;
  /** Comma-separated origins whose pages may use the civic routes (wrangler.toml). */
  CIVIC_ALLOWED_ORIGINS?: string;
  /** The results recorder (recorder.ts), one per feed. Unset in tests: results pass through. */
  RECORDER?: DurableObjectNamespace<Recorder>;
  /** The recorder's audit trail: every report as fetched (R2 bucket openslate-reports). */
  REPORTS?: R2Bucket;
}

export { Recorder } from "./recorder";

/** The recorder's bindings, when this deployment has them. */
function recorderOf(env: Env) {
  return env.RECORDER && env.REPORTS ? { RECORDER: env.RECORDER, REPORTS: env.REPORTS } : null;
}

const POLLS_UPSTREAM = "https://api.votehub.com";
const RESULTS_UPSTREAM = "https://civicapi.org/api/v2";

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
const RESULTS_ERROR_TTL_SECONDS = 15;

const POLLS_PROXY_PATHS = ["/api/polls", "/api/pollsters", "/api/subjects", "/api/poll-types"];
const RESULTS_PREFIX = "/api/results/v2";

function isPollsProxyPath(pathname: string): boolean {
  for (const prefix of POLLS_PROXY_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function isResultsProxyPath(pathname: string): boolean {
  return pathname === RESULTS_PREFIX || pathname.startsWith(`${RESULTS_PREFIX}/`);
}

function isLiveRaceDetailPath(pathname: string): boolean {
  // Matches `/api/results/v2/race/{id}` exactly (excludes /race/search and
  // /race/{id}/history).
  const inner = pathname.slice(RESULTS_PREFIX.length);
  return /^\/race\/[^/]+$/.test(inner) && !inner.startsWith("/race/search");
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(req: Request, env: Env = {}, ctx?: ExecutionContext): Promise<Response> {
    // Google Civic lookups use the relay's own key (see civic.ts), so they only
    // answer pages from OpenSlate's origins.
    const pathname = new URL(req.url).pathname;
    if (pathname === CIVIC_ELECTIONS_PATH || pathname === CIVIC_VOTERINFO_PATH) {
      const elections = pathname === CIVIC_ELECTIONS_PATH;
      const cors = civicCors(
        req.headers.get("Origin"),
        (env.CIVIC_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
        elections ? "GET, OPTIONS" : "POST, OPTIONS",
      );
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const config = { key: env.GOOGLE_CIVIC_API_KEY };
      return elections
        ? handleCivicElections(req, config, cors)
        : handleCivicVoterInfo(req, config, cors);
    }
    // The address relay is the one POST route; it keeps nothing (see geocode.ts).
    if (new URL(req.url).pathname === GEOCODE_PATH) {
      const cors = { ...corsHeaders(), "Access-Control-Allow-Methods": "POST, OPTIONS" };
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      return handleGeocode(req, cors);
    }
    // A feed's WebSocket: each new report as the recorder sees it.
    const recorder = recorderOf(env);
    if (pathname.startsWith(LIVE_PREFIX)) {
      if (!recorder) return new Response("Not Found", { status: 404 });
      return serveLive(recorder, req, pathname);
    }
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
          sos_ca_upstream: SOS_CA_UPSTREAM,
          county_ca: COUNTY_CA_PREFIX,
          state_feeds: STATE_FEEDS_PREFIX,
          // The recorder: results from its copy, history, and live reports over a WebSocket.
          recorder: Boolean(recorder),
          geocode: GEOCODE_PATH,
          // Whether this relay can ask Google (it has a key): the web app
          // offers "Google (via OpenSlate)" only then.
          civic: Boolean(env.GOOGLE_CIVIC_API_KEY),
          civic_elections: CIVIC_ELECTIONS_PATH,
          civic_voterinfo: CIVIC_VOTERINFO_PATH,
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
    if (url.pathname === RECORDER_STATUS_PATH) {
      if (!recorder) return new Response("Not Found", { status: 404, headers: corsHeaders() });
      return serveStatus(recorder, corsHeaders());
    }
    if (url.pathname.startsWith(HISTORY_PREFIX)) {
      if (!recorder) return new Response("Not Found", { status: 404, headers: corsHeaders() });
      return serveHistory(recorder, url.pathname, corsHeaders());
    }
    // Results the recorder keeps come from its copy; the rest pass through, as
    // does everything if the recorder can't answer (still one cached request
    // per file per minute to the source, as before the recorder).
    if (recorder && ctx) {
      try {
        const recorded = await serveRecorded(recorder, url, corsHeaders(), ctx);
        if (recorded) return recorded;
      } catch {
        // Passed through below.
      }
    }
    if (url.pathname.startsWith(SOS_CA_PREFIX)) {
      return handleSosCa(url.pathname, corsHeaders());
    }
    if (url.pathname.startsWith(COUNTY_CA_PREFIX)) {
      return handleCountyCa(url.pathname, corsHeaders());
    }
    if (url.pathname.startsWith(STATE_FEEDS_PREFIX)) {
      return handleStateFeed(url.pathname, corsHeaders());
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },

  /** The cron (wrangler.toml): keep every feed's recorder checking. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const recorder = recorderOf(env);
    if (recorder) ctx.waitUntil(startRecorders(recorder));
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

  // An outage's errors are kept seconds, not the success TTL, so the relay
  // recovers when civicAPI does without every visitor retrying it meanwhile.
  const upstreamRes = await fetch(upstream.toString(), {
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": ttl, "404": ttl, "500-599": RESULTS_ERROR_TTL_SECONDS },
    },
  });

  const headers = new Headers(upstreamRes.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  headers.set(
    "Cache-Control",
    upstreamRes.ok
      ? `public, max-age=${ttl}, stale-while-revalidate=${swr}`
      : `public, max-age=${RESULTS_ERROR_TTL_SECONDS}`,
  );
  headers.set("X-Data-Source", "civicAPI");
  headers.set("X-Data-License", "https://civicapi.org");
  headers.delete("Set-Cookie");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
}
