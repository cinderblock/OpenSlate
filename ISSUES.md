# Issues

## Hosted app shows raw HTTP 404 errors for elections and ballot lookup

On https://openslate.us there is no `apps/server`, so `/api/elections` and
`/api/ballot` (`apps/web/src/lib/query.ts`, `electionsQueryOptions` and
`ballotQueryOptions`) get a plain 404 from the static-assets worker. The
queries surface that as "Elections lookup failed: HTTP 404" / "Ballot lookup
failed: HTTP 404" in Compose. Only a 501 gets the friendly "isn't configured"
message, and that message talks about `.env`, which means nothing to a visitor.
The README says the hosted mode is manual entry, so the UI should say that
instead of showing an error (or not call the endpoints when no server is
configured).

**Update (branch `ui/two-modes`, 2026-10-20):** Compose no longer calls either
endpoint (it signs My-ballot picks), and the Google address lookup (*Your
server* under Find your districts, since `feat/find-my-districts`) only
appears when `/api/health` reports `ballotLookup: true`, so the ballot half is
moot. The Elections page (`ElectionsPanel.tsx`) still calls `/api/elections`
and shows "Google elections list unavailable — HTTP 404" on the hosted app.

## `bun run lint` fails on every file in a Windows checkout

With `core.autocrlf=true` the working tree is CRLF, but `biome.json` leaves
`formatter.lineEnding` at its default (`lf`), so `bun run lint` reports ~104
format errors (`Found 104 errors.`) on untouched files, e.g. `apps/web/src/App.tsx`
and `biome.json` itself. With `"lineEnding": "crlf"` in a copy of the config
(`biome check --config-path=<dir>`), `apps/web/src` checks clean. Matters
because lint can't be used as a gate on Windows, where the user works. Fix
needs a choice that works on both OSes (e.g. a `.gitattributes` policy, or
Biome 2's `lineEnding: "auto"`).

## Setup wizard hangs on "Where do you vote?" while loading endorsements

Seen 2026-10-21 in a fresh browser profile (T3 preview, local dev server):
Get started → Plan my vote → Nov 3, 2026 → Next. The "Where do you vote?" step
showed "Loading endorsements… 173 of 197" and never finished. The console
warned "Cannot update a component while rendering a different component" from
`ElectionSlates` (`apps/web/src/components/Wizard.tsx`). Clicking "Skip, show
everything →" didn't advance either, and hash navigation stopped re-rendering
the page until a reload. The preview tab wasn't visible at the time, which may
be a factor. Matters because this is the first thing a new visitor does.

Seen again 2026-10-22 1:15 AM PDT (08:15Z), fresh incognito T3 preview (hidden
tab): right after "Plan my vote" the page stopped answering automation
entirely (snapshot and evaluate timed out for over a minute). Since `bce1106`
the area step has no forward button while loading (Next waits for the
picker), so a stuck load now leaves only Back and "Skip setup".

## Dark theme: some text and white-on-colour fills fall below 4.5:1

Dark `--bad` (`#e74c3c`) as text measures 4.41:1 on `--surface` and 4.02:1 on
`--surface-2` (error text, Oppose stance, `button.danger`). White text on dark
`--ok` (`#2ecc71`) is 2.10:1 (`.filter-chip.active.ok`) and on dark `--accent`
3.22:1 (primary buttons, selected segments and tags). The light theme clears
4.5:1 for all of these. Lightening `--bad` to fix the text makes the
white-on-red fills worse, so the fix probably wants "on-colour" tokens for text
on filled backgrounds. `apps/web/test/theme.test.ts` lists the `--bad` pairs as
known failures; take them off the list when fixed.

## Same candidate under two spellings: "Donald P. (Don) Wagner" / "Don Wagner"

**Fixed, not yet pushed** (`plans/ballot-choice-validation.md`): in the
endorsements repo, choices are snapped to the ballot spelling and `choice_id`
and CI fails an off-ballot race or choice (`ab65d6b`…`7207c50`, rebased); in
OpenSlate (branch `feat/choice-ids`) the web app also shows any slate's
choices under the ballot's names. Remove this entry once both are pushed and
the publish workflow has run.

Seen 2026-10-22 on My ballot, California Secretary of State race (Nov 3,
2026): the SoS ballot lists "Donald P. (Don) Wagner" and the California
Republican Party's slate says "Don Wagner", so the race shows two rows and
CAGOP's endorsement sits on a name that isn't on the ballot. The fix belongs
in the endorsements repo's `scripts/normalize-choices.ts` (parenthesised
nickname not matched). Matters because party/source quick fill and "your
sources agree" both key on the exact name.

