# Usage analytics: opt-in, allowlisted counts only

`plans/usage-analytics.md`

## Goal

Learn how OpenSlate is used (which pages and features, roughly how much)
without collecting anything that reveals a voter's choices, location or
identity, and with a user-facing opt-out. Requested 2026-10-14: "I want
_some_ sort of anonymized usage tracking", "get these both working
together" (Cloudflare Web Analytics + telemetry-collector).

## Environment / context

- Web app: `apps/web` (React + Vite SPA, TanStack Router), to be served at
  `https://openslate.us` from the `openslate-web` worker (see
  `plans/domain.md`).
- telemetry-collector: `github.com/cinderblock/telemetry-collector`, cloned
  at `~/git/Personal Projects/telemetry-collector`. Its hostname is
  `telemetry.tomsawyerlabs.com` (ops
  `cloudflare/config/workers/telemetry-collector.yaml`), but no code is
  deployed there yet.
- ops `web_analytics` key on a zone entry: `true` (edge auto-inject),
  `manual` (site exists, no injection, app embeds the beacon), `false`.

## Findings

### telemetry-collector (audited 2026-10-14 from the repo, read-only)

- Usage events carry only `{event, value?, dims?}` plus `release` and
  `environment`. No user/device/session id, no URL, no referrer, no
  storage (no cookies, no localStorage).
- Server stores usage in Analytics Engine (90-day raw), plus a daily
  per-(app, event) rollup in D1 with no dims, never pruned. The client IP
  is used only as a rate-limit key and is **not stored**. Country and UA
  are not stored for usage events.
- Nothing is auto-captured by `init()`. `installBrowserHandlers()` turns
  on error capture **and click breadcrumbs that record up to 40 chars of
  clicked text**, which could include a ballot choice. **Don't call it**
  (or only with clicks/console off) in OpenSlate.
- No built-in opt-out. "Don't call `init`" works. Mid-session opt-out
  needs our own wrapper around `track()`. `beforeSend` does not run for
  usage events.
- Ingest key is public, and CORS is `*` with no origin allowlist. Anyone
  can inflate our counts. Acceptable.
- **SDK not published to npm yet** (`@cinderblock/telemetry-collector`,
  404). It depends on a `workspace:*` core package, so a git dependency
  won't resolve. Needs a release (tag `v*` in that repo) or vendoring.
- A new app is registered in its passkey-protected admin UI (user-only).
  The ingest key is derived offline with `telemetry-collector key --app
  <id> --channel <version>`.

### Cloudflare Web Analytics beacon

- Cookieless. Reports page URL path, referrer, UA-derived browser/OS,
  country, and Core Web Vitals. SPA mode follows history navigation.
- **Privacy problem in our routes:** `/results/$token` puts an entire
  signed slate (choices plus signer key) in the URL path, and `/race/$key`
  names the race being viewed. A path-recording beacon would ship those to
  Cloudflare. The beacon has no URL-scrubbing hook.

### Is feature-level tracking a privacy concern?

Not inherently. The risk is in *what the event says* and whether events
can be linked to a person. Political opinions are GDPR Art. 9
special-category data, so the bar is: no event or dim may reveal a choice,
a race, a candidate, an org, a slate, or a jurisdiction finer than "has
one". With telemetry-collector's no-id, no-IP storage, a fixed allowlist
of event names and low-cardinality, non-political dims is fine.

## Proposed design (awaiting user OK)

1. **One switch.** Settings → "Share anonymous usage statistics", default
   on, stored in localStorage. It reads `navigator.globalPrivacyControl`
   and defaults to off when GPC is set. Both pipes check it. Toggling it
   off stops future sends immediately.
2. **telemetry-collector** = the main usage pipe.
   - `page.view` with dim `route` = the route *template*
     (`/results/$token`, never the value).
   - A fixed allowlist of feature events: `slate.import` (dim `source`:
     catalog|url|file|paste), `slate.compose`, `slate.sign`,
     `slate.share`, `ballot.print`, `ballot.export` (dim `format`:
     csv|md|png|svg), `catalog.import_all`, `identity.create`,
     `results.view`.
   - Counts only. No candidate, race, org, slate or jurisdiction values,
     ever. A typed wrapper makes anything else a compile error.
   - Don't call `installBrowserHandlers`.
3. **Cloudflare Web Analytics** (`web_analytics: manual` in ops; the app
   injects the beacon only when the switch is on) for referrers, country
   and Web Vitals. Precondition: **move sensitive route params out of the
   path**, e.g. `/results#<token>` and `/race#<key>`. Fragments aren't sent
   to servers or reported by the beacon as path. (Verify this against the
   beacon payload before shipping.) Otherwise skip the beacon and rely on
   Cloudflare's zone analytics, which use no script.
4. A short "What we collect" note on the Settings page listing exactly
   the events above.

