# House race pages show no polls

> Plan path: `plans/house-district-polls.md`. Read this first when resuming.
> Follows `plans/race-polls-scope.md`, which gave House races their district key.

## Goal

Fix the ISSUES.md entry "House race pages never show polls: VoteHub's subject
filter ignores districts". A House race page should list VoteHub's polls for
that district.

## Environment / context

- VoteHub adapter: `apps/web/src/lib/polls.ts` (`createVoteHubSource`,
  `pollsForKey`). `PollsPanel` fans out one TanStack query per subject key.
- Polls proxies: `apps/poll-cache` (Cloudflare Worker, `polls.openslate.us`)
  and `apps/server` (Hono). Both pass `/api/polls?…` straight through to
  `api.votehub.com/polls`.

## Findings

- 2026-10-23, against both `polls.openslate.us` and `api.votehub.com` directly:
  `?subject=2026%20CA-22`, `?subject=2026+CA-22`, `?subject=CA-22` and
  `?subject=2026%20AK-01` all return `[]`. Adding
  `&poll_type=us-representative` doesn't change that. `?subject=2025%20New%20York%20City`
  returns 11, so the filter works for other subjects; it's VoteHub's API, not
  our proxy.
- `?poll_type=us-representative` returns all 175 House polls (88 KB), each with
  `subject: "2026 CA-22"` and `seat_name: "CA-22"`. The worker serves it with
  `Cache-Control: public, max-age=900, stale-while-revalidate=3600`, so House
  pages after the first one in a session read it from the HTTP cache.

## Decisions

- Work around it in the adapter: `pollsForKey` fetches a district key
  (`<year> <ST-DD>`) as `?poll_type=us-representative` and keeps the polls whose
  `subject` is the key. The key stays the provider subject key, so the panel's
  tags and the TanStack cache key don't change. If VoteHub fixes the filter, the
  workaround still returns the same polls.
- No proxy change: the proxies stay transparent passthroughs, and a client fix
  covers both.

## Plan / steps

1. `pollsForKey`: the district branch, as above.
2. Web test stubbing `fetch`: the URL asked for, and the filtering.
3. Checks; a browser check on a House race with polls (CA-22 has 2); commit;
   close the issue.

## Progress log

- [x] Confirmed upstream behaviour; plan written; issue claimed
- [ ] Adapter change and test
- [ ] Checks and browser verification
- [ ] Commit, close the issue
