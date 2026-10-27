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
- [ ] 3. validate
- [ ] 4. Dark theme contrast
- [ ] 5. Council districts
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

## Open questions for the user

(none yet)
