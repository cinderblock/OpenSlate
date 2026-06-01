import { verifySlate } from "@openslate/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBallotSource, createElectionsSource } from "./ballot";
import { createPollsSource } from "./polls";
import { createResultsSource } from "./results";

const VERSION = "0.0.0";
const ballot = createBallotSource();
const elections = createElectionsSource();
const polls = createPollsSource();
const results = createResultsSource();
const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "openslate", version: VERSION, storesUserData: false }),
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

// Optional ballot lookup proxy (Google Civic Information API). The address is
// forwarded upstream and never stored. Returns 501 when GOOGLE_API_KEY is unset.
app.get("/api/ballot", async (c) => {
  const address = c.req.query("address");
  const electionId = c.req.query("electionId");
  if (!address) return c.json({ error: "address query param required" }, 400);
  if (!ballot) return c.json({ error: "ballot lookup not configured (set GOOGLE_API_KEY)" }, 501);
  try {
    return c.json({ contests: await ballot.lookup(address, electionId) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "ballot lookup failed" }, 502);
  }
});

// List available elections (so the UI can let the user pick one). 501 when no key.
app.get("/api/elections", async (c) => {
  if (!elections)
    return c.json({ error: "elections lookup not configured (set GOOGLE_API_KEY)" }, 501);
  try {
    return c.json({ elections: await elections.list() });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "elections lookup failed" }, 502);
  }
});

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

// Example identity attestation document (see SPEC §7). A real host lists the keys
// it controls here so verifiers can attest `issuer.uri` -> key.
app.get("/.well-known/openslate.json", (c) =>
  c.json({ version: 1, name: "Example OpenSlate host", keys: [] }),
);

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
console.log(`OpenSlate server (stateless) listening on http://${hostname}:${port}`);

export default { port, hostname, fetch: app.fetch };
