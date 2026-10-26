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

Feature request from the user, 2026-10-26.

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

## Progress log

- [x] 1. search helpers + tests (`test/search.test.ts`, 9 tests)
- [x] 2. routes (`validateQuerySearch` in `router.tsx`)
- [x] 3. My ballot
- [x] 4. Sources
- [x] 5. verified in the browser 2026-10-26 (search, `?q=` survives a race
  page and Back, "Nothing in Against all matches… Show all 6"); typecheck,
  335 tests and Biome (CRLF config) clean; committed

## Findings / gotchas

- `validateQuerySearch` lives in `router.tsx`, not `lib/search.ts`: the
  router is in the main chunk, and `search.ts` pulls in the jurisdiction
  labels, which belong to the lazily loaded pages.
- The search box keeps its own state and writes the URL, rather than reading
  its value back from the URL: the router updates the location after the
  keystroke, and a controlled input that waited on it would jump its cursor.
- Chrome drew its own clear "×" for `type="search"` beside the kit's, on every
  `SearchField` (Slates list and catalog too). Hidden in `20f67ba`.

## Things not to do

- Don't fold the catalog search into the page search without asking: the
  catalog's list is what you *could* add, a different thing from what you have.
