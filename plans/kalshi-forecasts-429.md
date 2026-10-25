# Kalshi answers the forecasts relay 429

> **Outcome (2026-10-25):** Kalshi is out of the public app. The public worker
> no longer relays it, and the web app shows forecasts only when its backend
> is a self-hosted apps/server started with `KALSHI_FORECASTS=true`. The
> ISSUES.md entry is closed with that change.

> Plan path: `plans/kalshi-forecasts-429.md`. Read this first when resuming.
> Branch / worktree: `fix/kalshi-forecasts-429` in
> `C:\Users\camer\.t3\worktrees\OpenSlate\fix-kalshi-forecasts-429`.
> ISSUES.md entry claimed in `966c35e`.

## Goal

The hosted app shows no Kalshi market forecasts: every
`https://api.openslate.us/api/forecasts/v2/events/<ticker>` answers Kalshi's
`429 {"error":{"code":"too_many_requests",...}}`, and the worker
(`apps/poll-cache`) cached that 429 at the edge and in browsers. Make
forecasts reliable through the election (2026-11-03), and make a Kalshi outage
cost the reader as little as possible.

## Environment / context

- Worker: `apps/poll-cache` (`openslate-poll-cache`), deployed by **Cloudflare
  Workers Builds on every push to `master`** that touches `apps/poll-cache/*`
  or `bun.lock` (README "Deployment"). The web app (`openslate-web`) deploys
  the same way for `apps/web/*`, `packages/core/*`, `bun.lock`. So merging
  this branch to master **deploys both**: it needs the user's yes.
- Upstream: `https://api.elections.kalshi.com/trade-api/v2`, served by AWS
  CloudFront (`Via: … (CloudFront)`). `kalshi.com` itself is on Vercel. The
  web app asks for `/events/<ticker>?include_markets=true`
  (`apps/web/src/lib/forecasts.ts`), up to four guessed tickers per race
  (`inferKalshiEventTickers` in `packages/core/src/forecasts.ts`).
- Kalshi rate limits (docs.kalshi.com/getting_started/rate_limits, read
  2026-10-24): token buckets per **account** for authenticated requests,
  10 tokens per request, Basic tier 200 read tokens/s (about 20 reads/s).
  The 429 body documented there is `{"error": "too many requests"}`, a
  different shape from what the Workers get. The page says nothing about
  anonymous requests.
- Biome on Windows needs a CRLF copy of the config (see ISSUES.md):
  `sed 's/"formatter": *{/"formatter": { "lineEnding": "crlf",/' biome.json >
  $TEMP/biome-crlf/biome.json`, then `bunx biome check
  --config-path=$TEMP/biome-crlf <files>`.

## Decisions already made (don't re-ask)

- No central server; the worker stays a stateless relay/cache (user memory).
- Don't deploy the worker, and don't change any Cloudflare setting (secrets,
  KV, cron triggers, dashboard) without the user's explicit per-change yes.
- Kalshi blocks cross-origin browser calls (`Origin: https://openslate.us` →
  403 from CloudFront), so going straight from the browser isn't an option.
- Last good copies go in the Cache API (`caches.default`), not KV: no binding,
  so no Cloudflare change. It's per datacenter, which is fine for a fallback.
- 404 from Kalshi is a real answer (no such event) and stays cacheable
  (15 min), since most guessed tickers don't exist. Every other non-2xx is
  `no-store`, at the edge (`cacheTtlByStatus` -1) and in browsers.
- (User, 2026-10-24) Merge the mitigations on their own: done, deployed
  10:20 PM PDT (05:20Z).
- **(User, 2026-10-25) No Kalshi in the public app at all; at most an opt-in
  for self-hosting.** Reason: Kalshi likely wouldn't allow a public relay or
  mirror of its prices if it saw one. This supersedes the CI-snapshot plan
  (the user had first picked a sibling repo `openslate-forecasts`, read
  directly or through the worker; that was never created).
