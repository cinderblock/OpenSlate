# Project domain

`plans/domain.md`

## Goal

Pick and register a domain for OpenSlate so the web app, the poll-cache
Worker (`plans/polls-cache-worker.md` step 4), and the public endorsements
catalog (`plans/openslate-public-endorsements.md` follow-up 2) can move off
`*.github.io` / `*.workers.dev` before the 2026-11-03 general election. A
domain root also enables `/.well-known/openslate.json` domain attestation
(SPEC §7).

## Environment / context

- Infra is on Cloudflare (Workers, Pages-capable). Any registrar works; NS can
  point at Cloudflare. Cloudflare Registrar sells at cost but supports fewer
  TLDs.
- Registering, DNS, and Cloudflare changes need the user's explicit
  per-change yes (global CLAUDE.md). This doc only records research.

## Decisions already made (don't re-ask)

- User likes the name "OpenSlate" and would rather keep it. Renaming is on
  the table only if no acceptable domain exists.
- `openslate.vote` was the user's first choice. It's taken.
- **`openslate.us` purchased** by the user 2026-10-14 at Cloudflare Registrar
  (zone in the user's Cloudflare account, NS rob/daisy.ns.cloudflare.com).
- Hostname layout (staged in ops, see below):
  - `openslate.us` → worker `openslate-web` (apps/web SPA)
  - `polls.openslate.us` → worker `openslate-poll-cache` (apps/poll-cache)
  - `www` → 301 to apex
  - Catalog stays on GitHub Pages for now.
- ops pattern: same as empyreangate.org. ops provisions the empty workers
  (`external: true, provision: true`) and attaches custom domains. The app
  repo deploys code into them (Workers Builds or its own CI). Worker names
  must match the app's wrangler config.

## Findings (availability sweep, 2026-10-14)

Method: registry RDAP via the IANA bootstrap (`data.iana.org/rdap/dns.json`),
with port-43 whois for ccTLDs that have no RDAP. `rdap.org` rate-limits
(Cloudflare error 1015) after about 20 queries, so query the registries
directly. A whois regex for "available" gave false positives on .io/.me
because the boilerplate contains that word, so check the raw output.

### Taken

| Domain | Registered | Notes |
| --- | --- | --- |
| openslate.com | 1999-12-21 | AWS DNS, long-held |
| openslate.vote | 2026-09-02 | Namecheap, no site |
| open-slate.vote | 2026-09-02 | Namecheap, no NS |
| open-slate.org | 2026-09-02 | Namecheap, no site |
| openslate.org | 2026-06-26 | Afternic for-sale lander. Price not checked (JS-rendered) |
| openslate.xyz | 2026-06-27 | Afternic, for sale |
| openslate.dev | 2026-08-28 | Cloudflare Registrar, no site. Not the user's (no receipt in Gmail) |
| openslate.app | — | Someone's classroom-response app |
| openslate.online | 2026-10-11 | Vercel, a fantasy-sports "Open Slate" |
| openslate.net | 2026-01-31 | NameBright |
| openslate.ai | 2024-12-02 | Cloudflare |
| openslate.world | 2026-02-04 | |
| openslate.ca | 2026-07-27 | GoDaddy |
| openslate.io, .me, .co | — | |

The 2026-09-02 cluster: `openslate.vote`, `open-slate.vote` and
`open-slate.org` were all registered at Namecheap on the same day, which
suggests a single registrant. The `.org`/`.xyz` pair on Afternic were
registered a day apart in late June, a typical speculator pattern. Either
could in principle be bought: Afternic listing, or a Namecheap
WHOIS-privacy contact for the .vote owner.

### Available (registry 404 / whois "not found")

- **openslate.\***: `.us`, `.page`, `.info`, `.guide`, `.tools`,
  `.community`, `.network`, `.foundation`, `.voto`, `.democrat`, `.party`,
  `.one`, `.to`, `.fyi`, `.social`, `.cc`, `.sh`, `.ing`
- **Variants**: `openslates.org`, `openslates.vote`, `getopenslate.org`,
  `getopenslate.com`, `useopenslate.org`, `useopenslate.com`,
  `theopenslate.org`, `openslateproject.org`, `signedslate.org`
- **.vote, other names**: `slate.vote`, `slates.vote`, `myslate.vote`,
  `yourslate.vote`, `endorse.vote`, `endorsements.vote`

"Available" means unregistered at the registry. Short names like
`slate.vote` may be registry-premium. Confirm the price at a registrar
before counting on it.

## ops change (staged, NOT committed — ops requires per-commit approval)

File: `ops/cloudflare/config/projects/openslate.yaml`. `bun run validate`
passes. A dry-run sync against a clean HEAD worktree plus this file gives
**8 creates, 1 update, 0 deletes**: two empty workers, two custom domains,
the www stub AAAA plus a 301 rule, SPF `-all` + DMARC `p=reject` (no mail
from this domain), and SSL full→strict + always-HTTPS. Running the dry run
in the shared ops checkout also shows 3 unrelated diffs from another
thread's uncommitted edits (telemetry SECRET_KEK, restic CNAME,
*.empyreangate.org delete). Those are not part of this change.

## Progress

- [x] Availability sweep
- [x] Domain purchased (`openslate.us`)
- [x] ops config written + validated + dry-run (staged)
- [x] User approved; ops `e3b3455` pushed, Cloudflare CI applied 8 creates + 1 update.
      Verified live: openslate.us and polls.openslate.us return the 503 empty-worker stub,
      www → 301 to apex with the path kept, DMARC TXT resolves.
