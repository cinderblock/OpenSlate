# Race links opened without the race's slate

> Plan path: `plans/race-link-unresolved.md`. Read this first when resuming.

## Goal

Fix the ISSUES.md entry "A race link opened without that race's slate shows
the raw route key". A shared race link should work for a first-time visitor:
the race's title as the heading, its jurisdiction and election, the official
voter guide's material, polls, forecast and results, plus a pointer to where
endorsements come from.

## Environment / context

- `apps/web/src/components/RacePanel.tsx`. The route param is the subject key
  (`subjectKey` in `apps/web/src/lib/subjects.ts`): `subject.id` when there is
  one, else `t:<title>|j:<jurisdiction>|e:<election>`.
- The race comes from `collateRaces` over imported slates. With no slate for
  it, `race` is undefined and the page used the key itself as the title.
- `useGuideItem(subject)` (`apps/web/src/lib/guides.ts`) loads the default
  catalog's voter guides on its own (no import needed), matching on
  jurisdiction + election and then `subjectKey`.

## Decisions

- Add `subjectFromKey`, the inverse of `subjectKey` for the `t:|j:|e:` form.
  Jurisdiction and election never contain `|`, so anchoring them at the end
  parses titles that do.
- Subject, in order: the collated race's, then a draft row's (my own picks),
  then the official guide item's (it has `kind`), then the parsed key. An
  `id` key can't be parsed and keeps today's behaviour.
- The empty state links to Sources.
- With no imported slate listing the race's choices, show the guide's own:
  each candidate's statement and photo, or what a Yes and a No vote mean
  (`GuideChoices` in RacePanel, reusing `CandidateGuide` and `GuideMeans`).
  Without this, the first-time visitor saw the guide's overview but not who
  is running.

## Plan / steps

1. `subjectFromKey` and tests.
2. RacePanel uses it: heading, jurisdiction/election line, guide lookup,
   polls subject; the guide's choices when there's no race.
3. Checks; a browser check in a fresh incognito profile on a guide-covered race;
   commit; close the issue.

## Progress log

- [x] Plan written; issue claimed (`f2e721d`)
- [x] `subjectFromKey`, with tests in `apps/web/test/subjects.test.ts`
- [x] RacePanel
- [x] Checks: `bun test` (418 pass), typecheck (5/5), Biome on the touched
      files
- [x] Browser check, 2026-10-23, fresh incognito profile with no imports.
      The LA CCD Board Seat 4 link shows its title, `race us/ca/los-angeles ·
      2026-11-03`, the LA County guide, both candidates (Adam Bruno, Elaine
      Alaniz) with their statements, and no polls. Prop 1 shows `measure`, the
      summary, and the Yes/No meanings. The Governor page in a profile with
      imports is unchanged (ballot count, endorsement cards, 7 polls).
- [x] Committed; ISSUES.md entry closed
