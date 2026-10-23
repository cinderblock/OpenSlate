# Elections page shows an HTTP 404 on the hosted app

> Plan path: `plans/elections-page-hosted.md`. Read this first when resuming.

## Goal

Fix the remaining half of the ISSUES.md entry "Hosted app shows raw HTTP 404
errors for elections and ballot lookup". The ballot half went away with
`ui/two-modes`. On https://openslate.us there's no `apps/server`, so the
Elections page (`ElectionsPanel.tsx`) gets a 404 from `/api/elections` and shows
"Google elections list unavailable — HTTP 404".

## Environment / context

- `electionsQueryOptions` / `serverHealthOptions`: `apps/web/src/lib/query.ts`.
  `/api/health` answers `{ ballotLookup: true }` only from a self-hosted
  `apps/server` with a Google Civic key. On a static host or with the dev
  proxy and no server, the fetch fails and the query reports `false`.
- `apps/server`: `createBallotSource()` and `createElectionsSource()` both come
  from `readCivicConfig()`, so `ballotLookup` also means `/api/elections` can
  answer.
- Find your districts (`FindDistricts.tsx`) already gates the Google lookup on
  `ballotLookup` the same way.

## Decisions

- Only run the elections query when `/api/health` reports `ballotLookup`.
  Hosted visitors never call `/api/elections`, so they never see an error.
- The intro only mentions Google's list when the server provides it.
- A self-hosted server without a key still gets the 501 message (it names
  `GOOGLE_API_KEY`, which means something to whoever runs the server).

## Plan / steps

1. ElectionsPanel: gate the query on health; wording.
2. Checks; a browser check on the dev server with no `apps/server` (the same
   situation as the hosted app); commit; close the issue.

## Progress log

- [x] Plan written; issue claimed
- [ ] ElectionsPanel
- [ ] Checks and browser verification
- [ ] Commit, close the issue
