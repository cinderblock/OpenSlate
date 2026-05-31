import { verifySlate } from "@openslate/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBallotSource, createElectionsSource } from "./ballot";

const VERSION = "0.0.0";
const ballot = createBallotSource();
const elections = createElectionsSource();
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

// Example identity attestation document (see SPEC §7). A real host lists the keys
// it controls here so verifiers can attest `issuer.uri` -> key.
app.get("/.well-known/openslate.json", (c) =>
  c.json({ version: 1, name: "Example OpenSlate host", keys: [] }),
);

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
console.log(`OpenSlate server (stateless) listening on http://${hostname}:${port}`);

export default { port, hostname, fetch: app.fetch };
