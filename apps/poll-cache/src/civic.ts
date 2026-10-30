/**
 * Google Civic Information relay: the web app's "through OpenSlate" route to
 * Google's elections list and ballot lookup, for people who haven't brought
 * their own key (see plans/google-civic-two-ways.md). The worker and a
 * self-hosted apps/server both mount these handlers, each with its own key.
 *
 * Google's terms shape it: the key never leaves the relay; the routes answer
 * only what the app reads, so this isn't a stand-in for the Civic API; and
 * nothing is cached longer than Google's own cache header allows.
 *
 * Privacy: the ballot lookup's address arrives in a POST body, so it never
 * sits in a URL or a request log. It is passed to Google and forgotten: no
 * cache (in either direction), no logging, no storage.
 */

import {
  CivicError,
  civicUrl,
  normalizeVoterInfo,
  parseCivicElections,
  readCivic,
  type VipVoterInfo,
} from "@openslate/core/civic";

export const CIVIC_ELECTIONS_PATH = "/api/civic/elections";
export const CIVIC_VOTERINFO_PATH = "/api/civic/voterinfo";
/** Longer than any real one-line US address. */
export const MAX_CIVIC_ADDRESS_LENGTH = 200;
/** Used when Google sends no cache header: an hour, well inside its guidelines. */
const ELECTIONS_FALLBACK_CACHE = "public, max-age=3600";

export interface CivicRelayConfig {
  /** The relay's Google API key; without one, the routes answer 501. */
  key?: string;
  /** Override the API base, for tests. */
  base?: string;
}

/**
 * CORS headers for the civic routes: they name the origin only when it's one
 * of `allowed`, or a local development server, so other sites' pages can't use
 * the relay's key. (Scripts outside a browser ignore CORS; this keeps the relay
 * from serving as a public Civic API for other web apps.)
 */
export function civicCors(
  origin: string | null,
  allowed: readonly string[],
  methods: string,
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!origin || !(allowed.includes(origin) || isLocalOrigin(origin))) return headers;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string>,
  cacheControl = "no-store",
): Response {
  return Response.json(body, { status, headers: { ...headers, "Cache-Control": cacheControl } });
}

const notConfigured = (cors: Record<string, string>) =>
  json({ error: "this relay has no Google key, so it can't ask Google" }, 501, cors);

/**
 * Google saying "not now" rather than "no": the relay's quota is spent or
 * Google is overloaded. Nothing is wrong with the request or the key, and it
 * passes on its own. 403 is how older paths say quota; other 403s (a
 * referrer-restricted key, say) are the relay's own problem.
 */
function isOverloaded(err: unknown): boolean {
  if (!(err instanceof CivicError)) return false;
  if (err.status === 429 || err.status === 503) return true;
  return err.status === 403 && /quota|limit exceeded/i.test(err.message);
}

const overloaded = (cors: Record<string, string>) =>
  json({ error: "OpenSlate's Google lookups are used up for now" }, 503, cors);

/** GET → `{ elections: CivicElection[] }`, cacheable as long as Google says. */
export async function handleCivicElections(
  req: Request,
  config: CivicRelayConfig,
  cors: Record<string, string>,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "GET the list" }, 405, { ...cors, Allow: "GET, OPTIONS" });
  }
  if (!config.key) return notConfigured(cors);
  let upstream: Response;
  try {
    upstream = await fetch(civicUrl("elections", config.key, {}, config.base));
  } catch {
    return json({ error: "Google didn't answer" }, 502, cors);
  }
  try {
    const elections = parseCivicElections(await readCivic(upstream));
    return json(
      { elections },
      200,
      cors,
      upstream.headers.get("Cache-Control") ?? ELECTIONS_FALLBACK_CACHE,
    );
  } catch (err) {
    if (isOverloaded(err)) return overloaded(cors);
    return json({ error: err instanceof Error ? err.message : "unexpected answer" }, 502, cors);
  }
}

/** POST `{ address, electionId? }` → the normalized `CivicBallot`. Never cached. */
export async function handleCivicVoterInfo(
  req: Request,
  config: CivicRelayConfig,
  cors: Record<string, string>,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "POST an address" }, 405, { ...cors, Allow: "POST, OPTIONS" });
  }
  if (!config.key) return notConfigured(cors);
  let body: { address?: unknown; electionId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "expected a JSON body" }, 400, cors);
  }
  const { address, electionId } = body ?? {};
  if (typeof address !== "string" || !address.trim()) {
    return json({ error: "address is required" }, 400, cors);
  }
  const trimmed = address.trim().replace(/\s+/g, " ");
  if (trimmed.length > MAX_CIVIC_ADDRESS_LENGTH) {
    return json(
      { error: `address is longer than ${MAX_CIVIC_ADDRESS_LENGTH} characters` },
      400,
      cors,
    );
  }
  if (electionId !== undefined && (typeof electionId !== "string" || !/^\d+$/.test(electionId))) {
    return json({ error: "electionId must be Google's numeric election id" }, 400, cors);
  }

  const params: Record<string, string> = { address: trimmed };
  if (electionId) params.electionId = electionId;
  let upstream: Response;
  try {
    upstream = await fetch(civicUrl("voterinfo", config.key, params, config.base), {
      cache: "no-store",
    });
  } catch {
    return json({ error: "Google didn't answer" }, 502, cors);
  }
  try {
    return json(normalizeVoterInfo((await readCivic(upstream)) as VipVoterInfo), 200, cors);
  } catch (err) {
    if (isOverloaded(err)) return overloaded(cors);
    // A 400 or 404 is about the address or election ("Failed to parse
    // address", "Election unknown"): pass Google's reason on as the asker's
    // problem. Anything else, a bad relay key included, is the relay's.
    const aboutInput =
      err instanceof CivicError &&
      (err.status === 400 || err.status === 404) &&
      !/API key/i.test(err.message);
    const status = aboutInput ? 422 : 502;
    return json({ error: err instanceof Error ? err.message : "unexpected answer" }, status, cors);
  }
}
