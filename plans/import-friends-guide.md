# Import a friend's voter guide

`plans/import-friends-guide.md`

## Goal

Friends have voter guides from other friends, as spreadsheets and the like, and
want them in OpenSlate as a slate in their browser. Support any format.

## Decisions already made (don't re-ask)

- **Agents do the conversion, not the app.** The user's call: people have agents,
  so publish clear instructions instead of building a parser. An agent reads any
  format; the app would only ever read a few.
- **Instructions and tool are static files on openslate.us** (`/agents/`). No
  server, which keeps the no-central-server rule.
- **The slate is a secondhand report** (`attribution.of` = the friend, mode
  `transcribed`): the friend didn't sign it.
- **Not published to npm.** A served single file needs no release, no clone and no
  package name, and it updates with every deploy.

## Environment

- Instructions: `apps/web/public/agents/import-friends-guide.md`.
- Tool: `openslate.mjs`, the CLI bundled by the `agentTool` plugin in
  `apps/web/vite.config.ts`. A Vite plugin because `vite build` runs under Node
  and the Workers Builds command isn't in this repo or in ops, so a package script
  couldn't be relied on.
- Prompt: `FriendsGuideCard` in `apps/web/src/components/ImportVerifyPanel.tsx`,
  under Sources → Add endorsements → Link, file, QR or paste.

## Findings / gotchas

- A position joins a ballot race only on an exact `(title, jurisdiction, election)`
  match, and the titles are long (`California — Proposition 1 (Authorizes Bonds for
  Housing Affordability Programs)`). Instructions alone would leave races stranded
  with no error, hence `races` and `check`. Names are more forgiving: the app
  resolves nicknames and middle initials.
- Ballot listings cover California only: the Secretary of State and eight counties
  (Alameda, LA, Newport Beach, Orange, San Mateo, Santa Clara, San Diego, SF).
  Elsewhere `check` can't check, and says how many positions that hit.
- The service worker's navigation fallback would answer `/agents/*` with the SPA,
  so that path is on its denylist. `.md` and `.mjs` aren't precached.
- The CLI used `Bun.*` throughout; it now uses `node:fs` so the bundle runs on Node.
  `Bun.write` made parent directories, so `writeText` does too.
- Agents with no shell (a plain chat window) can't use this: the page tells them to
  stop rather than fake a signature.

## Progress log

- [x] CLI runs on Node; `races` and `check`, with tests.
- [x] Dry run on plain Node against the live catalog: `check` caught a bad title
  and a misspelt name, and the signed file verified as a secondhand report.
- [x] Instructions, prompt in the app, README.
- [x] Deployed `95d57e3`, 2026-11-02. Downloaded the tool from openslate.us and ran
  `races` with it (1,187 races for 2026-11-03).
- [ ] Not tried by a real agent on a real guide yet: the dry run was a scripted
  stand-in for the agent's reading of the guide.

## Things not to do

- Don't suggest hand-copying short race names: they won't join the ballot.
- Don't let the slate be signed as if the friend wrote it.
