import { verifySlate } from "@openslate/core";
import {
  CIVIC_ELECTIONS_PATH,
  CIVIC_VOTERINFO_PATH,
  type CivicRelayConfig,
  civicCors,
  handleCivicElections,
  handleCivicVoterInfo,
} from "@openslate/poll-cache/civic";
import { GEOCODE_PATH, handleGeocode } from "@openslate/poll-cache/geocode";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createForecastsSource } from "./forecasts";
import { createPollsSource } from "./polls";
import { createResultsSource } from "./results";

const VERSION = "0.0.0";
// Optional Google Civic Information (elections list, ballot by address), the
// same relay the public worker runs (apps/poll-cache/src/civic.ts), with this
// server's own key. Without GOOGLE_API_KEY those routes answer 501.
const civic: CivicRelayConfig = {
  ...(process.env.GOOGLE_API_KEY ? { key: process.env.GOOGLE_API_KEY } : {}),
  ...(process.env.GOOGLE_API_BASE ? { base: process.env.GOOGLE_API_BASE } : {}),
};
const civicOrigins = (process.env.CIVIC_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const CIVIC_PATHS = new Set([CIVIC_ELECTIONS_PATH, CIVIC_VOTERINFO_PATH]);
const polls = createPollsSource();
const results = createResultsSource();
const forecasts = createForecastsSource();
const app = new Hono();

// Open CORS everywhere but the civic routes: those spend this server's Google
// key, so only its own pages (same origin) and CIVIC_ALLOWED_ORIGINS may use them.
const openCors = cors();
app.use("/api/*", (c, next) => (CIVIC_PATHS.has(c.req.path) ? next() : openCors(c, next)));

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "openslate",
    version: VERSION,
    storesUserData: false,
    // Lets the web app offer Google only when this server can ask it.
    civic: civic.key !== undefined,
  }),
);

// Convenience for thin clients. Stateless: the token is verified and the result
// returned; nothing is persisted or logged.
app.post("/api/verify", async (c) => {
  let token: unknown;
  try {
    token = (await c.req.json<{ token?: unknown }>()).token;
  } catch {
    return c.json({ error: "expected a JSON body" }, 400);
  }
  if (typeof token !== "string") return c.json({ error: "expected { token: string }" }, 400);
  return c.json(verifySlate(token));
});

// Address → districts via the Census geocoder, the same relay the public
// worker runs (apps/poll-cache/src/geocode.ts): opt-in in the web app, the
// address is forwarded and forgotten.
app.post(GEOCODE_PATH, (c) => handleGeocode(c.req.raw, {}));

// Google Civic Information: the elections list and the ballot for an address.
for (const [path, handle, methods] of [
  [CIVIC_ELECTIONS_PATH, handleCivicElections, "GET, OPTIONS"],
  [CIVIC_VOTERINFO_PATH, handleCivicVoterInfo, "POST, OPTIONS"],
] as const) {
  app.on(["GET", "POST", "OPTIONS"], path, (c) => {
    const headers = civicCors(c.req.header("Origin") ?? null, civicOrigins, methods);
    if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    return handle(c.req.raw, civic, headers);
  });
}

// Polls passthrough — matches @openslate/poll-cache (Cloudflare Worker) so the
// web client treats either as the source of truth. Short in-memory TTL keeps
// VoteHub from being hammered when self-hosted at scale.
const POLLS_PATHS = ["/api/polls", "/api/pollsters", "/api/subjects", "/api/poll-types"];
for (const prefix of POLLS_PATHS) {
  app.get(`${prefix}/*`, (c) => proxyPoll(c.req.path, c.req.url));
  app.get(prefix, (c) => proxyPoll(c.req.path, c.req.url));
}

async function proxyPoll(reqPath: string, reqUrl: string) {
  const upstreamPath = reqPath.replace(/^\/api/, "");
  const search = new URL(reqUrl).search;
  try {
    const { status, contentType, body } = await polls.proxy(upstreamPath, search);
    return new Response(body, {
      status,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=900, stale-while-revalidate=3600",
        "x-data-source": "VoteHub (CC BY 4.0)",
        "x-data-license": "https://creativecommons.org/licenses/by/4.0/",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "polls lookup failed" },
      { status: 502 },
    );
  }
}

// civicAPI results passthrough. Mounted under /api/results/v2/* so it 1:1
// mirrors civicAPI's /api/v2/* path layout — the web client just retargets
// VITE_RESULTS_BASE at the server prefix and everything else lines up.
// Adaptive TTL: 30s while a race is mid-count, 15min once settled.
app.get("/api/results/v2/*", (c) => proxyResults(c.req.path, c.req.url));
app.get("/api/results/v2", (c) => proxyResults(c.req.path, c.req.url));

async function proxyResults(reqPath: string, reqUrl: string) {
  const upstreamPath = reqPath.replace(/^\/api\/results\/v2/, "");
  const search = new URL(reqUrl).search;
  try {
    const { status, contentType, body, ttlMs } = await results.proxy(upstreamPath, search);
    const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
    return new Response(body, {
      status,
      headers: {
        "content-type": contentType,
        "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 4}`,
        "x-data-source": "civicAPI",
        "x-data-license": "https://civicapi.org",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "results lookup failed" },
      { status: 502 },
    );
  }
}

// Kalshi forecasts passthrough — mounted at /api/forecasts/v2/* so the SPA's
// VITE_FORECASTS_BASE points here. Kalshi's CORS only allows kalshi.com, so
// this proxy is REQUIRED for browser access (the web client honours that and
// pins kalshi to proxy mode in lib/routing.ts).
app.get("/api/forecasts/v2/*", (c) => proxyForecasts(c.req.path, c.req.url));
app.get("/api/forecasts/v2", (c) => proxyForecasts(c.req.path, c.req.url));

async function proxyForecasts(reqPath: string, reqUrl: string) {
  const upstreamPath = reqPath.replace(/^\/api\/forecasts\/v2/, "");
  const search = new URL(reqUrl).search;
  try {
    const { status, contentType, body, ttlMs, stale } = await forecasts.proxy(upstreamPath, search);
    const maxAge = Math.floor(ttlMs / 1000);
    // Same headers as the Cloudflare relay (apps/poll-cache/src/forecasts.ts):
    // errors and stale copies are never cached, and a stale copy says so.
    const headers: Record<string, string> = {
      "content-type": contentType,
      "cache-control":
        maxAge > 0 ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 4}` : "no-store",
      "x-data-source": "Kalshi",
      "x-data-license": "https://kalshi.com/legal",
    };
    if (stale) {
      headers["x-openslate-stale"] = "true";
      headers["x-openslate-fetched-at"] = new Date(stale.fetchedAt).toISOString();
      headers["x-openslate-upstream-status"] = String(stale.upstreamStatus);
    }
    return new Response(body, { status, headers });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "forecasts lookup failed" },
      { status: 502 },
    );
  }
}

// Example identity attestation document (see SPEC §7). A real host lists the keys
// it controls here so verifiers can attest `issuer.uri` -> key.
app.get("/.well-known/openslate.json", (c) =>
  c.json({ version: 1, name: "Example OpenSlate host", keys: [] }),
);

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
console.log(`OpenSlate server (stateless) listening on http://${hostname}:${port}`);

export default { port, hostname, fetch: app.fetch };
