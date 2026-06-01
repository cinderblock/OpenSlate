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

## Open follow-ups (require user judgment, not blocked on code)

1. **Seed a first real worked example** — pick an org that actually
   endorses candidates or measures (e.g., a state Sierra Club chapter
   that's published 2026 endorsements; a city's editorial board; a labor
   council). The OpenSlate `endorsement-scraper` Claude skill is the
   recommended authoring path.
2. **Custom domain for the Pages site** — currently default
   `cinderblock.github.io/openslate-public-endorsements/`. A custom domain
   would enable `/.well-known/openslate.json` at the domain root and
   improve the trust story per OpenSlate SPEC §7.