## Endorsements name 21 LA and Orange County seats and measures the county ballot sources don't list

Blocks pushing the endorsements repo's ballot gate (`7207c50` and before):
with it, CI fails these, seen 2026-10-23 10:00 AM PDT (17:00Z) with
`bun scripts/verify-positions.ts`. Each is an endorsement for a race in a
jurisdiction `orgs/la-county-registrar/` or `orgs/oc-registrar-of-voters/`
covers, that the listing doesn't name, and no listed race has the candidate:

- Long Beach CCD Board Areas 1 and 3 (CNA, LA Fed; LA lists only Area 5)
- Centinela Valley UHSD Trustee Area 5 (DSA-LA, LA Fed, LA Forward, UNITE HERE 11)
- Pasadena Area CCD Trustee Area 7 (Equality CA, LA Fed, LA Forward; LA lists 1, 3, 5)
- Alhambra USD Seat 4, Bellflower USD Area 1, Newhall SD Area 1, Paramount USD
  Districts 1 and 5 (LA Fed); Garvey SD Area 1 (LA Forward)
- South Gate Measure UUT (LA Fed; LA lists only Measure SG)
- Newport Beach Measures P, Q and R (SCNG; OC lists only Measure H)

Each is either a seat that isn't on this ballot (uncontested seats are filled
without an election) or a contest the county listing missed. Check each
against the county's own list, then drop the position, fix the listing, or
decide on an exception. Also: Lincoln Club's page puts Grace Dañino Hickok in
Newport-Mesa USD Area 2 and Craig Holiday in Area 7; OC's listing (from its
filing log) has them the other way round, and `7207c50` follows the listing.
Worth confirming against ocvote.gov.

## `openslate validate` rejects the positions.json the scraper skill tells you to validate

`.claude/skills/endorsement-scraper/SKILL.md` step 4 says to run
`bun run packages/cli/src/index.ts validate research-bot/orgs/<slug>/<election>/positions.json`,
but `validate` checks a full `SlatePayload`, so a sign-input bundle fails with
`v: Invalid literal value, expected 1`, `issuer: Required`, `issued_at:
Required` (seen 2026-10-23 on `orgs/ca-republican-party/2026-11-03/positions.json`).
`sign` accepts the same file. Either `validate` should accept sign input, or the
skill should validate another way (the endorsements repo's
`verify-positions.ts` already does the schema check).

## Cloudflare's analytics beacon is injected and then blocked by our CSP

Every page on https://openslate.us logs a console error (seen 2026-10-23,
3:32 AM PDT (10:32Z), in a fresh incognito tab):

> Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/…'
> violates the following Content Security Policy directive: "script-src 'self'".

Cloudflare injects its Web Analytics beacon into the HTML, and
`apps/web/public/_headers` deliberately allows only our own scripts. So the
beacon never runs (no analytics are collected that way) and every visitor's
console shows an error. Either turn off the automatic beacon injection for
the zone (a Cloudflare setting: needs the owner's authorization, through the
ops repo), or decide to allow it in the CSP (which the `_headers` comment rules
out on purpose).

## Race pages for local offices show the Governor's polls

On https://openslate.us, the race page for a local office (e.g.
`#/race/t%3ALos%20Angeles%20Community%20College%20District%20Board%2C%20Seat%204|j%3Aus%2Fca%2Flos-angeles|e%3A2026-11-03`,
seen 2026-10-23, 4:32 AM PDT (11:32Z)) lists "Recent polls" that are all
Xavier Becerra vs Steve Hilton, the Governor's race. The panel's lookup tries
`2026 California`, then `California`, then the race's own slug, and the
statewide rollup matches first. A poll shown on a race it isn't about reads as
data about that race. The statewide rollup should only be used for statewide
races (or the panel should say what the polls are about).

