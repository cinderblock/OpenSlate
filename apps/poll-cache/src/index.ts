const UPSTREAM = "https://api.votehub.com";
const CACHE_TTL_SECONDS = 15 * 60;
const SWR_SECONDS = 60 * 60;

const PROXY_PATHS = ["/api/polls", "/api/pollsters", "/api/subjects", "/api/poll-types"];

function isProxyPath(pathname: string): boolean {
  for (const prefix of PROXY_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
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
        { status: "ok", service: "openslate-poll-cache", upstream: UPSTREAM },
        { headers: corsHeaders() },
      );
    }

    if (!isProxyPath(url.pathname)) {
      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    }

    const upstream = new URL(UPSTREAM);
    upstream.pathname = url.pathname.replace(/^\/api/, "");
    upstream.search = url.search;

    const upstreamRes = await fetch(upstream.toString(), {
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });

    const headers = new Headers(upstreamRes.headers);
    for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
    headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`,
    );
    headers.set("X-Data-Source", "VoteHub (CC BY 4.0)");
    headers.set("X-Data-License", "https://creativecommons.org/licenses/by/4.0/");
    headers.delete("Set-Cookie");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers,
    });
  },
};
