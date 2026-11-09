# Catalog move to catalog.openslate.us

## Goal

Serve the public endorsements catalog from `catalog.openslate.us` (Cloudflare
Workers static assets) as well as GitHub Pages, then point the app at it. Pages
has a 100 GB/month soft limit with no paid tier, and Workers static assets are
free and unmetered. Held until after the 2026-11-03 election (see
`plans/traffic-surge.md`), then run by a one-time scheduled task on 2026-11-04.

## Environment / context

- Catalog source: `github.com/cinderblock/openslate-public-endorsements`. Its
  `publish.yml` signs every slate (key in the GitHub secret
  `OPENSLATE_SIGNING_KEY`), builds `dist/` with `scripts/build-site.ts`, and
  deploys it to Pages. That's its only secret.
- Current catalog: `https://cinderblock.github.io/openslate-public-endorsements/`.
  The app's default is `apps/web/src/lib/query.ts`. The CLI has its own copy,
  `PUBLIC_CATALOG` in `packages/cli/src/index.ts`, which is outside this task's
  scope.
- The app's own Workers (`openslate-web`, `openslate-poll-cache`) are deployed by
  **Cloudflare Workers Builds**, connected in the dashboard. Ops provisions the
  empty worker and the custom domain (`cloudflare/config/projects/openslate.yaml`,
  `external: true, provision: true`). The OpenSlate README says no app repo
  holds a Cloudflare credential.

## Decisions already made (don't re-ask)

- Run after the election, on 2026-11-04 (the user, 2026-10-30).
- Pre-approved scope (the user, 2026-10-30 and 2026-11-02): publish alongside
  Pages from the endorsements repo's CI; an ops worker with the custom domain;
  verify; switch the app default; then stop the endorsements scripts writing
  github.io addresses.
- Pages stays up and unchanged, with no custom domain on it.
- Deploy route: **(a) Workers Builds on a `catalog-site` build branch** (the
  user, 2026-11-06). No Cloudflare credential goes in GitHub.

## Plan / steps

1. [x] Ops: worker `openslate-catalog` with custom domain
       `catalog.openslate.us` (`external: true, provision: true`). The dry run
       showed 2 to create and nothing else. Ops `7e244f85`, applied by CI.
2. [ ] **Current:** the endorsements repo's `publish.yml` commits the signed
       site to the `catalog-site` branch (endorsements `4e56998`). Then the user
       connects Workers Builds to that branch in the dashboard (the one manual
       step). Root directory `/`, no build command, deploy command
       `npx wrangler deploy`.
3. [ ] Verify: certificate, `Access-Control-Allow-Origin: *`, and `index.json` and
       `bundle.json` byte-identical to Pages.
4. [ ] Switch the default in `apps/web/src/lib/query.ts`, run the checks, push,
       and confirm the new URL is in the production bundle.
5. [ ] Endorsements scripts: `PAGES` in `scripts/adopt.ts`, `PUBLISHED` in
       `scripts/keep-unchanged.ts`, and `uri` in `keys/project-public.json` and
       `well-known/openslate.json` move to the new host. The `a.uri` match in
       `adopt.ts` changes to issuer, `of` and election. Existing `adopts[].uri`
       values stay as they are. Source IDs and the slate count must not change.

## Findings / gotchas

- Pre-checks, 2026-11-04 at about 10:00 AM PST (18:00Z), all passed:
  - `openslate.us`, `api.openslate.us` and the Pages `index.json` all answered 200.
    Pages sends `Access-Control-Allow-Origin: *`.
  - The WAF rule `API circuit breaker` was disabled.
  - The endorsements repo was clean and even with origin (`184d165`). The last
    publish run (`41745749776`) succeeded.
  - The Pages build is 3,039 files and 59 MB. The largest file is `bundle.json`,
    12.2 MB uncompressed, which is under the 25 MiB per-file limit. The file
    count is under the 20,000-file limit.
  - The app still never fetches an adoption `uri`. `expandAdoptions` finds
    adopted slates among the imported ones, `adoptedEntries` matches catalog
    entries by issuer key, `of` and election, and `sourceIdOf` uses
    `attribution.of.uri` or the issuer key.
