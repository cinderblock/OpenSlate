# ISSUES.md burn-down (2026-10-26)

`plans/issues-burndown.md`

## Goal

Work through `ISSUES.md` one issue at a time until it's empty or everything
left needs the user. Each issue: claim (own commit), fix properly, gates
(`bun run lint`, `bun run typecheck`, `bun test`), remove the entry in the fix
commit, push master.

## Environment / context

- Main checkout `C:\Users\camer\git\Personal Projects\OpenSlate`, branch
  `master`, shared with other threads: stage only my own changes, commit with
  explicit paths, list `origin/master..HEAD` before each push.
- Lint is Biome 2.6.3 (`biome.jsonc`, `lineEnding: "auto"`, Markdown excluded),
  closed by `e4b4d77`.

## Decisions already made (don't re-ask)

- Regional outlets "based elsewhere": pick the *best* rule, even if more work.
  Candidate: local when any of its positions is on a race in the voter's area.
- `openslate validate` vs sign input: user leans to `validate` accepting sign
  input; weigh it and report the choice and why.
- Cloudflare beacon: infrastructure. Stage the exact change in the ops repo,
  show it, wait for an explicit yes. Do it last.
- Setup "Follow 1 and see my ballot": reproduce by hand in a browser first,
  waiting for the "still filling in" banner to clear. If it doesn't reproduce,
  record what was tried in the entry instead of guessing at a fix.

## Order (by value)

