# Issues

## Setup lists a region's own outlets as "based elsewhere"

Seen 2026-10-26 7:58 PM PDT (02:58Z), in setup with the area set to San
Francisco: Bay Area News Group (the Mercury News and East Bay Times) is
under "▸ 162 more based elsewhere", though it weighs in on races on an SF
ballot. Its slate's `context.jurisdiction` is `us/ca/bay-area`, and
`GetStarted.tsx`'s `elsewhere` test calls any local scope that isn't one of
the area's localities "elsewhere". A region has no `voted_in` to say which
places it covers (that's per contest, SPEC §3.3), so the fix needs a call on
what "your area's" means for a regional outlet (e.g. by where its races are
rather than its scope). Matters because a voter's own regional paper is
tucked away with out-of-area ones.

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
