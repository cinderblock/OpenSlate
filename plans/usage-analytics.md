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

## Open questions for the user

1. OK with the design above, including the route change for
   `/results/$token` and `/race/$key`?
2. Default on (with GPC respected), or default off (opt-in)?
3. telemetry-collector SDK: cut a `v*` release of that repo so it lands
   on npm (preferred), or vendor it into OpenSlate for now?
4. Register an `openslate` app in the telemetry-collector admin UI (needs
   your passkey) and tell me the app id.

## Things not to do

- Don't send any political content (race, candidate, measure, org, slate,
  jurisdiction) in an event name or dim.
- Don't call telemetry-collector `installBrowserHandlers` with click
  breadcrumbs on.
- Don't enable zone-wide `web_analytics: true` (auto-inject). It can't
  honor the per-user switch.
