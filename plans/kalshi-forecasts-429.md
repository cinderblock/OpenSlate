# Kalshi answers the forecasts relay 429

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

1. [x] Claim the ISSUES.md entry (`966c35e`)
2. [x] Find the cause (above)
3. [x] Worker: never cache non-2xx (except 404), keep a last good copy, serve
       it marked stale; same in the Hono mirror (`54d97c0`)
4. [x] Web: quiet one-liner when unavailable, "prices from <time>" when stale,
       no retries into a 429 (`0d0a003`)
5. [x] README: the forecasts column and a paragraph on why
6. [ ] **Current: the user's decision on a source Kalshi will answer** (open
       question 1). Until then the hosted app says "Kalshi isn't answering
       right now", because the worker never gets a good copy to keep.
7. [ ] Merge to master (deploys the worker and the web app): needs the
       user's yes

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
- [ ] Root-cause source (waiting on the user)
- [ ] Merge / deploy (waiting on the user)

## Open questions for the user

1. **Where should forecasts come from, given that Kalshi refuses Workers?**
   - **(a) Recommended: a CI snapshot.** A scheduled GitHub Actions job
     (every 10–15 min, best effort) fetches the tickers OpenSlate can ask for
     and publishes them as static JSON on GitHub Pages, like the endorsements
     repo. The worker falls back to it when Kalshi refuses. It fits "no
     central server" and needs no Cloudflare change. Unknowns: whether
     Kalshi also refuses GitHub's runners (one workflow run would tell), and
     which repo hosts it.
   - (b) Ask Kalshi to stop refusing Workers, or whether an API key gets
     past their edge limiter. Cheap to ask, but slow and out of our hands.
   - (c) Relay through a server of the user's (e.g. steamboat).
     Infrastructure work, and closer to a central server.
   - (d) Accept it: the hosted app shows no forecasts, quietly.
2. OK to merge to master once the above is settled (or now, since the
   changes stand on their own)? Merging deploys both workers.

## Things not to do

- Don't `wrangler deploy` or `wrangler dev --remote` (both use the account).
- Don't push to master without listing what would deploy.
- Don't add a Kalshi API-key secret hoping it lifts the 429: the probe shows
  the limiter fires before auth. Test with a real key first if ever tried.
- Don't add a Cron Trigger prefetch in the worker: same blocked egress.
- Don't add a User-Agent hoping it changes the result. One is sent now as
  good manners, but it made no difference in the probe.