- **Blocker:** the endorsements repo's CI has no way to deploy to Cloudflare.
  It has no Cloudflare token, and that would break the rule that app repos hold
  no Cloudflare credential. Workers Builds can't run the publish either,
  because signing needs a key that exists only as a GitHub secret. Local tokens
  can't write Workers, and none of the scope's changes can make a credential or
  a Workers Builds connection.
- The `catalog-site` branch layout: `wrangler.jsonc` and `README.md` at the
  root, the built site under `site/` with `site/_headers` added. The templates
  live in master's `catalog-site/` folder. The publish step builds the tree with
  a separate git index (`GIT_INDEX_FILE` and `--work-tree`), so the checkout is
  untouched. It parents each commit on the fetched branch tip and pushes
  without force. A run whose tree matches the tip adds nothing. Tested against
  a local bare remote: create, skip when unchanged, add on change.
- Branch growth: `bundle.json` is 12.2 MB, about 1.9 MB gzipped. Each publish
  that changes a slate adds roughly that to the repo. If it ever matters,
  trimming the branch's history is a rewrite and needs the user's yes.
- Workers Builds posts a GitHub check run named `Workers Builds: <worker>` on
  each commit it builds (seen on the app repo). That's how to see a build's
  result here: the local Cloudflare token answers "Invalid token" (12006) on
  the Builds API.
- Connecting Workers Builds doesn't start a build. Only a push to the branch
  does.
- Read build state with the user-owned `CF_BUILDS_TOKEN` in ops
  `cloudflare/.env.local` (Workers CI Read):
  `GET /accounts/<id>/builds/workers/<script-tag>/triggers` and `/builds`. The
  script tag for `openslate-catalog` is `12732711609f4f40ac1a34ec19ea0a13`. The
  ops `bun builds <worker>` CLI does the same but needs `bun install` in the
  checkout it runs from.
- A test commit made with the Contents API briefly cut the branch README
  short: `base64 -d` failed on GitHub's line-wrapped base64. Strip newlines
  first (`tr -d '
'`). Fixed in `ae50a30`. The catalog files weren't touched.
- Workers static assets don't add CORS headers. The deploy needs a `_headers`
  file with `Access-Control-Allow-Origin: *`, written only into the Workers
  copy so the Pages output stays unchanged.

## Progress log

- [x] Pre-checks (2026-11-04). All passed. Nothing changed anywhere.
- [x] Step 1 was stopped on the deploy route. The user chose (a) on
      2026-11-06.
- [x] Ops worker and domain (`7e244f85`).
- [x] `publish.yml` commits to `catalog-site` (`4e56998`).
- [x] Workers Builds connection (the user, 2026-11-09).
- [ ] First build. **Blocked:** no push to `catalog-site` has ever reached
      Workers Builds. The trigger is right (read through the Builds API on
      2026-11-09): branch `catalog-site`, root `/`, no build command, deploy
      `npx wrangler deploy`, path filter `*`, token
      `Workers Builds - 2026-09-23 01:27`, caching off, created 10:45 AM PST
      (18:45Z). It has 0 builds after four pushes: an empty commit (`4077b19`),
      a publish by `github-actions[bot]` (`48fba31`), and two README commits
      pushed as the user (`3be46fe`, `ae50a30`). The same API shows
      `openslate-web` building the user's pushes normally. Suspect: the
      Cloudflare GitHub app's repository access doesn't cover this repo, so its
      push events never reach Cloudflare.
- [ ] Verify, switch the app default, update the endorsements scripts.
- [x] The scheduled task turned itself off, so it won't run again.

## Open questions for the user

None. The deploy route is decided: (a).

## Things not to do

- Don't set a custom domain on the Pages site: `github.io` would redirect.
- Don't disable or remove Pages, or move the ballot guide sites.
- Don't create the Workers Builds connection, or any token, through the API
  with a token you happen to have. The user sets up the route.
- Don't add `_headers` to the Pages `dist/`.
