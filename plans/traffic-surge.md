# Traffic surge: cost ceiling and degraded modes

## Goal

Stay up and stay cheap if OpenSlate gets a sudden burst of visitors before the
2026-11-03 election: 100k visitors in a couple of days was the scenario asked
about on 2026-10-30.

## Environment / context

- `openslate.us`: Workers static assets, no Worker script. Free and unlimited.
- `api.openslate.us`: Worker `openslate-poll-cache`, the only metered piece.
- Catalog: GitHub Pages (`cinderblock.github.io/openslate-public-endorsements`).
  `index.json` is 65 KB on the wire, `bundle.json` 1.67 MB. Ballot guides have
  their own Pages site (`openslate-ballot-ca-2026-11-03`).
- Cloudflare account: Workers Paid, $5/month (the user, 2026-10-30). The
  `openslate.us` zone is on the Free plan: one rate limiting rule, path-only
  expression, 10 s period and timeout.
- The ops repo's uptime worker polls Cloudflare usage hourly into D1 and has
  dollar thresholds (`cloudflare/workers/uptime/src/cost/thresholds.ts`). They
  alert only; nothing acts on them.

## Decisions already made (don't re-ask)

- Spending ceiling: **$100 total** is acceptable (the user, 2026-10-30).
- When a lookup can't answer, tell the voter and send them to the map or to
  setting districts by hand, both of which need no server of ours.

## Plan / steps

1. [x] Fallback when the address lookups are overloaded (this repo). Live.
2. [x] Rate limit on all of `/api/*`, 60 per 10 s (ops `6983f44`). Live.
3. [ ] **Current:** spend breaker, written on ops branch `surge-circuit-breaker`
       (`b42e88a`), not merged. Waiting on the user, see below.

Dropped or held by the user (2026-10-30): budget alerts weren't chosen, and the
catalog move is on hold. If it's revived: publish to Workers static assets at
`catalog.openslate.us` from the endorsements repo's CI alongside Pages, then
point the app at it.

## The spend breaker, waiting to land

Each hour, after the cost poll, the uptime worker estimates the month's bill net
of included usage. It turns the WAF rule `API circuit breaker` (block
`api.openslate.us`) on at $75 and off below it. It holds no state, so a new
month reopens the API by itself. It does nothing until its token is set.

To land it:

1. Merge the branch to master. CI creates the rule, disabled, and deploys uptime.
2. Create a token with Zone WAF:Edit on `openslate.us` only, and set it as the
   uptime secret `CF_BREAKER_TOKEN`.
3. Prove the token can write with no outage: PATCH the rule to `enabled: false`,
   the state it's already in. Then check the next hourly log line.

## Findings / gotchas

- Cloudflare has **no hard spending cap** on paid plans. Budget alerts "do not
  cap your usage", and usage is processed daily. Rate limiting and a home-made
  breaker are the only real limits.
- A rate limit inside the Worker wouldn't lower the bill: the request has
  already been counted by the time the Worker runs. It has to be at the zone.
- Workers bill cached responses too ("the caching of a request still incurs
  costs"), so edge caching in the Worker protects upstreams, not the bill.
- GitHub Pages' 100 GB/month can't be raised: there's no paid tier, and the
  limit is soft. GitHub's advice is a CDN in front or another host.
- The zone's rate limit block carries no CORS headers, so the browser sees a
  failed fetch rather than a 429. The app has to treat a failed fetch to the
  relay as "unavailable", not only a status code.
- Google signals quota as 429 `RESOURCE_EXHAUSTED`, or as 403 on older paths.
  Other 403s (a referrer-restricted key) must stay reportable bugs.
- `/api/civic/elections` isn't cached at the edge, so each browser asking
  spends one Google query. It's only on the Publish > Elections page.
- The uptime cost log is gross: $19.85 for October so far, of which $18.70 is D1
  writes inside the 50M allowance. The real overage is about $0, so a breaker
  on those numbers would trip about $20 early. It subtracts allowances instead.
- CPU time isn't in the cost log. About $6 at a full 316M requests, inside the
  $25 margin. The breaker's month is the calendar month in UTC, which may not
  match the billing period.
- Live test of the rate limit, 2:54 PM PDT (21:54Z): of 90 requests, blocking
  began at about 60, with no CORS headers on the block, and a request after the
  timeout succeeded.
- A local ops dry run needs `.env.local` loaded by Bun (`cd cloudflare && bun
  src/cli.ts sync`). Sourcing it in a shell breaks `DO_SERVERS`' JSON, and
  `SKIP_WORKERS=1` makes every worker look missing, including a false
  `SECRET_KEK` create. The workflow's own dry run skips the sync job entirely.

## Progress log

- [x] Cost estimate at 100k visitors (2026-10-30).
- [x] Step 1 implemented. Unit tests plus a headless run of the real app: a 503
      and a failed fetch from the Census relay each show the notice, and both
      of its buttons work. Google's own quota answer is covered by unit tests
      only, since it can't be triggered on demand.
- [x] Step 1 pushed (`87bd7b5`) and found in the production bundle. The worker
      redeployed at 2:38 PM PDT (21:38Z).
- [x] Step 2 applied by CI, with only that rule changed, and tested live.
- [x] Step 3 written: 12 tests, typecheck, all ops hooks, and a dry run showing
      one new disabled rule.
- [ ] Step 3 merged, token set, and write access proven.

## Open questions for the user

1. Merge the spend breaker and set its token? Recommendation: yes.

## Things not to do

- Don't apply any Cloudflare or ops change without a per-change yes.
- Don't remove a worktree until `git log` shows the commit landed: a failed hook
  commit once took the uncommitted breaker with it.
- Don't put a rate limit in the Worker expecting it to cap the bill.
- Don't set a custom domain on the Pages site this close to the election: that
  makes `github.io` redirect, and a bad certificate would take the catalog down
  for every voter.
