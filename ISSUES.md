# Issues

## No lookup places a voter in a city council district

**In progress — master (ISSUES.md burn-down).**

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
