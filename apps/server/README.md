# @openslate/server

A deliberately minimal, **stateless** backend. It stores **no user data** — OpenSlate
is decentralized-first, so the server only does things a pure client can't safely do
on its own. Running it is **optional**: the web and desktop apps work fully without it.

Built with [Hono](https://hono.dev), so it runs on Bun, Node, or Cloudflare Workers.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + `storesUserData: false`, and `civic`: whether Google lookups can answer. |
| POST | `/api/verify` | `{ token }` → verification result. Convenience for thin clients; nothing stored. |
| GET | `/api/civic/elections` | OPTIONAL: Google's elections list; see below. **501** if no key configured. |
| POST | `/api/civic/voterinfo` | OPTIONAL: `{ address, electionId? }` → the contests on that ballot. **501** if no key configured. |
| POST | `/api/geocode/census` | `{ address }` → districts, via the US Census geocoder (opt-in in the app; nothing kept). |
| GET | `/.well-known/openslate.json` | Example identity attestation document (SPEC §7). |

## The (optional) Google Civic relay

With a **Google Cloud API key** for the **Google Civic Information API** (which
surfaces Voting Information Project data), this server answers the app's "Google
(via OpenSlate)" lookups: Google's elections list, and the contests on an
address's ballot. The address arrives in a POST body, is forwarded to Google, and
is **never stored, cached or logged**. The handlers are the public Worker's
([`apps/poll-cache/src/civic.ts`](../poll-cache/src/civic.ts)), and the Civic
adapter is shared with the browser
([`packages/core/src/civic.ts`](../../packages/core/src/civic.ts)). Contests have
no stable ids, so the adapter synthesizes a deterministic `Subject.id`
(`vip:<election>:<district>:<office-slug>`) so different people's endorsements
align on the same race.

The civic routes spend your key, so they don't get this server's open CORS: only
its own pages (same origin), localhost, and any origins you list in
`CIVIC_ALLOWED_ORIGINS` can call them from a browser.

Caveats:

- It's optional. Without a key, anyone can still use Google with their **own** key
  straight from the browser (Settings → *Your Google API key*), and the rest of
  the app needs no server at all.
- It is **not** the Voting Information Tool customizer (a client-side widget) — that's a
  separate integration option for the web app.

## Run

```sh
cp .env.example .env   # optional: set GOOGLE_API_KEY to enable /api/civic/*
bun run dev            # http://localhost:8787 (hot reload)
```

## Self-hosting the web app

Build the web app (`bun run build` at the repo root → `apps/web/dist`) and serve it with
any static host, or add Hono's `serveStatic` here to serve it from this process.
