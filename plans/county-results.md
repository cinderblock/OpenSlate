# County results on Live (election night 2026-11-03)

> Plan path: `plans/county-results.md`. Read this first when resuming. Builds on
> `plans/live-race-tracker.md` (the Live page and the Secretary of State relay).

## Goal

Live results show local races (city, county, school, special district, local
measures) from each county's own election-night feed, which can lead the
Secretary of State. California only.

## Decisions (from the user, don't re-ask)

- Through our relay by default (a crowd costs a county one request per minute);
  Settings may pick a direct connection (`routing.ts` PROVIDERS).
- **No automatic fallback** relay → direct.
- Gentle on county servers: cache, coalesce, honest User-Agent
  (`OpenSlate election-results relay (+https://openslate.us)`), no aggressive polling.
- Ship the first working county early, add more after.

## Design

- `packages/core/src/countyResults.ts`: the county feed registry (slug → feed
  kind, upstream base, results page) and pure parsers (Clarity `summary.json`
  first). Shared by the web app (direct mode, parsing) and the relay (allowlist).
- `apps/poll-cache/src/countyCa.ts`: `/api/county-ca/<slug>/<inner>`, inner
  path allowlisted per feed kind. Same pattern as `sosCa.ts`: coalesced, a
  minute's cache for the version pointer, versioned files kept longer
  (immutable), errors 15 s. Mounted by the worker and apps/server.
- Web `lib/countyCa.ts`: fetch (pointer → versioned summary), normalize to
  `ContestResult`. Contest ids in the watch list: `county-ca/<slug>/<key>`.
  One query per county (all its contests in one document), cards `select` theirs.
- Live: a place with a county that has a feed offers "Local races": a picker
  and "Add all local races for this place" (matched on the place's names).

## County survey

| County | Feed | Format | CORS | Notes |
| --- | --- | --- | --- | --- |
| Santa Clara | `results.enr.clarityelections.com/CA/Santa_Clara/127570/` | Clarity: `current_ver.txt` → `<ver>/json/en/summary.json` (134 contests, all in one doc) | `*` | ver 383439 at 7:05 PM PST; summary `Cache-Control: max-age=86400` (versioned), pointer `no-cache` |
| Contra Costa | Clarity root exists (`/CA/Contra_Costa/`), election id TBD | Clarity | `*` | `elections.json` is `[]`; id from ROV site |
| others | survey in progress (background agent) | | | |

Clarity `summary.json` contest fields: `K` key, `C` title, `CAT` category
(Santa Clara: State and Federal, Judicial, Local, School, Propositions, Measures),
`VF` vote-for (0 on measures), `TP`/`PR` precincts total/reporting, `CH` choices,
`P` parties, `V` votes, `PCT` percents. No timestamp in it: use the
`Last-Modified` of the versioned file (`electionsettings.json` has `websiteupdatedat`).

## Findings / gotchas

- Clarity's `elections.json` lists nothing for CA counties: election ids come
  from each ROV's results link.

## Progress log

- [x] core registry + Clarity parser + tests
- [x] relay route (worker + server) + tests
- [x] web adapter + routing provider (`county-ca`)
- [x] Live UI: "+ Local races" per place: picker, and "Add all N local races" (name match)
- [x] checks (1051 tests, typecheck, web build, wrangler dry-run), commit `4d4ebc9`, pushed 7:15 PM PST (03:15Z)
- [x] CI lint was already red from a peer's `sosCa.ts` formatting: fixed in `4f988fc`
- [ ] live check: worker serves `/api/county-ca/santa-clara/current_ver.txt`, Live shows local races
- [ ] more counties (per survey)
- [ ] link county contests to catalog races (My ballot / race pages)

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web: its Vite alias maps
  only `@openslate/core` to `src/index.ts`, so subpaths break the build (tsc and
  bun test pass anyway). Export from core's index instead.
- Don't write regexes through bash heredocs/python in Git Bash: backslashes
  were eaten (`\b` became a backspace). Use the Edit/Write tools.
