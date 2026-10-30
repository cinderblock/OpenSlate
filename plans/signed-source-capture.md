# Provable raw-source capture for endorsement scraping

`plans/signed-source-capture.md`

## Goal

User request (2026-10-30): when scraping endorsement data, save the raw thing
the server served, plus enough proof that anyone can later show it came from
the group we summarised, even if that group's site goes offline. Smallest
verifiable unit: "here is the raw text we took in, it gets you to the same
slate we computed, and here is proof it came from them." Objectivity is the top
requirement.

This is an **exploration**: research, spikes and a recommendation. No changes
to the scrapers or the published catalog. The user decides what gets built.

Status: started 2026-10-30.

## Environment / context

- Worktree: `explore-signed-source-capture` branch, from `origin/master`.
- Spike code lives in `experiments/signed-source-capture/`.
- Sibling repos (read only): `openslate-public-endorsements`,
  `openslate-ballot-ca-2026-11-03`.
- Must run on Windows without WSL and on GitHub Actions (Linux), with Bun.

## Progress log

- [ ] Read the pipeline (scrapers, schema, skill, CI, evidence layout)
- [ ] Forgery spike
- [ ] Research the options
- [ ] Spikes for the most promising rungs
- [ ] Recommendation and next steps
