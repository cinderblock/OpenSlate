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

- New page `/live` ("Live results"), source CA SOS. Browser fetches through the
  worker (`/api/sos-ca/returns/*`, 60 s edge cache, path allowlist) so a crowd
  of browsers costs SOS one request per data center per minute. The browser
  falls back to calling SOS directly when the relay fails.
- Watch list in localStorage: groups (a place, or "Races I added"), each a list
  of contest ids. "Add a place" from where-you-vote, an address lookup, or
  district numbers; "Add a race" from a list of every contest.
- Checks every 60 s while the tab is visible, with a "Check now" button.
- Existing civicAPI follows still show (the Following list), with a banner when civicAPI is down.

## Progress log

- [ ] lib/sosCa.ts (contests, fetch, normalize) + tests
- [ ] lib/watch.ts store + area → contests + tests
- [ ] LivePanel page, route, nav
- [ ] worker route + test
- [ ] checks, commit, push (deploys), live check
