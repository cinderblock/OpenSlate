# Any race, all slates

> Plan path: `plans/any-race-all-slates.md`. Read this first when resuming.

## Goal

The user, verbatim:

> every ballot item should have a button to "see all slates that reference
> this", not just the ones i've said I trust. also, i should be able to look up
> any race anywhere and see all slates for/against it. For instance, I have a
> friend running for office in Oakland and I wanna see (and follow) how she's
> doing, even though I don't have her on my ballot.

Three parts:

1. **On every ballot item:** a button to see ALL slates that reference it, not
   only the sources the voter follows.
2. **Look up any race anywhere**, on the voter's ballot or not, and see every
   slate for and against it.
3. **Follow a race or candidate that isn't on your ballot**, to keep track of
   how they're doing.

The election is Tuesday Nov 3, 2026. Most useful if it ships before then, but
done properly.

## Environment / context

- Worktree `~/.t3/worktrees/OpenSlate/feat-any-race-all-slates`, branch
  `feat/any-race-all-slates`, from master `978d839`. Merging to master deploys
  openslate.us (Workers Builds); list `origin/master..HEAD` first; fast-forward
  or merge, never force.
- Public catalog (GitHub Pages, sibling repo): `index.json` 605 KB (58 KB gzip),
  `bundle.json` 9.9 MB (1.48 MB gzip), both with `Cache-Control: max-age=600`
  and an ETag. 390 entries: 320 organization, 24 party, 11 news, 9 ballot
  listings (`election-authority`), 6 editorial boards, 1 campaign.
- Checks: `bun run typecheck`, `bun test`, Biome on touched files with a CRLF
  setting, browser at desktop and phone width.
- Dev server for this worktree: pick a free port (the main checkout uses 5173).

## Measurements (real bundle, this desktop, Bun, 2026-10-30)

| Step | Time |
| --- | --- |
| `JSON.parse` of the bundle | 244 ms |
| verify + decode 390 slates | 3,463 ms (about 9 ms each) |
| `translateSlates` | 148 ms |
| `collateRaces` (2,192 races) | 314 ms |
| `raceSearchText` for every race | 35 ms |
| one search over all of them | 4 ms |

Heap about 97 MB with everything held. A phone is several times slower, so
verification is the only step that needs real care: it must be time-sliced, and
must not be repeated every session.

November: 1,955 races, 1,187 with a ballot listing, 188 with no endorser at all.
Top race (Prop 43) has 127 sources. Oakland has 10 races in the catalog (Mayor 8
sources, Measure EE 9). No race has its title under two jurisdictions, so
`subjectKey()` needs no cross-jurisdiction merging. 11 slates use `adopts`.

## Decisions

Made here; the user can overrule them.

- **Download: the bundle, in one request, when asked for.** Asked for means
  opening *All races* or pressing *All slates*. Never on app start. One file
  says nothing about what the voter is looking up, whereas fetching only
  Oakland's slates would tell the host what they care about (same reasoning as
  setup's *Download all*).
- **Verified slates are kept in IndexedDB** (`idb-keyval`, its own key, not the
  query persister) with the catalog's `generated_at`, so the next visit skips
  the download and the signature checks. A new catalog re-downloads the bundle
  and only checks tokens not seen before.
- **Time-sliced on the main thread, not a Worker.** The queue already works
  this way, `decodeSlates`' cache lives there, and a Worker has to clone 7 MB
  back anyway, on top of being one more thing the desktop webview must support.
  Yields through `MessageChannel`, because `setTimeout` is throttled to once a
  second in a background tab.
- **Same collation.** All slates go through `collateRaces`, so one source's
  newest slate speaks for it and election authorities never count. A catalog
  source the voter hasn't imported is standing `off` (the default for a source
  nobody decided about is `follow`, which is right only for imports).
- **Race page, not a second page:** `/race/$key?all` is the same page with every
  slate, so official guide, polls, forecast and results stay beside them. *All
  slates* on a card links there; the page lets you turn it on too.
