# OpenSlate Public Endorsements — parallel repo

`plans/openslate-public-endorsements.md`

## Goal

Stand up a separate git repo that holds publicly-attributed endorsement blocks
created on behalf of well-known organizations. The repo signs slates in CI and
publishes them to GitHub Pages so the main OpenSlate web app can import them
by stable URL.

These are **secondhand reports** — the slate's issuer is the project ("OpenSlate
Public Endorsements"), and every slate populates the `attribution` field
pointing to the actual organization (`attribution.of`).

## Environment / context

- Host machine: Windows, Personal Projects directory at
  `C:\Users\camer\git\Personal Projects\`.
- Parent project: `OpenSlate/` (this repo). Provides the `@openslate/cli`
  tool with `sign --batch <dir>` that already walks
  `<dir>/orgs/<slug>/<election>/positions.json` and emits `signed.slate` +
  `index.json`. We use it as-is, no fork.
- New repo: `openslate-public-endorsements/` (sibling of OpenSlate).
- Likely GitHub remote: `github.com/cinderblock/openslate-public-endorsements`
  (mirrors `github.com/cinderblock/openslate@master`).
- Likely Pages URL: `https://cinderblock.github.io/openslate-public-endorsements/`.

## Decisions already made (don't re-ask)

1. **Repo name & location**: `openslate-public-endorsements/`, sibling of
   OpenSlate.
2. **Signing identity**: single project key ("OpenSlate Public Endorsements",
   `kind: researcher`). Private key lives ONLY in GitHub Actions secrets —
   never on a contributor laptop.
3. **CI-only signing**: PRs are schema-validated but unsigned. Pushes to
   master sign + publish.
4. **Distribution**: GitHub Pages, deployed by Actions (modern
   `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`,
   no `gh-pages` branch).
5. **Source of truth**: human-editable `orgs/<slug>/<election>/positions.json`.
   Signed `.slate` files are build artifacts — not committed to git, only to
   the published site.
6. **Worked example**: League of Women Voters, marked clearly as
   researcher-inferred, with real cited sources.

## Layout (new repo)

```
openslate-public-endorsements/
├── README.md                       # explains the project, attribution model, import URLs
├── LICENSE                         # MIT, matching OpenSlate
├── .gitignore                      # ignore dist/, node_modules/, any *.key
├── package.json                    # depends on @openslate/cli (GitHub URL)
├── keys/
│   └── project-public.json         # { publicKey: "ed25519:..." } — committed
├── well-known/
│   └── openslate.json              # served as /.well-known/openslate.json
├── orgs/
│   └── league-of-women-voters/
│       ├── meta.yaml               # display name, uri, kind
│       └── 2026/
│           └── positions.json      # source of truth — what we sign
├── scripts/
│   ├── verify-positions.ts         # schema-validate every positions.json (PR check)
│   └── build-site.ts               # assemble dist/ after sign --batch
└── .github/
    └── workflows/
        ├── verify.yml              # PR: schema check
        └── publish.yml             # master: sign + build + deploy
```

The `orgs/` layout matches what `openslate sign --batch` already expects.

## CI flow

### `verify.yml` (PR)
1. `bun install`
2. `bun scripts/verify-positions.ts` — for each `orgs/*/*/positions.json`,
   wrap it into a full `SlatePayload` and run `slatePayloadSchema.safeParse`.

### `publish.yml` (push to master, manual `workflow_dispatch`)
1. `bun install`
2. Write `$OPENSLATE_SIGNING_KEY` (full identity JSON from secret) to a
   tmpfile.
3. `bun openslate sign --batch . --key <tmpfile> --force`
4. `bun scripts/build-site.ts` — assemble `dist/` from `orgs/` + signed
   slates + `index.json` + `keys/` + `well-known/` + a generated
   `index.html` listing every slate with its import URL.
5. `actions/configure-pages` → `actions/upload-pages-artifact` (path
   `dist/`) → `actions/deploy-pages`.

## Import URL pattern (for main app)

```
https://cinderblock.github.io/openslate-public-endorsements/orgs/<slug>/<election>/signed.slate
https://cinderblock.github.io/openslate-public-endorsements/index.json
```

The catalog (`index.json`) is what the main web app can fetch to discover
available slates.

## Findings / gotchas

- `openslate sign --batch` skips bundles whose `signed.slate` already exists
  unless `--force`. CI must pass `--force` because the previous build's
  artifacts won't be present anyway (we don't commit them) — but the flag
  is cheap insurance if someone ever commits one by accident.