## Decisions (user, 2026-10-15)

- Design approved ("I trust you"). ~~On by default~~ **Superseded
  2026-10-17: "make sure it's opt-in. add a toggle in the settings and in
  the footer".** Off until the user turns it on; GPC needs no special case.
- Cut a telemetry-collector release. Use the plain npm names if available
  (they were): `telemetry-collector`, `-core`, `-cli`.
- Register an `openslate` app in the telemetry-collector admin UI.

- **2026-10-17, user: "make sure it's only sharing usage and
  sanitizes/cannot leak personal choices/preferences".** Done in `252ae76`:
  - **Cloudflare Web Analytics beacon removed.** It loads live and
    unversioned, and its Web Vitals (INP/CLS/LCP) report a CSS selector for
    the target element, e.g. `button.stance-btn.stance-endorse` (read from
    beacon.min.js 2026-10-17). Nothing could promise it never carries a
    choice. (Resource timings: used only for the LCP image and opt-in
    server-timing, not sent.) Usage = our own events only.
  - **Runtime allowlist** `sanitizeUsageEvent` in `lib/usage.ts`, driven by
    the same `USAGE_SCHEMA` as the types: known name, exact dims, closed
    values, own plain props. 11 tests incl. events forged past the types.
  - **CSP** `apps/web/public/_headers`: `script-src 'self'` (no third-party
    or inline script can run, including edge-injected ones),
    `Referrer-Policy: no-referrer`. Verified locally under `wrangler dev` and
    live.

## Implementation notes

- **Hash routing instead of moving params**: `createHashHistory()` puts
  every route in the fragment. Browsers never send it to a server, so shared
  `/results/<token>` links never reach Cloudflare's edge logs either. The
  beacon's URL sanitizer (`ot()` in beacon.min.js, version 2026.10.x) sets
  `hash=""` and `search=""` on both location and referrer. Read from the
  live script 2026-10-15.
- ops: `web_analytics: { auto_install: false }` (zone-level, no injection
  anywhere in the zone) rather than `manual` (which is auto-install plus a
  per-host exclusion rule).
- The page-view route is compile-checked: `const route: RouteTemplate =
  routeId` fails to typecheck if a new route isn't added to the union.

## Progress

- [x] OpenSlate web: switch, Settings panel, typed events, beacon loader,
      hash routing (`b9e728a`). Tests 136 pass, typecheck + build green.
- [x] telemetry-collector: unscoped rename + trusted publishing workflow
      (`50b7756` in that repo). 221 tests pass.
- [x] ops `web_analytics: { auto_install: false }` on openslate.us, approved
      2026-10-17, pushed as ops `e5515bd`; Cloudflare CI created the site.
- [x] Beacon token in `apps/web/.env.production` (`VITE_CF_BEACON_TOKEN`).
      Cloudflare Web Analytics goes live with the first deploy.
- [x] ~~Parked~~ Unparked 2026-10-17: "let's get the telemetry wired in.
      make sure it's opt-in. add a toggle in the settings and in the footer".
- [x] Opt-in + footer toggle (`dd2e429`, live on openslate.us). One
      subscribable switch shared by Settings and the footer. Turning it off no
      longer reloads (Compose keeps unsaved work in memory); a note offers
      "Reload now" if the beacon already ran on this page. Plus the `.row`
      label fix it exposed (`1aa12f5`).
- [ ] Decide how OpenSlate gets the SDK. The user asked why npm at all.
      Options: vendor the browser client into OpenSlate, a git dependency on a
      built branch, or an npm release. **An npm release is CI-only, from a
      protected version tag; no local publish, not even a 0.0.0 name claim.**
      npm trusted publishing can only be configured on a package that already
      exists. The user (2026-10-17): "that's the only reason to do a first
      local push". So a new package's first publish may be local, with the
      user's go-ahead at that moment, solely to enable trusted publishing.
      Every later version comes from CI.
- [ ] OpenSlate: wire `setUsageSink` in main.tsx with `VITE_TELEMETRY_ENDPOINT`
      / `VITE_TELEMETRY_KEY`.
- [ ] **telemetry-collector has never been deployed.** Findings 2026-10-17:
      its only Workers Build (deploy@7a2d14e, 2026-09-25) failed with
      "UnknownLockfileVersion" because the trigger has no `BUN_VERSION` (image
      Bun 1.2.15 can't read the lockfile; OpenSlate's triggers set
      `BUN_VERSION=1.4.2` + `SKIP_DEPENDENCY_INSTALL=1`). Trigger has
      `D1_DATABASE_ID`/`KV_NAMESPACE_ID`. The worker had **no secrets**;
      SECRET_KEK is now set (ops `54c66ff`, 2026-10-18, see question 4).
      `deploy` is at 7a2d14e, master at 50b7756 (fast-forward). GitHub reports
      `deploy` as **not protected**, though its README says it is.
      Earlier note:
      telemetry.tomsawyerlabs.com serves ops's 503 stub. Workers Builds
      "has produced no build across three push events", per ops'
      `plans/telemetry-collector-cloudflare.md`, which has uncommitted edits
      from another thread (since 2026-09-25). There's no admin UI to register
      `openslate` in until it ships, and passkey enrolment needs the user's
      BOOTSTRAP_TOKEN. Not taking that work over without the user's say-so.

