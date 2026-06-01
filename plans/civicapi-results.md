# civicAPI election-results integration

## Goal

Let an OpenSlate user load a slate and **watch / compare actual election results
against the positions in that slate** — both during election night (live
progression with replay) and after certification (static comparison).
Counterpart to the existing VoteHub *polls* integration, which covers
pre-election public-opinion data.

Reuses the existing decentralized-first model: the browser fetches civicAPI
directly; the worker/server proxy mirrors only for self-host parity and
edge caching.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\OpenSlate` (Bun workspaces monorepo).
- Existing analogues to mirror:
  - `apps/server/src/polls.ts` (15-min cache proxy of VoteHub)
  - `apps/poll-cache/src/index.ts` (Cloudflare Worker, same shape)
  - `apps/web/src/lib/polls.ts` + `apps/web/src/components/PollsPanel.tsx`
  - `apps/server/src/ballot.ts` (VIP via Google Civic) — *not* the model for results, but shows the `ElectionsSource` interface we may align with.
- Subject model: `@openslate/core` `Subject` already has `id`, `title`,
  `jurisdiction`, `election` — enough to drive a civicAPI search.
- Project constraint: no central server for per-user queries
  ([[openslate-no-central-server]]). civicAPI is OK because it's a public
  third-party endpoint we hit directly from the browser.

## Decisions already made (don't re-ask)

1. **Source is civicapi.org** (civicAPI v2) — *not* Open Civic Data, AP, DDHQ.
   User confirmed in clarification round.
2. **Scope is all phases**: live election-night returns, certified results,
   historical comparison, and subject-matching. (User: "all of the above".)
3. **Transport: browser-direct, worker optional.** civicAPI returns
   `Access-Control-Allow-Origin: *` and needs no key, so the SPA can fetch
   it directly with no proxy. The `poll-cache` Worker and Hono server gain
   `/api/results/*` mirrors for self-host parity and edge caching, but the
   client falls back to direct civicAPI if `VITE_RESULTS_BASE` is unset.
4. **Matching is auto + manual override.** Auto-resolve civicAPI race IDs by
   `(election_date, country, province, district, normalized title)` similarity;
   show confidence; let user override and persist the override locally.
5. **Live behavior: full replay/scrubber.** While `percent_reporting < 100`,
   poll `/race/{id}/history` on a slow cadence; render a timeline scrubber so
   the user can replay how the night unfolded.
6. **Sourcing is opaque** — civicAPI doesn't publish how it gets its numbers.
   We must surface "Source: civicAPI" attribution and a one-line caveat
   ("third-party aggregator; verify against official results for high-stakes
   use") wherever results are shown.
7. **Override storage: IndexedDB.** Reuses the existing `idb`-backed `openslate`
   DB in `apps/web/src/lib/db.ts`. Bumps `DB_VERSION` from 3 → 4 and adds a
   new `subjectRaceMap` object store keyed by canonicalized subject key.
8. **Results lives on its own page/view.** A dedicated route, focused purely on
   showing results next to the slate's positions. Read-only with respect to
   endorsements — viewing results never edits the slate.
9. **Provider abstraction from day one.** `ResultsSource` is a swappable
   interface; civicAPI is one adapter. Plan should leave room for an AP
   Elections, Decision Desk, or OpenElections adapter to slot in without
   touching panel/timeline code. (User's note about being open to alternate
   sources applies to both results *and* polls in spirit — we won't refactor
   `polls.ts` as part of this work, but the new abstraction should be a model
   we could eventually pull polls under.)
10. **Maps in v1.** Surface civicAPI's `?generateMap` (SVG) as a toggle in
    `ResultsTimeline` for races where `has_map: true`. PNG variant is a
    follow-up.

## civicAPI surface (verified live 2026-05-31)

Wire-format reference for future implementers.

- Base: `https://civicapi.org/api/v2`
- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Credentials: true`
- Auth: none. License: free incl. commercial; attribution required for non-personal use.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | `{"status":"ok"}` |
| GET | `/getElectionYears` | `["2026","2025",...]` |
| GET | `/getElectionDates?country=US&province=CA&year=2024` | List of election dates with race counts |
| GET | `/race/search?country=&province=&district=&query=&startDate=&endDate=&election_type=&limit=` | Search races — returns `{count, offset, limit, races:[...]}` |
| GET | `/race/{raceid}?[generateMap\|generateMapPNG]&data=[csv\|json]&[embed]&[precinct]` | Full race detail incl. `region_results` and optional rendered map |
| GET | `/race/{raceid}/history` | List of available timestamps (UTC ISO) |
| GET | `/race/{raceid}/history/{timestamp}?[generateMap\|generateMapPNG\|light\|precinct]` | Snapshot at that timestamp. History only available for races tracked after 2025-10-09. |

### Race object (representative fields)

```jsonc
{
  "id": 26131,
  "type": "Referendum",
  "country": "US",
  "province": "IA",
  "district": null,
  "municipality": null,
  "election_name": "Iowa State Supreme Court Retain Justice David A. May",
  "election_type": "Statewide",
  "election_date": "2024-11-05T05:00:00.000Z",
  "polls_open": "...",
  "polls_close": "...",
  "has_breakdown": true,
  "has_map": true,
  "percent_reporting": 100,
  "candidates": [
    { "name": "David A. May", "party": "Republican", "color": "#c6606b",
      "votes": 776472, "percent": 63.29, "winner": true,
      "incumbent": false, "electoral_votes": 0, "seats": 0,
      "delegates": 0, "legislative_votes": 0, "fusion_votes": 0 }
  ],
  "region_results": { /* per-region candidate breakdown */ }
}
```

## Plan / steps

Numbered roughly in dependency order. Steps later in the list are stubbed-out
until earlier ones land.

1. **`packages/core/src/results.ts`** — new module exporting:
   - `interface Race` (the wire shape above, narrowed).
   - `interface RaceSummary` (search-result subset).
   - `interface ResultsSource { search(...); get(raceId); history(raceId, ts?); }`
   - `function subjectToRaceQuery(subject: Subject): SearchParams` — derives
     `(country, province, startDate, endDate, query)` from a `Subject`'s
     `jurisdiction` + `election` + `title`. (Re-use jurisdiction parser if any.)
   - `function scoreMatch(subject: Subject, race: RaceSummary): number` —
     0–1 confidence for ranking search hits.
   - Pure types + helpers — *no fetch*. Transport lives in app code so core stays
     dep-light per existing convention.
   - Re-export from `packages/core/src/index.ts`.

2. **`apps/web/src/lib/results.ts`** — browser adapter wired to a
   `ResultsSource` (mirrors `lib/polls.ts`):
   - `const BASE = (import.meta.env.VITE_RESULTS_BASE ?? "https://civicapi.org").replace(/\/+$/, "")`
   - `createCivicApiSource(base)` returns a `ResultsSource` implementation
     (search / get / history). The module exposes a default `resultsSource`
     bound to `BASE`; alternate adapters can be slotted later without changing
     callers.
   - `raceSearchQueryOptions(subject)` — TanStack-Query options; calls
     `resultsSource.search(...)` with params derived by `subjectToRaceQuery`.
   - `raceQueryOptions(raceId)` and `raceHistoryListQueryOptions(raceId)` and
     `raceHistorySnapshotQueryOptions(raceId, ts)`.
   - Cache TTLs: search 5 min, race detail 30 s while live (`percent_reporting < 100`) else 1 h, history list 30 s while live else 1 h.
   - Subject-to-race-ID override persisted in IndexedDB via `lib/db.ts`
     (new `subjectRaceMap` store added under `DB_VERSION = 4`, keyed by
     canonicalized subject key — prefer `subject.id` when present, else a
     normalized `(jurisdiction|election|title)` tuple).

3. **`apps/web/src/components/ResultsPanel.tsx`** — per-`Subject` panel:
   - Calls `useQuery(raceSearchQueryOptions(subject))`.
   - If 1+ hits, picks top by `scoreMatch`; shows confidence indicator + "change"
     button (opens a list of all hits + a "search manually" input).
   - Renders winner row + every candidate with votes/% bar + party color + incumbent badge.
   - If `position.choice` is present: green check when it matches the winner
     name (case/whitespace-insensitive); red strike otherwise. For `oppose`,
     check inverts (success = the user's `choice` lost).
   - For unmatched subjects: "Attach civicAPI race" search box.
   - Footer: "Source: [civicAPI](https://civicapi.org) · third-party aggregator; verify against official results for high-stakes use."

4. **`apps/web/src/components/ResultsTimeline.tsx`** — election-night scrubber:
   - Loads `history` list; renders a horizontal time scrubber from the first
     to the latest timestamp.
   - Drag/keyboard scrub triggers `raceHistorySnapshotQueryOptions(raceId, ts)`.
   - "Live" toggle: when on AND `percent_reporting < 100`, refetch list every
     30 s and auto-advance the scrubber head.
   - Optional `?generateMap` SVG when `has_map`.
   - Pure presentational + a thin `useResultsTimeline(raceId)` hook in
     `lib/results.ts`.

5. **Dedicated results route in `apps/web`** — new `/results/:slateHash` (or
   `/results/:slateToken`) route:
   - Renders the slate's `Position[]` as read-only rows with a `ResultsPanel`
     beside each.
   - Strictly view-only — no stance/choice editing, no signing. Importing or
     editing the slate happens on the existing slate routes.
   - Linkable: "Share my results" copies the URL.
   - Adds a sidebar entry / nav link from the existing slate view to "View
     results" for any slate whose `subject.election` is past-or-in-progress.
   - Collation view (`CollatePanel.tsx`) gets a smaller "outcome" column that
     reuses the same `ResultsPanel` data hooks but renders the winner only —
     no scrubber, no map — so multi-issuer side-by-side stays compact.

6. **`apps/server/src/results.ts`** — Hono `/api/results/*` proxy (mirrors
   `polls.ts` shape: 15-min cache when reporting is settled, 30 s while live).
   Optional, lights up if self-hoster wants the uniform fetch surface.

7. **`apps/poll-cache/src/index.ts`** — add `/api/results/*` to `PROXY_PATHS`
   and adjust upstream rewriting (`/api/results/x` → `https://civicapi.org/api/v2/x`).
   Edge cache: `s-maxage=30` if upstream `percent_reporting < 100`, else
   `s-maxage=900, stale-while-revalidate=3600`. Adds
   `X-Data-Source: civicAPI` / `X-Data-License: see civicapi.org`.

8. **README + SPEC.md updates**:
   - README: add civicAPI row to the hosting-topology table and to the
     `apps/server` / `apps/poll-cache` rows.
   - SPEC.md §8: mention civicAPI race-IDs as another valid subject-id
     namespace (`civicapi:<numeric-id>`) for cross-issuer matching.

9. **Tests**:
   - `packages/core` unit tests for `subjectToRaceQuery` and `scoreMatch`.
   - `apps/web` component tests for `ResultsPanel` happy / no-match / multi-match.
   - `apps/server` test that `/api/results/race/search` proxies and caches.
   - `apps/poll-cache` test (Miniflare or fetch-mock) on the same path.

## Findings / gotchas

- **No OCD-ID / Google-Civic ID alignment.** civicAPI IDs are numeric and
  internal. Matching must be similarity-based. Don't lean on `subject.id`
  prefixes — use `election_date` + `(country, province, district)` + title.
- **History endpoint only goes back to 2025-10-09.** Races before that have no
  timeline; scrubber must degrade gracefully (hide for pre-cutoff races).
- **civicAPI returns "Top three candidates" on the list endpoint** but full
  candidate set on the detail endpoint. So `search` results are for picking
  the race, not for rendering the final panel — always fetch `/race/{id}` for
  the comparison view.
- **`percent_reporting` is the only freshness signal** — once it hits 100 the
  race is considered final by civicAPI even if the official body hasn't
  certified yet. Surface this distinction in the UI.
- **Stance semantics for results.** `endorse`+`choice` → winner-match check.
  `oppose`+`choice` → inverted check. `lean_for`/`lean_against` → same as
  endorse/oppose but rendered with a softer success indicator. `neutral` /
  `abstain` → suppress the check; just show the result.
- **No `civicapi.json` openapi spec or swagger surface.** Endpoint list was
  reverse-engineered from the docs SPA bundle
  (`assets/entries/pages_api-documentation.wirjySxv.js`). Re-derive if their
  docs change.

## Open questions for the user

*(All four prior questions answered 2026-05-31 — see Decisions 7–10.)*

## Things not to do

- **Don't proxy civicAPI through a worker by default.** The whole point of
  adding it directly is that civicAPI's CORS already allows browser fetches
  — we'd be adding a hop and a hosted dependency for no benefit. The worker
  route is optional.
- **Don't write a civicAPI API key into env templates** — there is none.
- **Don't hard-code year/jurisdiction lists** — use `getElectionYears` and
  `getElectionDates`. The user's slate's `subject.election` is the seed.
- **Don't substitute `civicapi:<id>` for an existing `vip:<id>` on the
  `Subject`.** Subjects from the ballot picker stay `vip:<id>` to preserve
  cross-issuer matching; the civicAPI race-ID is a separate, locally-stored
  *alias*.

## Progress log

- [x] 2026-05-31 — Reverse-engineered civicAPI endpoint surface, verified live
      against `/getElectionYears` and `/race/search`. Confirmed CORS,
      no-auth, and race+candidate response shape.
- [x] 2026-05-31 — User confirmed scope (all phases) and the three architectural
      choices: direct fetch, auto-match + override, full replay scrubber.
- [x] 2026-05-31 — User confirmed: IndexedDB for override storage, dedicated
      `/results/:slateHash` route (read-only), `ResultsSource` abstraction
      from day one, maps in v1.
- [x] 2026-05-31 — Plan written; user gave go-ahead to implement.
- [x] Step 1: `packages/core/src/results.ts` — types + matching helpers.
- [x] Step 2: `apps/web/src/lib/results.ts` + `subjectRaceMap` IndexedDB store.
- [x] Step 3: `apps/web/src/components/ResultsPanel.tsx`.
- [x] Step 4: `apps/web/src/components/ResultsTimeline.tsx` (scrubber + map).
- [x] Step 5: `/results/:token` route + Results nav + `OutcomeChip` in collation.
- [x] Step 6: `apps/server/src/results.ts` — adaptive-TTL proxy.
- [x] Step 7: `apps/poll-cache` `/api/results/v2/*` route added.
- [x] Step 8: README + SPEC.md §8.1 updates.
- [x] Step 9: tests — 41 passing across core matching helpers + server TTL.
- [ ] Future: vitest setup for `apps/web` React-component tests; AP/DDHQ
      adapter behind `ResultsSource`; PNG-map support; per-timestamp maps
      if civicAPI ever exposes them.