- [x] User go-ahead to deploy (2026-10-17). Same pattern as empyreangate.org:
      Workers Builds deploys, ops owns worker + domain, no Cloudflare credential
      in this repo, no deploy workflow in GitHub Actions.
- [x] App repo deploy config: `apps/web/wrangler.jsonc` (assets only,
      `not_found_handling: none` since routes are hash-based), poll-cache
      `wrangler.toml` without routes, both `workers_dev`/`preview_urls` off
      (matching ops' stub), wrangler 4 in both. `wrangler deploy --dry-run`
      passes for both.
- [x] `apps/web/.env.production` (committed, public values): the three
      `VITE_*_BASE` at https://polls.openslate.us, plus `VITE_CF_BEACON_TOKEN`.
- [x] README: Deployment section with the Workers Builds settings; hosted URL.
- [x] Connect Workers Builds for both workers. The user finished both by hand
      on 2026-10-17, after Claude Code's auto-mode classifier blocked my clicks
      in the dashboard (it refused even after a chat yes). Verified read-only
      via the Builds API (`/builds/workers/<tag>/triggers` and
      `/builds/triggers/<uuid>/environment_variables`): one trigger per worker,
      branch `master` only (no preview trigger), roots `apps/web` /
      `apps/poll-cache`, the commands from README "Deployment",
      `SKIP_DEPENDENCY_INSTALL=1` and `BUN_VERSION=1.4.2`.
- [x] First builds. Connecting doesn't start a build; the next push to
      `master` does. Pushes `95da035` and `9c872d0` (empty) produced nothing
      because the "Cloudflare Workers and Pages" GitHub App on cinderblock
      (github.com/settings/installations/62496988) is limited to selected
      repos and OpenSlate wasn't one. The user added it on 2026-10-17; the push
      of `174a9f5` then built and deployed both workers ("Workers Builds:
      openslate-web" / "…openslate-poll-cache" checks, both success).
- [x] Verified live 2026-10-17: openslate.us 200 serving the app (title
      OpenSlate), polls.openslate.us/api/health 200 (`"status":"ok"`), www →
      301 to apex with path kept. In the deployed app, Catalog loads (69
      entries from Pages); the Race view calls
      `https://polls.openslate.us/api/polls?...` and gets 200 with no CORS
      error. It shows no polls, but that's an app bug in the subject → VoteHub
      mapping, not the deploy (logged in ISSUES.md, `264f819`).
- [x] ops `web_analytics: { auto_install: false }` pushed as `e5515bd`, CI
      applied it (1 create; verify run 0/0/0).

## Findings / gotchas (ops)

- The ops Cloudflare config has no Tiered Cache zone setting, and
  `plans/polls-cache-worker.md` says the poll-cache assumes it. Either
  toggle it by hand (it's then unmanaged drift) or add support to ops.
  Not needed for correctness, only for cache hit rate.
- **Is the Tiered Cache assumption safe? Partly.** Per CF docs ("How the
  cache works", 2026-10-14): the Cache API is per-datacenter and "not
  compatible with tiered caching". `fetch()` with `cf.cacheTtl` reads
  through the Worker zone's cache "even if the URL is for a non-Cloudflare
  site", and CF recommends fetch for tiered caching. The poll-cache uses
  fetch + cf.cacheTtl, which is right. The docs don't explicitly say Tiered
  Cache applies to Worker subrequests to third-party origins
  (VoteHub/civicAPI/Kalshi). Worst case is per-PoP caching: about 1 origin
  hit per active PoP per TTL. That's harmless at our scale. Only works on
  a custom domain in a zone, which polls.openslate.us now is (not
  workers.dev). Smart Tiered Cache is free-plan.
- The Workers Builds connect dialog calls the root directory "Path" (under
  Advanced settings), and the preview toggle "Enable Preview builds" (on by
  default). The ops `bun builds` CLI is read-only; it can't create a
  connection, so connecting is dashboard-only. Connecting doesn't start a
  build; `bun builds <worker>` says "No builds exist" until the next push.
- The connect dialog lists every public repo, including ones the Cloudflare
  GitHub App isn't installed on, because public repos are readable without
  the app. Connecting such a repo succeeds, but GitHub never sends it push
  events, so nothing builds and no "Workers Builds: …" check appears. A
  working repo (empyreangate.org) shows that check on every commit. The repo
  has to be in the app's repository access list.
- Polling the Cloudflare API in a loop (the ops `bun builds` CLI every 10s)
  hits error 971 "Please wait and consider throttling" on both CF_API_TOKEN
  and CF_BUILDS_TOKEN. Check GitHub check runs instead
  (`gh api repos/cinderblock/OpenSlate/commits/<sha>/check-runs`).
- On a curl quirk: Git Bash curl `-o /dev/null -w %{http_code}` prints
  `000` on this machine even when the request succeeds. Use `-D - -o NUL`.

## Open questions for the user

1. ~~Approve the ops commit~~ (done, `e3b3455`).
2. Make an offer on `openslate.vote` / `openslate.org`, or skip?
   Recommendation: skip until after the election.
3. ~~Analytics~~ (decided; see `plans/usage-analytics.md`).
4. Tiered Cache by hand? Recommendation: skip (ops can't manage it, and
   per-datacenter caching is fine at this traffic).

## Things not to do

- Don't register, change DNS, or touch Cloudflare without explicit
  per-change approval.
- Don't trust `rdap.org` "000"/1015 results as availability. That's rate
  limiting.
