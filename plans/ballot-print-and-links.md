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
  `feat/ballot-print`, from `master` at `4739b5e`.
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
- Endorsement counts are followed sources only, same as the rest of My ballot.

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

### Part B2 — curated news per ballot item (needs the user's decision)

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

- [ ] A1 collate `ballotIndex`
- [ ] A2 `ballotView.ts` + tests
- [ ] A3 screen ballot look
- [ ] A4 `PrintBallot` + fit-to-page
- [ ] A5 print options card
- [ ] B1 `researchLinks.ts` + tests, wired into card, race page, toolbar
- [ ] Checks, README, verify in the browser (screen + print preview)
- [ ] B2 — waiting on the user

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

## Things not to do

- Don't use the `neutral` stance to carry news links: neutral is a position
  and would show up as one.
- Don't fetch anything (news, guides) to build links: privacy and the
  no-central-server rule.
