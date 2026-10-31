# Issues

## Cited endorsement sources already gone, or answering a bot page

Seen 2026-10-30, about 3:15 AM PDT (10:15Z), by `experiments/signed-source-capture/03-survey-hosts.ts`
(one GET, honest user agent; full results in that directory's `results/host-survey.json`). These are
URLs cited in `openslate-public-endorsements`, whose slates are live:

- 404 from two clients: `cragop.org/2026/03/21/california-republican-assembly-june-2026-primary-election-endorsements/`
  (94 positions), `sfgop.org/nov-2026-endorsements` (25), `sfyimby.org/endorsements/2026-primary-election/` (10).
- 404 from one client, the second failed to connect: `oaklandrisingaction.org/homepage/2026-oakland-progressive-voter-guide/`
  (20), `www.peaceandfreedom.us/index.php/news/elections-campaigns/november-2026-voting-guide` (22).
- 403: `www.nfib.com`, `www.plannedparenthoodaction.org`.
- 200 with a 212-byte body instead of the page: `www.sierraclub.org`.

Why it matters: a voter following `source` finds nothing, or a different page. Four of the five
404s have Wayback copies, so `source` could fall back to them. A 403 or a stub may be aimed at
scripts only.

## The publish workflows write the signing key to the runner's disk

`openslate-public-endorsements/.github/workflows/publish.yml`, step "Stage signing key from secret",
writes `OPENSLATE_SIGNING_KEY` to `$RUNNER_TEMP/signing/key.json` so `sign --key` can read it. The
project rule is that the key never touches disk, and `sign` only accepts a path today. The runner is
ephemeral, so this is lower risk than it sounds, but the rule and the workflow disagree. The ballot
repo's `publish.yml` does the same with `OPENSLATE_GUIDE_SIGNING_KEY`.

## The catalog files many parties and papers as plain `organization`

Seen 2026-10-30 in `bundle.json`: 339 of 390 entries say
`attribution.of.kind: "organization"`, among them dozens of county parties
("Alameda County Democratic Party", "Republican Party of Orange County"),
editorial boards ("Los Angeles Times Editorial Board") and papers ("The Press
Democrat", "Marin Independent Journal", "San Mateo Daily Journal"). The web app
works around it with name rules in `apps/web/src/lib/raceTally.ts`
(`sourceGroup`), but a paper with no "editorial board" in its name lands in
*Other groups* on All slates, and the rules are a guess at what the data should
say. Fix it in `openslate-public-endorsements`, where each org is scraped.

## The catalog copy verifies on the page, and workers would halve the wait

Seen 2026-10-30 building Compare. `createCatalogLoader` (`lib/catalogCopy.ts`)
checks every signature on the main thread in 12 ms slices. In a production worker
on a 12-core desktop, 349 slates took 4.3 s on 1 thread, 1.9 s on 4 and 1.5 s on 8,
and a phone is several times slower. It's once per catalog version, but it's the
first thing a voter waits for on Compare and All races. A worked version of the
pool is on the local branch `ballot-alignment-worker-pipeline`
(`lib/comparison.ts` `verifyAll`). A worker can't import `collate.ts` today:
`subjects.ts` pulls in React and the database, so `subjectKey` needs its own file.

## Save Page Now replies 200 with no job for two news pages (in progress — fix/spn-no-job-news-pages)

Seen 2026-10-30, about 5:35 PM PDT (00:35Z), archive run `41148660738`: `POST /save` answered 200
with no `job_id` or `status_ext`, so `archive.ts` recorded `error: "200"`. Pages:
`sfbg.com/2026/10/06/endorsements-for-the-november-3-2026-election/` and
`sfchronicle.com/projects/2026/california-sf-election-endorsements/`. The reply body isn't logged.
They retry daily, but without a reason recorded nobody can tell if those two can ever get a snapshot.