- The opt-in is one switch on the server, `KALSHI_FORECASTS=true`, which it
  reports as `forecasts: true` in `/api/health`; the web app asks the
  backend, the same way it decides whether to offer Google. No web build
  flag, so the hosted build needs no setting. `VITE_FORECASTS_BASE` is gone:
  forecasts come from `VITE_API_BASE`'s backend.

## Findings / gotchas

- **Cause: Kalshi refuses Cloudflare Workers' egress as a whole.** Proven
  2026-10-24 around 4:20 PM PDT (23:20Z) with a probe worker in the public
  Workers Playground (`workers.cloudflare.com/playground`, a different
  account and no openslate zone; egress `2a06:98c0:3600::103`):
  - `/events/KXGOVCA-26` → 429 with no User-Agent, with
    `OpenSlate/1.0 (+https://openslate.us)`, and with a Chrome UA.
  - `/exchange/status`, `/markets?limit=1` → 429 too.
  - Bogus `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP` headers → 429, so the
    limiter runs before auth is even looked at. (From this machine the same
    bogus headers get 200: public endpoints ignore auth.)
  - `https://kalshi.com/markets/kxgovca` (Vercel, not CloudFront) → 429.
  - From this machine everything answers 200, UA or not.
  So the User-Agent and an API key both look ineffective, and a Cron
  prefetch from a Worker would egress the same way. **Nothing inside a Worker
  can fix it.**
- **GitHub-hosted Actions runners do get answers.** A throwaway workflow on a
  `probe/kalshi-gh-runner` branch (run 40161812073; branch deleted after),
  2026-10-24 9:25 PM PDT (2026-10-25 04:25Z), egress `132.196.15.178` (Azure),
  three tries each: `/events/KXGOVCA-26?include_markets=true` → 200,
  `/exchange/status` → 200, `https://kalshi.com/markets/kxgovca` → 429. So
  only the website refuses runners; the API we need answers them. One run
  from one runner IP; runners rotate through Azure ranges.
- **Browsers can't call Kalshi directly, from any origin but kalshi.com.**
  Re-tested 2026-10-24 9:20 PM PDT from this machine: no `Origin` → 200;
  `Origin: https://openslate.us`, `http://localhost:5173` or `null` → 403
  (`X-Cache: Error from cloudfront`), and the OPTIONS preflight → 403 too;
  `Origin: https://kalshi.com` → 200 with `access-control-allow-origin:
  https://kalshi.com`. Browsers always send `Origin` on cross-origin fetches,
  so there is no way around it from the page.
- A snapshot job can list what it needs cheaply: `/series?category=Elections`
  returns 2,324 series in one request (`GOVPARTYFL`, `KXSENATEVAD`,
  `HOUSECA47`, …), and `/events?status=open&with_nested_markets=true&limit=200`
  pages through open events with a cursor (200 per page, mixed categories).
- Kalshi's terms couldn't be checked: kalshi.com answers 429 to this machine
  too, and docs.kalshi.com lists no data-licensing page. That uncertainty is
  why the user took Kalshi out of the public app (2026-10-25).
- A CI snapshot was built and tested before that decision (3,671 Elections
  events, 13.4 MB, 32 s per run from this machine; settled events can't be
  included, `/events` has no category filter). Kept only locally.
- The relay probably never worked in production. Earlier forecast checks
  (plans/race-polls-scope.md) went through the local dev server.
- 2026-10-24 4:15 PM PDT (23:15Z): relay → 429 with `CF-Cache-Status:
  EXPIRED`, a fresh 429 from Kalshi, not only a cached one.
- Testing from Cloudflare's edge without touching the account: the
  Playground loads a worker from its URL hash, which is
  `LZString.compressToEncodedURIComponent("<multipart content-type>:<multipart body>")`
  (parts `index.js` and `metadata` `{"main_module":"index.js",…}`). Its
  preview URL refuses direct visits (`PreviewRequestForbidden`); use the
  Playground's own HTTP tab (click "HTTP", then "Send") and read the
  response out of the page text.
