# Issues

## Hosted app shows raw HTTP 404 errors for elections and ballot lookup

On https://openslate.us there is no `apps/server`, so `/api/elections` and
`/api/ballot` (`apps/web/src/lib/query.ts`, `electionsQueryOptions` and
`ballotQueryOptions`) get a plain 404 from the static-assets worker. The
queries surface that as "Elections lookup failed: HTTP 404" / "Ballot lookup
failed: HTTP 404" in Compose. Only a 501 gets the friendly "isn't configured"
message, and that message talks about `.env`, which means nothing to a visitor.
The README says the hosted mode is manual entry, so the UI should say that
instead of showing an error (or not call the endpoints when no server is
configured).

Note: `ComposePanel.tsx` and `ElectionCombobox.tsx` had uncommitted edits from
another thread on 2026-10-17; check with whoever owns them first.

## Race view finds no polls and no endorsements for catalog slates

Reproduce on https://openslate.us (or locally): Catalog → import "California
Democratic Party" 2026-11-03 → Collate → click "Governor of California". The
race page (URL `#/race/Governor%20of%20California|us%2Fca|2026-11-03`) shows:

- **Recent polls**: "No governor polls found. Tried
  `governor-of-california-us-ca-2026-11-03`." The app sent
  `/api/polls?subject=governor-of-california-us-ca-2026-11-03` (the slate's
  `subject.id`), which VoteHub doesn't know, so the result is `[]`. VoteHub keys
  subjects by a `<year> <state>` rollup; `subject=2026 California&poll_type=governor`
  through the same cache returns real polls. See `voteHubLookup` /
  `subjectToVoteHubKey` in `apps/web/src/lib/polls.ts`.
- **Endorsements**: "No endorsements imported for this subject yet", even
  though the slate that linked here is imported. The Collate group key
  (`Governor of California|us/ca|2026-11-03`) apparently doesn't match what
  RacePanel looks up (`subjectKey()` in `lib/subjects.ts`, which prefers
  `subject.id`).

So the race view is broken for every catalog slate whose subjects carry an
`id`. Not a deploy problem: the poll-cache answers both queries with 200.