1. Setup's "Follow 1 and see my ballot" (first-run path for every voter).
2. Regional outlets listed as "based elsewhere".
3. `openslate validate` rejects sign input.
4. Dark theme contrast.
5. City council districts in lookup.
6. Local measures outside covered counties: official text.
7. Cloudflare beacon (needs the user's yes; last).

## Progress log

- [x] 1. Setup follow: interrupted setup downloads now resume (`pendingSetup.ts`)
- [x] 2. Regional outlets: catalog `regions` (core `regionsOf`, `sign --batch`), setup's `basedInArea` (`plans/regional-outlets-setup.md`). Live: endorsements `b3ba2e9` re-signed the catalog, checked on openslate.us
- [x] 3. validate: accepts sign input; core `signInputSchema` (closed) shared by `validate`, `sign`, `sign --batch` and `adopt --into`
- [x] 3b. Doubled quote marks on statements: the app no longer adds quotes; a statement is a ruled block (`.statement`) shown as written
- [x] 4. Dark theme contrast: `--on-accent/ok/bad/warn` tokens for text on fills (dark text on dark theme's bright fills), dark `--bad` lightened to `#f26b5f`, lean fills as tokens; `theme.test.ts` checks each fill/text pair and that every filled rule uses its partner
- [x] 4b. Endorsements CI gate: `verify-positions.ts` parses with `signInputSchema`; endorsements `1def270` (pin `5300971`), README `0beb2a3`
- [x] 5. Council districts: `council` lookup layer (`<City>|<n>`, filed as `us/ca/<city>/council`), 433 districts in 84 cities from registrars' (OC, Alameda, LA), SANDAG's and cities' GIS (`plans/council-districts-lookup.md`). Follow-ups in ISSUES.md: citywide seats tagged as districts (Newport Beach; HP and San Leandro left out until checked), cities with no usable map
- [x] 5b. Citywide council seats tagged as districts: only Newport Beach is (endorsements `795617d`, `CITYWIDE_COUNCILS`); Huntington Park's and San Leandro's District 2 seats are by district (LA's sample ballot data; San Leandro's City Clerk), so both cities joined the council lookup (444 districts)
- [ ] 6. Local measure text
- [ ] 7. Cloudflare beacon

## Findings / gotchas

- Setup follow (2026-10-26, ~11 PM PDT): on the dev server with a fast
  network the follow and import land within ~1 s; no bug. With slate fetches
  slowed (a fetch wrapper in the page: ballot lists 1.8 s, the rest 20 s),
  the ballot shows "0 of 0 sources followed" and `openslate.follows.v2` stays
  unwritten until the picked slate arrives: the report's symptom, an interim
  state. The real bug: closing/reloading mid-download lost the rest and the
  follow for good, and setup never came back once the ballot lists were in.
  The "Leave site?" guard (ImportBanner) didn't help CDP reloads or mobile tab
  discards. Fixed by `lib/pendingSetup.ts` + `startSetupImport` /
  `resumeSetupImport` (catalogImport.ts), resumed by CatalogUpdater; the
  guard is gone.
- News-coverage (articles-only) slates count in "N of M sources followed"
  (12 of 12 with one pick). Separate simple fix.
- Port 5291 is another worktree's dev server (`feat-ballot-print`); use 5377.
- Claude-in-Chrome tab groups vanished mid-session; T3's preview browser
  (`preview_open`/`preview_evaluate`) worked instead.

- Regional outlets (2026-10-26): "local when any of its positions is on a
  race in your area" can't work alone. BANG's only SF contest is RTM, the same
  as the Alameda County Democratic Party's, so by races they're identical for
  an SF voter; only the scope tells them apart. Chosen: a region scope is
  yours when a contest filed under it is voted in your area (`voted_in`), via
  a new per-entry catalog field `regions`.

- validate vs sign input (2026-10-26): chose to make `validate` accept sign
  input (the user's lean), not to point the skill elsewhere. `validate` is the
  check that ships with the tool that signs, so it should answer "will this
  sign?"; `verify-positions.ts` lives in the endorsements repo and adds
  ballot-name checks a scraper bundle in `research-bot/` can't run yet. The
  shape is detected: any of `v`/`issuer`/`issued_at` means a SlatePayload,
  else sign input (output says which). `sign` used to drop unknown top-level
  keys silently; it now rejects them like `validate`. All 387 published
  bundles pass. Found: `verify-positions.ts` drops `adopts`/`labels` before
  its check (new ISSUES.md entry, endorsements repo).

- Doubled quote marks (2026-10-26): fixed in the app, not the bundles.
  SPEC §3.4 makes `statement` free text, not a quotation: Courage
  California's statements are unquoted summaries ("Tax billionaires and
  backfill…"), so the app's curly quotes were wrong there too, and scraped
  bundles' own quote marks separate several excerpts (`"a"; "b"`), which
  stripping would lose and re-signing 100+ bundles would cost. Both render
  sites (`ChoiceRow` popover, `RacePanel` position list) now use
  `<blockquote className="statement">`, a left rule with no glyphs. Labels
  (`“{label}”`) keep their quotes: they are the source's own term.

- Endorsements CI gate (2026-10-26, ~11:55 PM PDT): `verify-positions.ts`
  now parses each positions.json with core's `signInputSchema` (no
  placeholder payload). All 387 bundles pass; a broken `adopts` entry and a
  misspelt top-level key now fail it. A throwaway-key `sign --batch` with the
  new pin signed all 387. In the endorsements repo on Windows, `bun run lint`
  fails on every file (Biome 1.9 wants LF; logged in its ISSUES.md) and
  `tsc` fails on old scripts (already logged there): neither is run by its CI.

- Dark theme contrast (2026-10-27, ~12:10 AM PDT): on-colour tokens, not
  darker dark fills: darkening dark `--accent`/`--ok` for white text would
  break them as text colours on the dark surfaces. Dark fills now carry
  `#0f1115` text (accent 5.87, ok 8.99, bad 6.34, warn 11.38); dark `--bad`
  `#e74c3c` → `#f26b5f` (5.15 on `--surface-2`). The lean stance fills
  (`#4d8a63`/`#a76b4d`, white text 4.09/4.33 in both themes) also failed:
  now `--fill-lean-for` `#467f5a` / `--fill-lean-against` `#9e6447`. The
  switch thumb and checkbox tick use the on-colours too. A new test fails
  any rule with a solid `--accent/--ok/--bad/--warn/--fill-lean-*`
  background that doesn't set its partner text colour (textless fills are
  listed). Checked in the preview browser, dark scheme.
- One full `bun test` run reported `1 fail, 1 error` right after
  `bun run format`; four reruns all passed. Unidentified flake, not
  reproduced.

- Council districts (2026-10-27, ~1 AM PDT): no statewide source; registrars
  publish county-wide layers (OC `OCROV_WEBADMIN`, Alameda, LA RR/CC's Aug
  2023 one), SANDAG covers San Diego County, San Mateo and Santa Clara
  cities each publish their own. Some adopted maps exist only inside the
  demographer's (NDC's) web map beside dozens of drafts: `build-geo.ts`
  reads those by exact layer title. A wrong line hides a race, so anything
  uncertain was left out (its races stay maybes). Registrars title
  citywide-voted residency seats "District N" too (Newport Beach), so a
  listing's `council-N` tag isn't proof a seat is by district.
- `bun run format` reflowed the long source lists in `build-geo.ts`; the
  boundary build (`bun run --filter '@openslate/web' geo`) takes ~2 min warm
  and its cache is now keyed by source, not index.

- Citywide council seats (2026-10-27, ~1 AM PDT): of the 89 cities with
  `council-N` tags, only Newport Beach elects district members citywide
  (its council page). Huntington Park's ordinance phases districts 1-3 in
  for 2028, yet its 2026 District 2 special is by district: LA's interactive
  sample ballot data (`isb.lavote.gov/parsed/4348/…`, static JSON, curl-able)
  gives each block one council race. That data can verify any LA County
  contest's electorate. Newport Beach stays out of the council lookup (no
  district-tagged races to place).

## Open questions for the user

(none yet)
