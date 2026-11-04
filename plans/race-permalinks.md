# Readable, canonical race URLs

> Plan path: `plans/race-permalinks.md`. Read this first when resuming.

## Goal

Every race gets one readable, stable address that a voter can bookmark or
send, e.g. `openslate.us/#/race/2026-11-03/us/ca/governor`. Asked 2026-11-03
(Election Day) by the user, who kept opening the app for one race and found
no address for it. Today's race links do exist (`#/race/<subject key>`), but:

- the key is the raw subject key `t:<title>|j:<jurisdiction>|e:<election>`,
  percent-encoded, so the URL reads like
  `#/race/t%3AGovernor%7Cj%3Aus%2Fca%7Ce%3A2026-11-03`;
- the race heading on My ballot is a link, but it is styled as plain text
  (`.race-link`: `color: inherit`, underline only on hover), so on a phone
  nobody can tell it's a link.

## Environment / context

- Router: `apps/web/src/router.tsx`, TanStack Router with **hash history**.
  The route lives after `#`, which browsers never send to a server and the
  analytics beacon strips (`b9e728a`). That's deliberate: which races someone
  reads says where they vote. Keep it.
- Race page: `apps/web/src/components/RacePanel.tsx`, route `/race/$key`.
- `subjectKey` / `subjectFromKey`: `apps/web/src/lib/subjects.ts`. Subject
  identity (SPEC §3.3, §3.10) is `id` when present, else
  `(title, jurisdiction, election)`.
- Link sites (`to="/race/$key"`): AllRacesPanel, CompareBallotPanel,
  ComposePanel, FollowedRaceCard, GuideContent (measure mentions, by key only),
  MyBallotPanel (heading, All slates, Read up, articles), RacePanel
  (Referenced by, In the news). Several only have the key, not the race.
- `usage.ts` lists route templates (`"/race/$key"`); `feedback.test.ts` uses it.

### Survey of the real data (2026-11-03)

Every subject in `openslate-public-endorsements/orgs/**/positions.json` and
the CA ballot guide items (script was `$TEMP/race-slug-survey.ts`):

- 18,652 subjects, **0 with an `id`**, all with `jurisdiction` and `election`.
- Elections: `2026-11-03`, `2026-06-02`. 632 jurisdictions, all already
  `[a-z0-9/-]` paths.
- 2,935 distinct identities → 2,935 slugs of `election/jurisdiction/slug(title)`:
  **no collisions**.
- Long measure titles make long slugs (≈200 chars for Laguna Beach Measure E).
  Accepted: still readable, and truncating would invite collisions.

## Decisions already made (don't re-ask)

- Stay on hash routing (privacy, above). The user agreed 2026-11-03.
- URL shape: `#/race/<election>/<jurisdiction path>/<title slug>`. A missing
  election is `_`; a missing jurisdiction drops its segments. The slug is a
  pure function of the subject's identity fields, so it is a pure function of
  the `t:|j:|e:` key and every link site can build it from the key alone.
- Old `#/race/<key>` links keep working. A `t:|j:|e:` key redirects (replace)
  to its slug. An `id` key (none exist today) still renders by key.
- Slug collisions (only possible today through case or punctuation
  differences): the page lists the matching races; each pick pins the exact
  identity with `?k=<key>`.
- Race headings on My ballot look like links all the time.

## Plan / steps

1. `lib/raceSlug.ts`: `raceSlug(key)`, `parseRaceSlug(splat)`, slugify. Tests.
2. Routes: new `/race/$` (slug) rendering RacePanel; `/race/$key` becomes the
   legacy route (redirect when parseable). Search: `all`, `k`.
3. `RaceLink` component replacing every `to="/race/$key"` site.
4. RacePanel resolves the slug: candidates from imported races, my picks,
   the voter guide's items for that election + area, then (only on a miss)
   the public catalog. One match → the race; several → pick list; none →
   not found with links out.
5. Heading link styling.
6. usage.ts templates, tests, typecheck, lint, browser check (headless):
   slug link in a fresh profile, a legacy link redirecting, `#official`
   anchors, All slates.
7. README / SPEC mention if they describe race URLs. Commit.

## Findings / gotchas

- **Resolver flapping (fixed).** With `guides.json` failing, the page found a
  catalog-only race, mounted the race view, and the view's own guide lookup
  re-fetched the failed guide list. That flipped `isPending` back to true, the
  resolver went back to "searching", the view unmounted, and it looped
  (`guides.json` requested ~2×/s forever). Fix: the local look latches as
  settled per slug (`settledFor` in `useRaceTarget`). An `id`-key page, which
  skips the resolver, made 2 requests in 12 s, so the loop was this change's.
- Almost every race resolves from the voter guides in ~150–300 ms, so the
  catalog fallback is rare. Tested it by aborting `guides.json` in Playwright:
  West Hollywood City Council opened from the catalog in ~5.4 s.
- A slug nothing has ("not found") loads the whole catalog first (~5 s) before
  saying so. Accepted: it's the only way to know.
- Biome `--write` over every changed `.ts` in the shared tree also reformatted
  another thread's untracked `apps/web/scripts/ca-district-overlaps/block-equivalency.ts`
  (2026-11-03 6:48 PM PST). Run Biome on explicit paths only.
- Headless checks: Playwright from `$TEMP/raceshot`, pointed at the installed
  `chromium_headless_shell-1248` with `executablePath` (the npm package's own
  build wasn't downloaded). Dev server: `bunx vite --port 5391 --strictPort`.

## Progress log

- [x] Plan written
- [x] 1 `lib/raceSlug.ts` + `test/raceSlug.test.ts` (12 tests)
- [x] 2 routes: `/race/$` (slug), `/race/$key` redirects `t:|j:|e:` keys
- [x] 3 `components/RaceLink.tsx` at every race link (12 sites)
- [x] 4 `useRaceTarget` / `RaceLookup` / `RaceView` in RacePanel
- [x] 5 `.race-link` underlined always (faint), none in print
- [x] 6 typecheck, Biome, `bun test` (1030 pass); headless, fresh profiles,
      2026-11-03 PST: guide race by slug; old key link → slug with `?all`
      kept; All races hrefs are slugs and open fresh; catalog-only race with
      guides blocked; not-found; `#official` scrolls via slug and via old link
- [x] 7 README paragraph; committed (`7c10955`)
- [x] Deployed: on origin/master (pushed with `ccf0234`); checked on
      openslate.us 2026-11-03 PST: slug and old key link both land on the slug
      with `#official` scrolled to, headings underlined

## Open questions for the user

- None. A "Copy link" button on each race card was offered as optional and
  is not in scope unless asked.

## Things not to do

- Don't move off hash history to real paths; it would put every race view in
  Cloudflare's request logs with the visitor's IP.
- Don't truncate slugs.
