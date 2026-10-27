# Issues

## Quoted statements show doubled quote marks

Seen 2026-10-26: scraped bundles in openslate-public-endorsements write each
statement as one or more quoted excerpts (`"\"We recommend …\"; \"…\""`, in
over a hundred bundles), and the web app wraps `statement` in curly quotes too
(`ChoiceRow.tsx` popover, `RacePanel.tsx` position list), so voters see
`“"We recommend voting for Shirley Weber."”`. Either the app shouldn't add
quotes to a statement that's already quoted, or the bundles should drop
theirs. Affects every scraped source's statements.

## No lookup places a voter in a city council district

Seen 2026-10-26 (a Sunnyvale voter's report): the Santa Clara listing files
Sunnyvale's council races with `district: us/ca/sunnyvale/council-{1,3,5}`,
but no lookup layer (`LOOKUP_LAYERS` in `apps/web/src/lib/geo.ts`: school,
BOE, college, supervisorial) has council districts, so every district race in
the voter's city lands in *Might be on your ballot*, their own included. The
voter can now answer *On my ballot* per race (`plans/ballot-feedback-sunnyvale.md`),
but an address lookup should place them. Wants city council boundaries per
city (no statewide source like TIGER), at least for the cities whose listings
carry `council-N` districts.

## Local measures outside the covered counties have no official text

Seen 2026-10-26: My ballot links a measure's official text only when a voter
guide in `guides.json` lists it (state, SF, LA, OC, Alameda, San Diego, Santa
Clara, San Mateo). A local measure in any other county gets only Ballotpedia,
CalMatters and news searches, which often have nothing on small city
measures. Matters because a voter asked for "a link to the measure text for
all the measures, especially the local ones".

## Dark theme: some text and white-on-colour fills fall below 4.5:1

Dark `--bad` (`#e74c3c`) as text measures 4.41:1 on `--surface` and 4.02:1 on
`--surface-2` (error text, Oppose stance, `button.danger`). White text on dark
`--ok` (`#2ecc71`) is 2.10:1 (`.filter-chip.active.ok`) and on dark `--accent`
3.22:1 (primary buttons, selected segments and tags). The light theme clears
4.5:1 for all of these. Lightening `--bad` to fix the text makes the
white-on-red fills worse, so the fix probably wants "on-colour" tokens for text
on filled backgrounds. `apps/web/test/theme.test.ts` lists the `--bad` pairs as
known failures; take them off the list when fixed.

## The endorsements CI gate never schema-checks a bundle's `adopts` or `labels`

Seen 2026-10-26: `scripts/verify-positions.ts` in `openslate-public-endorsements`
copies `positions`, `endorsed_by`, `attribution`, `context` and `articles` out
of each positions.json into a placeholder payload and drops everything else,
so the 10 bundles with `adopts` pass the gate without their adoptions being
checked, a `labels` list would be dropped too (and its positions' labels then
fail as undefined), and a misspelt top-level key passes silently. OpenSlate
core now exports `signInputSchema` (what `openslate sign` and `validate`
check); the gate should use it, after bumping `.openslate-version` past the
commit that added it.

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
