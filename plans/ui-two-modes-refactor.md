# UI refactor: two modes + getting-started wizard

## Goal

Restructure the web app (`apps/web`) around the two things people actually come
to do:

1. **My vote**: collect the endorsements *I* care about and use them to decide
   my ballot. This is the main path, and the current UI underplays it.
2. **Publish**: make, sign and share my own endorsements.

Add a skippable getting-started wizard that sets someone up for mode 1 (and
points publishers at mode 2).

## Environment / context

- Web app: `apps/web` (React 18, Vite, TanStack Router with **hash history**,
  TanStack DB over IndexedDB, TanStack Query). Styles: one `src/styles.css`.
- Checks: `bun run typecheck`, `bun run lint` (biome), `bun test` (repo root).
- Hosted at https://openslate.us. No `apps/server` there, so `/api/elections`
  and `/api/ballot` 404 in hosted mode (see ISSUES.md). The hosted ballot comes
  from imported endorsements only.
- Public catalog: `https://cinderblock.github.io/openslate-public-endorsements/index.json`
  (sibling repo `openslate-public-endorsements`). As of 2026-10-19: 69 entries,
  ~40 orgs, all California, elections `2026-06-02` (30) and `2026-11-03` (39).
  **Every entry is signed by the same researcher key** ("OpenSlate Public
  Endorsements"). The org is in `attribution.of`. The index has **no
  jurisdiction field**; jurisdiction is only in each slate's `context`.
- Usage telemetry: `ROUTE_TEMPLATES` in `src/lib/usage.ts` must list every
  route (compile-checked from `router.tsx`). New events must go through
  `USAGE_SCHEMA` and may never reveal a choice, org, race or jurisdiction
  (plans/usage-analytics.md).

### Current UI (before)

Nine flat tabs: Identity (home), Compose, Import & verify, Catalog, Collate,
Elections, Results, Viewer, Settings.

- The home page is **Identity** (key management), a publisher concern.
- **Compose** mixes both modes: the private ballot draft (stances and private
  notes per candidate, print my ballot, export) *and* signing a public slate.
- **Collate** is the closest thing to "my voting guide", but it is a flat list
  of every subject across every imported slate and every election, with no
  notion of which sources I care about, and no way to record my own pick.
- Getting sources in is spread over Catalog, Import & verify and Identity
  (contacts).
- Every imported slate counts equally. There is no "sources I follow" concept.
- Known bug that this refactor touches: Collate groups by a different key than
  RacePanel looks up (ISSUES.md, "Race view finds no polls and no
  endorsements"). Using `subjectKey()` everywhere fixes the endorsement half.

## Structure (approved 2026-10-19)

Header: `OpenSlate` · mode switch **[My vote | Publish]** · "Get started" (opens
wizard again) · Settings.

**My vote** (default mode)

| Page | Route | Built from |
| --- | --- | --- |
| **My ballot** (home) | `/` | Collate + the ballot draft half of Compose + Elections picker |
| Race detail | `/race/$key` | RacePanel (unchanged route) |
| **Sources** | `/sources` | followed sources, Catalog, Import & verify, Contacts |
| Results | `/results`, `/results/$token` | unchanged |

- **My ballot**: pick an election (defaults to the next upcoming one that has
  endorsements). Every race from followed sources, each candidate showing which
  of *my* sources endorse/oppose it, plus my own private pick buttons (the
  existing draft store, so picks carry over). Summary strip: "N races · M
  decided". Print / export. Empty state points to the wizard or Sources.
- **Sources**: "Following" list grouped by source (org or person), one row per
  source with its slates per election, a follow toggle, remove. "Add sources":
  catalog browser and import from link/file/QR/paste. Contacts (nicknames,
  notes) live here too.

**Publish**

| Page | Route | Built from |
| --- | --- | --- |
| **Compose** | `/publish` | signing half of Compose: positions from my picks + off-ballot, sign, share |
| Identities | `/publish/identities` | IdentityPanel (my keys only) |
| Tools | `/publish/verify`, `/publish/viewer` | Import & verify's verify view, Block viewer |

Old routes (`/compose`, `/collate`, `/catalog`, `/import`, `/elections`,
`/viewer`) redirect to their new homes so bookmarks keep working.

### Wizard

Opens automatically on first visit (no slates, no identities, never dismissed).
"Skip" on every step. Re-openable from the header.

1. **Welcome**: two big choices, "Plan my vote" / "Publish endorsements".
2. (vote) **Which election?** Upcoming elections from the catalog (+ Google if a
   server is configured).
3. (vote) **Where do you vote?** Region chips derived from the slates'
   `context.jurisdiction` (statewide / SF / LA / San Diego …). Optional.
4. (vote) **Pick sources you trust.** Catalog entries for that election and
   region, grouped by kind (party, labor, environment, editorial board, civic
   group…), multi-select. "Have a link from a friend? Paste it" escape hatch.
5. (vote) **Done**: imports the picks, lands on My ballot.
6. (publish) Create identity → back it up → go to Compose.

## Decisions already made (don't re-ask)

- Two modes, "My vote" emphasized. Wizard exists and is skippable. (User,
  2026-10-19.)
- **Structure as drawn in the proposal is approved** ("Yes, build it",
  2026-10-19), old routes redirecting.
- **Follow toggle per source**, separate from "imported", keyed by source so it
  carries across elections. (User, 2026-10-19.)
- **Work on branch `ui/two-modes` in a dedicated T3 worktree**, merge to master
  when done and walked through. (User, 2026-10-19.)
- **The uncommitted ComposePanel / ElectionCombobox / subjects.ts edits are
  still in progress in another thread. Don't adopt or touch them.** So this
  refactor leaves `ComposePanel.tsx`, `ElectionCombobox.tsx` and
  `lib/subjects.ts` unedited: new collation code goes in a new module, and
  Publish → Compose mounts the existing `ComposePanel` as-is. Slimming Compose
  (taking positions from My-ballot picks) is a follow-up once that thread
  lands.
- No central server (memory: project_no_central_server). Everything stays
  client-side; follow state lives in IndexedDB/localStorage.
- **Publishing is not centred on where you live** (user, 2026-10-19): anyone
  can endorse in any race. The address / "where you vote" belongs to My vote
  only; Compose must not be driven by an address lookup. Compose starts from
  My-ballot picks and lets you add any race.
- **My vote links to my endorsements** (user, 2026-10-19): a race card shows
  what I've already published for it and leads to Compose.
- **My ballot must not be a blind list** (user, 2026-10-19): a race should show
  the field, not just the names your sources endorsed. See follow-up
  "Opponents on My ballot".

## Plan / steps

1. ~~Get sign-off on the structure and the open questions.~~ Done.
2. ~~Data: "source" identity (firsthand = issuer key; secondhand = `attribution.of`)
   and per-source follow state. Shared `collate()` helper on `subjectKey()`.~~
   `0103dfe` (lib/sources.ts, jurisdictions.ts, collate.ts, localStore.ts, myVote.ts).
3. ~~Shell: mode switch, nav per mode, redirects, `ROUTE_TEMPLATES`.~~ `f28a7b5`.
4. ~~My ballot page.~~ `d76ba4e`.
5. ~~Sources page.~~ `4bb9c0d`.
6. ~~Publish: move Identity/Verify/Viewer.~~ Done in the shell (`f28a7b5`);
   Compose mounts the existing ComposePanel unchanged (see Decisions).
   Contacts moved to Sources (`4bb9c0d`).
7. ~~Wizard.~~ `79d242a`.
8. ~~README update, typecheck, lint, test, browser walkthrough.~~ `fbebe24`.
   Typecheck, 172 tests, Biome (CRLF config) and `bun run build` pass; agent
   walkthrough in the dev server (first-visit wizard both paths, My ballot,
   Sources follow/unfollow, catalog, redirects, tab highlighting, phone width,
   Escape) found no console errors.
9. **[current]** User walks through it, then merge `ui/two-modes` into master.

## Follow-ups (not started)

- **Opponents on My ballot.** The endorsement data alone can't show the field:
  across all 69 November sources, 729 of 1,412 office races name exactly one
  candidate, 572 name two, and only 32 carry any `oppose` (counted
  2026-10-19 over `orgs/*/2026-11-03/positions.json`). Layers, cheapest first:
  1. Show every imported source's choices on each card (unfollowed ones
     muted) and say plainly "your sources cover 1 of ? candidates".
  2. A candidate-list source. Options: (a) Civic `voterinfo` by address when
     self-hosted (it returns contests with candidates *and* OCD district ids,
     so it also fills Where-you-vote; coverage is spotty per the other thread);
     (b) official candidate lists (CA SoS certified list for state/federal,
     county registrars such as sfelections.org election data for local)
     published as a signed secondhand report next to the endorsements catalog,
     keyed by the same title|jurisdiction|election race key; no server, works
     on openslate.us. Both can coexist: (b) as the base, (a) on top.
- **Address moves to My vote.** `openslate.address.v1` (`lib/address.ts`)
  already exists and is used by Compose only. Where-you-vote gets an optional
  "Use my address" that, when the self-hosted server answers, fills districts
  and the ballot from `voterinfo`; otherwise the manual area picker as now.
- **Compose from My-ballot picks.** Blocked on the other thread's uncommitted
  ComposePanel / ElectionCombobox / subjects.ts work landing. Then: Compose takes
  positions from My-ballot picks (keyed by election date), drops its own
  address/ballot lookup (per the decision above), keeps "add any race" (search
  imported subjects + free-form), and its "Identity tab" copy becomes
  "Identities".
- **My ballot ↔ my endorsements.** A race card shows my published stance when
  one of my own identities' slates covers the race, with a link to Compose.
- **Catalog index should carry each slate's scope** (`context.jurisdiction`) in
  `openslate-public-endorsements`, so the wizard's area/sources steps don't
  download the election's ~0.8 MB of slates to learn it.
- **Race page**: mark which positions come from followed sources. The polls
  half of the ISSUES.md race-view bug is still open.
- `bun run lint` on Windows (ISSUES.md).

## Findings / gotchas

- **Catalog data shape (probed 2026-10-19):** no subject has an `id`; races are
  keyed by title + jurisdiction + election, and titles are consistent across
  orgs (380 of 648 November races have 2+ sources). Measures are positions with
  `choice: "Yes"/"No"` and `stance: "endorse"`. Position jurisdictions are
  `us/ca` (statewide), `us/ca/<family>-<n>` districts (cd, sd, ad, coa, bart),
  and ~100 locality slugs (`sf`, `los-angeles`, `chula-vista`…). The slate-level
  `context.jurisdiction` is coarser (`us/ca`, `us/ca/sf`, …). All slates total
  1.4 MB; one election's ~0.8 MB.
- **Publish → Elections** was added to the Publish tabs (not in the mockup): it
  still sets Compose's active Google election, so it belongs with Compose.
- **TanStack `Link` adds an `active` class on any prefix match** by default;
  nav links pass `activeProps={{}}` and compute "active" themselves.
- **Wizard relevance:** groups based in another locality still endorse statewide
  races, so "races on your ballot" alone ranked San Diego groups for an SF voter.
  Locality-scoped groups outside the area fold under "based elsewhere".
- **Where-you-vote model:** state (implied) + localities + a number per district
  family. Unset district family = its races hidden, but My ballot counts them
  ("Hidden until you set your district: 80 Assembly district races…").
- **Performance:** with the whole catalog imported, a pick took ~930 ms:
  `useKnownIdentities` returned a new array every render (so everything
  recollated) and all 648 race cards re-rendered. Fixed: memoized hooks,
  `memo` RaceCard comparing only its own draft rows, and non-statewide sections
  collapsed (unrendered) while no area is set. Now ~50 ms.
- **My-ballot picks are keyed by election date** (`2026-11-03|<subjectKey>|<choice>`)
  in the existing ballot-draft store. Compose still keys by Google election id,
  so picks don't flow into Compose until the Compose follow-up.
- **`bun run lint` fails on Windows checkouts** (CRLF vs Biome's default LF;
  logged in ISSUES.md, `ac56031`). Lint touched files with a CRLF copy of the
  config: `bunx biome check --config-path=<dir with lineEnding crlf> <files>`.
- Python/Write edits produce LF; run `biome check --write` with the CRLF config
  on touched files before committing to keep CRLF.
- **The "look yours up" link was made up** (`findmyrep.legislature.ca.gov`
  returns ENOTFOUND). The real one is `findyourrep.legislature.ca.gov` (title
  "Find Your California Representatives"); fixed in `5d0b88d`. Its TLS chain is
  incomplete (`curl` says "unable to verify the first certificate"), but browsers
  load it.
- **Address lookup already exists, server-side only.** `apps/server` proxies
  Google Civic `voterinfo` (and `elections`) when `GOOGLE_API_KEY` is set. Only
  Compose uses it, through `/api/ballot` → `lib/subjects.ts`. No key is configured
  in this checkout, and openslate.us doesn't offer it (README "Cloud"). Civic's
  `divisionsByAddress` returns OCD ids (`…/cd:11`, `…/sldu:11`, `…/sldl:17`,
  `…/place:san_francisco`) that map straight onto the Area model; it also needs a
  key (unkeyed calls get 403 "unregistered callers"). It has no Court of Appeal
  or BART districts.
- The dev server for this worktree runs on port 5199 (`bunx vite --port 5199
  --strictPort` in apps/web) to stay clear of the main checkout's 5173.

- Catalog slates all share one signer key, so "follow by issuer key" would
  follow all ~40 orgs at once. Sources must be keyed by `attribution.of` for
  secondhand slates.
- Region filtering in the wizard needs each slate's `context.jurisdiction`,
  which the index lacks. Options: fetch the ~39 slates for the chosen election
  (small, cached by Query), or add `jurisdiction` to the index in the
  endorsements repo (better long-term; separate repo).
- `ComposePanel.tsx`, `ElectionCombobox.tsx`, `lib/subjects.ts` carry another
  thread's uncommitted edits (since ~2026-10-17): a ballot synthesized from
  imported endorsements when Civic has none (`useImportedBallotContests`) and
  local-date fixes. That fallback is exactly what My ballot needs.

## Progress log

- [x] Survey current UI and data layer
- [x] Structure sign-off and open questions answered (2026-10-19)
- [x] Step 2 data layer, step 3 shell, step 4 My ballot
- [x] Steps 5–8 (Sources, Publish, wizard, README)
- [ ] User walkthrough and merge to master

## Open questions for the user

1. Walk through `ui/two-modes` (worktree dev server: `bunx vite --port 5199
   --strictPort` in `apps/web`) and say whether to merge into master.
2. Where do opponents come from (follow-up "Opponents on My ballot")?
   Recommendation: layer 1 now in this branch; then (b) official candidate
   lists in the endorsements repo, with (a) Civic-by-address as a self-hosted
   extra. Needs a yes because (b) widens the endorsements repo's scope.
3. Is the other thread's Compose work (uncommitted in the main checkout)
   finished, so this thread can take ComposePanel / ElectionCombobox /
   subjects.ts for the "Compose from picks" follow-up?

## Things not to do

- Don't key follow state by issuer key alone (see Findings).
- Don't break `/results/$token` or `/race/$key` links; they're shared outside
  the app.
- Don't add usage events that carry an org, race, region or choice.
