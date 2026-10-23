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

- **The app persists its query cache to IndexedDB** (`apps/web/src/lib/query.ts`,
  15-minute `staleTime` for polls), so a browser that visited a House page
  before the fix keeps showing "No representative polls found" until that
  entry goes stale. That's fine for visitors (it heals itself in 15 minutes).
  To check by hand, invalidate from the page:
  `(await import('/src/lib/query.ts')).queryClient.invalidateQueries({ queryKey: ['polls'] })`.
- **`performance.getEntriesByType('resource')` is useless for checking fetches
  in `vite` dev:** module loads fill the 250-entry buffer, so the polls request
  never shows up.
- **A race link opened in a profile without that race's slate** (e.g. fresh
  incognito) doesn't resolve: the heading is the raw route key and there's no
  jurisdiction, so no polls. Pre-existing; logged in ISSUES.md.

## Progress log

- [x] Confirmed upstream behaviour; plan written; issue claimed (`5f83ab2`)
- [x] Adapter change, plus tests in `apps/web/test/polls.test.ts` (fetch stubbed)
- [x] Checks: `bun test` (414 pass), typecheck (5/5), Biome on the touched
      files
- [x] Browser check, 2026-10-23 (dev server with live polls): CA-22's
      page lists its 2 polls (Tulchin Research 2026-06-21, Public Policy Polling
      2025-08-08)
- [x] Committed; ISSUES.md entry closed
