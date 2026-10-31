# Internet Archive snapshots with an archive.org key

Follows finding 9 and the "Next steps" table in `plans/signed-source-capture.md`.

## Goal

Get a recent, independent Internet Archive snapshot of every cited page before the
election on Tuesday 2026-11-03. The Archive is the one witness we don't control, so it
keeps a page checkable after the page is edited or deleted. Requests are the weak part:
anonymous ones from GitHub's addresses are throttled after about 3.

## Environment

- Code: sibling repo `cinderblock/openslate-source-captures`, `src/archive.ts`,
  `.github/workflows/archive.yml`. Commits land on `master`; the repo has no PR history.
- Worktree for this task:
  `C:\Users\camer\.t3\worktrees\openslate-source-captures\feat-archive-org-key`.
  The main checkout at `~/git/Personal Projects/openslate-source-captures` is left alone.
- Repo secrets planned: `ARCHIVE_ORG_ACCESS_KEY`, `ARCHIVE_ORG_SECRET_KEY`.

## Decisions already made (don't re-ask)

- The user supplies the account and key. Nobody signs up for anything here.
- The key is requested with `request_secret`, set as an Actions secret, and never written
  to the repo, a log or a chat.
- Snapshot by a mechanical rule, never by who a source is.
- No posts or messages to the Internet Archive.
- Hosts in `withheld-hosts.json` `personal_data_risk` are never sent to the Archive, decided by
  the user 2026-10-30. A snapshot is public, and those bytes stay private because they may
  carry personal data. The list decides, so it's mechanical. Today that's 2 pages: a Facebook
  post, and an Instagram post the Archive blocks anyway. `lookup` and `compare` still read
  snapshots others made.
- Rate: at most 4 captures a minute, a 15 s gap, against the 7 the documentation allows.

## What the primary sources say

