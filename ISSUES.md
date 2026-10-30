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
