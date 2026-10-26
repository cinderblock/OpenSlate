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

### Part B2 — curated news per ballot item (needs the user's decision) ← current

Not started. Proposal, see Open questions 1.

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
- [ ] C — structured ballot fields and attached articles in the spec

## Open questions for the user

1. **News coverage per ballot item.** Recommendation: a new signed document
   type, a *reading list* (`openslate-reading+jws`, or an optional
   `readings` array in a slate), where a curator signs links per subject:
   `{ subject, uri, title, publisher, published_at, kind: news | analysis |
   guide | official }`. It is not a position, so it never counts as an
   endorsement. The public-endorsements repo (or anyone) publishes them; the
   app imports and follows curators like sources and shows the links under
   each race. Alternatives: (b) a live news search through a project Worker
   (unvetted results, and a server sees which races people look at), or
   (c) only the Google News search link from B1 (already done, no curation).

## Findings added during the build

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

## Open questions (continued)

2. **Seats as a real field.** `voteFor` parses "N seats" out of the ballot
   source's free-text note. Cleaner: an optional `Subject.seats` (or
   `vote_for`) in SPEC §3.3, written by the ballot-source scripts in the
   public-endorsements repo. Needs a spec change (the schema is strict, so
   older verifiers would reject slates carrying it). Recommendation: do it
   together with any other v1 schema additions (e.g. B2's reading list), not
   on its own.

## Things not to do

- Don't use the `neutral` stance to carry news links: neutral is a position
  and would show up as one.
- Don't fetch anything (news, guides) to build links: privacy and the
  no-central-server rule.
