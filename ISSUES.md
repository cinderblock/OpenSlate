# Issues

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

## `openslate validate` rejects the positions.json the scraper skill tells you to validate

**In progress — master (ISSUES.md burn-down).**

`.claude/skills/endorsement-scraper/SKILL.md` step 4 says to run
`bun run packages/cli/src/index.ts validate research-bot/orgs/<slug>/<election>/positions.json`,
but `validate` checks a full `SlatePayload`, so a sign-input bundle fails with
`v: Invalid literal value, expected 1`, `issuer: Required`, `issued_at:
Required` (seen 2026-10-23 on `orgs/ca-republican-party/2026-11-03/positions.json`).
`sign` accepts the same file. Either `validate` should accept sign input, or the
skill should validate another way (the endorsements repo's
`verify-positions.ts` already does the schema check).

Leaning (user, 2026-10-26): `validate` accepts sign input, but the user wasn't sure; weigh it and say which you chose and why.

## Cloudflare's analytics beacon is injected and then blocked by our CSP

Every page on https://openslate.us logs a console error (seen 2026-10-23,
3:32 AM PDT (10:32Z), in a fresh incognito tab):

> Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/â€¦'
> violates the following Content Security Policy directive: "script-src 'self'".

Cloudflare injects its Web Analytics beacon into the HTML, and
`apps/web/public/_headers` deliberately allows only our own scripts. So the
beacon never runs (no analytics are collected that way) and every visitor's
console shows an error. Either turn off the automatic beacon injection for
the zone (a Cloudflare setting: needs the owner's authorization, through the
ops repo), or decide to allow it in the CSP (which the `_headers` comment rules
out on purpose).
