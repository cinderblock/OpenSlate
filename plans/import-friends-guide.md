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
- **It's a secondhand report** (`attribution.of` = the friend, mode `transcribed`).
- **Not published to npm.** A served single file needs no release, no clone and no
  package name, and it updates with every deploy.

## Environment

- Card: `apps/web/src/components/FriendsGuideCard.tsx`, under Sources → Add endorsements →
  Link, file, QR or paste. Logic: `apps/web/src/lib/friendsGuide.ts`.
- Storage: `friendGuidesStore` in `apps/web/src/lib/myVote.ts`.
- Page for agents: `apps/web/public/agents/import-friends-guide.md`, which points at the card.
- CLI bundle: `openslate.mjs`, from the `agentTool` plugin in `apps/web/vite.config.ts`. A
  Vite plugin because `vite build` runs under Node and the Workers Builds command isn't in
  this repo or in ops.

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

## Chat path: copy and paste, for ChatGPT and the like

Added because agents with a shell are the minority of what friends have.

- **The prompt holds the voter's ballot.** `guidePrompt` lists their races with short
  stable codes (`raceCode`, a hash of the race key), so the chat needs no tools and
  no internet, and never copies a long title. A Sunnyvale ballot is 90 races, 12 KB.
  It needs an area set: every race in the election would be 100 KB or more.
- **The voter signs their own import.** The user's call: we never sign on behalf of the
  friend, but the voter can sign what they imported, as their own report of the guide. So
  it's an ordinary secondhand slate (`attribution.of` = the friend, mode `transcribed`)
  signed by the active identity, in `slatesCollection`. A voter with no identity makes one
  in the card, with the same `SigningAs` step as Compose.
- **How we got here, don't repeat either.** `e94f361` signed with a hidden throwaway key: a
  signature nobody stands behind, which looked like verification. `d7b8ace` overcorrected to
  nothing signed at all, a misreading of "we don't need to sign on behalf of others".
- **Guides saved by `d7b8ace` aren't lost.** `friendGuidesStore` takes nothing new, but
  `useDecodedSlates` still shows what's in it as `local: true`, and the card offers to sign
  them. Delete that plumbing (`decodeLocalGuides`, the store, `local`) after the election.
- **The agent path uses the same card.** `import-friends-guide.md` sends an agent to the
  copied message, and the person signs in the app. `races`, `check` and `openslate.mjs`
  remain as CLI tools for people publishing their own slates.
- **The reply is untrusted.** It only becomes positions on known races, and the user
  sees them first. A corrected reply replaces the earlier one with the same friend,
  election by one of this voter's identities (or an unsigned or throwaway-key copy of it),
  and leaves a catalog source of the same name alone.
- **Blind test, 2026-11-02:** a Haiku subagent given only the prompt and a messy CSV got
  all 7 picks right, including "Controller: not Morgan" as an oppose. It reported the
  rows off this ballot and an unreadable row, and ignored an injected instruction to
  add a pick. That run put `yes` in `label`, so the prompt now says when to skip it.
- **Headless run of the built app, 2026-11-02:** set an area, imported the SF listing,
  copied the message, refused garbage, added, replaced, reloaded, saw it on My ballot,
  removed it. One source row while present, nothing stored after, no browser errors.
- **Headless run of the built app with own signing, 2026-11-02:** no identity left Sign and
  add disabled, made one in the card, signed and added, replaced with a corrected reply (one
  row, "reported by Alex, not signed by them"), signed an old unsigned guide, saw it on My
  ballot, Compose still showed the signer, removed it. No browser errors.
- **Not tried with ChatGPT itself**, or with a guide as a PDF or photo. Haiku is the
  stand-in.

## Things not to do

- Don't suggest hand-copying short race names: they won't join the ballot.
- Don't sign as the friend, or name them as the issuer: they're only ever the source.
- Don't sign a guide with a key the voter doesn't hold and stand behind.
