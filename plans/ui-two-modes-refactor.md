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
- ~~The uncommitted ComposePanel / ElectionCombobox / subjects.ts edits are
  another thread's; don't touch them.~~ **Superseded 2026-10-19:** the user
  said to adopt them (`1cf282c`); Compose was then reworked here (`71a33e9`)
  and `ElectionCombobox` / `BallotComposer` deleted.
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
9. ~~User walks through it, then merge~~ → superseded: the walkthrough produced
   round 2 below (user feedback 2026-10-19). Merge moves to step 18.

### Round 2: not address-centred, not a blind list, picks → endorsements

10. [x] Adopt the other thread's Compose edits (`1cf282c`). Those files are
    ours now.
11. [x] (`ad16ad9`) Ballot sources in the data model. An official candidate list
    is a slate like any other: `attribution.of.kind = "election-authority"`
    (the SoS, a county registrar), one `neutral` position per candidate with
    `choice`, measures as `neutral` on "Yes"/"No". Collate: a source whose
    positions are all neutral is a *ballot source*: never filtered by follows,
    not counted as an endorsement source, its choices become `race.candidates`,
    and its chips don't render. Sources page lists them under "Ballot data".
    No format change; signing/import/verify all reuse the catalog pipeline.
12. [x] (`0559c2a`, verified in the browser with test-signed ballot slates:
    "1 of 4 candidates covered", full field with pick buttons, race page
    lists everyone and marks unfollowed) My ballot cards show the field: every candidate anyone names (ballot
    source first, then any imported source, unfollowed muted), with "your
    sources cover 1 of 5". Races listed = those a followed source covers (or
    all, with the checkbox, which becomes "Show races only unfollowed sources
    cover"). Candidates with no endorsement are plain rows with pick buttons.
13. [x] (`dd5ad9e`; scoped 2026-10-19: districts and city only. Civic's
    contest titles — "Governor" — don't match the catalog's race keys —
    "Governor of California" — so feeding its candidates into the field
    needs same-race matching; follow-up.) Address moves to My vote. Where-you-vote gets "Use my address": calls
    `/api/ballot`, which the server extends to pass each contest's
    `district.scope` + `district.id` (Civic gives e.g. scope `stateUpper`, id
    `"34"`; `congressional`→cd, `stateUpper`→sd, `stateLower`→ad,
    `citywide`/`countywide` + name → locality). The client maps those onto the
    Area and keeps the contests as a local ballot source for that election
    (`openslate.civicBallot.v1`, so it survives offline). Hidden when the
    server returns 501/doesn't answer. Can't be live-tested here: no
    `GOOGLE_API_KEY`; test the mapping against a recorded response fixture.
14. [x] (`71a33e9`) Compose from picks. Election by date (what My ballot uses); positions =
    draft rows for that date + off-ballot entries. Remove the address field,
    `ElectionCombobox`, `BallotComposer` and the ballot export from Compose.
    Export (JSON/CSV) moves to My ballot over the collated races. "Add any
    race" stays (SubjectPicker + free-form). Copy: "Identity tab" →
    "Identities". Ranked-choice ordering (`useBallotRanking`, SF uses RCV):
    keep it as a follow-up on My ballot cards that have a candidate list.
15. [x] (`b3f9ed9`) Published slates are remembered: new IndexedDB store `published`
    (token, publishedAt), written when Compose signs. My ballot card shows
    "You published: X" with a Compose link; Identities lists "My slates".
16. [x] (endorsements repo `b9e20a8` bundles + scripts + README, `0193108`
    698 spelling edits; **not pushed**, so the public catalog doesn't carry
    them until the user pushes and CI signs) Endorsements repo: ballot
    sources for 2026-11-03. CA SoS certified list
    (PDF, 8/27/2026: `elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf`)
    → statewide, Congress, Senate, Assembly. SF Dept of Elections
    (`sf.gov/reports--candidates-nov-3-2026-general-election`,
    `sf.gov/qualified-ballot-measures`) → SF local. Race keys must match the
    catalog's existing titles/jurisdictions or the field won't line up with
    the endorsements. Separate repo, separate commits.
17. [x] README (modes, address lookup, ballot sources), ISSUES.md (hosted
    404 entry updated), this plan. Walkthrough script in Open questions.
18. **[current]** Merge `ui/two-modes` into master, after the user's
    round-2 walkthrough and yes. Then push the endorsements repo so the
    public catalog carries the ballot bundles.

## Follow-ups (not started)

Done in round 2 (steps 11–16): opponents on My ballot (every source's
choices on the card, official candidate lists as ballot sources; the data
behind it: 729 of 1,412 November office races named one candidate), address
lookup on Where-you-vote, Compose from picks, My ballot ↔ my slates. The
numbers and options considered are in the Findings.

- **Civic candidates into the field.** `voterinfo` contest titles ("Governor")
  don't match catalog race keys ("Governor of California"), so the address
  lookup only fills districts/city today. Needs same-race matching
  (jurisdiction + office family) before its candidates can join the field.
- **Push `openslate-public-endorsements`** (`b9e20a8`, `0193108`): CI signs
  and the catalog gets the two ballot bundles and canonical spellings.
  Until then ballot sources only exist as the local test-signed slates.