- `sed -i` on a CRLF file in Git Bash rewrites it as LF; convert back
  (`sed -i 's/$/\r/'`) or edit with Python using `newline=""`.

## Plan / steps

1. [x] Claim the ISSUES.md entry (`966c35e`, rebased as `30be9ae`)
2. [x] Find the cause (above)
3. [x] Relays never cache errors, keep a last good copy (`d6b56da`)
4. [x] Web degrades quietly (`057546c`)
5. [x] README
6. [x] Test the alternatives: GitHub runners get answers; browsers can't
7. [x] Merge the mitigations (`d9118e3`, deployed 10:20 PM PDT, 05:20Z)
8. [x] ~~Snapshot repo + reading it~~: dropped by the user's 2026-10-25
       decision. The local repo `~/git/Personal Projects/openslate-forecasts`
       (`92e66de`) was never pushed; the reading commit `ea5f990` is kept
       only on the local branch `backup/kalshi-snapshot-reading`.
9. [x] Kalshi opt-in for self-hosting only: worker relay removed, server
       behind `KALSHI_FORECASTS=true`, web asks `/api/health`; ISSUES.md
       entry closed
10. [ ] **Current: merge step 9 to master** (redeploys both workers): needs
        the user's yes
11. [ ] After deploy: `https://api.openslate.us/api/forecasts/v2/events/KXGOVCA-26`
        → 404, health has no `forecasts`, and the Governor page has no
        Forecast card

## Progress log

- [x] 2026-10-24: issue claimed; cause found with two Playground probes
- [x] Worker + Hono: `src/forecasts.ts`, tests `apps/poll-cache/test/forecasts.test.ts`,
      `apps/server/test/forecasts.test.ts`
- [x] Web: `ForecastsPanel`, `lib/forecasts.ts`, `Forecast.staleAsOf`, test
      `apps/web/test/forecasts.test.ts`
- [x] Browser check (local Vite against a stub relay): Governor shows the stale
      note "These prices are from Oct 24, 2:31 PM PDT…" over the table,
      Attorney General shows only "Kalshi isn't answering right now. Try
      again later.", and the 429'd ticker was requested once (no retries)
- [x] `bun test` 462 pass; `bun run typecheck` clean; Biome (CRLF config)
      clean on touched files
- [x] Mitigations merged and deployed (2026-10-24 10:20 PM PDT, 05:20Z): the
      live relay answered 429 with `Cache-Control: no-store`
- [x] Opt-in only (2026-10-25): `bun test` 462 pass, typecheck clean, Biome
      clean on touched files; browser check against a local apps/server: with
      `KALSHI_FORECASTS=true` the Governor page shows live Kalshi prices;
      without it, health says `forecasts: false`, `/api/forecasts/*` is 404,
      the race page shows only Polls and Results, no forecast requests are
      made, and Settings doesn't mention Kalshi
- [ ] Merge + deploy (waiting on the user)

## Open questions for the user

1. OK to merge the opt-in change to master? It redeploys both workers: the
   public worker drops `/api/forecasts/*`, and the web app stops asking.
2. Delete the unused local `openslate-forecasts` repo and the
   `backup/kalshi-snapshot-reading` branch? Recommendation: yes; nothing
   else refers to them.

## Things not to do

- Don't `wrangler deploy` or `wrangler dev --remote` (both use the account).
- Don't push to master without listing what would deploy.
- Don't add a Kalshi API-key secret hoping it lifts the 429: the probe shows
  the limiter fires before auth. Test with a real key first if ever tried.
- Don't add a Cron Trigger prefetch in the worker: same blocked egress.
- Don't bring Kalshi back into the public app (worker, snapshot, mirror,
  or a default-on setting): the user's decision, 2026-10-25.
- Don't use ports 8788–8987 for local test servers on this machine: Windows
  reserves them (`netsh interface ipv4 show excludedportrange protocol=tcp`),
  and Bun reports EADDRINUSE. 8787 is often taken by another thread's server.
- Don't add a User-Agent hoping it changes the result. One is sent now as
  good manners, but it made no difference in the probe.
