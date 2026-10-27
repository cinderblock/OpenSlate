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

- [ ] 1. Setup follow — **current**
- [ ] 2. Regional outlets
- [ ] 3. validate
- [ ] 4. Dark theme contrast
- [ ] 5. Council districts
- [ ] 6. Local measure text
- [ ] 7. Cloudflare beacon

## Findings / gotchas

(none yet)

## Open questions for the user

(none yet)