- **New page `/races`, "All races", a fourth tab.** Search, filter by contest,
  browse by place, and the races you follow at the top.
- **Counts first.** Each choice shows for/against, then sources grouped by kind,
  collapsed, rendered only when opened. Filters: stance, kind, name, sources you
  follow.
- **Kinds:** the catalog's `kind` where it's specific (party, news, editorial
  board, individual), else careful name rules (parties, labor, business,
  political clubs), else *Other groups*. Needed because `kind` says
  `organization` for dozens of county parties and some editorial boards, and
  otherwise 339 of 390 slates would be one bucket. The fix belongs in the
  catalog data; logged in ISSUES.md.
- **"How she's doing":**
  - Endorsements: for/against across all slates, and how that compares with the
    rest of the field. Always.
  - New since you last looked: who joined or changed, kept in this browser. This
    is what makes following different from looking up.
  - Results (civicAPI): on the followed card once polls close, with percent
    reporting and who leads. The real answer on election night.
  - Polls (VoteHub): the latest poll on the card where one exists. Statewide and
    House only, so most local races get none, and the card says nothing then.
  - Kalshi: race page only. It's opt-in for self-hosted servers and absent on
    openslate.us, so a card can't count on it.
- **Following stays in this browser** (`openslate.followedRaces.v1`). No usage
  event: `page.view` with the route template is the only trace of the feature.
  A followed race doesn't touch My ballot's counts, picks or Compose.
- Follow state for a candidate is by name as the listing spells it; a name that
  disappears shows as not found rather than vanishing.

## Plan / steps

1. [ ] Plan, ISSUES entry for the catalog's `kind` data.
2. [ ] `lib/raceTally.ts`: tally, source kinds, filters. Tests.
3. [ ] `lib/followedRaces.ts`: store, marks, what's new. Tests.
4. [ ] `lib/allSlates.ts`: loader (injected deps), IndexedDB copy, merge with
       imports, `useAllRaces`. Tests.
5. [ ] Race page: `?all`, summary and filters, grouped lists, follow buttons.
6. [ ] My ballot: *All slates* on every card.
7. [ ] `/races`: route, usage, tab, search, sections, rows.
8. [ ] Following cards: counts, what's new, results, latest poll.
9. [ ] README, checks, browser at desktop and phone width.
10. [ ] Rebase on the `adopts` expansion when it lands (see below), merge.

## Depends on

- **`adopts` expansion** (thread on `feat/adopts-expansion`, `plans/adopt-by-reference.md`):
  counts must go through its shared helper. `useAllRaces` has one place to add
  it. If it hasn't landed when this is ready, ship without it and note the
  undercount (11 slates) rather than wait.
- `feat/ballot-alignment`: endorser alignment scoring. Don't overlap: no scoring
  of sources against the voter's picks here.

## Findings / gotchas

- `index.json` has no race titles, only per-jurisdiction counts, so a race
  search can't work from it. The bundle is required.
- `sourceOf`'s `kind` is unreliable; see Decisions. Naive name rules are wrong
  too: `union` catches the San Diego Union-Tribune, Union City Chamber of
  Commerce and tenants unions; `club` catches Sierra Club and Club for Growth.
- `measureChoices` drops a neutral stance on a measure as a whole ("no bubble to
  sit by"). All slates must still list it, so the tally adds it back.

## Things not to do

- Don't load the bundle at app start or from My ballot's render path.
- Don't count `election-authority` slates as endorsers.
- Don't put a race, choice, org or place in a usage event.
- Don't fetch per-jurisdiction slates to save bytes: it leaks what's looked up.
- Don't use the query persister for the catalog copy: it rewrites the whole blob
  on every change.
- Don't add native form controls.

## Progress log

- [x] Read the docs and code; measured the real bundle (2026-10-30).

## Open questions for the user

(none yet)