- **Same-person matching in the app** (choice spellings that differ only by
  initials/nicknames collapse onto the ballot's spelling), for firsthand
  slates the catalog's normalizer never sees.
- **Jurisdiction containment:** `us/ca/bay-area` measures should show for an
  SF voter. Needs a region → localities map (or the catalog to settle on one
  jurisdiction per regional measure; see Findings).
- **Catalog data drift** (RTM and BART 8 keyed under several jurisdictions)
  needs a one-off fix in the endorsements repo.
- **Ranked choice** on My ballot cards with a candidate list (SF uses RCV);
  `useBallotRanking` exists.
- **Catalog index should carry each slate's scope** (`context.jurisdiction`) in
  `openslate-public-endorsements`, so the wizard's area/sources steps don't
  download the election's ~0.8 MB of slates to learn it.
- **Race page**: the polls half of the ISSUES.md race-view bug is still open
  (followed/unfollowed marking landed in `0559c2a`).
- **Elections page** still calls `/api/elections` and shows "HTTP 404" on the
  hosted app (ISSUES.md). Its "Use as active" now sets the My-ballot election
  by date; it mainly serves self-hosters with a Google key.
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
  in the existing ballot-draft store. Since `71a33e9` Compose reads the same
  rows for the same election (shared `myElectionStore`), so picks flow
  straight through. Rows keyed by a Google election id (pre-refactor drafts)
  are ignored by Compose; the Elections page still counts them.
- **Compose signs `context.election`** (the date), so a slate signed from
  picks says which election it is for even where positions carry no date.
- **Big Bash heredocs with quotes fail to parse in this harness** ("unexpected
  EOF while looking for matching quote" at the script's last line). Write
  multi-file edit scripts to `$TEMP/*.py` with the Write tool and run them.
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
- **Certified list parsing (2026-10-19):** the SoS PDF's text layer (pypdf)
  is "Office heading / Name[*] Party / ballot designation" triples; Senate
  pages are headed "State Senate District N" (not "State Senator"), which
  silently fed 20 Senate races into House District 52 until a two-line
  designation guard caught it. Judicial retention is "• For <office> Shall
  [role] NAME be elected…" with ALL-CAPS names; title-casing them matched
  every catalog retention title. After the Senate fix, 258 of 260 catalog
  races in scope matched by title|jurisdiction; the two misses are BART
  districts 2 and 4 (outside SF, no bundle yet).
- **Candidate spellings:** the catalog mostly drops middle initials ("Malia
  Cohen" ×59 vs the ballot's "Malia M. Cohen"); 55 names differed. Fixed at
  the data level: `normalize-choices.ts` now makes an election authority's
  spelling canonical (698 edits). Firsthand slates from individuals will
  still spell names freely; app-side same-person matching is a follow-up.
- **Catalog jurisdiction drift:** the regional transit measure appears as
  `us/ca` ×3, `us/ca/bay-area` ×5 and `us/ca/sf` ×2, and BART 8 as both
  `us/ca/bart-8` and `us/ca/sf`, so one race splits into several keys. The
  SF ballot bundle uses `us/ca/bay-area` and `us/ca/bart-8`. A regional
  measure at `us/ca/bay-area` is hidden for an SF voter because areas are
  flat; containment (bay-area ⊃ sf) is a follow-up.
- Test-signing locally: `bun .openslate/packages/cli/src/index.ts keygen …`
  then `sign <positions.json> --key … -o x.slate`; serve with CORS
  (`$TEMP/serve-slates.ts`, port 5198) and import by URL on Sources.
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
- [x] Round 1 walkthrough feedback (2026-10-19): not address-centred, not a
      blind list, picks → endorsements
- [x] Steps 10–16: ballot sources in data model + endorsements repo, field on
      cards, address lookup on Where-you-vote, Compose from picks, signed
      slates remembered (`1cf282c`…`b3f9ed9`)
- [x] Step 17: README / ISSUES / plan current
- [ ] Round 2 walkthrough, then merge to master (step 18)
- [ ] Push the endorsements repo (user's call; two commits waiting)

## Open questions for the user

1. **Round-2 walkthrough** on `http://localhost:5199` (branch
   `ui/two-modes`, dev server already running), then say whether to merge
   into master. What to look at:
   - *Sources*: a "Ballot data" card for the official candidate lists. The
     public catalog doesn't carry them until the endorsements repo is pushed;
     the preview browser has test-signed copies (`$TEMP/sos.slate`,
     `$TEMP/sf.slate`, import by file on Sources) and the preview profile
     already has them imported.
   - *My ballot*: cards show the whole field with "N of M candidates covered"
     (or "field unknown" without a list), unfollowed sources as one muted
     "+N you don't follow" chip, party/designation under each name.
     **Export** (toolbar) downloads JSON/CSV, private notes opt-in. *Where
     you vote* shows "Use my address" only when a self-hosted server with
     `GOOGLE_API_KEY` answers (`bun run dev:server`); otherwise the picker.
   - *Publish → Compose*: your picks for the election (same election as My
     ballot, by date); untick to keep one private, change the stance, add a
     public statement; "Other positions" for anything else; Sign.
   - Back on *My ballot*, the race says "✍ You endorsed X · signed <date> ·
     Compose". *Identities → My slates* lists what you signed (copy /
     forget). *Elections → Use as active* sets the same election by date.
2. Push `openslate-public-endorsements` (two commits, `b9e20a8` and
   `0193108`)? Recommendation: yes, after the walkthrough; CI signs and the
   hosted catalog gains the ballot bundles.

Answered 2026-10-19: opponents come from official candidate lists in the
endorsements repo plus Civic-by-address when self-hosted; this thread adopts
the other thread's Compose files (both "Recommended" options).

## Things not to do

- Don't key follow state by issuer key alone (see Findings).
- Don't break `/results/$token` or `/race/$key` links; they're shared outside
  the app.
- Don't add usage events that carry an org, race, region or choice.