[Save Page Now 2 API docs](https://docs.google.com/document/d/1Nsv52MvSjbLb2PCpHlat0gkzw0EvtSgpKHu4mk0MnrA/mobilebasic),
by Vangelis Banos, updated 2026-07-22. These replace the unverified "6 to 12 a minute" in
finding 9.

| Limit | Authenticated | Anonymous |
| --- | --- | --- |
| Captures per minute | 7 | 3 |
| Captures per day | 30,000 | 200 |
| Captured data per day | 5 GB | 2 GB, and elsewhere in the same table 500 MB |
| Captures of one URL per day | 5 | 5 |

- Auth: header `Authorization: LOW <access>:<secret>`, keys from
  `archive.org/account/s3.php`. Cookies also work and expire, so aren't used.
- Request: `POST https://web.archive.org/save` with `url=`, returning `{url, job_id}`.
  Options need POST, and only `1` or `on` count as on.
- `if_not_archived_within`: if a newer capture exists, SPN2 returns that one rather than
  making another. Default 1 hour. This is how we avoid redundant captures.
- Status: `POST /save/status` with `job_ids=a,b,c`. Results are kept for about an hour.
  Success carries `timestamp` and `original_url` (after redirects).
- Sessions: `GET /save/status/user` returns `{available, processing}`. No cap is published;
  the example shows 12 available.
- Quota errors: `error:user-session-limit`, `error:too-many-daily-captures`,
  `error:max-daily-bandwidth`. A page-level limit of 5 a day sits beside an error text
  that says 10, so assume 5.
- Each capture is bounded by 2 minutes. Redirects: 3 followed.
- Target-side protection is built in: over 20 concurrent captures of one host in 60 s adds
  a delay, and a 429 from a target slows that host for 60 s.

**Terms.** `archive.org/about/terms` is a JavaScript app that keeps its text in shadow DOM,
so a plain fetch, a Wayback copy and a headless `--dump-dom` all returned an empty shell. Walking
the shadow roots in a rendered page worked, on 2026-10-30. The current text is dated 31 Dec 2014,
and its footer says "last updated 12/31/2014", so the 2024 Wayback copy was already current.

- Nothing addresses automation, rate or API use. The limits are the API docs' published ones,
  and those docs invite scripted use and say to write to info@archive.org for more.
- "You agree not to interfere with the work of other users or Archive personnel, servers, or
  resources." Staying inside the published rate, and stopping on a 429, is how we honor this.
- Access is "granted for scholarship and research purposes only". Keeping public evidence for
  how endorsements were sourced fits.
- Don't "recirculate your password to other people or organizations". The key is the user's,
  used by the user's own repo, so that holds. It would stop holding if the repo gave others
  a way to use the secret.
- Users agree "(a) not to violate anyone's rights of privacy" and "(d) not to collect or store
  personal data about anyone". That's why `personal_data_risk` hosts are no longer sent.
- The Archive asks that research publications list it as a resource, and may end access at its
  discretion. It may also remove a page if the author objects, so a snapshot isn't permanent.

Archive-It is the paid route for large or recurring crawls. 980 pages a few times is well short
of that.

## Findings

Measured 2026-10-30 about 2:30 PM PDT (21:30Z), from `sources.json`, `archived.json` and
run `2026-10-30T1747Z`.

- 914 sources are 754 pages, because 175 differ only by `#fragment`. 750 are cited, 4
  discovered. 237 hosts.
- **Only 339 pages have been looked up**, so the reported "400 URLs" overstates coverage:

  | State | Pages |
  | --- | --- |
  | Never looked up | 415 |
  | Looked up, no snapshot | 87 |
  | Snapshot older than 7 days | 240 |
  | Snapshot within 7 days | 12 |

  So the known gap is 327 and the worst case is 742.
- **Time:** at 4 a minute, 742 pages take about 3 h 5 m unbroken. Real runs manage less,
  see Results.
- **Bytes:** the 754 responses total 251 MB, the largest 15 MB. Embeds add to that, but a
  pass should sit well under 5 GB a day.
- **The hourly schedule has never fired.** `archive.yml` has one run, a manual dispatch at
  10:47 AM PDT (17:47Z). The `:30` crons were due at 18:30Z, 19:30Z and 20:30Z.
  It began after the next push, see below.
- Bugs in `archive.ts` that would have hurt once snapshots flow:
  - A new snapshot replaced the old one even if it held fewer statements, so a page edited
    after we scraped it would lose its "independently archived" claim.
  - `save` marked only the first source of a page, and marked it even on failure.
  - `lookup` queried the same page once per fragment, in file order, so a page just
    captured could wait a day. A redirected page never matched, since the capture sits
    under the final URL.
  - A 400-URL lookup took 21 minutes against a 12-minute step bound.
  - `compare` refetched one snapshot for every fragment citing it.

## Rule: which page goes next

Written here and in `archive.ts`. No source is chosen for who it is.

1. Every page in `sources.json` is eligible unless it has a snapshot under 7 days old, we
   asked in the last day, it's already a Wayback link, or its host is on the
   `personal_data_risk` list.
2. Cited pages before discovered ones.
3. Pages with no known snapshot first, then oldest snapshot first.
4. Ties go by URL order.

## Results

Measured 2026-10-30 about 5:55 PM PDT (2026-10-31 00:55Z).

| | Start of this work | Now |
| --- | --- | --- |
| Pages cited | 754 | 980, after a capture at 5:03 PM PDT (00:03Z) added more |
| Pages with a snapshot under 7 days old | 12 | 246 |
| Sources compared to a snapshot | 194 | 626 |
| Sources whose snapshot holds every statement | 108 | 417 |
| `lookups.json` | 0 snapshots | snapshot `20261030214304`, marked `requested` |
| Workflow | Never ran on schedule | Fired at 3:33 PM PDT (22:33Z) |

Pages by the origin of their current snapshot: 163 `requested`, 255 `existing`, 285
unknown. Unknown is mostly records no lookup has revisited since the field was added.

| Run | Started | Mode | Result |
| --- | --- | --- | --- |
| `41131962317` | 2:33 PM PDT (21:33Z) | Anonymous | 45 captured, 1 already there, 1 failed |
| `41134616671` | 3:24 PM PDT (22:24Z) | Key | **Records lost**, see below. Snapshots stand |
| `41138931119` | 4:15 PM PDT (23:15Z) | Key | 46 captured, 28 already there, 27 failed, 12 pending |
| `41148660738` | 5:10 PM PDT (00:10Z) | Key | 94 asked in 30 minutes, 75 captured, 5 already there, 5 failed, 21 pending |

**Rate:** about 3 a minute in practice, against 7 allowed. The account's counter read 91
captures for the UTC day at 5:43 PM PDT (00:43Z), against a limit of 30,000.

**Forecast:** 734 of 980 pages lack a recent snapshot. At about 94 a run, hourly, the first
pass ends about 3 AM PDT Saturday 2026-10-31 (10:00Z). That leaves three days of margin, so
the rate stays where it is. Snapshots stay "recent" for 7 days, so nothing repeats before
the election.

## Findings from the real runs

- **The account has 3 concurrent sessions and 70,000 status calls a day.** Neither is
  documented; `/save/status/user` returned
  `{"processing":0,"available":3,"daily_captures":0,"daily_captures_limit":30000,"daily_status":0,"daily_status_limit":70000}`.
  The batch now waits for a free session, for up to 3 minutes.
- **The hourly schedule started after a push to `master`.** No schedule fired from about
  10:40 AM PDT (17:40Z) until the push at 2:33 PM PDT (21:33Z); the next `:30` fired. The
  cause wasn't established. That the push re-registered the cron is a guess.
- **A queued run loses its work.** `41134616671` waited 28 minutes behind another run and
  checked out the commit it was triggered on, not the tip, so its `archived.json` was stale
  and the commit failed: `CONFLICT (content): Merge conflict in archived.json`. Every job ID
  it held was lost. The workflow now checks out `master`, this run's results win a conflict,
  and `jq` confirms the file parses before pushing.
- **The lost run mislabelled 28 pages.** The next run asked again and heard "already
  archived", which recorded our own snapshots as `existing`. Those 28 were reset to unknown
  (`8d04c0f`), since nothing can show who caused them.
- **`save` overran 36 minutes** when sessions were busy, and was killed before reporting. It
  now stops asking after 30 minutes.
- **Anonymous was not as weak as reported.** It made 47 requests in 36 minutes with no 429.
  The "throttled after about 3" result from the first run did not recur. Each anonymous
  request blocks for about 45 s, which is the practical limit. The key's gains are a job ID,
  so the Archive says what it did, and the 30,000-a-day allowance.
- **Save Page Now queues.** Jobs ran about 8 minutes behind our requests, beyond the 3-minute
  wait at the end of a run, so the last ~20 of each run stay `pending` until the next run
  collects them. Any older than 2 hours become `status-expired`, and origin stays unknown.
- **Failures so far:**

  | Reason | Pages | Meaning |
  | --- | --- | --- |
  | `error:too-many-daily-captures` | 22 | Mostly images and files, no snapshot yet. Retried after a day |
  | `error:no-request` | 7 | The Archive couldn't reach the page. Retried after a day |
  | `200` with no job | 2 | Not a failure: the Archive had a recent copy, see below |
  | `error:blocked-url` | 1 | Instagram, on Mozilla's tracker list. Won't succeed |

- `lookup` hit a 429 from the CDX API after 150 pages in the last run, and stopped as designed.
  Lookups are behind `save`, which doesn't depend on them.

## The 200 with no job

Run `41148660738` recorded `error: "200"` for `sfbg.com/2026/10/06/endorsements-for-the-november-3-2026-election/`
and `sfchronicle.com/projects/2026/california-sf-election-endorsements/`. Run `41155118921`,
dispatched 2026-10-30 at 6:23 PM PDT (2026-10-31 01:23Z), asked for those two again with the
reply logged. It spent no captures: the account's counter stayed at 91.

- **One cause, and neither a refusal nor a block.** Both replies were 200 with `"job_id":null` and:

  > The same snapshot had been made 127 hours, 1 minute ago. You can make new capture of this URL after 168 hours.

  The other page's said 167 hours, 47 minutes. 168 hours is the 7 days we send as
  `if_not_archived_within`, so this is that option working. The SPN2 documentation says a newer
  capture is returned instead of a new one, but doesn't describe this reply. There's no job, and
  the logged part of the reply shows no timestamp (the quote stops at 200 characters).
- **Why they were asked at all.** Neither page had a record yet: both arrived with the capture
  at 5:03 PM PDT (00:03Z), and `save` runs before `lookup`, so the queue saw no snapshot. Any new
  page with a copy under 7 days old can do the same.
- **Both pages can be snapshotted.** CDX shows five recent rows for each, the newest 200s at
  `20261025182210` (sfbg) and `20261025182322` (sfchronicle), and `compare` found 42 of 42 and
  61 of 65 statements. The Archive isn't refusing them.
- **Only these two.** No other record in `archived.json` had `error: "200"`.
- **Five other pages took the documented route.** `crimevictimsunited.com` pages inside the window
  got a job, then a status naming a snapshot about 15 minutes old. What decides between the
  two routes is unknown.
- **The sfchronicle reply doesn't match the newest CDX row.** 167 hours, 47 minutes before the reply
  is about 6:37 PM PDT on 10-23 (10-24 01:37Z), not the 10-25 row. The nearest row is
  `20261024013559`. Why the Archive measured from that one is unknown.
- **They don't retry daily.** Once `lookup` records a snapshot under 7 days old, `saveQueue` skips
  the page. sfbg and sfchronicle become eligible at 10:22 and 10:23 AM PST on Sunday 2026-11-01
  (18:22Z and 18:23Z), so the 10:30 AM PST (18:30Z) run asks, if the schedule fires.

Changes in `openslate-source-captures`:

- `d1933df`: a reply with no job records its message, or `no-job: HTTP <status>`, and logs at most
  200 characters with the key removed. `save --only` and the workflow's `only` input replace the
  queue for one manual run. Nothing scheduled uses them.
- `8cafb88`: a message starting `The same snapshot had been made ` is recorded as
  `already-archived`, and `lookup` is sent to find the snapshot. The rule looks at the reply text
  alone, never the source. If the Archive rewords it, the page falls back to a `failed` record
  quoting the new text.

`archived.json` still shows these two as `failed` with the Archive's message, written by the run
before `8cafb88`. The next request replaces those records.

## Plan

1. [x] Primary-source research.
2. [x] Size the gap.
3. [x] Change `archive.ts` and `archive.yml`, with tests (`6868b7c`, `7290c2f`, `a002a41`, `8d04c0f`,
   `6b095f3`, `d1933df`, `8cafb88`).
4. [x] Anonymous path checked in CI.
5. [x] The user supplied the key; Actions secrets set 2:55 PM PDT (21:55Z). Temporary files
   deleted; the key was never printed and the logs show `***`.
6. [x] Ran for real.
7. [ ] **Current, automatic:** hourly runs finish the first pass.

## Things not to do

- Don't exceed 4 a minute, or retry past a 429 or a quota error. They end the batch.
- Don't use `capture_outlinks`: it spends others' capacity on pages nobody cited.
- Don't print request headers, or anything else holding the key.
- Don't count a snapshot as ours because it's recent. Only a job naming that timestamp is.
- Don't let a newer snapshot erase an older one that held more statements.
- Don't hand-edit `archived.json` while a run is active: that run's results win.

## Open questions for the user

None.
