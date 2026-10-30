# Ballot alignment: which endorsers agree with my picks

`plans/ballot-alignment.md`

## Goal

From the voter's picks on My ballot, live as they fill it in, rank endorsers by
how much they agree with the voter, across the **whole catalog** and not only
followed sources ("who should I be following that I'm not?"). The user's words:

> As a ballot is getting completed (or once finished), we can also compare a
> ballot to different endorsers and see which endorsers we're most aligned it
> (and most anti-aligned with). And maybe even most "orthogonal"? (the most
> mixed? or clearly looking at a different axis that what this voter cares
> about)

The election is Tuesday 2026-11-03, so it's most useful if it ships before then.

## Environment / context

- Web app `apps/web`. Branch `feat/ballot-alignment`, worktree
  `~/.t3/worktrees/OpenSlate/feat-ballot-alignment`. Merging to master deploys
  to openslate.us: list `origin/master..HEAD` first, never force-push.
- Hard constraint: no central server. Picks stay in the browser. The only
  request this feature makes is the same public `bundle.json` for every visitor.
  Usage events can't carry a choice, org, race or jurisdiction.
- Draft marks: `lib/ballotDraft.ts`, keyed `election|subjectKey|choice`. My
  ballot's buttons: Pick = `endorse`, Maybe = `lean_for`, Against = `oppose`
  (`lib/triage.ts`). A ranked name past the ballot's marks is a backup, kept as
  `lean_for` (`lib/ranking.ts`).
- Catalog as of 2026-10-30: 390 entries, 360 November, 9 of those election
  authorities, 358 distinct entities. `bundle.json` 9.9 MB raw, 1.5 MB gzipped.
  13,964 November positions: endorse 10,007, neutral 3,000 (nearly all ballot
  listings), lean_for 732, abstain 184, oppose 37, lean_against 4. 158 labelled,
  28 ranked. 12,239 carry `choice_id`.
- Other threads: `feat/adopts-expansion` (parent; adds `adopts` to the web app's
  collation, use its helper when it lands), `feat/any-race-all-slates` ("see
  all slates for this item", race lookup; don't overlap).

## Decisions already made (don't re-ask)

From the task brief:

- Compare against the whole catalog; a one-click follow from the result.
- Election-authority listings aren't endorsers; exclude them.
- Fetch the bundle on demand, when the voter asks. No picks ever leave.
- Kit controls only. New routes go in `ROUTE_TEMPLATES`.

Decided in this thread, with the reason:

- **Each race counts once**, however many seats it has, and the score is a
  plain "agreed on X of Y races" a voter can check by hand. No weighting by how
  rare a position is: explainability beats a cleverer number.
- **Two picks conflict only if they can't both fit on one ballot.** With `k`
  seats, `conflicts = clamp(|V ∪ O| − k, 0, min(|V \ O|, |O \ V|))`, where V is
  what the voter backs and O what the endorser backs. See Scoring.
- **A race where the two simply don't collide isn't evidence.** It's reported
  ("both fit on one ballot"), not scored.
- **Neutral and abstain are not disagreement.** They're reported as "declined".
- **A voter's Maybe, or a conflict resting on a guessed seat count, counts half.**
  An endorser's lean counts in full: it's still what they recommend, and halving
  it made "agreed on 14 of 24" show as 48% (DSA SF, whose "recommended" tier is
  `lean_for`). Counts are what the voter sees; the weights only move the rank.
- **Rank with a Wilson bound**, and always show the raw count beside it.
- **"Orthogonal" is two different things, so it's two groups** (see below).
- **Republished lists fold, they aren't scored away.** An adopter does hold the
  positions (SPEC §3.10), so its own score counts them, but it's listed under
  the org it repeats and takes no slot of its own. Endorsers with an identical
  record on the voter's races fold onto one row the same way.

## Scoring (what's meant to be built)

Unit: a race both sides took a position on.

| Race | Agreement | Disagreement |
| --- | --- | --- |
| Yes/No, or two names on the ballot | same side | other side |
| Vote for `k` | names in common | names that can't share a ballot (rule above) |
| Ranked choice | same first choice = 1; same names in another order = ½ | no names in common |
| Any | both against the same name | one backs what the other opposes |

Each race scores `agreements / (agreements + conflicts)`, 0 to 1.

Seats: `vote_for` when a listing says. A two-name ballot is 1. Otherwise (66% of
office races have no `vote_for`) the most names any one source backs there, and
a conflict resting on that guess counts half. The voter's own count needn't
raise it: when they fill the guessed seats the clamp gives the same answer.

## Plan / steps

1. [ ] **Current:** pure scoring in `lib/alignment.ts`, tests, tried on
   simulated voters against the real catalog.
2. [ ] Data: load, verify and cache the catalog for the election off the main
   thread.
3. [ ] UI: `/compare` page, live strip on My ballot, one-click follow.
4. [ ] README, checks, browser pass (desktop, phone), merge.

## Findings / gotchas

- **Seat counts are mostly unknown:** of 1,567 November office races, 1,035 have
  no `vote_for`; 118 of those have an org backing 2+ names (West Hollywood City
  Council: 4). The spec forbids reading a seat count out of a title (§3.14).
- **Verifying is the slow part:** `verifySlate` averages 21 ms per slate in Bun
  (zod plus noble ed25519), about 7.5 s for the election on one thread, more on
  a phone. It has to be off the main thread and cached.
- **The TanStack Query cache is the wrong place for it:** the whole client is
  persisted on every change, so a few MB of slates would slow everything.
- **Most agreement isn't copying:** 258 pairs of orgs share ≥90% of the smaller
  one's picks, nearly all of it ideology (ACLU SoCal matches 40 Democratic and
  labor groups). So undeclared copying can't be inferred from similarity, and
  the app must not claim it. Identical records fold with neutral wording.
- **Catalog drift is gone for November:** no title sits under two jurisdictions.
- 113 office and 126 measure positions are neutral/abstain on the race as a
  whole; no endorser has a whole-race `endorse` on an office.

## Progress log

- [x] Read the plans, collation, ballot view, ranking and the SPEC sections.
- [x] Profiled the live catalog.

## Open questions for the user

(none yet)

## Things not to do

- Don't send picks anywhere, or add a usage event with a choice, org or race.
- Don't parse seat counts, parties or ranks out of titles or statements (§3.14).
- Don't say two orgs copied each other unless an `adopts` says so.
- Don't count a neutral or abstain as disagreement.
- Don't put catalog slates in the persisted query cache.
