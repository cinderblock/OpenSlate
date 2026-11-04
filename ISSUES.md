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

## The archive workflow's hourly schedule skips slots

Seen 2026-10-30, about 8:50 PM PDT (2026-10-31 03:50Z), in `gh run list` for
`openslate-source-captures`. `archive.yml` has fired on schedule at 3:33 PM and 7:37 PM PDT
(22:33Z, 02:37Z). The 4:30, 5:30 and 6:30 PM PDT slots (23:30Z, 00:30Z, 01:30Z) left no run, each
falling inside another run. The 8:30 PM PDT slot (03:30Z) had none 18 minutes later, with nothing
running. `plans/archive-org-snapshots.md` forecasts the first pass from hourly runs.

## June primary slates quote nothing and cite nothing

Seen 2026-11-03 in `openslate-public-endorsements`. `orgs/courage-california/2026-06-02`,
`orgs/la-forward/2026-06-02` and `orgs/reform-california/2026-06-02` have no `evidence/` and no
`source` on any position (17, 36 and 27). Five of their statements are the researcher's own words
("Dual endorsement with Chad Bianco.", "Recommended to block Spencer Pratt."). `verify-positions`
requires a source, and checks quoting, only in bundles with evidence, so these pass.

Why it matters: a statement with no source can't be checked or read in full, which is what
`plans/statement-truncation.md` set out to rule out. The election is past, but the slates are
still published.

## Statements the quoting check can't see

Seen 2026-11-03: `verify-positions` with the private store reports 1,345 statements "not found in
the evidence text". Without it (CI), saved news pages are skipped, and it's 1,829. The
whole-passage check (`scripts/lib/quote-bounds.ts`) only judges quotes it can find, so a cut quote
whose words differ slightly from the evidence (a typo, a different capture, a paraphrase in quotation
marks) isn't checked. Neither is a hard wrap just before a capitalised word in unfenced evidence
(`scripts/lib/evidence-text.ts`).

Why it matters: these are the gaps left in "a statement can't cut its source short". Listing the
not-found statements per bundle, as `review/unanchored.md` does for anchoring, would show which
are quotes.
