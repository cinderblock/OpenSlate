# @openslate/server

A deliberately minimal, **stateless** backend. It stores **no user data** — OpenSlate
is decentralized-first, so the server only does things a pure client can't safely do
on its own. Running it is **optional**: the web and desktop apps work fully without it.

Built with [Hono](https://hono.dev), so it runs on Bun, Node, or Cloudflare Workers.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + `storesUserData: false`. |
| POST | `/api/verify` | `{ token }` → verification result. Convenience for thin clients; nothing stored. |
| GET | `/api/ballot?address=…&electionId=…` | OPTIONAL ballot lookup; see below. **501** if no key configured. |
| GET | `/.well-known/openslate.json` | Example identity attestation document (SPEC §7). |

## The (optional) ballot proxy

Structured, per-address ballot data needs an API key that must stay server-side, so it
can't live in a pure client app. If you want this feature, this proxy holds a **Google
Cloud API key** for the **Google Civic Information API** (`voterInfoQuery`, which
surfaces Voting Information Project data), forwards the address upstream, and **never
stores or logs it**. Contests have no stable ids, so the adapter synthesizes a
deterministic `Subject.id` (`vip:<election>:<district>:<office-slug>`) so different
people's endorsements align on the same race.

Caveats:

- This means running a **central server**, which is opt-in. The default, fully
  client-side app uses manual subject entry instead.
- It is **not** the Voting Information Tool customizer (a client-side widget) — that's a
  separate integration option for the web app.
- The source is swappable: implement `BallotSource` in [`src/ballot.ts`](./src/ballot.ts).

## Run

```sh
cp .env.example .env   # optional: set GOOGLE_API_KEY to enable /api/ballot
bun run dev            # http://localhost:8787 (hot reload)
```

## Self-hosting the web app

Build the web app (`bun run build` at the repo root → `apps/web/dist`) and serve it with
any static host, or add Hono's `serveStatic` here to serve it from this process.
