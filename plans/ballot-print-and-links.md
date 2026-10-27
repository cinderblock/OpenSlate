# My ballot that looks like a ballot, a one-page printout, and per-race links

## Goal

The user asked (2026-10-21):

1. *My ballot* should look more like the real ballot: a bubble per choice with
   the number of endorsements next to it.
2. Especially *Print*: it should print as a ballot, ideally on a single page.
3. Each ballot entry should link to popular references (Ballotpedia, other
   voter guides).
4. News articles about specific ballot items (not endorsements) should be
   collated with that item.

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\feat-ballot-print`, branch
  `feat/ballot-print`. Started from `master` at `4739b5e`; on 2026-10-25 it was
  re-made on `origin/master` at `cec2113` (207 commits later), the code
  commits squashed into one port (see Findings: the port). The pre-port
  branch is kept as `backup/ballot-print-pre-rebase` (`7cf5daf`).
- My ballot: `apps/web/src/components/MyBallotPanel.tsx` (sections →
  `BallotSection` → `RaceCard` → `ChoiceRow`; `PrintPicks` is the old print
  view). Collation: `apps/web/src/lib/collate.ts` (`Race`, `ChoiceGroup`).
  Race page: `apps/web/src/components/RacePanel.tsx`. All CSS:
  `apps/web/src/styles.css` (print rules in one `@media print` block).
- Data reality (public-endorsements repo, Nov 3 2026): measures are
  `kind: "measure"`, titled `California – Proposition 43 (Limits …)`, with
  choices `Yes` / `No` (a few positions have no choice). The CA Secretary of
  State ballot source lists candidates with `stance: neutral` and the ballot
  designation in `statement`. No subject carries `uri` or `id` today.
- Checks: `bun run typecheck`, `bun test`, lint with a CRLF copy of
  `biome.json` (see `plans/custom-form-controls.md`), `bun run build`.

## Decisions already made (don't re-ask)

- Everything stays client-side (hard project constraint): research links are
  plain outbound links built in the browser; nothing is fetched to make them.
- Endorsement counts are followed sources only, same as the rest of My ballot
  (since the port: a source followed to *disagree* counts the other way, as
  everywhere on master).
- 2026-10-25, user: merge `feat/ballot-print` into master and push: yes.
- 2026-10-25, user, on seat counts: the spec *needs* a field for this. A
  standard string format that gets parsed is **not acceptable** for the data
  format; everything needs more structure. (So: no parsing "3 seats" or
  "Democratic · Attorney" out of `statement`.)
- 2026-10-25, user, on news per ballot item: "basically yes" to signed links
  attached to ballot items, **but no curation should be needed**: if an
  article is attached to a particular ballot item, collating its link with
  that item should be trivial (automatic, like endorsements are).
- 2026-10-26, user, on who publishes articles: not the project. We find
  articles that news orgs (or any publisher) have published about specific
  ballot items. Eventually publishers sign their own reference links, like
  endorsers; for now we publish the link for them, the way we publish
  endorsements we find (researcher-signed secondhand slates in the
  endorsements repo).
- 2026-10-26, user: fix the catalog refresh (so C5 can happen): yes.
- 2026-10-26, user, on ranked choice: must be supported, and ranking is to
  be **the primary interface**: the voter drags candidates up and down a
  preference list. Where a contest isn't ranked, the list converts to their
  best pick(s). Later (not now): strategic ranking, where the voter's own
  list keeps a no-chance favourite first but the marked ballot votes for
  others, until real ranked voting is available.

## Plan / steps

### Part A — ballot look and one-page print

1. `ChoiceGroup.ballotIndex` from collate, so the ballot view can show the
   official order (the card's "your sources agree" verdict still uses the
   support order).
2. Pure `lib/ballotView.ts`: `ballotChoices(race)` → choices in ballot order;
   measures always show Yes and No, with choice-less positions folded in
   (endorse → Yes, oppose → No). Unit-tested.
3. Screen: each choice row starts with an oval bubble (the pick toggle),
   then the endorsement count, then name / designation / source chips.
   *Maybe* and *Against* stay as small secondary toggles.
4. Print: a new `PrintBallot` replaces `PrintPicks`. Whole ballot (or only
   picked races), ballot-style boxes in three columns, bubbles filled for
   picks, `n ✓ / n ✗` counts beside each bubble. Scaled to fit one page:
   measured off-screen at the printable width before printing, scale found by
   search, floor at a minimum readable size (then it spills to more pages and
   the print card says so).
5. Print options card (like Export): whole ballot vs only my picks, include
   private notes, page-fit readout, Print button. Ctrl+P uses the same
   options.

### Part B1 — generated research links

6. Pure `lib/researchLinks.ts`: per race and per candidate, built from title,
   jurisdiction and election. Unit-tested.
   - `subject.uri` when a slate supplies one.
   - Ballotpedia (search with `go=Go`, which jumps straight to an exactly
     named page such as a candidate's).
   - CA statewide propositions: the Secretary of State's Official Voter
     Information Guide (`voterguide.sos.ca.gov/propositions/<n>/`), only for
     elections not yet past (the site only hosts the current guide).
   - CalMatters (site search) for California races.
   - Google News search for the race / candidate.
   - VOTE411 (LWV) once at the top of My ballot: it's address-based, no
     per-race deep link.
7. Shown on each race card (race-level links) and on the race page (race and
   per-candidate links). Screen only, not printed.

### Part B2 — news per ballot item → Part C

The user's answer (2026-10-25): signed links attached to ballot items, no
curation step, collated with the item automatically. Designed as `articles`
in Part C.

### Part C — structure in the spec (2026-10-25) ← current

Why: the app was parsing meaning out of free text: seat counts from "3
seats", party from "Democratic · Attorney", the measure number and label
from "California — Proposition 43 (Limits …)", the measure type from a
listing's `statement`. The user ruled that out for the data format. The
listing scripts already hold every one of these values separately (CA SoS:
party, designation, incumbent, measure number / label / type; SF: seats and
measure type; OC: "Vote For: N"; Alameda: party, designation, incumbent;
LA/SCC/SD/OC: designation) and flatten them into `statement`.

Design (amended in place in v1, like `district` and `choice_id`: optional
fields, consumers upgrade before publishers use them):

- `Subject.ballot` (`BallotContest`): how the ballot prints the contest. Not
  part of identity; a ballot listing's value wins (like `district`).
  - `heading`: the contest's heading as printed ("Proposition 43", "Measure
    A", "Attorney General").
  - `number`: a measure's number or letter ("43", "A"), on its own so
    nothing has to parse it out of `heading` or `title`.
  - `label`: what's printed under the heading: a measure's ballot label, a
    retention question.
  - `measure_type`: "Initiative Statute", "Legislative Constitutional
    Amendment", "Bond Measure"…
  - `vote_for`: integer ≥ 1, the most choices a voter may mark ("Vote for
    no more than N").
  - `ranks`: integer ≥ 2, a ranked-choice contest: rank up to N choices (SF
    uses ranked choice for some offices; "Vote for one" would be wrong
    there).
- `Position.ballot` (`BallotChoice`): how the ballot prints a choice; for
  listings, and anyone copying from them.
  - `party`: the party (preference) as printed.
  - `designation`: the ballot designation (occupation) as printed.
  - `incumbent`: `true` (never `false`: omit it, like `write_in`).
- Listings (§8.2) put these in `ballot`, not `statement`. Consumers MUST NOT
  parse structure out of `statement` or `title`.
- `SlatePayload.articles` (`Article[]`): links attached to ballot items,
  never positions. Anyone signs them (a newsroom about its own coverage, a
  researcher, a voter); consumers collate them by subject identity (and
  `choice` / `choice_id`), exactly as positions are, with no curation step.
  Fields: `subject` (req), `choice`, `choice_id`, `uri` (req), `title`
  (req), `publisher`, `published_at` (RFC 3339 full-date or date-time), `kind`
  (`news` | `analysis` | `opinion` | `explainer` | `guide` | other),
  `summary`. MUST NOT count as support or opposition; SHOULD show who
  attached it; dedupe by `uri`.

Steps:

1. C1 SPEC.md (§3.3, §3.4, new §3.14 `BallotContest` / `BallotChoice`, new
   §3.15 `Article`, §8.2, changelog, Appendix A; §3.13 became the http(s)
   links rule), `packages/core` zod schema,
   exported JSON schema, vectors (positive: all fields; negative:
   `incumbent: false`, article without uri…), core tests.
2. C2 web app reads the structured fields: `voteFor` from
   `subject.ballot.vote_for` (and `ranks` → "Rank up to N"), designation and
   party from `ballot`, measure heading / label / type / number from
   `subject.ballot`, research links from `ballot.number`; Quick fill's party
   from `ballot.party`. Collate carries a listing's `ballot` onto the race
   and its choices.
3. C3 web app collates `articles`: under each race on the race page
   (newest first, who attached it, publisher, date), and a count / the
   latest few on My ballot's card. Never counted as endorsements.
4. C4 public-endorsements repo: every listing script writes `ballot` fields
   instead of flattening into `statement`; re-sign in CI; Pages publishes.
   Only after C1–C3 are live (old verifiers reject the new fields).
5. C5 once the live listings carry the fields: remove the app's
   free-text fallbacks (`SEATS`, `partyOf`'s split, `splitMeasureTitle`,
   `legacyMeasureNote`, and "listed by a ballot source → vote for one").
   **Blocked**: the app never refreshes a catalog slate it already
   imported (ISSUES.md "Imported catalog slates never update"), so
   browsers that imported the listings before 2026-10-25 keep the old
   `statement` text. Removing the fallbacks now would drop party,
   designation and vote-for lines for them. Do C5 after that issue is
   fixed.
6. C6 data for `articles`: answered 2026-10-26, see Part F.

### Part D — imported catalog slates update (2026-10-26) — done

The app stores a catalog slate's token once and never looks again
(ISSUES.md "Imported catalog slates never update"). Two halves:

1. D1 endorsements repo: CI re-signs every slate on every publish, so every
   `issued_at` changes even when nothing else did (seen: 350 SF Action's
   entry says `issued_at` 2026-10-26 though its positions are from Oct 23).
   An app that updates on "newer `issued_at`" would re-download all 376
   slates after every publish. Fix at the source: after signing, a script
   fetches the live `bundle.json` and, for every slate whose payload is the
   same apart from `issued_at` (same signer), puts the published token back.
   `issued_at` then only moves when the content does, which is also what
   it should mean.
2. D2 app: a pure `staleImports` matches stored slates to catalog entries by
   stream (signer key, source id, election, scope) and returns the entries
   whose `issued_at` is newer than the newest stored slate of that stream.
   The app fetches those (the bundle when there are many), verifies them,
   inserts the new tokens and deletes the stream's old ones. Runs on its
   own whenever the default catalog loads and the user has imported from
   it; a quiet line says how many sources were updated. Slates the user
   imported some other way are never touched (signer and source must
   match a catalog entry).
3. D3 then C5 (remove the text fallbacks), once D1 and D2 are live.

### Part E — ranking is the primary interface (2026-10-26)

1. E1 spec: `Position.rank` (integer ≥ 1, 1 = first choice, requires
   `choice`, only with `endorse` / `lean_for`): ranked endorsements are in
   `statement` text today ("Ranked-choice first choice: …", "Rank Both
   Candidates", 34 files), which the user ruled out. Core schema, JSON
   schema, vectors, CLI.
2. E2 app model: for candidate contests the voter's choice *is* an ordered
   list (the existing, unused `useBallotRanking` store in
   `lib/ballotDraft.ts`, keyed by election and subject). Marks derive from
   it: a ranked contest marks ranks 1..N for the first N; a vote-for-N
   contest marks the first N; unknown count: the first one. *Against* stays
   a separate mark outside the list. Yes/no questions keep two bubbles.
3. E3 UI: the card is a reorderable list (React Aria `GridList` with
   `useDragAndDrop`, so keyboard and screen-reader reordering come with it;
   drag handle on touch). A line splits "on my ballot" from the rest; rank
   numbers on ranked contests. Print, export, Quick fill, focus mode and
   triage read the derived marks.
4. E4 endorsements repo: ranked endorsements carry `rank`; collation shows
   how sources rank a choice ("ranked 1st by 3").
5. Later (user, not now): strategic ranking.

### Part F — articles from publishers (2026-10-26) ← current

1. F1 research (background agent, endorsements worktree `feat-articles`):
   per publisher, an `orgs/<slug>/2026-11-03/positions.json` with
   `positions: []` and `articles`, attribution naming the publisher,
   evidence and NOTES like the endorsement scraper. Starting with the
   California propositions.
2. F2 endorsements pipeline: verify checks article subjects against the
   ballot listings like positions; the catalog index counts articles and
   takes `jurisdictions` from article subjects too (or setup never offers
   an articles-only source).
3. F3 app: setup and the catalog browser treat an articles-only source
   properly (it's not something to follow for picks; its count is
   articles).

## Findings / gotchas

- Voter's Edge (MapLight + LWV California) has shut down; LWV moved to
  VOTE411. Don't link votersedge.org.
- `voterguide.sos.ca.gov` serves only the current election's guide (Nov 3 2026
  now), with `/propositions/<n>/` and `/candidates/`. Past guides live at
  `vigarchive.sos.ca.gov`.
- Ballotpedia answers scripted requests with HTTP 202 (a bot check); the
  links work in a browser.

## Progress log

- [x] A1 collate `ballotIndex`
- [x] A2 `lib/ballotView.ts` (`ballotChoices`, `measureNote`, `splitMeasureTitle`,
  `isMarked`) + tests
- [x] A3 screen ballot look: header band, bubble = pick toggle, count beside
  it, Maybe/Against as small extra marks (no Against on measures)
- [x] A4 `PrintBallot` + `lib/printFit.ts`: SF + CD3 ballot (49 races) fits
  one page at 80%; only marked races (3) at 100%
- [x] A5 print card (whole ballot / only marked, notes, fit readout); Ctrl+P
  goes through `beforeprint` (verified: mounts, fits, unmounts after)
- [x] B1 `lib/researchLinks.ts` + tests; card "Read up" line, race page "Read
  up" card with descriptions and per-candidate links, VOTE411 in the stats row
- [x] Checks (lint with CRLF config, typecheck, 167 tests, build), README,
  verified at 1280 and iPhone 12 Pro, print layout checked on a letter-size
  mock page
- [x] A6 "Vote for one" / "Vote for no more than three" under each office
  (user, 2026-10-21), on screen and paper, with an over-vote warning.
  `voteFor` in `lib/ballotView.ts`; retention races count as yes/no
  questions (two bubbles, no line), like measures.
- [ ] Not checked: a real print dialog / paper (the preview can't open one);
  the multi-page fallback below the 62% floor (needs a no-area statewide
  ballot; logic is simple)
- [x] Port onto master `cec2113` (2026-10-25): My ballot keeps master's
  triage filters, one-at-a-time mode (number keys follow the ballot order;
  Shift+number does nothing on yes/no questions), Quick fill, write-ins,
  choice-id tags and source popovers; the bubble is the pick, Maybe/Against
  stay as small marks. Print uses every race on the ballot plus marked
  maybes, whatever the status filter. Triage counts a measure's Yes/No
  bubbles even when no source named them. Checks: typecheck, 348 tests, lint
  (only master's own pre-existing errors in `BallotTags.tsx` /
  `ballotCheck.ts`); verified at 1280 and iPhone 12 Pro; print fits one page
  at 79%.
- [ ] B2 — news per ballot item: see Part C
- [x] Security (2026-10-25, `0503c96`, pushed): zod's `.url()` accepted
  `javascript:` / `data:` URLs and React 18 runs a `javascript:` href on
  click (keys live in this origin). SPEC §3.13: links MUST be http(s);
  core `httpUrl` for slates and guides; `httpHref` for catalog links;
  negative vector `javascript-uri`. All 14,948 published links and the CA
  guide's 3,044 pass.
- [x] C1 spec + core + vectors (`6169747`), C2 app reads the fields
  (`549ca19`), C3 articles UI (`c24ec5b`), CLI passes `articles`
  (`c975975`, `86d3838`): pushed to master and live on openslate.us
  (checked the deployed chunks).
- [x] C4 endorsements repo `31f09df` (branch `feat/ballot-fields`, pushed
  to master, publish run 40263969087 succeeded): all 8 listing scripts
  write `ballot`, Newport Beach's hand-made listing too; rebuilt from
  evidence; diff proven to be only `statement` → `ballot`; published SF
  listing verified (25 ranked positions, no statements). Checked in the
  dev app with locally signed copies: "Rank up to ten choices", "Vote for
  no more than three", party · designation · incumbent, proposition
  label and type.
- [x] C5 (`a5c…` see git log, 2026-10-26): no fallbacks left. A race no
  listing covers shows its title whole and no vote-for line; measure search
  words come from place + `ballot.heading`; the export lost its BallotNote
  column.
- [x] C6 answered (Part F).
- [x] D1 endorsements `e4f288d`: `scripts/keep-unchanged.ts` after
  signing. First CI run 2026-10-26 5:56 PM PDT (00:56Z): "376 slate(s)
  unchanged since the last publish, 0 new or changed". Tested end to end
  with a throwaway key first (unchanged slate kept its token and date,
  edited one got a new one).
- [x] D2 `4bf99f6`: `lib/catalogUpdates.ts` (`staleImports`,
  `updateProblem`), `updateFromCatalog` through the import queue (new
  `kind: "update"`, `check`, `replaces`; old tokens removed after the new
  are stored), `CatalogUpdater` in App, banner copy for updates, usage
  event `catalog.update`. Verified: a local test catalog (Sierra Club
  55 → 54 positions replaced, "Updated 1 source"), then the live catalog:
  this dev profile's 5 slates from Oct 20–23 became the Oct 26 ones with
  `ballot` fields ("Updated 5 sources").
- [x] E1 spec `8b96a04`: `Position.rank` (§3.16), only with endorse /
  lean_for, needs a choice; vectors ranked / rank-on-oppose / rank-zero.
- [x] E2/E3 UI `457974a`: `lib/ranking.ts` (pure, tested),
  `RankedChoices.tsx` (React Aria GridList + useDragAndDrop; one list with
  a draggable "not ranked" line), `ChoiceRow.tsx` split out of
  MyBallotPanel. Decisions made while building (not asked):
  - the order is kept per race in `rankingStore`; marks stay in draft rows
    and are re-derived on every ranking change (top `marksFor` = endorse,
    the rest = lean_for "backups");
  - unknown vote-for count: every ranked name is marked (no guess of one);
  - the bubble moves a name into the last marked place (first in a vote-for-
    one race), so the displaced pick becomes the first backup; a filled
    bubble unranks;
  - Maybe / Against stay as marks on unranked names; on a ranked name they
    unrank it;
  - a race-wide stance ("Overall") and yes/no questions stay plain rows.
  Verified in the preview: bubble tap, backups line, keyboard drag
  (Enter on the handle, arrows, Enter: "Insert before Not ranked"),
  iPhone 12 Pro layout. **Not verified: a real mouse/touch drag** —
  Playwright's synthetic drag doesn't fire HTML5 drag events.
- [x] E3b `d47fe80`: print numbers a ranked-choice contest's bubbles and
  labels backups; Compose publishes `rank`; collation passes sources'
  `rank` to chips ("1st") and the race page.
- [ ] E4 data: endorsements repo — ranked endorsements still in
  `statement` ("Ranked-choice first choice: …", 34 files) → `rank`.
  Needs `.openslate-version` at a commit with `rank`.
- [x] F1 research (agent, endorsements `feat/articles`, 4 commits, not
  pushed): 9 newsroom slates, ~150 articles, all 14 propositions and SF
  B, D–I and RTM. Its plan: `plans/articles-2026-11-03.md` there.
- [x] F2/F3 `4d977bd`: catalog jurisdictions count article subjects;
  articles-only entries are "news coverage" (setup and updater add them for
  your area without a follow; catalog browser Add button; removed sources
  stay removed).
- [ ] F2b endorsements repo: verify-positions checks `articles` subjects
  against the listings; pin OpenSlate; publish.

## Open questions for the user

1. ~~News per ballot item~~: answered 2026-10-25 (Part C, `articles`).
2. ~~Seats as a real field~~: answered 2026-10-25 (Part C, structure in the
   spec, no parsed strings).
3. ~~Who publishes the first `articles`~~: answered 2026-10-26 (Part F).

## Findings added during the build

- The query cache is persisted (IndexedDB `keyval-store` /
  `openslate.query-cache`) with a 5-minute staleTime, so a just-published
  catalog reaches an open app on its next refetch after that, not on a
  reload within it. Fine for real use; when testing, delete that key.
- The catalog's `issued_at`, `election`, `scope` and `issuer.key` match
  every published slate's payload (checked all 376), so a stream can be
  matched from the index alone.

- Ranked choice isn't in any county's list. Sourced rules in the scripts:
  SF city offices and Supervisors rank up to 10 (sf.gov/ranked-choice-voting);
  Alameda County ranks up to 5
  (acvote.alamedacountyca.gov/voting/rcv): every Oakland contest (school
  directors too), Berkeley Mayor / Council / Auditor (not Rent Board or
  school board), San Leandro Mayor / Council, Albany Council and school
  board (multi-winner). Before this, the app printed "Vote for one" on all
  of them.
- LA's and San Diego's lists give no vote-for count, so their contests
  carry none (the app shows no line rather than guess).
- LA's measure labels are the full ballot question, often several
  sentences: long on the card and on paper.
- A dev browser profile's catalog import can be days old: races filed with
  `district` (Oct 24) only appear once the listing is re-imported.


- `title=` tooltips are banned (user's global rule: invisible on touch). The
  chips' hover text (statement, secondhand, "not followed" names) was dropped
  from My ballot; the race page shows all of it inline. Link descriptions are
  shown as text on the race page.
- The CA SoS ballot source puts the measure type ("Initiative Statute") on
  both Yes and No; `measureNote` shows it once under the title.
- Vite Fast Refresh refuses a component module that also exports functions;
  keep `fitToPage` in `lib/printFit.ts`, not in `PrintBallot.tsx`.
- Measuring: `.print-ballot.measuring` lays it out off-screen at zoom 1 with
  the print typography (pt units live outside `@media print`); printing uses
  `zoom: s` on a box `PAGE_WIDTH / s` wide, so columns reflow wider rather
  than just shrinking.

- Seat counts exist only as the SF Department of Elections source's
  "3 seats" note on each candidate (`statement`). The CA SoS source has
  none (its offices are single-seat), so: "N seats" note → N; listed by a
  ballot source → 1; no ballot source → unknown, no line (local boards are
  often multi-seat, so guessing "one" would mislead).

## Things not to do

- Don't use the `neutral` stance to carry news links: neutral is a position
  and would show up as one.
- Don't fetch anything (news, guides) to build links: privacy and the
  no-central-server rule.
- Don't parse structure out of free text (`statement`, `title`) in new code:
  the user ruled it out for the data format (2026-10-25). Add a field.
- Don't publish listings with the new fields before the app that accepts
  them is live: the schema is closed, so older verifiers reject them.
