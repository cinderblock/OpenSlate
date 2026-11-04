# Live results you can leave open: recorder, push, freshness

Started 2026-11-04 (the day after the Nov 3, 2026 California general election).
Follows `plans/county-results.md` and `plans/live-race-tracker.md`.

## Goal

People should trust that the Results page can be left open, or put away and
reopened, and will show the latest count as soon as it exists. Refreshing
should never be needed, and the page should say so.

1. **Freshness on screen.** After a tab or phone wakes, the page must not
   pass off old numbers as current. Dim data that may be out of date, show a
   small progress bar while the new data loads, then undim.
2. **Recorder.** Our worker checks every source on a schedule (adaptive, with
   faster checks around announced release times) and stores each race's
   history. The History chart then shows the whole canvass, not just what one
   browser happened to see.
3. **Push.** Open pages hear about a new report the moment the recorder has
   it. Pages that can't use push ask just after the recorder's next check.
4. **Audit trail.** An exact copy of every new report from every source is
   kept in R2.

## Decisions (from the user, don't re-ask)

- Yes to Durable Objects on openslate-poll-cache, and to an R2 bucket for the
  audit trail (2026-11-04). Cost is fine; worst case is about $2 a day on a
  crowded night.
- Check schedule:
  - Once a minute from when counties start releasing on election night.
  - Slowing to hourly by morning.
  - Continue until the count is done.
  - Faster than once a minute around a county's announced release time.
- Clients should get data as soon as the server has it: push, or polling
  lined up with the server's checks.
- No backfill from the user's browsers.
- Standing rules from the county work: results go through our relay by
  default; no automatic fallback from the relay to direct; be gentle with
  sources (honest User-Agent, cache, coalesce); California only.

## Design

### Sources and Durable Objects

- One `Recorder` Durable Object per feed: `sos-ca` (the state), plus one per
  county in `CA_COUNTY_FEEDS`. It holds that feed's schedule, latest raw
  files, history rows and WebSocket subscribers.
- Its alarm runs the checks:
  - **Clarity:** the small `current_ver.txt` pointer, then the summary when
    the version changes.
  - **Others:** a conditional GET when the source honours it.
- A changed report is:
  1. copied raw to R2;
  2. parsed with the same code the web app uses;
  3. diffed per contest, with a row added for each contest whose numbers
     changed;
  4. broadcast to subscribers.
- The state's Durable Object polls the contest paths that exist. District
  paths that answer an empty 500 aren't on this ballot: skip them and recheck
  daily.

### Relay

- The worker answers `/api/sos-ca/…` and `/api/county-ca/…` from the
  recorder's latest copy.
- A response carries `X-Next-Check` (epoch ms) and `X-Report-Version`.
- `?v=<version>` URLs are immutable and cached long; unversioned URLs are
  cached briefly.
- apps/server (self-hosted, no Durable Objects) keeps today's stateless relay.

### Schedule (pure function, tested)

- After a change: once a minute for an hour, then the gap doubles each hour
  without a change, up to hourly.
- Election night, from polls closing at 8 PM until 2 AM: never slower than
  once a minute.
- Release windows: a hand-kept list (county, time) in the repo. From 5 minutes
  before to 20 minutes after, or until a new report lands, check every 15 s,
  using only the cheap check.
- Stop: "100% of precincts" is not the end in California, so don't stop on it.
  Counties finish the canvass by Dec 3, 2026, and the Secretary of State
  certifies by Dec 11, 2026, which is the hard stop. Rechecks are hourly until
  then.

### History API

- `GET /api/history/<feed>/<contest key>` returns `{ names, points }`, the
  same shape as the browser's `RaceHistory`.
- The chart loads it and keeps this browser's own points only from before the
  server's first point.

### Push

- `GET /api/live/<feed>` upgrades to a WebSocket held by that feed's Durable
  Object (Hibernation API, so idle sockets cost nothing).
- Messages: `{ feed, version, at, nextCheck }`. The page then refetches with
  `?v=`.
- If the socket isn't open, the page polls our relay at
  `X-Next-Check` + 1–4 s jitter, and never a county directly. Users who chose
  their own connection in Settings get no socket and keep 60 s polling.

### Freshness UI (step 1, no server change needed)

- **Wake detection:**
  - the page becoming visible;
  - `online`;
  - a timer tick arriving late (sleep).
