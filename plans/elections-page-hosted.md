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

- Imported slates count under their election **date** too (a subject's
  `election`, else the slate's context, i.e. `electionOf` in `collate.ts`),
  not only under a `vip:<id>:…` subject id. Without that, the page stays empty
  on the hosted app even with slates imported, because only Google-backed
  slates carry `vip:` ids. A slate counts once per election, whichever way it
  names it. The logic moved to `apps/web/src/lib/electionList.ts`
  (`electionEntries`) so it can be tested.

## Findings

- With slates imported (default preview profile, 5 slates for 2026-11-03),
  the page said "No elections upcoming" before this change: the catalog's
  slates name their election by date, not by Google id.
- Vite's `/api` proxy targets `localhost:8787`, where another process was
  listening and answering 404, so the proxy logged nothing. To see which `/api`
  calls the page makes, wrap `window.fetch`, then clear the app's
  `queryClient` (`import('/src/lib/query.ts')`) and re-enter the route.

## Plan / steps

1. ElectionsPanel: gate the query on health; wording.
2. Count slates by election date; move the merge into `electionEntries`.
3. Checks; a browser check on the dev server with no `apps/server` (the same
   situation as the hosted app); commit; close the issue.

## Progress log

- [x] Plan written; issue claimed (`da5d603`)
- [x] ElectionsPanel: query gated on `/api/health`; wording
- [x] `electionEntries` with dated slates, plus tests in
      `apps/web/test/electionList.test.ts`
- [x] Checks: `bun test`, typecheck (5/5), Biome on the touched files
- [x] Browser check, 2026-10-23, dev server with no backend
      (`/api/health` 404, like the hosted app). Fresh profile: no error, and
      only `/api/health` is requested. Profile with imports: "Nov 3, 2026 · 5
      imported slate(s)", where it used to say "No elections upcoming".
- [x] Committed; ISSUES.md entry closed
