# Text search at the top of My ballot and Sources

## Goal

A search box at the top of the two list-heavy pages, so a voter can jump
straight to what they're looking for:

- **My ballot** (`/`): races by seat or measure title ("Prop 50", "Assembly"),
  by candidate or option name, by party or ballot designation, by where it's
  voted on ("Oakland"), or by an endorser ("Sierra Club" shows every race it
  took a position on).
- **Sources** (`/sources`): imported endorsers (the Ballot data, Following,
  Disagree with and Imported but not followed lists) by name, the researcher
  who reported them, their link, or an election date.

Feature request from the user, 2026-10-26. Widened the same day: "all pages
with large amounts of things that could/should be filtered should get a text
search".

## Environment / context

- Web app: `apps/web` (Vite + React + TanStack Router, hash history).
- Pages: `src/components/MyBallotPanel.tsx`, `src/components/SourcesPanel.tsx`.
- Search control: `SearchField` in `src/components/ui/TextField.tsx` (React Aria;
  Escape clears). Already used by `SlatesList` (Fuse.js) and `CatalogBrowser`
  (substring).
- Tests: `bun test` in `apps/web/test`, typecheck `bun run typecheck`.

## Decisions already made (don't re-ask)

- **Matching:** every word of the query must appear somewhere in the item's
  text (AND of substrings), case- and accent-insensitive. Predictable, cheap on
  a 600-race statewide ballot, and "san jose" finds "San José". Not fuzzy:
  Fuse on a ballot surfaces near-misses that read as wrong results.
- **The query lives in the URL** (`?q=` on `/` and `/sources`, `replace` so
  typing doesn't fill history). Going to a race page and back keeps the search.
  Hash history, so it never reaches a server; usage tracking reports only the
  route template.
- **My ballot:** the search narrows the status-filtered list and the "Might be
  on your ballot" list; status counts and the progress bar stay whole-ballot.
  Matching sections open while searching (a statewide ballot starts its
  district sections closed). "No race" district notes hide while searching.
- **Sources:** the box filters your imported sources. The public catalog keeps
  its own search box (it has its own election tabs). "Imported but not
  followed" opens while a search matches something in it.

## Plan / steps

1. `src/lib/search.ts`: `searchTerms`, `matchesSearch`, `raceSearchText`,
   `sourceSearchText`; unit tests in `test/search.test.ts`. The URL hook is
   `src/lib/pageSearch.ts` (`usePageSearch`).
2. `validateSearch` for `q` on the `/` and `/sources` routes.
3. My ballot: search row under the toolbar, filtering, open sections,
   "N races match" / nothing-matches note.
4. Sources: search above the lists, filtering, empty note.
5. Typecheck, tests, check in the browser, commit.

## Phase 2: every page with a long list

Surveyed every route and the wizard (2026-10-26):

| Page | What's searched | Notes |
| --- | --- | --- |
| Results `/results` | imported slates: issuer, reported org, reporter, key, election | `?q=`; the Leaderboard keeps ranking all of them |
| A slate's results `/results/$token` | positions: title, choice, place, election, statement | `?q=`; combines with the outcome filter |
| Publish `/publish` | My picks: title, choice, place, statement | `?q=`; only what's *shown*: a pick hidden by the search is still signed |
| Publish → Elections | name, date, division, id | `?q=` |
| Wizard, sources step | organization name, link, where it publishes | component state (it's a dialog) |
| Public catalog (Sources) | upgrade to the shared matcher: name, link, reporter, slug | already had a box |

Left alone, short lists: a race page, Identities, Settings, Slates list and
Contacts (both already searchable, Fuse / own matcher).

Phase 2 steps:

- [x] P2.1 `searchTextOf` and `positionSearchText` in `lib/search.ts`, tests
- [x] P2.2 `?q=` on `/results`, `/results/$token`, `/publish`, `/publish/elections`
- [x] P2.3 Results list, a slate's results
- [x] P2.4 Compose picks, Elections
- [x] P2.5 Wizard sources step, catalog matcher
- [x] P2.6 verified in the browser 2026-10-26: Results list ("sierra", 1 of 5),
  a slate's results ("senate 2", 1 of 55), My picks in an incognito tab
  ("bonta", 1 of 3, Sign still says 3 positions), the wizard (337
  organizations, "alameda democratic" finds 1, Escape clears without
  closing), the catalog ("club redwood"). Elections only had one entry
  (no Google key in the test profile). Typecheck, tests, Biome clean.

## Progress log

- [x] 1. search helpers + tests (`test/search.test.ts`, 9 tests)
- [x] 2. routes (`validateQuerySearch` in `router.tsx`)
- [x] 3. My ballot
- [x] 4. Sources
- [x] 5. verified in the browser 2026-10-26 (search, `?q=` survives a race
  page and Back, "Nothing in Against all matches… Show all 6"); typecheck,
  335 tests and Biome (CRLF config) clean; committed

## Status

Done and deployed 2026-10-26: `dc6e504`, `9cb30d2`, `8044b13` pushed to
master (rebased onto upstream's ballot-style My ballot, `bd35565`; only the
imports conflicted) and live on https://openslate.us within a minute.
The user called it enough for now; a race page and Identities were left
without search on purpose (short lists).

## Findings / gotchas

- `validateQuerySearch` lives in `router.tsx`, not `lib/search.ts`: the
  router is in the main chunk, and `search.ts` pulls in the jurisdiction
  labels, which belong to the lazily loaded pages.
- The search box keeps its own state and writes the URL, rather than reading
  its value back from the URL: the router updates the location after the
  keystroke, and a controlled input that waited on it would jump its cursor.
- Chrome drew its own clear "×" for `type="search"` beside the kit's, on every
  `SearchField` (Slates list and catalog too). Hidden in `20f67ba`.

- A digit-only query word matched inside other numbers: "senate 2" found
  District 4, 6, 20… because every subject's election is 2026. Digit-only
  terms now match whole numbers only (`matchesSearch`).
- Shared `PageSearch` component (`components/PageSearch.tsx`) and
  `useSearchBox` (no URL, for the wizard dialog) / `usePageSearch` (URL).
- Running `biome format --write apps/web/src` rewrote 15 untouched LF files
  to CRLF (content identical). Reverted after checking each against HEAD.
  Run Biome only on the files you changed.

## Things not to do

- Don't run Biome with `--write` over a whole directory in this shared tree.

- Don't fold the catalog search into the page search without asking: the
  catalog's list is what you *could* add, a different thing from what you have.
