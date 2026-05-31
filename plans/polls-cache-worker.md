# OpenSlate — Polls Cache Worker

> Plan path: `plans/polls-cache-worker.md` — read this first when resuming.

## Goal

Surface up-to-date opinion-polling numbers (presidential approval, generic ballot,
race-specific polls, etc.) inside OpenSlate's `RacePanel` so a viewer comparing
endorsements on a contest also sees what the public is saying. Source the data
from [VoteHub](https://votehub.com)'s free CC-BY 4.0 API, but front it with a
thin Cloudflare Worker so the browser can actually fetch it (VoteHub's origin
whitelists `https://votehub.com` for CORS) and so we don't hammer their AWS API
Gateway on every page load.

Voter-info / polling-place lookup is a separate, parallel feature handled by
embedding the VIP **Voting Information Tool** widget (the user's existing
customizer access) — out of scope for this plan; see future
`plans/voter-info-vit.md` when we build it.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\OpenSlate` (Bun workspaces monorepo).
- New package: `apps/poll-cache/` (Cloudflare Worker). Sits alongside
  `apps/server/` (Hono), `apps/web/` (React+Vite), `apps/cli/`, `apps/desktop/`.
- Deploy target: Cloudflare Workers (free tier expected to cover early usage).
- Local dev: `wrangler dev`.
- Upstream API: `https://api.votehub.com` — confirmed live, no auth required,
  CC-BY 4.0 licensed.
- Project hard constraint (from user memory `openslate-no-central-server`):
  must work without a central server doing per-user queries. We read a thin
  pass-through public-data cache as **compatible** with that constraint
  (no per-user state, no auth, no who-asked-for-what logs) — see Open
  Questions below to confirm with user.

## Decisions already made (don't re-ask)

1. **Primary polls source: VoteHub.** Beta service but live, structured JSON,
   CC-BY 4.0, no key. Schema includes pollster, sample_size, population (lv/rv),
   start/end dates, sponsors, partisan flag, `answers: [{choice, pct}]`.
2. **Architecture: Cloudflare Worker as caching pass-through proxy.** Not a
   stateful backend. Browser → Worker → `api.votehub.com`, cached at the edge.
   `Access-Control-Allow-Origin: *` set on the Worker response.
3. **Cache layer: Cloudflare's main fetch cache** via
   `fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } })` — participates
   in Cloudflare's Tiered Cache (must be enabled at zone level, free) so global
   miss rate is ~1 per endpoint per TTL window, not 1 per PoP.
4. **TTL: 15 minutes** + `Cache-Control: public, max-age=900,
   stale-while-revalidate=3600` on the response.
5. **No Cron Trigger pre-warm.** Cron Triggers only fire in one PoP, so they
   warm 1 out of ~300 PoPs — near-zero benefit. The 300–800ms miss tax happens
   ~once per TTL window globally and is acceptable.
6. **No D1, KV, R2, or Cache Reserve in the MVP.** Reconsider R2 only if/when
   we want VoteHub-down resilience or want to publish historical snapshots
   as signed slates.
7. **No request-shape rewriting.** Worker is a transparent passthrough of
   `/polls`, `/polls/:id`, `/pollsters`, `/subjects`, `/poll-types`. VoteHub
   already supports useful query filters (`poll_type=`, `subject=`).
8. **Attribution:** Worker sets `X-Data-Source: VoteHub (CC BY 4.0)` on every
   response. UI surfaces a visible "Polling data via VoteHub (CC BY 4.0)"
   credit on any panel that renders these numbers — required by the license.
9. **No code comments for the obvious.** Match the `apps/server` style.

## Plan / steps

- [x] **1. Build Worker.** `apps/poll-cache/` with `wrangler.toml`, types,
      `src/index.ts`. Transparent passthrough of `/api/polls,/polls/:id,
      /pollsters,/subjects,/poll-types` to `api.votehub.com`, CORS `*`,
      `cf.cacheTtl + cacheEverything`, `Cache-Control` with
      max-age=900 + SWR=3600, `X-Data-Source` attribution header.
- [x] **2. Mirror routes on Hono server** (`apps/server/`). New
      `src/polls.ts` with `createPollsSource()` doing an in-memory TTL Map
      cache (15min). Wired into `index.ts` at the same `/api/polls,...`
      shape so self-hosted and Worker-hosted are at feature parity.
- [x] **3. Web client lib + UI.** `apps/web/src/lib/polls.ts` exposes
      TanStack Query options keyed by `VITE_POLLS_BASE` env (defaults to
      relative `/api`, so dev hits Hono via the existing Vite proxy; prod
      web-only builds set it to the Worker URL).
      `apps/web/src/components/PollsPanel.tsx` renders recent polls for a
      Subject, with required CC-BY 4.0 attribution footer.
      Integrated into `RacePanel.tsx`.
- [ ] **4. Configure deployment.** *Deferred until user buys a domain.*
      `apps/poll-cache/` is scaffolded and compiles, but not deployed.
      Until then, the feature demos end-to-end via the Hono server
      (`bun run dev:server`) + Vite proxy — no Worker required.
      When the domain lands: enable zone Tiered Cache, add `routes = [...]`
      to `wrangler.toml`, set `VITE_POLLS_BASE` in the web build env, run
      the `cloudflare-cost-estimate` skill, then `wrangler deploy`.
- [ ] **5. Improve subject matching.** Current matching is slug-of-title
      → VoteHub `subject` filter (e.g. "Donald Trump" → `donald-trump`).
      Works for candidate-named subjects; fails for race-named subjects
      like "President 2024". Likely next step: a small mapping table from
      OpenSlate `Subject.kind` + title heuristics to VoteHub `poll_type`
      (e.g. kind=race + title contains "President" → `poll_type=approval`).
      Optionally let users pin a VoteHub subject key per OpenSlate Subject.

## Findings / gotchas

- **The API host is `api.votehub.com`, not `votehub.com/polls/api/`.** The
  latter is a WordPress docs page that 403s under Cloudflare bot challenge.
  Easy to confuse. The Worker's `Link: <…/wp-json/>` header is a red herring;
  the actual data API is on a separate subdomain.
- **CORS whitelist on `api.votehub.com` is `https://votehub.com` only**,
  with `Vary: Origin`. Confirmed by sending `Origin: https://votehub.com`
  and getting `access-control-allow-origin: https://votehub.com` back, vs
  no CORS header at all with `Origin: https://example.com`. OPTIONS preflight
  returns 204 regardless of origin — preflight isn't where the filter lives.
- **Cache API (`caches.default` in Workers) is per-PoP, not global.** That's
  why we lean on `fetch`'s `cf.cacheTtl + cacheEverything` instead — it
  participates in Cloudflare's main CDN cache, which Tiered Cache can make
  effectively global.
- **VoteHub's API is on AWS API Gateway** (per `Apigw-Requestid` header).
  No auth required currently, but they could add throttling without warning.
  TTL+SWR limits our exposure.
- **Endpoint inventory** (confirmed live 2026-05-31):
  - `GET /polls` — filterable by `poll_type=` and `subject=`
  - `GET /polls/{id}`
  - `GET /pollsters`
  - `GET /subjects`
  - `GET /poll-types` — returned: `governor`, `us-representative`,
    `presidential-primary`, `us-senator`, `favorability`, `generic-ballot`,
    `mayor`, `proposition-50`, `attorney-general`, `approval`.
- **Big response shape** — `/polls?poll_type=generic-ballot` returned 218 KB
  in our probe. That's significant for mobile cold-load; will want to
  evaluate filtering by `subject=` from the client to keep payloads small.
- **Latency math we agreed on:**
  - Edge cache hit: ~20–50 ms
  - Cache miss → VoteHub origin: ~300–800 ms (network + AWS API Gateway warmup
    tail; 218 KB response amplifies the bandwidth tail)
  - Miss frequency with 15min TTL + Tiered Cache: ~1 user per 15min globally
- **Cost (rough; replace with `cloudflare-cost-estimate` output before deploy):**
  free Workers tier covers ≤100k req/day; expected real load far below that.
  At 1M req/day, ~$0.50–$3/mo for Workers; everything else still free.

## Open questions for the user

1. ~~Does a thin cache Worker satisfy the "no central server" constraint?~~
   **User-confirmed yes ("sounds great") — proceed.**
2. **Worker hostname** — user-confirmed: ship MVP under
   `openslate-poll-cache.<account>.workers.dev`. User plans to buy a
   domain but hasn't yet (as of 2026-05-31). Domain swap when ready is
   two lines: `routes = [...]` in `apps/poll-cache/wrangler.toml`, and
   `VITE_POLLS_BASE=https://<new>` in the web build env.
3. ~~Self-host opt-out shape?~~ **User-confirmed feature parity is required;
   `/api/polls/*` is implemented in both `apps/server/` (Hono) and
   `apps/poll-cache/` (Worker) at the identical path shape so the web
   client is source-agnostic via `VITE_POLLS_BASE`.**

## Things not to do

- **Don't add a Cron Trigger** to "pre-warm" the cache. Only warms one PoP
  out of ~300; benefit is rounding error and adds an extra moving part.
- **Don't bypass Cloudflare's main cache by using only `caches.default`.**
  That's per-PoP. We want `cf.cacheTtl + cacheEverything` + zone-level
  Tiered Cache for global effect.
- **Don't add D1/KV for read-through caching.** Cloudflare's CDN cache is
  the right tool. D1/KV would be reinventing it more expensively.
- **Don't strip VoteHub attribution from the response or UI.** CC BY 4.0
  requires it. Header + visible UI credit are both cheap.
- **Don't log request paths / query strings / IPs in the Worker.** The
  no-central-server constraint is about user privacy too; the Worker
  must be observably equivalent to a dumb CDN edge.
- **Don't hardcode the VoteHub URL in the web client.** Goes through the
  Worker indirection so we can swap origins (or add a fallback source like
  Wikipedia / FiveThirtyEight archive) without a client redeploy.

## Progress log

- 2026-05-30/31 — Research + probes:
  - Mapped free civic-data APIs (Google Civic Info, Democracy Works,
    civicAPI, VoteHub, FiveThirtyEight archive).
  - Discovered Google Civic Representatives API turndown (April 2025);
    `voterInfoQuery` still alive.
  - Discovered VoteHub's real API host is `api.votehub.com` (not the
    WordPress docs page at `votehub.com/polls/api/`).
  - Confirmed CORS whitelist on `api.votehub.com` excludes arbitrary
    origins — forces us to proxy.
  - Settled on CF Workers + Cache API (no D1/KV/R2/Cron) for MVP.
- 2026-05-31 — Built steps 1–3:
  - `apps/poll-cache/` Worker scaffolded; passthrough + CORS + cache
    headers + attribution.
  - `apps/server/` gained `/api/polls/*` mirror routes with in-memory
    TTL cache for parity.
  - `apps/web/src/lib/polls.ts` + `<PollsPanel>` shipped; integrated
    into `RacePanel`. Path shape `/api/polls/*` on both backends;
    web client base URL via `VITE_POLLS_BASE` (default empty = relative).
  - `bun run typecheck`, `bun run lint`, `bun test` all green.
- Next: step 4 (deployment / Tiered Cache enable / cost estimate); then
  step 5 (smarter subject matching).
