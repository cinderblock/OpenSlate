# Google Civic Information: your own key, or through OpenSlate

> Plan path: `plans/google-civic-two-ways.md`. Read this first when resuming.

## Goal

Offer Google's Civic Information API (the elections list, and the ballot for an
address) on the hosted app, two ways (user, 2026-10-23: "let's build both. in
browser privacy focused and through our backend for ease of use"):

1. **Your own key, in the browser.** The user pastes their own Google API key.
   Their browser calls Google directly, so the address goes only to Google.
   The key stays in this browser and goes only to Google.
2. **Through OpenSlate.** No setup: the browser asks OpenSlate's relay
   (`polls.openslate.us`), which calls Google with OpenSlate's key. A
   self-hosted `apps/server` runs the same relay with its own key.

Today only a self-hosted `apps/server` with `GOOGLE_API_KEY` can do this, so
the hosted app never offers Google.

## Environment / context

- Work happens on branch `feat/google-civic`, in its own worktree (from local
  master after `e6b69c2`). A push to master deploys the worker through Workers
  Builds, so merging and pushing wait for the user.
- Existing Google code: `apps/server/src/ballot.ts` (`createBallotSource`,
  `createElectionsSource`, `normalize`, `extractGoogleError`; tests in
  `apps/server/test/ballot.test.ts`). Routes `GET /api/ballot?address=` and
  `GET /api/elections`; `/api/health` reports `ballotLookup`.
- Web: `apps/web/src/lib/query.ts` (`serverHealthOptions`,
  `electionsQueryOptions`, `ballotQueryOptions`, Civic types),
  `apps/web/src/lib/lookups.ts` (online lookups + consent store; `"server"` is
  the Google entry), `FindDistricts.tsx` (address lookup, `areaFromLookup` in
  `civicArea.ts`), `ElectionsPanel.tsx`, `AddressLookupsPanel.tsx` (Settings).
- Relay pattern to copy: `apps/poll-cache/src/geocode.ts`. It's POST-only,
  `Cache-Control: no-store`, upstream `cache: "no-store"`, returns only what
  the app needs, and `apps/server` mounts the same handler. Workers Logs are
  off (`wrangler.toml`).
- Hosted CSP (`apps/web/public/_headers`): `connect-src 'self' https:` (Google
  allowed); `Referrer-Policy: no-referrer`.
- No Google key on this machine (`apps/server/.env` doesn't exist).

## Findings

- **Google's terms allow a relay for our own app**, with conditions
  (https://developers.google.com/terms, checked 2026-10-23):
  - §4b: keep credentials confidential; keys "may not be embedded in open
    source projects". So OpenSlate's key lives only as a Worker secret, never
    in the repo or the bundle.
  - §4a: don't "create an API Client that functions substantially the same as
    the APIs and offer it for use by third parties". So the relay is a couple
    of fixed, trimmed endpoints, not a passthrough.
  - §5e: no cached copies longer than the cache header allows.
- **Civic data guidelines**
  (https://developers.google.com/civic-information/docs/data_guidelines):
  - Honour Cache-Control; absent a header, cache voting locations ≤ 24 h, and
    office holders and districts ≤ 30 days.
  - Give everyone the same experience: no A/B tests.
  - Attribution is optional, but Google's wording if used.
  - Extra quota is "only intended to support user-facing use cases".
  - Tell users to check with their election officials.
- **Bring-your-own-key fits the terms:** the key is the user's, used by them.
- **Browser-direct works technically:** `civicinfo.googleapis.com/civicinfo/v2/elections`
  answers `Access-Control-Allow-Origin: https://openslate.us` (GET and
  OPTIONS). Without a key it returns 403 "Method doesn't allow unregistered
  callers".
- **Referrer-restricted keys vs our CSP:** the site sends
  `Referrer-Policy: no-referrer`, so a key restricted to openslate.us would
  see no Referer and fail. The direct calls set `referrerPolicy: "origin"` on
  the request (it overrides the document policy for that request only).

## Decisions

- **One Civic adapter in `packages/core`** (`civic.ts`): types, `normalize`,
  `extractGoogleError`, and fetch helpers taking a key. The browser, the
  worker and `apps/server` all use it, so every route gives the same answer.
- **Relay routes, shared by the worker and `apps/server`**
  (`apps/poll-cache/src/civic.ts`, mounted like `geocode.ts`):
  - `GET /api/civic/elections`: the same for everyone, so cached, never longer
    than Google's header allows.
  - `POST /api/civic/voterinfo` with `{ address, electionId? }`: returns the
    normalized ballot only. `no-store` both ways, nothing logged.
  - `501` when no key is configured. `/api/health` reports `civic: true|false`.
  - `apps/server`'s old `GET /api/ballot` (address in the URL) and
    `/api/elections` go away in favour of these.
- **Not an open relay for other sites:** the civic routes only send CORS
  headers to an allowlist of origins (openslate.us and localhost), set in
  `wrangler.toml`. That isn't a security boundary (scripts ignore CORS), but it
  keeps the relay from being a public Civic API for other web apps. Rate
  limiting would be a Cloudflare setting, which is a follow-up for the user.
- **Keys:** worker secret `GOOGLE_CIVIC_API_KEY`; `apps/server` keeps reading
  `GOOGLE_API_KEY`. The user's own key is kept in this browser
  (`localStorage`), never sent anywhere but Google.
- **Consent, same model as the other lookups:** two online lookups, each
  opted in to and revocable:
  - "Google (your key)": browser to Google, offered once a key is saved.
  - "Google (via OpenSlate)": offered when the relay reports `civic`.
  The stored `"server"` consent migrates to the relay one.
- **Elections page:** your own key first, else the relay, else nothing (as
  now).
- **Settings:** a "Your Google API key" section (kit `TextField`, no native
  controls): how to get a key and restrict it (Civic Information API only;
  referrer `https://openslate.us/*`), a check that it works, and forget.

## Plan / steps

1. [ ] `packages/core/src/civic.ts` + tests (move from `apps/server/src/ballot.ts`).
2. [ ] `apps/poll-cache/src/civic.ts` handlers + tests; wire into the worker
       (health, origin allowlist, secret) and into `apps/server` (drop old
       routes).
3. [ ] Web: Civic client (direct with your key / relay), key store, queries.
4. [ ] Web: lookups + consent migration, FindDistricts, ElectionsPanel,
       Settings section.
5. [ ] README (hosting table, self-host env, privacy), `.env.example`.
6. [ ] Checks (typecheck, tests, Biome, build, `wrangler deploy --dry-run`);
       browser check against a local worker and server, with a bogus key for
       the direct path (Google's real error comes back through CORS).
7. [ ] **User:** an OpenSlate Google Cloud key (Civic Information API only);
       set it as the worker secret through the ops repo; a real-key check;
       merge and push to deploy.

## Progress log

- [x] Research: terms, guidelines, CORS (above)
- [ ] Steps 1–6
- [ ] Step 7 (user)

## Open questions for the user

1. A Google Cloud API key for OpenSlate's relay, restricted to the Civic
   Information API. It's needed for the hosted relay and for a real-key check;
   everything else can be built and tested without it.

## Things not to do

- Don't put any Google key in the repo, the bundle, a URL we log, or a commit.
- Don't make the civic relay a passthrough (§4a), and don't cache longer than
  Google's headers allow (§5e).
- Don't send an address before the user opted in to that lookup.
- Don't set the worker secret or deploy without the user's yes for that change.
