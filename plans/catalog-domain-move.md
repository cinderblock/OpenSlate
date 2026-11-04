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

## Plan / steps

1. [ ] **Current, blocked:** publish `dist/` to Workers static assets from the
       endorsements repo's CI. There's no way to deploy yet; see Findings and
       the open question.
2. [ ] Ops: declare worker `openslate-catalog` with custom domain
       `catalog.openslate.us` (`external: true, provision: true`), applied by CI
       after a dry run that shows only those additions.
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
- Workers static assets don't add CORS headers. The deploy needs a `_headers`
  file with `Access-Control-Allow-Origin: *`, written only into the Workers
  copy so the Pages output stays unchanged.

## Progress log

- [x] Pre-checks (2026-11-04). All passed. Nothing changed anywhere.
- [ ] Step 1. Stopped: needs a deploy route the user has to set up.
- [x] The scheduled task turned itself off, so it won't run again.

## Open questions for the user

1. How should the endorsements repo deploy to Workers? Recommendation: **(a)**.
   - **(a) Workers Builds on a build branch.** `publish.yml` commits the signed
     `dist/` and a `wrangler.jsonc` to a branch such as `catalog-site`, adding
     commits rather than force-pushing. A Workers Builds connection on that
     branch runs `bunx wrangler deploy`. No Cloudflare credential goes in
     GitHub, which keeps the app's existing pattern. You'd make the one
     dashboard connection.
   - **(b) A Cloudflare token in GitHub.** You'd create a token limited to
     Workers Scripts Edit and store it as a repo secret. `publish.yml` then runs
     `wrangler deploy` itself. That's simpler, but it puts the first Cloudflare
     credential in an app repo.

## Things not to do

- Don't set a custom domain on the Pages site: `github.io` would redirect.
- Don't disable or remove Pages, or move the ballot guide sites.
- Don't create the Workers Builds connection, or any token, through the API
  with a token you happen to have. The user sets up the route.
- Don't add `_headers` to the Pages `dist/`.
