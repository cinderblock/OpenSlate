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
- [x] F San Diego: the 7 SD orgs — 558 positions in 5 orgs, published `8c450f0`. SD Libertarians: no candidates on Nov ballot. **sd-green-party held back** (2 KPBS-only positions, no first-party page found at the time; the party's site turned out to be sdgreenparty.org, see "Green Party" below; local only, briefly published by accident in `ce6d305` and pulled in `b408649`). Lincoln Club moved to sdlincolnclub.com (meta updated).
- [x] G gaps/new: CA Labor Federation, SF Examiner, more SF clubs (sfendorsements.com list), SF Bicycle Coalition, Sierra Club San Diego — 8 new orgs, 366 positions, published `11c1e75`. SF Examiner + Bernal Heights Dems: no Nov picks yet. sfbike.org still 403 (used aggregator).

Post-batch cleanup to do once all batches land:
- [x] (`ce6d305`, 59 edits; reusable `scripts/normalize-choices.ts <election>`) Normalize candidate `choice` spellings across orgs (e.g. "D.J."/"DJ" Brookter, "JR"/"J.R." Eppler, "Joaquín"/"Joaquin" Torres). Use the ballot spelling from the official certified lists.
- [x] Harmonize San Diego county measure titles: audited 2026-10-19 (R2), already consistent and Reform CA letters confirmed.

**Result (2026-10-15): 39 November slates, 2,903 positions, live** at
https://cinderblock.github.io/openslate-public-endorsements/index.json.

Re-scrape before Nov 3 (updated 2026-10-30 after the early run, for the Nov 1 scheduled run). Run the
sweep first, because it found far more than this list did: `bun "%TEMP%\os-round2\sweep.ts" .
"%TEMP%\os-rescrape-1101"` from the endorsements repo (about 10 minutes), then
`bun "%TEMP%\os-round2\sweep-triage.ts" <out>\sweep-report.txt`. See "Early re-scrape" below. Saved news
pages no longer stay in `evidence/`: after refreshing, run `bun scripts/withhold-evidence.ts --apply
--private ../openslate-source-captures-private`, or `verify-positions` fails and publishing stops
(`plans/withhold-news-evidence.md`).
- [ ] bay-area-news-group: still "so far"; new picks land in the roundup (updated 10-30 9:23 AM PDT)
- [ ] southern-california-news-group: roundup says "More will be published"
- [ ] lookout-santa-cruz: its board was still publishing as of 10-28
- [ ] marin-independent-journal, santa-cruz-sentinel, san-mateo-daily-journal, sacramento-bee: late editorials
- [ ] sierra-club-sf-bay: "will be updated as endorsements are finalized" (Chrome only, Imperva)
- [ ] sf-examiner: no November picks as of 10-30
- [ ] noe-valley-democratic-club: Supervisor D8 still "To Be Announced"
- [x] ca-green-party `217deb2`, sd-green-party `38db05e` (see "Green Party" below)
- [x] sf-chronicle `2dccca5` (Governor: Becerra; BOE D1/D2 stay "It's complicated", no pick)
- [x] sf-yimby `6b42331`, sd-lincoln-club `d92a0ab`, peace-and-freedom-party `25889da`,
      courage-california `8c42885`, bernal-heights-democratic-club `37dbcf9`
- [x] la-county-federation-of-labor: "page 7" never existed (`65002bf`)

Conventions have moved on since the Oct 14 list: read "Round 3" and "Early re-scrape" below and the
endorsements README ("Ballot sources", "Republished picks") first. Republished picks are adopted with
`scripts/adopt.ts`, never copied.

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
- **"Recommend" rule:** use `lean_for` only when the org itself separates "endorsed" from "recommended" tiers (LA Forward, DSA SF). When "recommends" is the org's only word for its picks (Westside Forward), it is `endorse`.
- **Web-search budget is shared** (~200 searches per turn across agents). Late agents ran out, which left gaps. A follow-up pass can pick them up.
- **Neutral vs abstain (SPEC §3.6):** `neutral` only when the source literally says "neutral". "No Position", "No Recommendation", "No Endorsement" and "No consensus" are `abstain`.
- **Perl gotcha:** a `\x{2019}`-style escape in a `perl -pi` replacement upgrades the string to wide characters and double-encodes every existing UTF-8 character in the file ("Stateâ€™s"). Use plain UTF-8 bytes in the pattern, or edit with Bun/Python. Hit once (CalChamber evidence) and repaired.
- A quote checker (`%TEMP%\os-round2\quotecheck.ts`) flags statements not found in the evidence. Most hits are list lines with different separators; the real misses were truncated evidence files (see N5).
- List-line statements are sometimes reformatted (e.g. "GOVERNOR — X" for "GOVERNOR: X", table rows joined with "|"). The content is in the evidence; accepted.
- Each publish run succeeds in CI (checked via `gh run list`).
- Court of Appeal 4th District retention used `us/ca`; 1st and 6th use
  `us/ca/coa-N`. R2 fixes it.

Progress:
- [x] R1 (`6b42331`: Chronicle 48→53, SF YIMBY 20→24, SF Bike first-party; Sierra Club SF Bay behind an Incapsula bot wall, so it needs a Chrome pass; SF Examiner + Bernal Dems still have no Nov picks)
- [x] R2 (`25889da`: P&F 3→22 from its Oct 17 guide; CoA 4th → `us/ca/coa-4`; SD measure titles were already consistent, so the earlier "harmonize SD titles" item is closed; Lincoln Club measure picks + LA Fed p.7 still unpublished)
- [x] R1b (`a25ca40`: 23 new SF orgs, 718 positions; BART D8 jurisdiction aligned in `093baed`. Gaps: SF Young Dems (June only), Rose Pak (empty embed), Latinx Dems + Berniecrats (sites down). Unchecked: Affordable Housing Alliance, Home Sharers Dems, Tech Workers guide)
- [x] N1 (`d4c2779`: 20 orgs, 1,091 positions. Gaps: Contra Costa Labor Council (no live site), SV@Home (projects only), SVO (defunct). It overwrote N2's `north-bay-labor-council`; N2 was told to restore it, so that dir is NOT committed yet)
- [x] N3 (`2d207ea`: 8 orgs, 579 positions. The search budget ran out, so Tri-Counties CLC, VC Star, Stonewall Dems, LA Chamber, DSA-LA, Long Beach groups and UNITE HERE 11 were not attempted. LA Times has only No on 40)
- [x] Title fixes `ab608d6`: la-forward Burbank C, Cudahy H, Hawthorne O (Registrar letters); Oro Loma Area 5; Ontario H = "Transactions and Use Tax"
- [x] N4 (`1cabc70`: 23 national orgs, 401 CA positions. Gaps: SBA + NRLC (no CA picks), Heritage (scorecards only), AIPAC/UDP (script-only portal), NFIB federal (bot wall), No Labels. Review: VoteVets remapped old district numbers; RJC Valadao card has no year)
- [x] N2 (`29cb4d4`: 12 orgs, 562 positions; north-bay-labor-council restored and merged with N1's Marin picks. Gaps: Kern GOP, Sac + 3 Valley labor councils (no sites), Sierra Club Mother Lode/Tehipite/Redwood (Incapsula, so they need Chrome), Bakersfield Californian, Stockton Record, Press Democrat, Sac YIMBY, Yolo/SJ/Stanislaus/Placer other parties. Sac Bee: 6 articles unfetchable. Fresno GOP No on 41/42/45 as printed)
- [x] N3b (`4e221a9`: 11 orgs, 856 positions: OC Dems/GOP/Labor Fed/Lincoln Club/OCBC, SD U-T, Riverside Dems/GOP, SB Dems, IE Labor Council, IE United. OC supervisors moved `us/ca/orange` → `us/ca/orange-county` in `57abb15`. Gaps: SB County GOP, Sierra Club San Gorgonio, Desert Sun. OC ballot spellings unchecked (registrar list loads only via JS))
- [x] N5 (`fb7fd29`: 21 orgs, 1,442 positions. Evidence for CalChamber Props 44/45, SEIU BOE D4 and ACLU NorCal Prop 39 was missing from the saved page text; I re-fetched, confirmed live, and appended. CPF republishes IAFF's House picks (kept, attributed to CPF's guide). Gaps: CBRT, NFIB CA (403), CBIA (no stated position), CA Apartment Assn, UFCW WSC, CA Family Council, Consumer Watchdog, CFA)
- [x] Stance sweep `375ed94`: "No Position/Recommendation/Endorsement" → `abstain`, literal "NEUTRAL" stays `neutral` (SPEC §3.6). 23 positions in 13 orgs. courage-california not yet swept (R3 running)
- [x] R3 (`8c42885`: courage-california 164 → 329; `pdftotext -raw` fixed the garbling; 14 seat corrections, 12 drops)
- [x] Collation sweep `eb31430`: 3 one-off jurisdictions merged; no title is now split across jurisdictions
- [x] `normalize-choices.ts 2026-11-03 --apply` (`309792c`, 143 edits; re-run shows 0)

**Result (2026-10-19): 157 November slates, 8,735 positions, live** (from 39 / 2,903).
Every publish run passed CI. `orgs/sd-green-party/2026-11-03/` is still held back,
untracked.
- [x] User OK to publish (2026-10-19) → commit per batch, push, check CI + Pages
- [x] Follow-up pass for search-budget gaps + Sierra Club via Chrome (round 2b, below)
- [ ] Re-scrape before Nov 3: **scheduled** for 2026-10-28 09:00 (T3 scheduled task "OpenSlate endorsements: pre-election re-scrape (Oct 28)", fires Wednesdays, date-guarded; deletes itself after Nov 3)

## Round 2b (2026-10-19 evening): gap pass, Chrome pass, adopts

User answers (2026-10-19): Chrome pass OK; gap pass OK; Oct 28 re-scrape OK;
"if they published it, they published it" (keep odd-looking picks as printed,
e.g. Fresno GOP No on 41/42/45; collation shows the discrepancies); aggregator-only
bundles are fine as long as attribution/sources let everything be verified and
updated; **don't duplicate republished positions** → adopt by reference
(`plans/adopt-by-reference.md`), with tooling that lets publishers choose copy,
reference, or reference + snapshot.

- [x] Chrome: Sierra Club SF Bay refresh `0eb5398` (+SD 10 Sakakihara); Redwood (23)
  and San Gorgonio (20, PDF decoded in-page) `7f2e435`. Not reachable: Loma Prieta
  (June list only), Santa Lucia (Imperva blocks the Nov page even in T3's browser;
  needs Chrome), Ventana/Mother Lode/Tehipite/Kern-Kaweah/Los Padres (no 2026 page).
- [x] G3 statewide/national/SF `329fad9`: 9 orgs, 455 positions (IAFF, AIPAC PAC, NFIB
  props, CFA, UFCW WSC, Home Sharers Dems, SF AHA, Consumer Watchdog, CBIA). CPF's 51
  IAFF House picks removed from CPF `a90de93`.
- [x] G1 SoCal `76b3b74`: 11 orgs, 809 positions (DSA-LA, UNITE HERE 11, Stonewall, LA
  Chamber, SB County GOP, ACT Pasadena, Central Coast CLC, SB County Dems + GOP, 2 Long
  Beach clubs via Blue Voter Guide). Santa Barbara county-level contests moved to
  `us/ca/santa-barbara-county` `d468c35`.
- [x] G2 NorCal/Valley `3acf2ba`: 16 orgs, 553 positions. Key find: the Labor Fed's
  per-council CSV `https://calaborfed.org/wp-content/uploads/2026/10/2026G-CLC-web-endorsements-2.csv`.
- [x] Pin bumped to OpenSlate `7d8ce98` + `scripts/adopt.ts` `43ac6cc`. Adoptions:
  `4b1c4b3` (CPF→IAFF 51, Redwood→SC CA 13, San Gorgonio→SC CA 12, SB GOP→CAGOP 21,
  Central Coast CLC→Labor Fed 31) and `d44382f` (Santa Cruz Dems→CADEM 149, Contra
  Costa/Sacramento/Kern labor councils→Labor Fed 18/12/4, Press Democrat→BANG 1).
- [x] Normalize spellings `bf7a549` (10). No title split across jurisdictions.

**Result: 195 November slates, 10,545 positions live; 10 slates adopt 312 positions
by reference** (CI green on the new pin; `verify --resolve` on a live slate resolves).

### Deferred until the web app expands adopts (after `ui/two-modes` merges)
Converting these *existing copies* to `adopts` now would hide picks from voters on
openslate.us (it accepts `adopts` but doesn't expand them yet):
- sierra-club-sf-bay / -angeles / -san-diego copies of Sierra Club California's
  statewide + prop picks
- ventura-county-democratic-party's 15 CADEM statewide picks (stored `lean_for`)
- alameda-county-republican-party (CAGOP template), la-county-republican-party
  ("CAGOP"-badged statewide picks)
- sf-police-officers-association ↔ sf-firefighters-local-798 joint statement
- Not adoptable yet (no bundle): DSA-LA → California DSA; Santa Cruz YIMBY → YIMBY
  Action; SB County GOP judges → Craig Huey / Reform CA (inferred colours)

### Needs a real browser (Chrome) next pass
Santa Lucia SC chapter Nov page; NFIB CA legislative + FedPAC
(nfib.com, Cloudflare); VC Star + Desert Sun (402); Napa/Placer/El Dorado registrar
measure lists (Placer A/D/F/G/H/I/P are placeholder titles); San Benito candidate
list (SBLC San Benito picks); Rose Pak Dem Club and Long Beach clubs' FB/IG posts.

### Review items added in 2b
AIPAC PAC portal recipients encoded `endorse`; Consumer Watchdog staff picks
`lean_for`; IAFF sourced from CPF's guide (IAFF publishes no list); SF AHA is a paid
slate mailer (asterisks kept); Pasadena City College Area 7 subject in 3–4 bundles but
no such contest on the LA list; SOS `cert-raw.txt` sometimes prints a district heading
after its candidates (use `cert.txt`).

Known review items (details in each bundle's evidence/NOTES.md): SFTU is a
paid slate mailer; WFP Connolly listed as SD 12 but on the ballot in SD 2
(encoded SD 2); CAGOP neutral on Props 1 and 37; LWV CA's No on 37/41/42
comes from icons only.

## Round 3: pre-election re-scrape (2026-10-28, scheduled run)

Started 2026-10-28 9:00 AM PDT (16:00Z). State found: endorsements repo `64d66cb`,
388 bundles verify (only failure: the held-back, untracked `sd-green-party`). Other
sessions added official ballot listings, `choice_id`s, `subject.district`/`voted_in`,
labels, ranks and an evidence page since 10-19 (README "Ballot sources"). CI now
fails any position whose choice isn't the ballot spelling with its `choice_id` where a
listing covers the race, so every edit runs `normalize-choices --apply`,
`assign-voted-in --apply` and `refile-localities` before verify.
`ui/two-modes` merged, but the web app still doesn't expand `adopts`
(no `resolveAdoptions` in `apps/web`), so the deferred copy → adopt conversions
stay deferred.

- [x] R3a agent:
  - sf-chronicle 53 → 64 `44e6ea6` (Props 40/43, Supe D10, school and college boards, Prop J,
    Oakland EE; only Governor still "Coming Soon")
  - bay-area-news-group 28 → 35 `5eee991` (**Prop 37 flipped Yes → No**, Oct 26 editorial; the
    board doesn't endorse for governor)
  - new bernal-heights-democratic-club 47 `37dbcf9` (slate card image, transcribed; Props 4/38
    re-checked by eye; renamed from the assigned `bernal-heights-dems` to match other SF clubs)
  - sf-examiner: still no November editorials (gap)
- [x] R3b agent: sd-lincoln-club 58 → 77 `d92a0ab` (all 14 props, County A/B, "City of San Diego
  Measure M" filed as SDUSD M, the only Measure M on the ballot); SCNG, LA Times, LA Fed
  unchanged `65002bf` (LA Fed's "page 7" never existed: its file names skip 7)
- [x] Chrome (me):
  - sierra-club-sf-bay unchanged `22c9f99`
  - new sierra-club-santa-lucia 8 + 13 adopted from Sierra Club California `5dfc127`
    (`scripts/adopt.ts` now matches the same person under the ballot spelling, core `samePerson`)
  - nfib 6 → 44 `7d8938f` (NFIB CA PAC's 30 legislative + FedPAC's 8 House picks; Cloudflare
    cleared by itself in Chrome)
  - VC Star and Desert Sun: no 2026 editorial-board picks (Gannett; VC Star only has readers'
    letters, Desert Sun's newest editorial is from March 2025)
  - Placer GOP's 7 placeholder measure titles retitled from the county's list `ca52390`
  - American Canyon Measure P title confirmed against the city's page `3bd7f06`
  - El Dorado Dems' locals checked against the county's Candidates on Ballot Report; LTUSD
    Area 5 dropped (not on the ballot) `7439f73`
  - South Bay Labor Council +3 San Benito picks confirmed on San Benito's list `4153962`
    (Gavilan CCD Areas 5/7 still out: on neither county's list)
- [x] normalize-choices (+ `--suggested` for NFIB's "Kristi" Bruce-Lane and "Joshua" Hoover,
  checked by hand), assign-voted-in and refile-localities clean; verify 390 OK, 1 failed (the
  held-back, untracked `sd-green-party`); every publish run green.
- Marin IJ's reruns of BANG's Prop 5/43/45 editorials are syndicated BANG pieces (labelled
  "BANG endorsement"), not IJ picks, so no adoption (matches its NOTES).

**Result (2026-10-28 11:00 AM PDT, 18:00Z): 351 November endorser slates, 11,022 positions live;
11 slates adopt by reference.** (The catalog also carries 9 election-authority listings, which
the web app treats as ballot data, not sources.)

Still open after round 3:
- ~~Web app doesn't expand `adopts` yet~~ Done 2026-10-30 (`plans/adopt-by-reference.md`): five
  bundles converted in `607192d` (Ventura Dems 15, LA GOP 7, Alameda GOP 18, Sierra Club SF Bay
  12, Angeles 11). Left as they are: Sierra Club San Diego's No on 45 (its own statement) and
  SFPOA/Local 798 (adopting would leave a row with 0 positions).
- Realtors' six "not real estate related" props stay `abstain` (user said keep going, 2026-10-30).
- SF Chronicle Governor ("Coming Soon"), SCNG ("More will be published"), Sierra Club SF Bay
  ("will be updated"): a last look on Nov 1–2 could catch late picks. Not scheduled.
- The weekly scheduled task fires again 2026-11-04 and should delete itself (its guard).

**State 2026-10-30:** 351 November endorser slates, 10,959 own positions + 388 adopted by 16
slates, all resolving against the live catalog. Two feature threads started from this one:
`plans/any-race-all-slates.md` (branch `feat/any-race-all-slates`) and `plans/ballot-alignment.md`
(branch `feat/ballot-alignment`).

## Early re-scrape (2026-10-30, 4 days out)

The user asked to scrape now rather than wait for Nov 1. Worked in the endorsements repo, pushed per batch.

Result: 362 November endorser slates, 13,458 own positions + 438 adopted by 21 slates (was 351, 10,959,
388, 16). 401 of 402 bundles pass `verify-positions`; the one failure is the held-back `sd-green-party`.

- **Listed sources:** Chronicle Governor pick (Becerra); BANG Measure V; Press Democrat Prop 45; Sacramento
  Bee CD 7. Sierra Club SF Bay and SCNG unchanged. SF Examiner still has nothing.
- **New orgs (6):** Bay Area Reporter 109, Santa Cruz Sentinel 35, Monterey County Now 63, McClatchy's
  California editorial boards 14 props, YIMBY Action 112, Lookout Santa Cruz 11.
- **Largest refreshes:** Reform California 157 -> 2,145 (all 58 county guides);
  San Mateo Daily Journal 35 -> 65; Equality California 184 -> 224; LA
  Forward 186 -> 206; ACLU NorCal 1 -> 11; IE United 33 -> 44; League of Pissed-Off Voters 51 -> 67.
- **Adoptions (5 more slates, 50 positions):** Sentinel -> BANG 4, Marin IJ -> BANG 12, Sacramento Bee ->
  McClatchy 14, Sonoma Dems -> CADEM 14, Santa Cruz YIMBY -> YIMBY Action 6.

Findings:
- **The checklist badly undercounts.** It only knows what a source once said was pending. The sweep compares
  each live source with the bundle and its saved evidence, and news hubs catch papers with no bundle at all.
  Most of this run's picks came from neither the checklist nor any "coming soon" note.
- `sweep.ts` reports names and prop numbers on the live page that are in neither the bundle nor its evidence.
  A hit is a lead, not a pick: about half were opponents, mentions, or last cycle's text. It can't read PDFs,
  images or bot-walled pages (207 PDFs, 82 403s this run), and an aggregator source (sfendorsements.com, KPBS,
  voter guide pages) always hits.
- Git Bash's curl fails with error 43 on many sites; use `/c/Windows/System32/curl.exe --ssl-no-revoke`.
  McClatchy sites need Chrome. Chronicle's project page works with curl.
- Don't read a hub article list as new picks. The U-T's "new" articles were all already in its roundup.
- Modesto and Fresno Bee hubs mostly show June primary picks; low article numbers (315xxxxxx) are the
  primary, 317xxxxxx the general.
- Newspaper refreshes save no page text. The record is a NOTES entry and a short statement.

Decisions to check (all recorded in the bundles' NOTES):
- Reform California's 584 new races and 144 new measures sit in counties with no authority listing, so none
  are confirmed on a ballot. Some may be uncontested seats, as 12 were in San Diego. Eight county guides
  disagree with the statewide bundle on one race each; those were left as they were (list in NOTES).
- B.A.R.'s "Retain all justices" is applied to the Supreme Court, First and Sixth Districts only.
- EQCA's "Lyseria Kursave" is left out: the ballot's Lyseria Evelyn Phillips shares only the first name.
- LA Forward's South Pasadena D4 pick is removed because the row now says "Write-up coming soon"; it may come
  back.
- Marin IJ adopts only what ran under BANG's byline; its SCNG-bylined Prop 4 and Prop 40 aren't adopted.

## Green Party (2026-10-30, 2:05 PM PDT (21:05Z))

The user asked what was going on with the held-back `sd-green-party`. The hold's reason turned out to be wrong.

- **It was held because no first-party page was found.** The Oct 14 pass tried `cagreens.org/sandiego` (404),
  `sdgreens.org` and `sandiegogreens.org`. The party's site is https://www.sdgreenparty.org/, listed in the state
  party's directory at https://www.cagreens.org/county-party-directory. `greenpartysd.org` is not it (403).
- **What the county party itself published:** Alexander Kraft for El Cajon Mayor (Feb 28 membership vote, and
  `/candidates`); Yes on Lemon Grove Measure E (Sep 26 membership vote). Both are on the Nov 3 ballot. Measure E is
  missing from the held bundle, because KPBS doesn't list it.
- **Prop 40:** the county's own membership didn't vote on it. Its site reposted the state party's Jul 8 release and
  linked the state voter guide on Oct 1, and KPBS lists it under the county. Adopt it from the state party, don't copy.
- **Leave out, not on the Nov 3 ballot:** Butch Ware, Sasha Miller and the statewide Left Unity Slate (none is on the
  Secretary of State or San Diego listings); the San Diego Choice Voting amendment and Public Power SD (no measure).
  `/candidates` still shows them, and none of those were re-affirmed for November.
- **Green Party of California is missing from the catalog.** Its Nov 2026 guide takes positions on all 14 props, voted
  by county delegates. A fetch summary read Yes on 3, 4, 40, 44; No on 37, 38, 39, 41, 42, 43, 45; No position on 1, 2,
  5. Check against the page before building. No position is `abstain`. County positions stay out of that bundle.
- **`orgs/sd-green-party/meta.yaml`'s uri is a 404** and is published with the June bundle. Point it at the real site.
- The `verify-positions` failure is two missing `choice_id`s, because normalize skips untracked files. It clears once
  the bundle is tracked.

Done 2026-10-30 with the user's yes: `ca-green-party` 14 positions (`217deb2`), then `sd-green-party` with Kraft and
Measure E as own positions and Prop 40 adopted (`38db05e`), `meta.yaml` fixed, and the June bundle's link too. The slug
is `ca-green-party`, like the other state parties. KPBS isn't saved in the bundle: news pages stay private now
(`plans/withhold-news-evidence.md`), so NOTES cites it by link. The four candidates the state list marks as
county-endorsed are in `ca-green-party`'s NOTES; those county parties have no bundle.

## What the 10-30 adoptions rest on (2026-10-30)

The user asked whether these groups say they adopt, or whether we inferred it from overlap. Not inferred: each slate's
own page prints the picks, and `adopt.ts` refuses a pick the adopted bundle doesn't hold. But none says "adopt". That's
our word, and SPEC 3.10 reads as "is claimed to hold", which is stronger than some of these pages support.

- Sacramento Bee -> McClatchy (14): solid. Same board, the Bee's list runs under the shared byline.
- Santa Cruz Sentinel -> BANG (4): solid. Printed as "Recommendations from our Bay Area News Group".
- Santa Cruz YIMBY -> YIMBY Action (6): fair. On its chapter page, marked Endorsed, but the page's own vote text is
  about the June primary, so they may be YIMBY Action's picks shown there, not a chapter vote.
- Sonoma Dems -> CADEM (14): overstated. The page says it is "sharing" the state party's positions, and that they
  are "attributed to the California Democratic Party". That is republishing, not holding.
- Marin IJ -> BANG (12): likely wrong. This reverses the earlier decisions above and in its NOTES ("not the IJ board's
  own list"). The basis is reruns under BANG's byline and a roundup link to BANG. The 10-30 report didn't mention
  the reversal, so the user's OK on the Marin decision didn't cover it.

Decided 2026-10-30: the Marin IJ adoption is removed (`3df707d`). No "shares" relationship: the user doesn't want it,
so Sonoma stays an adoption. The other 16 adopting slates were not re-read for this question.