## Findings

- A corrupted file in Bun's global cache
  (`es-set-tostringtag@2.1.0/package.json`, binary garbage, hardlinked into
  node_modules) broke `vite build` (the workbox step) with "Invalid package
  config". Fixed by moving the cache entry aside
  (`%TEMP%/norm/es-set-tostringtag-corrupt-cache`) and reinstalling.

## Path to live events (2026-10-17)

1. ~~Trigger build variables `BUN_VERSION=1.4.2`, `SKIP_DEPENDENCY_INSTALL=1`~~
   Done 2026-10-18 by the user in the dashboard (the Builds API token is
   read-only); confirmed via the Builds API, all four vars present. As of
   that check the worker's only binding is `SECRET_KEK` (no BOOTSTRAP_TOKEN
   yet).
2. ~~SECRET_KEK on the worker~~ Done: ops `54c66ff`, CI created it 2026-10-18.
3. ~~BOOTSTRAP_TOKEN on the worker~~ Done 2026-10-19 by the user (dashboard;
   saving it redeployed the ops 503 stub with the new secret, version
   fb21dd01; no build was started). Bindings now: BOOTSTRAP_TOKEN, SECRET_KEK.
4. `git push origin master:deploy` in telemetry-collector → first deploy.
   Pushed 2026-10-19 (7a2d14e..50b7756, user's yes). Build bf46bdce: the
   build step passed (Bun 1.4.2, bindings resolved), the **deploy command
   failed** with `✘ [ERROR] Unknown argument: yes` from
   `wrangler d1 migrations apply ... --remote --yes`. Wrangler 4.136 has no
   `--yes`; non-interactive runs skip the prompt and still back up. Nothing
   migrated or deployed. README fixed (telemetry-collector `5e5a053`). The
   trigger's deploy command must lose ` --yes` (dashboard, user), then a
   retry or a push of `5e5a053` to `deploy` rebuilds. The same `--yes` is
   in ops `plans/telemetry-collector-cloudflare.md`.
   **Deployed 2026-10-19** (user removed `--yes`; deploy pushed to `5e5a053`,
   build b3f866da succeeded): migrations 0001-0003 applied to TELEMETRY_DB,
   version ecfa33c1 live; `/login` serves "Set up — telemetry-collector".
   Side effect: wrangler.toml left `workers_dev`/`preview_urls` unset, so
   wrangler enabled `telemetry-collector.isozilla.workers.dev` and preview
   URLs (both against production data). It also reset the compatibility
   date from the dashboard's 2026-09-08 to the repo's 2026-09-01. Fixed in
   telemetry-collector `664d56d` (both set false, CI green), deployed with
   the user's yes (build 9a539053 succeeded). Verified: subdomain
   `{"enabled":false,"previews_enabled":false}`, workers.dev `/login` 404,
   custom domain `/login` 200.
5. User enrols a passkey, registers app `openslate`; ingest key via
   `telemetry-collector-cli key --app openslate --channel <version>`
   (public value, goes in `apps/web/.env.production`).
6. SDK into OpenSlate (see question 3), then `setUsageSink` in main.tsx
   using `init({ endpoint, ingestKey })` and its `track`. **Rules for that
   wiring:** the sink only forwards what `track()` hands it (already
   sanitized); never call `installBrowserHandlers`, `captureException`,
   `captureMessage`, `sendFeedback`, `setUser` or `setTags` from OpenSlate
   (error reports can carry slate text); no `appSecret` in the browser;
   `release` = app version, `environment` = "production". Add the collector's
   origin to nothing: CSP `connect-src https:` already allows it. Check the
   request body in devtools after wiring: `{events:[{event,dims}],release,
   environment}` and nothing else.
7. Within 90 days of the first event: `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN`
   worker secrets, or the daily rollup loses days.

### Release and deploy protection (checked 2026-10-17)

telemetry-collector has **no rulesets**: any pusher can create a `v*` tag
(which `publish.yml` publishes from) and `deploy` has no required checks,
though the README says it does. The `npm` environment `publish.yml` names
doesn't exist yet (only `production`). The user's rule is "publish from CI
after a protected version tag", so before the first CI release:
- tag ruleset on `refs/tags/v*`: restrict creation/update/deletion to
  repo admins;
- branch ruleset on `deploy`: required checks `check` and
  `node-matrix (18/20/22/24)`, no force-push, no deletion;
- environment `npm`: deployments only from `v*` tags.
**Applied 2026-10-19** with the user's yes: ruleset 25377363 "release
tags: admins only" (creation/update/deletion; bypass: repository admin
role), ruleset 25377367 "deploy: CI-green fast-forwards only" (no bypass;
checks bound to GitHub Actions, app 15368), environment `npm` with a single
`v*` tag deployment policy. Verified via `rules/branches/deploy`.