- **Old data:** when a query's data is older than its expected next check
  plus a grace period, its card is dimmed and marked "may be out of date"
  while it refetches.
- **Progress:** a thin progress bar at the top of the page while catching up
  (the kit's `ProgressBar`, indeterminate). Routine one-minute checks don't
  flash it.
- **Failure:** if a check fails or the device is offline, keep the dim and say
  since when the data is.
- **Copy:** "Updates arrive here on their own; no need to refresh."

## Plan / steps

1. [x] Freshness UI (client only): `83f6575`, live 1:02 PM PST
2. [x] Shared core: `liveRecord`, `raceHistory` (`appendChoices`, `mergeHistories`), `countyReport`, `recordSchedule`, with a web parity test: `224247b`
3. [x] Recorder Durable Object, relay served from it, `/api/history`, `/api/live`, cron: `a7044d9`; status endpoint `/api/recorder` and start-on-first-request: `7520b31`
4. [x] R2 bucket `openslate-reports`: ops `3db16b36`, created by ops CI 1:10 PM PST (21:10Z)
5. [x] History API, and the chart merging the recorder's history with this browser's earlier points: `486174b`
6. [x] Push: WebSocket per watched feed on Results, `?v=` refetch with jitter, polling lined up with `X-Ready-By`: `486174b`; CSP `wss://api.openslate.us`: `1f3080f`
7. [x] Release windows: Sacramento (Tue/Fri 4:15 PM to Dec 1) and San Diego (Nov 5, 6, 9 at 6 PM)
8. [ ] More release times as counties post them (Los Angeles, Orange, Santa Clara: none found 2026-11-04)
9. [ ] Later: the web app's county fetchers could use core `readCountyReport` (one reading of each feed); left alone while other threads edit `countyCa.ts`
10. [ ] Later: My ballot / race pages could open the feed socket too (they poll lined up with the recorder today)

## Findings / gotchas

- Conditional GETs (checked 2026-11-04 with our User-Agent): livevoterturnout
  (CSV and HTML page) and Los Angeles answer 304 to `If-Modified-Since` /
  `If-None-Match`; Sacramento and Alameda send no validators, so the recorder
  compares content.
- The state's `status` document is stale (Sep 2024 report times), so it can't
  signal changes. The recorder checks `governor` alone (a statewide count moves
  whenever any county reports) and reads all ~190 documents only when it moves,
  plus twice more while the files settle.
- 20 State Senate districts (the odd ones) answer an empty 500: skipped,
  rechecked daily.
- A new cron schedule took about 12 minutes to reach Cloudflare (deployed
  ~1:18 PM PST, first run 1:30 PM). Until then the first request for a feed
  starts its recorder.
- CSP `connect-src https:` does not cover `wss:`. The browser blocked the
  socket until `wss://api.openslate.us` was added (`1f3080f`).
- The zone rate limit is 60 requests per 10 s per IP on `/api/*` (ops). Pages
  refetch after a push with 0–2 s jitter per card. A page watching very many
  races behind a shared NAT could approach it; a combined endpoint would fix
  that if it shows up.
- `apps/poll-cache/wrangler.toml` says Tiered Cache is off, but ops sets
  `tiered_cache: smart`. Not checked which is true.
- The README's Workers Builds watch paths for poll-cache omit
  `packages/core/*`, but a core-only commit (`44bf816`) did build the worker,
  so the README is the stale one.

## Progress log

- [x] Design and costs agreed (plan `ad5fae2`)
- [x] 1:30 PM PST (21:30Z): all 16 recorders running. First pass: state 167
  files, 180 races, 20 absent; Orange 215 races. The relay's governor is
  byte-identical to the source.
- [x] Live check on openslate.us (background browser):
  - sockets to `sos-ca` and `orange`;
  - `hello`, then the per-minute `checked` message;
  - heartbeat `pong`s;
  - History shows the recorder's point;
  - no page errors.
- [ ] A real new report pushed end to end (next county release: San Diego
  Nov 5, 6 PM PST)

## Things not to do

- Don't stop checking when a source reports 100% of precincts.
- Don't fall back from the relay to sources directly.
- Don't touch the Cloudflare dashboard; infrastructure goes through the ops
  repo.
- Don't run `biome check --write` on whole directories in the shared tree; it
  touches other threads' files. Name your own files.
