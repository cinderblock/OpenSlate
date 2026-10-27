# Silicon Valley DSA endorsements bundle (2026-11-03)

## Goal

Add Silicon Valley DSA's 2026 general election voter guide to the public
endorsements catalog as `orgs/dsa-silicon-valley/2026-11-03/` in
`openslate-public-endorsements`, so voters who load the catalog can follow
SVDSA's picks. The user is a member of the chapter and asked for it.

## Environment / context

- Target repo: `C:\Users\camer\git\Personal Projects\openslate-public-endorsements`
  (branch `master`, signing happens in CI on push; no local key).
- Source: <https://docs.google.com/document/d/e/2PACX-1vQAtAN3xtKSl7Pkx34nNpJyypPlm_Zga45PZHEYVk6jNpwxcp0GDBFrLsU9wjTjliya6ZP0OrMkljEt/pub>
  (a published Google Doc, "Updated automatically every 5 minutes"), linked from
  <https://siliconvalleydsa.org/voters-guide/>.
- Ballot authorities covering the guide's races: `ca-secretary-of-state`,
  `santa-clara-registrar-of-voters`, `alameda-registrar-of-voters` (Fremont,
  Newark, Union City). San Mateo County items (East Palo Alto, Menlo Park,
  Redwood City, county measures, Sequoia UHSD, Menlo Park City SD) have no
  authority; matched to other orgs' subjects by eye.
- Scratch files: `%TEMP%\svdsa-fetch\` (raw HTML + text), `%TEMP%\svdsa-work\`.

## Decisions already made (don't re-ask)

- Org slug `dsa-silicon-valley` (matches `dsa-san-francisco` etc.).
- Two tiers, as the guide itself defines them: "Silicon Valley DSA endorses" →
  `endorse`; "We recommend" → `lean_for` (same rule DSA SF's bundle uses).
- "No recommendation" / "we recommend no candidate" → `abstain`, no choice
  (DSA SF precedent). Prop 5 "We are neutral" → `neutral`.

## Plan / steps

1. [x] Fetch the doc, confirm provenance, extract text.
2. [x] Write evidence file + positions.json (generator `%TEMP%\svdsa-work\build.ts`
   checks every statement is verbatim in the guide).
3. [x] meta.yaml + logo (`bun scripts/fetch-logos.ts --only dsa-silicon-valley`).
4. [x] `normalize-choices --apply` (114 ids, 0 unresolved), `verify-positions` OK,
   `bun run test` 22 pass.
5. [x] NOTES.md with review flags.
6. [x] Committed `4473dda` in openslate-public-endorsements (local master).
7. [ ] **Current:** user reviews NOTES.md flags, then OKs the push (push → CI signs + publishes).

## Findings / gotchas

- `python -I` ignores `PYTHONIOENCODING`; on Windows stdout came out cp1252.
  Write files from Python with an explicit `encoding='utf-8'` instead.
- The doc's CSS defines a strikethrough class (`.c23`), but no element uses it,
  so nothing in the guide is crossed out.
- Guide vs ballot: Oak Grove "District 1" Victor Ramirez is on the ballot in
  Trustee Area 2. "Mer Nunez" is "Mer Curry Nuñez" on the ballot.
- `openslate validate` rejects unsigned sign-input bundles (wants `v`, `issuer`,
  `issued_at`). Already logged in OpenSlate `ISSUES.md`; `verify-positions.ts`
  does the schema check instead.
- San Mateo County has no authority bundle. Its Roster of Candidates PDF
  (smcacre.gov `52_candidateroster0903.pdf`) confirmed the San Mateo names.
- `verify-positions.ts` exits 1 because of another thread's untracked
  `orgs/sd-green-party/` (missing choice_ids), not ours. Left alone.
- The catalog's East Palo Alto Measure O title says "(Bond Measure)", but SVDSA
  describes it as a 1.5% tax on landlords of 5+ units.

## Progress log

- [x] Confirmed SVDSA absent from every branch of the endorsements repo.
- [x] Fetched guide 2026-10-26 7:30 PM PDT (2026-10-27 02:30Z).
- [x] Bundle built and committed: 158 positions (5 endorse, 122 lean_for,
  4 lean_against, 26 abstain, 1 neutral).
- [ ] Push to origin/master (needs the user's OK; carries 3 earlier local commits).

## Open questions for the user

1. OK to push? Local master is 4 ahead of origin: this commit plus 3 earlier ones
   (cde383b logo_background, 25955d8 bundle.json in index.json, e90825e logos).
2. Do the NOTES.md judgment calls look right (tiers, soft picks, blanket school measures)?

## Things not to do

- Don't push without the user's go-ahead: pushing to master signs and publishes.