- The CLI's batch mode writes `signed.slate` **inside the orgs/ tree** next
  to the input, AND writes `index.json` at the batch-root directory (i.e.
  the new repo's top level, not under `orgs/`). The build-site script
  reads `./index.json`, copies it to `dist/index.json`, and assembles
  `dist/orgs/` from the source tree (which already has signed.slate next
  to each positions.json from the batch step).
- The CLI reads the identity from a JSON file at a path. CI must write the
  secret to a tmpfile (e.g. `$RUNNER_TEMP/signing/key.json`) and never
  echo it. Don't try to pipe via stdin — the CLI's `--key` only takes a
  path.
- The npm packages `@openslate/cli` and `@openslate/core` are not
  published. CI clones OpenSlate at a pinned ref (`.openslate-version`)
  into a `.openslate/` directory and runs the CLI from source via
  `bun .openslate/packages/cli/src/index.ts`. Local dev mirrors via
  `bun scripts/fetch-openslate.ts`.
- **Pinned ref must exist on GitHub.** Local OpenSlate is 24 commits ahead
  of `origin/master` at the time of writing (everything from `9ecd22c
  Add interop kit + research bot plan doc` through `eae2dc7 plan: mark
  Part 2 (research bot) complete`). Until the user pushes OpenSlate, the
  new repo's CI cannot resolve the pinned ref and will fail at the clone
  step. Flagged in the user setup instructions.
- LWV is famously nonpartisan — they don't endorse candidates. The worked
  example uses three of their long-standing public policy stances
  (federal voting-rights legislation, independent redistricting commissions,
  DC statehood), marked `mode: "inferred"` with `sources` pointing at
  lwv.org pages, and `statement` text explicitly labeled "Researcher
  summary of...".
- OpenSlate already ships a `research-bot/` workspace AND an
  `endorsement-scraper` Claude skill that produce bundles in the
  *exact* `orgs/<slug>/<election>/positions.json` layout we adopt here.
  The new repo's README references both; future contributions can be
  produced via the skill and then committed verbatim.
- The new repo will live as a sibling of OpenSlate; the `.openslate/`
  junction created during local testing is gitignored. The user can
  recreate it any time with `bun scripts/fetch-openslate.ts`.

## Open questions for user

1. **Custom domain**? Defaulting to `cinderblock.github.io/...`. If a
   domain is preferred later, swap the CNAME + update `well-known/`.
2. **Main-app integration**: Should OpenSlate's web app auto-fetch
   `index.json` from the Pages URL, or should users paste individual
   slate URLs? Out of scope for this initial setup — flag for follow-up.

## Things not to do

- Don't commit `signed.slate` files. Source of truth is `positions.json`.
- Don't put the private key on disk (no local `.key` file). Only place:
  GitHub Actions secret.
- Don't `git init -b master` — respect git's configured default branch
  (per global feedback memory).
- Don't put words in real orgs' mouths. Every position must trace to a
  cited source; `mode: "inferred"` is fine for paraphrasing but the
  paraphrase has to be honest.

## Progress log

- [x] Plan written.
- [x] Generate project keypair. Public key
  `ed25519:55R2yyDnvx3DZCYshQQAb1LKJf6QAiyvojUvBbmziNuT`. Secret half installed
  as the `OPENSLATE_SIGNING_KEY` repo secret on the endorsements repo; temp
  file deleted from `$env:TEMP`. The secret JSON survives in the chat
  transcript of session 938177f1 only — back up to a password manager.
- [x] Create new repo directory + scaffolding files (initial commit `9d4a160`,
  17 files, 811 LOC; README catalog-integration note in `a8c9cb5`).
- [x] Author LWV worked example (3 inferred federal policy stances, sources
  cited).
- [x] Write CI workflows (`verify.yml` on PR, `publish.yml` on master+manual).
- [x] Write static-site generator script.
- [x] End-to-end pipeline verified locally then in production.
- [x] OpenSlate pushed to `origin/master` (24 commits ahead before this work
  — now `eae2dc7` is live, satisfying the pinned ref).
- [x] `github.com/cinderblock/openslate-public-endorsements` created public.
- [x] New repo pushed to its origin/master.
- [x] `OPENSLATE_SIGNING_KEY` secret installed via `gh secret set`.
- [x] GitHub Pages enabled with `build_type: workflow` (Actions source).
- [x] First publish workflow attempt failed (push beat secret installation by
  ~10s). Manual `workflow_dispatch` re-run succeeded in 17s. Second push (the
  README integration note) also succeeded in ~11s.
- [x] Pages site live at <https://cinderblock.github.io/openslate-public-endorsements/>.
  `index.json`, `well-known/openslate.json`, and the LWV `signed.slate` all
  reachable with permissive CORS. Curling the slate and piping into
  `openslate verify` returns VALID + SECONDHAND REPORT banner.
- [x] **OpenSlate web app integration done.** New `/catalog` route in
  `apps/web/src/components/CatalogPanel.tsx`, query helper +
  `DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG` in `apps/web/src/lib/query.ts`,
  route + nav entry registered. Default catalog URL points at the live
  Pages site; overridable via `VITE_PUBLIC_ENDORSEMENTS_CATALOG`. Committed
  in OpenSlate `83a6b26` and pushed.
- [x] End-to-end UI verified in dev server (Chrome): Catalog tab renders the
  LWV row, Import button fetches the slate from Pages, verifies offline,
  inserts into IndexedDB; the 3 positions appear immediately on the
  Collate page tagged to "OpenSlate Public Endorsements".

## Scope correction (2026-06-01)

User clarified that **only positions with a direct mapping to a specific
ballot entry** are in scope for this repo — named candidates in named
races, named ballot measures with Yes/No stances. NOT general policy
issue stances, legislative position calls, or platform planks.

That makes the LWV worked example wrong-shaped, and makes LWV (and ACLU)
poor choices as worked-example orgs at all since neither endorses
candidates. Sierra Club, labor councils, and editorial boards are better
fits.

**Actions taken in response:** deleted `orgs/league-of-women-voters/`
entirely; rewrote README scope section to make ballot-entry mapping a hard
requirement; updated the example JSON in the README to show race +
measure subjects with `id`, `kind`, and `choice` populated; updated
project memory `project_public_endorsements_repo.md` with a hard-constraint
scope note.

**Things NOT to do:** do not seed worked examples that are valid by schema
but out of scope by content (issue stances, policy summaries). Reject in
review even if they validate.

## CA primary push (2026-06-01, last 2 days before user's primary)

User flagged primary in 2 days, asked "do all the ones you can find."
Result: **31 endorser orgs, 681 ballot-entry positions** scraped + signed
+ published. Catalog lives at index.json; web app /catalog imports each.

Orgs by region:
- **Statewide civic/advocacy**: Sierra Club California, CA Environmental
  Voters, Courage California, LWV California, SPUR.
- **Statewide parties/party-adjacent**: CA Democratic Party (consent
  calendar only), CA Republican Assembly, Reform California, Peace and
  Freedom Party, Working Families Party CA.
- **SF Bay Area**: SF Chronicle, SF Bay Guardian, SF League of Pissed
  Off Voters, SF YIMBY, GrowSF, SF Democratic Party, SF Tenants Union,
  Harvey Milk LGBTQ Democratic Club, Sierra Club SF Bay, LWV-SF.
- **LA Area**: Thrive LA, LA Forward, Sierra Club Angeles.
- **Santa Barbara**: SB Independent.
- **San Diego**: SD County Democratic Party, SD County Republican Party,
  SD Green Party, SD Libertarian Party, SD Lincoln Club, DSA San Diego,
  SD & Imperial Counties Labor Council.

Cross-org disagreements deliberately preserved as separate slates so
voters can compare. Gov pick alone spans 8 distinct names across the 31
orgs.

### Sources that did NOT extract (gaps)

- LA County Federation of Labor (thelafed.org): endorsements only in
  image format. Ballotpedia index returned no 2026 entries.
- SF Examiner: page is index of separate articles; main endorsement
  guide behind paywall.
- CA Federation of Labor (statewide): PDF binary, not parseable.
- TogetherSF / SF Blueprint, SF Bicycle Coalition (403), Sierra Club
  San Diego/Orange chapters, smaller SF Dem clubs (Alice B. Toklas,
  Bernal Heights, Chinese American, Ed Lee Asian-Pacific, Noe Valley,
  etc.). The sfendorsements.com aggregator lists 34 SF-area orgs total
  — only 9 of them are in the catalog so far.

## Open follow-ups (require user judgment, not blocked on code)

1. **User's specific jurisdiction** — catalog has heavy SF, LA, SD,
   Santa Barbara coverage. Voters in other CA counties (Sacramento,
   Fresno, Ventura, Riverside, etc.) get state/federal/Republican
   coverage but thin local coverage. Local newspaper editorial boards
   + county party committees would fill gaps if needed.
2. **Custom domain for the Pages site** — currently default
   `cinderblock.github.io/openslate-public-endorsements/`. A custom
   domain would enable `/.well-known/openslate.json` at the domain root
   and improve the trust story per OpenSlate SPEC §7.
3. **Per-slate content audit** before treating as canonical — slates
   were authored under time pressure for the June 2 deadline. The big
   ones (CRA 94, EnviroVoters 105, LA Forward 36) are most prone to
   transcription error in the long candidate-name lists.

## CA general push (2026-10-14, 20 days before Nov 3)

User go-ahead: re-scrape for `2026-11-03`. **Publish directly to master,
no review branch** (user, 2026-10-14). Default org scope is the same 31
orgs plus retries of the June gaps. User didn't name other orgs.

Fan-out: 7 background subagents, each owning a disjoint set of
`orgs/<slug>/2026-11-03/` dirs in the endorsements repo. Agents write files
and run `bun scripts/verify-positions.ts`. They don't touch git. I commit
and push per batch as each one lands; CI signs and publishes.

Title conventions (keep cross-org collation working):
- Statewide offices and districts reuse the June titles ("Governor of
  California", "California State Assembly, District 17", "US House of
  Representatives, California District 11", ...).
- State props: `California — Proposition <N> (<official SOS title, without
  the trailing "Initiative Statute." etc.>)`. Qualified list from
  sos.ca.gov, fetched 2026-10-14: 1, 2, 3, 4, 5, 37–45 (ACA 13 removed
  2026-06-25). Prop 4 is the Fair Elections Act (the existing LWV-CA slate
  used a pre-number title and gets retitled).
- Local measures: `<City/County> — Measure|Proposition <X> (<official short title>)`,
  as in June.
- General = top-two finalists only. Drop endorsements of candidates who
  didn't advance.

Batches:
- [x] A statewide advocacy: sierra-club-california, ca-environmental-voters, courage-california, lwv-california, spur — 372 positions, published `108e6e8`. Courage CA local races skipped (garbled PDF); re-scrape from its county guides.
- [x] B statewide parties: ca-democratic-party, ca-republican-assembly, reform-california, peace-and-freedom-party, working-families-party-ca, + new ca-republican-party — 601 positions, published `490ae24`. P&F has only 3 (no prop recs yet), re-scrape later. WFP local rows omitted (undated list).
- [x] C SF 1: sf-chronicle, sf-bay-guardian, sf-league-of-pissed-off-voters, sf-yimby, grow-sf — 227 positions, published `4d9b701`. Re-scrape Chronicle + SF YIMBY later (partly "coming soon"). New title convention: `California Court of Appeal, First District — Retain Justice <Name>` (kind measure, Yes/No), `California Supreme Court — Retain Justice <Name>`.
- [x] D SF 2: sf-democratic-party, sf-tenants-union, harvey-milk-club, sierra-club-sf-bay, lwv-san-francisco — 229 positions, published (see endorsements log). SFTU = paid slate mailer, noted.
- [x] E LA/SB: thrive-la, la-forward, sierra-club-angeles, sb-independent, + LA County Fed of Labor (June gap) — 550 positions, published `14e3508`. LA Fed guide page 7 unpublished (some local picks likely missing). LA Forward \"Recommended\" → lean_for.
- [x] F San Diego: the 7 SD orgs — 558 positions in 5 orgs, published `8c450f0`. SD Libertarians: no candidates on Nov ballot. **sd-green-party held back** (2 KPBS-only positions, no first-party page; local only, briefly published by accident in `ce6d305` and pulled in `b408649`). Lincoln Club moved to sdlincolnclub.com (meta updated).
- [x] G gaps/new: CA Labor Federation, SF Examiner, more SF clubs (sfendorsements.com list), SF Bicycle Coalition, Sierra Club San Diego — 8 new orgs, 366 positions, published `11c1e75`. SF Examiner + Bernal Heights Dems: no Nov picks yet. sfbike.org still 403 (used aggregator).

Post-batch cleanup to do once all batches land:
- [x] (`ce6d305`, 59 edits; reusable `scripts/normalize-choices.ts <election>`) Normalize candidate `choice` spellings across orgs (e.g. "D.J."/"DJ" Brookter, "JR"/"J.R." Eppler, "Joaquín"/"Joaquin" Torres). Use the ballot spelling from the official certified lists.
- [ ] Harmonize San Diego county measure titles (Reform CA guessed the A/B letters).

**Result (2026-10-15): 39 November slates, 2,903 positions, live** at
https://cinderblock.github.io/openslate-public-endorsements/index.json.

Re-scrape before Nov 3 (sources said "coming soon" / pending):
- [ ] sf-chronicle: Governor, Props 2/40/43/45, SF Prop J, Supes D2/D6/D8/D10, school + college boards
- [ ] sf-yimby: state props, "further endorsements pending"
- [ ] sd-lincoln-club: measures hearing was Oct 14
- [ ] peace-and-freedom-party: prop recommendations
- [ ] sierra-club-sf-bay: "will be updated as endorsements are finalized"
- [ ] courage-california: ~150 local races from its county digital guides (PDF was garbled)
- [ ] la-county-federation-of-labor: guide page 7 (404 at scrape time)
- [ ] sf-examiner, bernal-heights-dems: no November picks yet

## Round 2 for the Nov 3 general (2026-10-19, 15 days out)

User picked scope (2026-10-19): **finish existing** (the re-scrape list above +
SD measure titles), **more CA regions**, and **national groups' CA picks**.
Not other states. Publishing: **push per batch to master** (user reconfirmed
2026-10-19). Prep commits `6b30df0` + `559ef5c` pushed.

New tool: `scripts/list-subjects.ts <election> [filter]` (endorsements repo
`6b30df0`) prints every subject title/kind/jurisdiction already in use and
which orgs use it. Agents MUST reuse existing titles so collation works.

Fan-out: 10 background agents, disjoint `orgs/<slug>/` sets, no git. Same
rules as round 1.

| Agent | Scope |
| --- | --- |
| R1 SF refresh | sf-chronicle, sf-yimby, sierra-club-sf-bay, sf-bicycle-coalition (refresh); sf-examiner, bernal-heights-dems (new if picks are out) |
| R1b SF clubs | the rest of the sfendorsements.com orgs not yet covered (SF Labor Council, SF GOP, Latinx/Rose Pak/Young Dems clubs, SFHAC, etc.) |
| R2 SD/LA/P&F | sd-lincoln-club (measures), peace-and-freedom-party (props), la-county-federation-of-labor (p.7); harmonize SD county measure titles across SD orgs; Court of Appeal 4th District jurisdiction `us/ca` → `us/ca/coa-4` |
| R3 Courage locals | courage-california: the ~150 local races from its county digital guides |
| N1 Bay Area | Alameda / Santa Clara / San Mateo / Contra Costa / Marin county parties (both), labor councils, Bay Area News Group editorial |
| N2 Sac + Valley | Sacramento, Fresno, Kern, San Joaquin, Stanislaus: county parties, labor councils, newspapers, Sierra Club Mother Lode |
| N3 LA County+ | LA County Dem/GOP parties, LA Times, SCNG editorial boards, Ventura County parties |
| N3b OC + IE | Orange, Riverside, San Bernardino: county parties, OC Labor Fed, Lincoln Club OC, IE labor council, SD Union-Tribune |
| N4 National | EMILY's List, NRA-PVF, Club for Growth, HRC, LCV Action Fund, Everytown, VoteVets, Our Revolution, Justice Dems, SBA Pro-Life, AIPAC/J Street PACs, US Chamber, etc.: CA entries only |
| N5 CA interest groups | HJTA, CalChamber, CTA, CFT, SEIU CA, CNA, EQCA, PP Affiliates of CA, PORAC, CA Professional Firefighters, CA YIMBY, CalPIRG, CA ProLife Council, NFIB CA |

Agent brief (shared by all 10): `%TEMP%\os-round2\BRIEF.md`. It is ephemeral.
The rules that matter are the ones in this plan plus the skill.

Findings before launch:
- **"No on X" encoding was split.** 29 orgs used `endorse` + `choice: "No"`;
  8 orgs (round-1 batch G plus sierra-club-san-diego) used `oppose` + `"No"`,
  which the web app renders as "oppose → No", a double negative. Normalized
  all 42 positions to `endorse`/`No` in endorsements `559ef5c`. Brief now
  forbids `oppose` for a No recommendation.
- Local jurisdictions: county-level contests use the county slug
  (`us/ca/san-diego`, `us/ca/sf`, `us/ca/los-angeles-county`); new counties
  get `us/ca/<name>-county`. San Diego is the odd one out (no `-county`).
  Left as is to avoid churn.
- Court of Appeal 4th District retention used `us/ca`; 1st and 6th use
  `us/ca/coa-N`. R2 fixes it.

Progress:
- [ ] R1 · [ ] R1b · [ ] R2 · [ ] R3 · [ ] N1 · [ ] N2 · [ ] N3 · [ ] N3b · [ ] N4 · [ ] N5
- [ ] `normalize-choices.ts 2026-11-03` re-run after all land
- [ ] User OK to publish → commit per batch, push, check CI + Pages

Known review items (details in each bundle's evidence/NOTES.md): SFTU is a
paid slate mailer; WFP Connolly listed as SD 12 but on the ballot in SD 2
(encoded SD 2); CAGOP neutral on Props 1 and 37; LWV CA's No on 37/41/42
comes from icons only.
