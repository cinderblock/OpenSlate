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

## Plan / steps

1. `subjectFromKey` and tests.
2. RacePanel uses it: heading, jurisdiction/election line, guide lookup,
   polls subject.
3. Checks; a browser check in a fresh incognito profile on a guide-covered race;
   commit; close the issue.

## Progress log

- [x] Plan written; issue claimed
- [ ] `subjectFromKey` and tests
- [ ] RacePanel
- [ ] Checks and browser verification
- [ ] Commit, close the issue
