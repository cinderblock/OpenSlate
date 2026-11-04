# Live race tracker (election night 2026-11-03)

> Plan path: `plans/live-race-tracker.md`. Read this first when resuming.

## Goal

A page that keeps checking for the latest results and shows them for the places
and races the user chose: several places at once ("add races for this area"),
plus single races. The user asked for it to be working within 1.5 h of
6:40 PM PST on election night (2026-11-03).

## Environment / context

- California only, like the catalog.
- civicAPI (the existing results source) has been down since at least
  6:31 PM PST (02:31Z): every `/api/v2/*` URL answers Cloudflare 502, both direct
  from this machine and through our relay. Their static site still answers 200.
  So their API origin is down for everyone, not blocking us. Our relay already
  edge-caches civicAPI (30 s race detail, 15 min the rest, per data center).
- **The California Secretary of State results API works**: `https://api.sos.ca.gov/returns/<contest>`,
  `Access-Control-Allow-Origin: *`, no key, no Cache-Control header. 2026
  candidates are already loaded (0 votes before polls close at 8 PM).

## SOS API surface (checked live 6:40 PM PST, 2026-11-03)

- Statewide offices: `governor`, `lieutenant-governor`, `secretary-of-state`,
  `controller`, `treasurer`, `attorney-general`, `insurance-commissioner`,
  `superintendent-of-public-instruction`.
- Districts: `us-rep/district/N`, `state-senate/district/N`,
  `state-assembly/district/N`, `board-of-equalization/district/N`.
- `ballot-measures` (all statewide props, with `Number`, `yesVotes`, …).
- `<contest>/county/<county-slug>`, e.g. `governor/county/santa-clara` (an array).
- `status`: per-county reporting.
- A contest not on this ballot (`us-senate`, `state-senate/district/13`) answers 500 with an empty body.
- Votes and percents are strings; `Reporting` is prose ("0% (0 of 23,860) precincts reporting").

## Decisions

- (User, 7:00 PM PST) Results go through our relay by default; users may pick
  their own connection in Settings; **never** fall back to direct
  automatically (no thundering herd on the state or civicAPI).
- (User) The Secretary of State is primary; civicAPI is backup only. We only
  have California so far.

- New page `/live` ("Live results"), source CA SOS. Browser fetches through the
  worker (`/api/sos-ca/returns/*`, 60 s edge cache, path allowlist) so a crowd
  of browsers costs SOS one request per data center per minute. The browser
  falls back to calling SOS directly when the relay fails.
- Watch list in localStorage: groups (a place, or "Races I added"), each a list
  of contest ids. "Add a place" from where-you-vote, an address lookup, or
  district numbers; "Add a race" from a list of every contest.
- Checks every 60 s while the tab is visible, with a "Check now" button.
- civicAPI follows stay on All races → Following (linked from /live); /live shows a banner when civicAPI is down.

## Findings / gotchas

- The hosted app reaches civicAPI **directly** by default (`routing.ts`
  `defaultMode: "direct"`), so the worker's civicAPI cache only covers people who
  switched to the proxy in Settings. Not changed tonight; the SOS provider
  defaults to the proxy instead.
- Every proposition is one SOS document (`ballot-measures`): `fetchContest`
  shares requests for 10 s, otherwise 14 cards made 14+ identical requests.
- In `vite` dev there's no `/api/sos-ca` (404), so the client falls back to SOS
  directly. Expected.
- Another session amended my commit with its staged `styles.css` lines. Pushed
  history has `9e08466` (mine) between its `f16f18d` and `6b6188c`.

## Progress log

- [x] lib/sosCa.ts (contests, fetch, normalize) + tests
- [x] lib/watch.ts store + area to contests + tests
- [x] LivePanel page (`/live`, nav "Live"), route, nav
- [x] worker route `/api/sos-ca/returns/*` + test
- [x] checks (1009 tests, typecheck), headless browser check, commit `9e08466`, pushed 6:45 PM PST (02:45Z)
- [x] live check 6:55 PM PST (02:55Z): openslate.us/#/live loads every contest through api.openslate.us/api/sos-ca (`Cache-Control: public, max-age=60`)
- [x] `c88792f`: a race shared by places shows once (section named for all of them); seats not up (empty 500) leave the list and the place notes them
- [x] `ba0eb2f`: civicAPI through the relay by default (when the build has one); no auto-fallback to direct for the state; county list through the relay; relay moved to `apps/poll-cache/src/sosCa.ts`, shared with apps/server, coalesces concurrent requests; civicAPI errors kept 15 s
- [x] Results/race pages/followed races/outcome chips: the state's count for every race it covers this election (`sos:` race ids, `lib/sosResults.ts`); civicAPI only for the rest (backup)
- [x] County results (local races) handed to its own thread: "County election-night results (local races) for Live"
- [x] Live and Results combined (user, 2026-11-03 evening): one Results tab, live count on top, slate scorecards below; `/live` redirects to `/results`
- [x] `7ffa05e`: Sort picker (ballot, your order with arrows, closest, clearest lead, most counted, newest, A–Z) and a Group by place switch, both kept in this browser
- [x] `b473b10`: "Add one race" finds a race by a candidate's name (catalog's Secretary of State certified list, one slate; county races from their own count)
- [x] `0527070`: "Add one race" keeps typed text when the county changes; with no county picked, typing searches every county's own races and measures (fetched once, no polling)
- [x] Real counts flow: 2026-11-04, `api.openslate.us/api/sos-ca/returns/governor` shows 100% of precincts, updated 8:08 a.m. PST (16:08Z), Becerra 4,992,161 (63.9%), Hilton 2,815,459 (36.1%)

## Follow-ups (not tonight)


- `apps/server` has no `/api/sos-ca` route (self-hosters fall back to direct).
- Consider defaulting civicAPI to the proxy so the edge cache protects it.