npm first publish: `scripts/guard-publish.ts` (prepublishOnly) allows a
local publish only at `0.0.0` (name claim) and refuses everything else
outside CI. Order: core, sdk, cli. Then on npmjs.com, per package, add the
trusted publisher (repo cinderblock/telemetry-collector, workflow
`publish.yml`, environment `npm`).
2026-10-19: user enrolled the passkey and ran `npm login` (whoami
cinderblock; all three names still free). Workspace ranges resolved in the
working tree, built, `npm pack --dry-run` clean (dist + package.json only).
`npm publish` from an agent shell fails with `EOTP` (account 2FA needs a
browser auth that only an interactive terminal waits for), so the user runs
the three publishes; afterwards revert the two `workspace:*` rewrites in
packages/sdk and packages/cli package.json.
Done 2026-10-19: all three names now exist on npm, owned by cinderblock
(read-write). The registry shows only npm's staged-publishing stub
`0.0.0-stage` ("Temporary package placeholder for staged publishing"),
not 0.0.0, and `npm stage list <pkg>` reports no staged versions for any of
them. The stub is enough for trusted publishing; `latest` moves when CI
publishes v0.1.0. Watch whether that CI publish also lands as staged and
needs approval (npm docs: staged publishing works with trusted publishers,
and approval needs 2FA). Temporary edits reverted; the tree is clean
(LF endings restored).
Trusted publisher: npmjs.com offers "Allow npm publish" with the warning
"Not recommended … leave this unchecked to require staged publishing".
Recommended unchecked (stage-only). `publish.yml` now runs
`npm stage publish` (telemetry-collector `d84934e`), which works under
either setting. Each release then needs the user's 2FA approval per
package on npmjs.com (Staged Packages tab), core first.

## Open questions for the user

1. ~~Design / default / release / register~~ (answered 2026-10-15).
2. ~~Approve the ops `web_analytics` commit~~ (done, `e5515bd`).
3. ~~How OpenSlate gets the SDK~~ npm via CI (user, 2026-10-17). Needs the
   user's `npm login` + go-ahead for the 0.0.0 name claims.
4. ~~SECRET_KEK~~ Finish the ops feature (user, 2026-10-17). **Staged** in
   ops worktree `ops-generated-secrets` (11 files; 195 tests pass; dry run =
   1 create: SECRET_KEK on telemetry-collector, value never shown; 32 random
   bytes, base64url, matching the worker's `importKek`). Left out of the
   stalled diff: its Previews removals (would have undone `102fbb9`), the
   `builds` CLI, a restic DNS record. Added: refuse under `DEBUG=true` (the
   SDK logs request bodies). **Applied 2026-10-18** (user: "go for it"):
   ops `54c66ff`, rebased onto Tiered Cache `dec8220` (206 tests pass;
   dry run still exactly 1 create). CI's apply job logged "Created
   worker-secret: SECRET_KEK on worker telemetry-collector (generated: 32
   random bytes, value never shown)", so CI's token can write worker
   secrets. The verify job then failed twice on Cloudflare's account rate
   limit (429, code 971, reading tunnels and then a WAF zone), which has
   nothing to do with this change. A third run, 5 min later, passed: 0/0/0,
   "Everything is in sync".
5. Approve the GitHub protections above (tag ruleset, deploy ruleset, npm
   environment)?
6. The ops `web_analytics: { auto_install: false }` site for openslate.us is
   now unused. Remove it from ops (needs a commit yes), or keep it?
   Recommendation: remove; the CSP would block an auto-injected beacon
   anyway.

## Things not to do

- Don't send any political content (race, candidate, measure, org, slate,
  jurisdiction) in an event name or dim.
- Don't call telemetry-collector `installBrowserHandlers` with click
  breadcrumbs on.
- Don't enable zone-wide `web_analytics: true` (auto-inject). It can't
  honor the per-user switch (and the CSP now blocks it).
- Don't add any third-party script or analytics to the web app, and don't
  loosen `script-src` in `apps/web/public/_headers`.
- Don't add a usage event or dim value that isn't a fixed identifier in
  `USAGE_SCHEMA`; never free text, never anything derived from a slate.
- Never publish an npm package from the dev machine (user, 2026-10-17). CI
  after a protected version tag only. The single exception is a brand-new
  package's first publish, which trusted publishing needs. Confirm with the
  user first.
