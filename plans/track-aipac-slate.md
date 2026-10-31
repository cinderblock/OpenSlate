# Track AIPAC slate

## Goal

Turn https://www.trackaipac.com/ (endorsements and ratings) into a secondhand-report slate for the
November 3, 2026 California ballot, alongside the existing `aipac-pac` bundle.

## Environment

- Bundle: `openslate-public-endorsements/orgs/track-aipac/` (`meta.yaml`, `logo.png`,
  `2026-11-03/positions.json`, `2026-11-03/evidence/`).
- Pushing that repo signs with the project key and publishes.
- Pages fetched 2026-10-30 8:05 PM PDT (2026-10-31T03:05:49Z).

## Decisions

- **California only**, matching `aipac-pac`. The evidence keeps the full national list.
- **Endorsements are `endorse`, label "Endorsed"** (8).
- **Red scorecards are `lean_against`, label "Pro-Israel"** (45). The site rates, and never says to
  vote against anyone, so `oppose` would overstate it.
- **Green scorecards are left out.** The methodology says they "on their own are not endorsements".
- **`mode: transcribed`**, because sitting members' ratings come from graphics.

## Findings

- Bundle findings and review flags are in
  `openslate-public-endorsements/orgs/track-aipac/2026-11-03/evidence/NOTES.md`.
- `curl` fails here with "(43) A libcurl function was given a bad argument"; `Invoke-WebRequest`
  works.
- Colour alone misreads plain portraits (Aisha Wahab's came out red). A rating needs a red graphic
  on `/congress` and `/states/california`, and no note in the text.
- `/congress` lists held seats. Four members run elsewhere after Prop 50, so match to the ballot by
  name, never by district number.

## Progress

- [x] Fetch pages, read the methodology
- [x] Build positions from the SOS listing
- [x] `validate`, `normalize-choices` (dry run), `verify-positions`: 404 OK, 0 failed
- [x] User published the bundle as built, all 53 positions (2026-10-30)
- [x] Pushed as `0a5a554` in `openslate-public-endorsements`; the `publish` run passed

Nothing is left to do by hand: `pin-capture.yml` sets `attribution.capture` after the next scheduled
capture.

## Things not to do

- Don't turn the ratings into `oppose`, or treat the dollar totals as the rating.
