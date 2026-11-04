/**
 * California Secretary of State election-night results
 * (`api.sos.ca.gov/returns/…`), relayed so a crowd of browsers costs the state
 * one request per contest per minute, not one each. The public worker and a
 * self-hosted apps/server both mount this. Stateless apart from a minute's
 * cache; stores and logs nothing.
 */

export const SOS_CA_UPSTREAM = "https://api.sos.ca.gov/returns";
export const SOS_CA_PREFIX = "/api/sos-ca/returns/";
export const SOS_CA_TTL_SECONDS = 60;
/** Failures are kept briefly too, so an outage upstream isn't repeated by every visitor. */
const SOS_CA_ERROR_TTL_SECONDS = 15;
/** Contest paths only: `governor`, `us-rep/district/16`, `ballot-measures/county/santa-clara`, `status`. */
const SOS_CA_PATH = /^[a-z-]+(\/district\/\d{1,2})?(\/county\/[a-z-]+)?$/;

export function sosCaUpstream(pathname: string): string | null {
  if (!pathname.startsWith(SOS_CA_PREFIX)) return null;
  const inner = pathname.slice(SOS_CA_PREFIX.length);
  return SOS_CA_PATH.test(inner) ? `${SOS_CA_UPSTREAM}/${inner}` : null;
}

interface Answer {
  status: number;
  contentType: string;
  body: string;
}

/**
 * One upstream request per contest at a time, and its answer reused until it
 * expires: what keeps a self-hosted server (no edge cache) from passing a crowd
 * straight through. On the worker the edge cache does the same across isolates.
 */
const cache = new Map<string, { until: number; answer: Promise<Answer> }>();

function ttlOf(status: number): number {
  return status >= 200 && status < 300 ? SOS_CA_TTL_SECONDS : SOS_CA_ERROR_TTL_SECONDS;
}

async function fetchUpstream(upstream: string): Promise<Answer> {
  const res = await fetch(upstream, {
    // Workers only: the edge cache, errors kept briefly. Ignored elsewhere.
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: {
        "200-299": SOS_CA_TTL_SECONDS,
        "400-599": SOS_CA_ERROR_TTL_SECONDS,
      },
    },
  } as RequestInit);
  return {
    status: res.status,
    contentType: res.headers.get("Content-Type") ?? "application/json",
    body: await res.text(),
  };
}

function answerFor(upstream: string): Promise<Answer> {
  const now = Date.now();
  const hit = cache.get(upstream);
  if (hit && hit.until > now) return hit.answer;
  const answer = fetchUpstream(upstream);
  // In flight, concurrent asks share it; once in, it's kept for its TTL.
  const slot = { until: now + SOS_CA_ERROR_TTL_SECONDS * 1000, answer };
  cache.set(upstream, slot);
  answer.then(
    (a) => {
      slot.until = Date.now() + ttlOf(a.status) * 1000;
    },
    () => {
      if (cache.get(upstream) === slot) cache.delete(upstream);
    },
  );
  return answer;
}

export async function handleSosCa(
  pathname: string,
  cors: Record<string, string>,
): Promise<Response> {
  const upstream = sosCaUpstream(pathname);
  if (!upstream) return new Response("Not Found", { status: 404, headers: cors });
  let answer: Answer;
  try {
    answer = await answerFor(upstream);
  } catch {
    return new Response("Secretary of State unreachable", { status: 502, headers: cors });
  }
  const headers = new Headers(cors);
  headers.set("Content-Type", answer.contentType);
  headers.set("Cache-Control", `public, max-age=${ttlOf(answer.status)}`);
  headers.set("X-Data-Source", "California Secretary of State");
  return new Response(answer.body, { status: answer.status, headers });
}

/** Tests only. */
export function clearSosCaCache(): void {
  cache.clear();
}
