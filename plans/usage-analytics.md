# Usage analytics with a user opt-out

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
- telemetry-collector: `github.com/cinderblock/telemetry-collector` (not
  cloned locally), running at `telemetry.tomsawyerlabs.com` (ops
  `cloudflare/config/workers/telemetry-collector.yaml`).
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

- Design approved ("I trust you"). **On by default**; GPC browsers default
  off. An explicit choice wins.
- Cut a telemetry-collector release. Use the plain npm names if available
  (they were): `telemetry-collector`, `-core`, `-cli`.
- Register an `openslate` app in the telemetry-collector admin UI.

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
- [x] ops `web_analytics: { auto_install: false }` on openslate.us. Clean
      dry run: 1 create. **Staged, waiting on the user's yes.**
- [ ] npm: claim the 3 names with a minimal `0.0.0` placeholder. **Needs
      the user to `npm login` first** (CLI is E401, and Chrome isn't signed
      in to npmjs.com).
- [ ] npm: configure a trusted publisher (repo cinderblock/telemetry-collector,
      workflow `publish.yml`, environment `npm`) on each of the 3 packages.
- [ ] Bump to 0.1.0, tag `v0.1.0`, CI publishes.
- [ ] OpenSlate: add `telemetry-collector` dep, wire `setUsageSink` in
      main.tsx with `VITE_TELEMETRY_ENDPOINT` / `VITE_TELEMETRY_KEY`.
- [ ] Read the openslate.us beacon token (`bun run web-analytics` in ops)
      into the web build env `VITE_CF_BEACON_TOKEN`.
- [ ] **Blocked: telemetry-collector has never been deployed.**
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

## Open questions for the user

1. ~~Design / default / release / register~~ (answered 2026-10-15).
2. Approve the ops `web_analytics` commit + push?
3. Run `npm login` so the 3 names can be claimed. Then either sign in to
   npmjs.com in Chrome (I'll configure trusted publishers) or do that
   yourself.
4. telemetry-collector deploy: start a separate thread for it, or pick up
   the stalled one?

## Things not to do

- Don't send any political content (race, candidate, measure, org, slate,
  jurisdiction) in an event name or dim.
- Don't call telemetry-collector `installBrowserHandlers` with click
  breadcrumbs on.
- Don't enable zone-wide `web_analytics: true` (auto-inject). It can't
  honor the per-user switch.
