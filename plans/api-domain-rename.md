# Rename polls.openslate.us to api.openslate.us

> Plan path: `plans/api-domain-rename.md`. Read this first when resuming.

## Goal

The poll-cache worker (`apps/poll-cache`, Cloudflare worker
`openslate-poll-cache`) started as a cache for VoteHub polls, so it lives at
`polls.openslate.us`. It now also serves civicAPI results and Kalshi
forecasts, and relays the opt-in Census and Google Civic lookups. The name
misleads anyone reading the README, the CSP or the network tab, so it becomes
`api.openslate.us` (user, 2026-10-24: "yes. add api. and plan to remove polls.
after we confirm new url is working and few/none are using old endpoint, then
clean up polls. fully").

Three phases:

1. Add `api.` beside `polls.` (same worker) and point the app at `api.`.
2. Watch until next to nothing calls `polls.`.
3. Remove `polls.` from Cloudflare (ops), and every mention of it from the
   code and docs.

## Environment / context

- The worker's custom domains are declared in the ops repo,
  `cloudflare/config/projects/openslate.yaml`, applied by ops CI on push to
  ops master. The worker's code deploys from this repo (Workers Builds).
- The app reads the worker's address from `VITE_API_BASE` (formerly
  `VITE_POLLS_BASE`), `VITE_RESULTS_BASE` and `VITE_FORECASTS_BASE` in
  `apps/web/.env.production`.
- The web app is a PWA with `registerType: "autoUpdate"`: an installed copy
  picks up a new build on its next visit. So `polls.` traffic should fall
  away as people open the app, apart from devices that never do.
- The edge rate limit on `/api/civic/*` matches the path only, so it covers
  both names.
- **Counting traffic per name:** `apps/poll-cache/scripts/host-usage.ts`
  (`bun run --filter '@openslate/poll-cache' host-usage [days]`, or run the
  script directly). It reads Cloudflare's zone analytics with
  `CLOUDFLARE_API_TOKEN`; the ops repo's `cloudflare/.env.local` has one:
  `bun --env-file="<ops>/cloudflare/.env.local" apps/poll-cache/scripts/host-usage.ts 14`.
  It splits the worker's real routes from scanner noise (`/.aws/credentials`,
  `/api/.env` and so on: most of what any hostname gets).

## Decisions already made (don't re-ask)

- **Both names on one worker during the switch,** so app copies installed
  before it keep working (user's yes, 2026-10-24).
- **The worker and package keep their names** (`openslate-poll-cache`,
  `@openslate/poll-cache`): renaming the worker would mean ops creating a new
  one and moving its domains and its Workers Builds connection, for no
  visible gain. Agreed with the rename proposal, 2026-10-24.
- **Removing `polls.` needs the user's yes at the time,** with the usage
  numbers in hand. It's an infrastructure change.

## Plan / steps

1. [x] Ops: `api.openslate.us` entry on the same worker (ops `98b0917`).
       CI created the custom domain 2026-10-24 12:20 PM PDT (19:20Z).
2. [x] Checked live: `api.` and `polls.` both answer `/api/health`
       (`civic: true`), `/api/polls` (same body, same Cache-Control) and
       `/api/civic/elections` (CORS for openslate.us).
3. [x] The app points at `api.`; README and `wrangler.toml` say so; the
       usage script.
4. [x] Pushed (`5fa22c1`); openslate.us now calls `api.` only.
5. [x] The cleanup that doesn't wait for `polls.` to go (user, 2026-10-24:
       "why can't we start the cleanup now?"):
   - `VITE_POLLS_BASE` is now `VITE_API_BASE`, read through `apiBase()` in
     `apps/web/src/lib/routing.ts`, which falls back to the old name so
     existing self-hosted builds keep working. The README says so.
   - Test hostnames `polls.example` are now `api.example`.
6. [ ] **Current step.** Watch `polls.` with the script. **Ready to remove when both hold:**
   - The 2026-11-03 election has passed and results have settled: not before
     2026-11-17. A broken install on election night is the one thing worth
     avoiding.
   - The worker's routes on `polls.` see next to nothing for 14 days in a
     row: a handful of requests a day at most (counts are sampled, and
     include our own checks).
7. [ ] With the user's yes, ops: delete the `polls.openslate.us` entry, move
       `provision: true` to the `api.` entry, and update the file's header and
       rate-limit comments. Dry run from a clean ops worktree first: expect one
       delete, `worker-domain:openslate-poll-cache:polls.openslate.us` (its
       AAAA record is Cloudflare's and goes with it).
8. [ ] The rest of the cleanup, which only makes sense once `polls.` is gone:
   - Remove the README paragraph on `polls.` and the `wrangler.toml` note.
   - Delete `scripts/host-usage.ts` and its package script.
   - Grep for `polls.openslate` / `polls.` one last time. Leave historical
     plans as they are.
   - The `VITE_POLLS_BASE` fallback in `apiBase()` and its README line can go
     later still: self-hosters' builds don't depend on our domain.

## Findings / gotchas

- **Traffic before the switch** (2026-10-18 to 10-24, the worker's routes
  only): 10–50 requests a day on `polls.`, mostly `/api/polls`,
  `/api/health` and `/api/civic/elections`. Scanners and crawlers sent about
  ten times that to other paths.
- **Traffic after the switch** (checked 2026-10-25 6:24 PM PDT, 01:24Z
  10-26): `polls.` had 52 app requests on 10-23 (UTC dates) and 26 on 10-24,
  some of them our own checks, then none at all from 10-25 00:00Z (10-24
  5 PM PDT) on. `api.` picked up 14, then 42. So the open copies of the app
  switched within hours; what's left to wait for is copies nobody has opened
  since (installed apps, tabs left open).
- **Cloudflare keeps about 30 days of these analytics** on this plan: a wider
  range errors with "cannot request a time range wider than 4w2d".
- **`/api/polls/polls` is not a route;** VoteHub answers 500 "Poll not
  found". `/api/polls` is the list.
- Ops CI's verify step still fails on the old openslate.us Web Analytics
  drift (ops ISSUES.md), not on this change.

## Progress log

- [x] 2026-10-24: steps 1–3 (see above).
- [x] Step 4: pushed `5fa22c1`; openslate.us serves a bundle naming only `api.` (an installed copy switched on its next load), and `api.` answers the openslate.us page with CORS.
- [x] Step 5: the env var and test hostnames renamed.
- [ ] Steps 6–8: from 2026-11-17 at the earliest.

## Open questions for the user

None right now. Step 7 waits for the user's yes, once the numbers are in.

## Things not to do

- Don't remove `polls.` before the election has settled, however quiet it
  looks.
- Don't run ops' sync from the shared ops checkout (other threads'
  uncommitted edits would be applied too): use a clean worktree at
  `origin/master` with `cloudflare/.env.local` copied in for the hooks.
- Don't judge usage by total requests: scanners make up most of them. Use the
  script's per-route count.
