# WebMCP: let the user's own browser agent read and mark My ballot

## Goal

Expose the user's ballot selections to AI agents running in their own browser
through WebMCP, so an agent can read the ballot (races, choices, how the
user's sources lean, what the user has marked) and mark choices for them. It
stays fully client-side: no server is involved (see the no-central-server
constraint). The tools run inside the page, read the same stores as the UI,
and write through the same code paths, so the open My ballot page updates
live.

## Environment / context

- Spec: WebMCP, W3C Web Machine Learning CG, Draft CG Report dated
  2026-10-20, https://webmachinelearning.github.io/webmcp/
  - The API is on `document.modelContext`. Earlier drafts and Chrome's first
    builds (Chrome 146, behind a flag) put it on `navigator.modelContext`, so
    the code detects both.
  - `registerTool({ name, title?, description, inputSchema?, execute, annotations? }, { signal? })`
    returns a `Promise<undefined>`. To unregister, abort the `signal`. There is
    no `unregisterTool` in the current draft. A duplicate name rejects with
    `InvalidStateError`.
  - `execute(input, { signal })` returns a `Promise<any>`. `executeTool`
    resolves to a DOMString.
  - Annotations: `readOnlyHint`, `untrustedContentHint` (the payload needs
    heightened handling, e.g. third-party text), `consequentialHint`,
    `debugging`.
  - Permissions-Policy feature `tools`. `public/_headers` sets a CSP but no
    Permissions-Policy, so nothing blocks it.
- Code (all paths under `apps/web/src`):
  - Selections: `lib/ballotDraft.ts` (`DraftRow`, localStorage
    `openslate.ballotDraft.v1`).
  - Race list: `collateRaces` in `lib/collate.ts`, as `MyBallotPanel.tsx`
    calls it.
  - Ballot order and vote limits: `ballotChoices`, `voteFor`, `picksIn` and
    `isYesNo` in `lib/ballotView.ts`.
  - Election, area, follows: the `createLocalStore` stores in `lib/myVote.ts`.

## Decisions already made (don't re-ask)

- **Usage stats count tool use** (user, 2026-10-26): only when the user has
  opted in, and only as `agent.tool` with `tool` (one of the five names) and
  `outcome` (`ok` or `refused`). *Never* what was passed or returned. No
  direction either, following `ballot.quick_fill`'s "never which way".

- **Prerequisite: one shared ballot store.** `useBallotDraft` was a per-hook
  `useState`, so each panel held its own copy. A write from outside (a tool,
  another panel, another tab) wasn't seen, and the stale copy's next save
  overwrote it. It now uses `createLocalStore`, like the other My vote state.
  This is a separate commit.
- **Registered once at startup** (`main.tsx`), not per route. The tools work
  on whatever page is open, because the ballot is app state rather than page
  state.
- **Tools** (snake_case):
  - `list_elections`
  - `get_ballot`
  - `get_race`
  - `mark_choice`
  - `set_race_note`
- **Marks the agent can set** mirror the UI:
  - `pick` (endorse)
  - `maybe` (lean_for)
  - `against` (oppose; not offered on yes/no questions, same as the UI)
  - `none` (clear)
- **Overvotes are allowed but reported.** The UI allows them and shows a
  warning, so the tool does the same: the result carries a `warning`.
- **Write-ins** follow `WriteInField`. A name that `matchBallotName` is sure
  is a listed candidate picks that candidate instead.
- **Reading tools carry `untrustedContentHint`.** Slates are third-party,
  signed by anyone, and their statements and names reach the model. Write
  tools are not `consequentialHint`: they change only local, reversible
  state.
- **Errors come back as `{ "error": ... }` JSON, not thrown.** The agent can
  read the message and correct itself. A rejected promise may reach it only
  as a bare `OperationError`.
- **Not exposed:**
  - the street address
  - identities and keys
  - publishing or signing
  - rankings (`useBallotRanking` has no UI consumer yet)

## Plan / steps

1. [x] Shared ballot store (`lib/ballotDraft.ts`), with tests.
2. [x] `lib/ballotAgent.ts`: pure functions that describe the ballot and
   resolve a mark. Unit-tested.
3. [x] `lib/webmcp.ts`: feature-detects the API, loads state outside React,
   registers the tools and handles HMR dispose. Called from `main.tsx`.
4. [x] Verify in a browser with a stub `document.modelContext` (the preview
   has no native WebMCP). Calls through the stub's `execute` must update the
   My ballot page live.
5. [x] README note.

## Findings / gotchas

- `useBallotRanking` has no consumers. Ranked-choice races are marked with
  plain picks in the UI today.
- Race keys are `subject.id` or `t:<title>|j:<jurisdiction>|e:<election>`.
  These are long, so `get_race`/`mark_choice` also accept a race's title or
  ballot heading when exactly one race matches.

- **A whole ballot is too big for one call.** With no area set, the dev
  catalog's Nov 3, 2026 ballot has 875 races, and `get_ballot` came to about
  500 KB. It now pages: 40 races by default, and `search` uses the same
  matcher as My ballot's search box. A page is about 16 KB.
- **Pre-existing UI bug, fixed in `fa2d974`.** `picksIn` ignored names the
  user wrote in, so a pick plus a write-in in a "Vote for one" race showed no
  overvote warning. The tools list write-ins as choices (`choicesOn`) so they
  can be seen and cleared.
- The preview browser (and Chrome without the flag) has no `modelContext`.
  To verify, define a stub `document.modelContext` in the page, then
  `(await import("/src/lib/webmcp.ts")).installWebMcp()` through Vite's
  module graph. This is the same module instance the app uses, so the marks
  go through the real store.
- Verified live on 2026-10-26 at about 8:50 PM PDT (03:50Z):
  - all five tools register
  - refusals carry readable messages
  - a batch with one bad entry marks nothing
  - pick, maybe, none, write-in and note all work
  - the overvote warning counts write-ins
  - the open My ballot page updated each time
  
  Not verified live: `get_race` positions with real endorsements. The setup
  import didn't land in the preview profile (ISSUES.md), so that path is
  covered by unit tests only.
- Not yet tried in a real WebMCP browser (Chrome with WebMCP enabled). That
  is open question 1.

## Progress log

- [x] `74f939b`, `eee8948`: shared ballot store
- [x] `fa2d974`: write-ins count toward picks
- [x] the WebMCP tools, README, this plan (the commit after `fa2d974`)
- [x] `agent.tool` usage event: tool and outcome, opt-in only
- [x] origin-trial token in `public/_headers`
- [x] merged master's ranking; `rank_choices`; marks through `lib/ranking.ts`
- [ ] a real-browser check in Chrome with WebMCP

## Open questions for the user

1. **The same for Edge?** Edge runs its own trial with a separate token
   (Microsoft's origin-trials site). Lower priority.
2. **Try it end to end** on openslate.us, in Chrome 149+ with an agent that
   speaks WebMCP. Chrome's post says Gemini in Chrome support is "coming
   soon"; otherwise use an agent extension. Check that
   `document.modelContext` (or `navigator.modelContext`) exists on the live
   site.

## Ranking (merged from master on 2026-10-26)

- Master's ranking work (`457974a` and the commits after it) makes every
  race except a yes/no question a *ranked* race. The bubble toggles a name
  into the saved order (`rankingStore`). The first `marksFor(race)` names
  are `endorse`, and the rest are backups (`lean_for`). The order and the
  marks must change together, as `ApplyRank` does in My ballot.
- **The agent's marks go through `lib/ranking.ts`** (`pickChange`,
  `markChange`, `orderPatches`, `reorderChange`), and `webmcp.ts` saves rows
  and rankings together. Writing plain marks would desync them.
- **No toggling for agents.** The UI's bubble toggles, but an agent's retry
  would then undo its own pick. "pick" on a picked name, or "maybe" or
  "against" on a name already so, is a no-op (`resolveMark`).
- Summaries show `ranked`, each choice's `rank`, and `backup`: a ranked
  `lean_for`, which isn't a maybe.
- Merge conflict: `ballotDraft.ts` keeps `ballotDraftStore` and takes
  master's `rankingStore`/`setRanking` whole. `writeInGroup` lives in
  `ranking.ts`.
- Verified live at about 9:40 PM PDT (04:40Z):
  - two picks in "Vote for one" give 1 pick and 1 backup, and the UI reads
    "ranked 2, a backup not marked on the ballot"
  - a repeated pick changes 0 rows
  - `rank_choices` on a "Vote for no more than three" race picks 3 in order

## Origin trial (Chrome)

- Chrome's announcement, 2026-06-09:
  https://developer.chrome.com/blog/ai-webmcp-origin-trial. The trial runs
  from Chrome 149. Without a token for the page's origin, real visitors'
  Chrome exposes no `modelContext`. The flag
  `chrome://flags/#enable-webmcp-testing` is for local testing only.
- **The token is in `public/_headers`** (user registered it, 2026-10-26).
  It is for `https://openslate.us:443` with subdomains, feature `WebMCP`.
  It expires 2027-03-30 00:00Z (Mar 29, 5:00 PM PDT), read from the token's
  own claims. Edge's trial page gives 2026-11-17, but that is Edge's trial,
  not Chrome's. Renew the token before it expires, or drop it once Chrome
  ships WebMCP.
- Tokens can arrive in an `Origin-Trial` response header or in
  `<meta http-equiv="origin-trial">`. The header in `public/_headers` sits
  with the rest of the response policy, and self-hosted copies (other
  origins) don't carry a token that's useless to them.

## Things not to do

- Don't write `localStorage` directly from a tool. Go through the store, or
  the UI won't see the change (or will overwrite it).
- Don't add the `@mcp-b/global` polyfill. It is third-party script, and the
  CSP allows only `'self'` for good reason (plans/usage-analytics.md).
