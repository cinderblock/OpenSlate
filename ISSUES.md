# Issues

## My ballot lists every school, water and supervisor race in the county

Seen 2026-10-24 for a Huntington Beach voter who set their area with the map
picker. Reproduced with the app's own `locate` + `areaFromHit` +
`collateRaces` over the catalog's 346 Nov 3 slates, for a point in Huntington Beach
(-117.998, 33.668): the area is CD 42, SD 36, AD 72, CoA 4,
`us/ca/huntington-beach` and `us/ca/orange-county`, and My ballot gets **111
races, 63 of them filed under `us/ca/orange-county`**. Those 63 include every
school board trustee area, every water/sanitary/park district, and
Supervisors districts 4 and 5 in the county (e.g. Anaheim, Capistrano and
Irvine school boards, Irvine Ranch Water). A voter has only a handful of them.
Without them the same area is 48 races.

Cause: county registrar ballot sources and guides file sub-county contests
under the county's path because there is no boundary data for them
(`oc-registrar-of-voters` 164 positions on `us/ca/orange-county`,
`la-county-registrar` 376 on `us/ca/los-angeles-county`, Santa Clara 136,
Alameda 112; the OC guide in `openslate-ballot-ca-2026-11-03/county/oc` 63).
`inArea` treats them as county-wide.

Related, same root:

- **San Diego's city and county share `us/ca/san-diego`** (677 positions
  catalog-wide, none on `san-diego-county`), so `localityCandidates` falls back
  to `us/ca/san-diego` for the county, and anyone in San Diego County gets San
  Diego City Council races (and every county special district).
- **All four Board of Equalization districts** are on every California
  ballot: they're filed under `us/ca`, not a district family.

Why it matters: in the counties we cover, My ballot is about twice as long as
the real ballot, and full of races the voter can't vote in.

## Kalshi answers the forecasts relay 429, and the worker caches it (in progress — fix/kalshi-forecasts-429)

Seen 2026-10-24 12:30 PM PDT (19:30Z): every
`https://api.openslate.us/api/forecasts/v2/events/<ticker>` tried
(`KXSOSCA-26`, `KXGOVCA-26`, `KXAGCA-26`; `polls.openslate.us` the same)
answers `429 {"error":{"code":"too_many_requests",...}}`, Kalshi's body, while
Kalshi answers this machine directly. `apps/poll-cache/src/index.ts`
(`proxyForecasts`) passes the 429 through with `Cache-Control: public,
max-age=30, stale-while-revalidate=300`, and `cf.cacheTtl` caches it at the
edge too (`CF-Cache-Status: HIT`), so one 429 is served to everyone for a
while. Why it matters: the hosted app shows no market forecasts, nine days
before the election.

## `bun run lint` fails on every file in a Windows checkout

With `core.autocrlf=true` the working tree is CRLF, but `biome.json` leaves
`formatter.lineEnding` at its default (`lf`), so `bun run lint` reports ~104
format errors (`Found 104 errors.`) on untouched files, e.g. `apps/web/src/App.tsx`
and `biome.json` itself. With `"lineEnding": "crlf"` in a copy of the config
(`biome check --config-path=<dir>`), `apps/web/src` checks clean. Matters
because lint can't be used as a gate on Windows, where the user works. Fix
needs a choice that works on both OSes (e.g. a `.gitattributes` policy, or
Biome 2's `lineEnding: "auto"`).

## Biome errors on master, beyond the line endings

With line endings set aside (Biome with `"lineEnding": "crlf"`), `bunx biome
check apps packages` still fails on master `612c12a` (2026-10-24):

- `apps/web/src/components/BallotTags.tsx:123`, `lint/a11y/useSemanticElements`
  (from `4eac74d`)
- `apps/web/src/lib/ballotCheck.ts:60` and `:161`, `lint/performance/noDelete`
  (from `e8064d6`)
- `packages/core/test/names.test.ts`, format (from `1b68fd4`)

Why it matters: lint can't gate anything while it's red, and the a11y one may
be a real accessibility problem.

## Setup wizard hangs on "Where do you vote?" while loading endorsements (in progress — master, plans/wizard-catalog-summaries.md)

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

Not reproduced 2026-10-23 3:42 PM PDT (22:42Z) on https://openslate.us in a
fresh incognito T3 preview (hidden tab): the area step loaded and the wizard
went through to the sources step. One snapshot timed out (15 s) while the
endorsements were loading, so the main thread is busy for that long; it may
only hang on the dev server, or on a slower machine.

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
