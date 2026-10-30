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

1. [x] Fallback when the address lookups are overloaded (this repo).
2. [ ] Spending limit: awaiting the user's yes on each change, see below.
3. [ ] Catalog off GitHub Pages' soft limit: awaiting the user's yes, see below.

## Proposed infrastructure changes (none applied)

Each needs its own yes, per the ops rules.

- **Budget alerts** in the Cloudflare dashboard at $25, $50 and $75. These only
  notify, and arrive about a day late.
- **Widen the zone's one rate limiting rule** from `/api/civic/*` at 10 per 10 s
  to `/api/*` at 60 per 10 s, so one IP can't run up requests anywhere on the
  API. That holds an IP to about 3 requests/s, or roughly $0.08/day flat out,
  where an unlimited host at 1,000/s would cost about $26/day. Blocked requests
  shouldn't reach the Worker, so they shouldn't be billed. The cost: Google's
  quota gets less protection, which is what step 1's fallback is for.
- **Circuit breaker**: at about $75 of usage, the uptime worker enables a
  pre-created WAF block on `/api/*`. Needs a new scoped API token. The site and
  catalog stay up, and the app falls back as in step 1.
- **Catalog**: publish to Workers static assets (`catalog.openslate.us`) from
  the endorsements repo's CI alongside Pages, then point the app at it.

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

## Progress log

- [x] Cost estimate at 100k visitors (2026-10-30).
- [x] Step 1 implemented. Unit tests plus a headless run of the real app: a 503
      and a failed fetch from the Census relay each show the notice, and both
      of its buttons work. Google's own quota answer is covered by unit tests
      only, since it can't be triggered on demand.
- [ ] Step 1 pushed: a push to master deploys both the site and the worker.
- [ ] Steps 2 and 3 not started, waiting on the user.

## Open questions for the user

1. Which of the infrastructure changes above to apply. Recommendation: alerts,
   the wider rate limit, and the circuit breaker; hold the catalog move unless
   traffic actually appears.

## Things not to do

- Don't apply any Cloudflare or ops change without a per-change yes.
- Don't put a rate limit in the Worker expecting it to cap the bill.
- Don't set a custom domain on the Pages site this close to the election: that
  makes `github.io` redirect, and a bad certificate would take the catalog down
  for every voter.
