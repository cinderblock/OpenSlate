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
- Rate: 4 captures a minute, a 15 s gap, against the 7 the documentation allows.

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

**Terms.** `archive.org/about/terms` is now a JavaScript app. A plain fetch, a Wayback
copy from 2026-10-22 and a headless dump all returned the empty shell, so the current text
was **not read**. The latest readable copy is a Wayback snapshot from 2024-01-01 of terms
dated 31 Dec 2014. It says not to "interfere with the work of other users or Archive
personnel, servers, or resources", not to recirculate a password, and that the Archive may
end access at its discretion. Nothing in it addresses automation, and the API docs invite
it: they publish the rates and say to contact info@archive.org for more. Scheduled use
inside the published limits fits both. Archive-It is the paid route for large or recurring
crawls; 754 pages a few times is nowhere near that.

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
- **Time:** at 4 a minute, 742 pages take about 3 h 5 m, and 754 about 3 h 10 m. Three full
  passes fit before polls open.
- **Bytes:** the 754 responses total 251 MB, the largest 15 MB. Embeds add to that, but a
  pass should sit well under 5 GB a day.
- **The hourly schedule has never fired.** `archive.yml` has one run, a manual dispatch at
  10:47 AM PDT (17:47Z). The `:30` crons were due at 18:30Z, 19:30Z and 20:30Z.
  Unexplained so far; bigger than the rate limit.
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

1. Every page in `sources.json` is eligible unless it has a snapshot under 7 days old, or
   we asked in the last day.
2. Cited pages before discovered ones.
3. Pages with no known snapshot first, then oldest snapshot first.
4. Ties go by URL order.

## Plan

1. [x] Primary-source research.
2. [x] Size the gap.
3. [ ] **Current:** change `archive.ts` and `archive.yml`, with tests, behind an unset secret.
4. [ ] Push, and check the anonymous path still works in CI.
5. [ ] The user supplies the key; set the Actions secrets.
6. [ ] Run it for real and report the numbers.

## Things not to do

- Don't exceed 4 a minute, or retry past a 429 or a quota error. They end the batch.
- Don't use `capture_outlinks`: it spends others' capacity on pages nobody cited.
- Don't print request headers, or anything else holding the key.
- Don't count a snapshot as ours because it's recent. Only a job naming that timestamp is.
- Don't let a newer snapshot erase an older one that held more statements.

## Open questions for the user

None yet.
