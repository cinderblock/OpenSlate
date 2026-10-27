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
- Every position carries the guide's own term as `label` (SPEC §3.17, built
  for this in [position-labels.md](position-labels.md)); stances unchanged.

## Plan / steps

1. [x] Fetch the doc, confirm provenance, extract text.
2. [x] Write evidence file + positions.json (generator `%TEMP%\svdsa-work\build.ts`
   checks every statement is verbatim in the guide).
3. [x] meta.yaml + logo (`bun scripts/fetch-logos.ts --only dsa-silicon-valley`).
4. [x] `normalize-choices --apply` (114 ids, 0 unresolved), `verify-positions` OK,
   `bun run test` 22 pass.
5. [x] NOTES.md with review flags.
6. [x] Committed (now `6859af3` after rebasing onto origin).
7. [x] Labels + OpenSlate pin `53ad9c5` (`d45d6e2`); San Mateo County's new
   listing matched every San Mateo title and name, 21 ids added (`6176d6d`).
8. [ ] **Current:** user OKs the push (push → CI signs + publishes).

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
- [x] Rebased onto origin (was 38 behind); the 3 earlier ride-along commits
  were already upstream. Backup branch `backup/pre-rebase-svdsa-labels`.
- [ ] Push to origin/master (needs the user's OK): 3 commits, all SVDSA.

## Open questions for the user

1. OK to push? Local master is 3 ahead of origin, all SVDSA: `6859af3`
   bundle, `d45d6e2` labels + pin, `6176d6d` San Mateo ids.
2. Do the NOTES.md judgment calls look right (tiers, soft picks, blanket school measures)?
   **Resolved 2026-10-26:** all good; the user confirmed Oak Grove's "District 1" is a typo.
3. User feedback (2026-10-26): "every endorser needs to be able to use their own
   language. we cannot 'coax' a recommendation to a full yes/reject." The SPEC §3.6
   stance enum is fixed and Position (§3.4) has no field for the endorser's own
   term. Proposed: an optional `Position.label` (the endorser's wording, e.g.
   "Recommended", "Cautious recommendation") plus optional slate-level definitions
   of each label (e.g. "Endorsed: 75% chapter vote"). `stance` stays as the
   machine bucket for collating. **Resolved:** user said go ahead if existing
   configs don't break; built additively (see position-labels.md).
4. User: "we need to timestamp our scrapes and include the provenance URL." Already
   in place: `attribution.retrieved_at`, `attribution.sources`, per-position
   `source`, and the evidence header; the app shows the retrieval date. Gaps:
   `evidence/` isn't published on Pages, and nothing pins *which version* of a
   live-updating Google Doc was captured (proposed: a sha256 of the captured text,
   and/or a Wayback snapshot URL). Waiting on which of these the user wants.

## Things not to do

- Don't push without the user's go-ahead: pushing to master signs and publishes.
