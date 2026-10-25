# Follow a source to disagree with it

> Plan path: `plans/disagree-sources.md`. Read this first when resuming.

## Goal

The setup wizard tells voters to "pick ones you disagree with too if you want
the contrast", but a picked source can only be *followed*: its endorsements
land on My ballot beside the ones you trust, counted the same way. Make a
negative selection possible: follow a source **to disagree**, so its picks count
the other way and are shown as such.

## Environment / context

- Web app `apps/web`. Follow state: `lib/myVote.ts` (`followsStore`), helpers
  in `lib/sources.ts` (`isFollowed`). Tallies: `lib/collate.ts`
  (`collateRaces` → `ChoiceGroup.support/opposition`, `RacePosition.followed`).
- UI that sets follow state: `SourcesPanel` (per-row Switch), `CatalogBrowser`
  (Follow / Following buttons), `Wizard` sources step (Checkbox cards).
- UI that reads it: `MyBallotPanel` (`ChoiceRow` chips, counts, summary bar),
  `RacePanel` (position list), `QuickFill` (`sourcesOn`), `ballotExport`.
- Checks: `bun run typecheck` (apps/web), `bun test`, Biome
  (`bunx biome check apps packages`; CRLF config copy if line endings trip it),
  `bun run build`.
- Another thread (`plans/wizard-catalog-summaries.md`) is about to rework the
  wizard's sources and import steps. Keep wizard edits small and local, and
  commit them promptly so that thread builds on them.

## Decisions (made in this thread)

- **Three standings per source**: `follow`, `disagree`, `off`. A source nobody
  decided about is `follow` (unchanged default). "Followed" (on My ballot)
  means `follow` or `disagree`: you follow a source you disagree with the way
  you'd follow an opponent, to see what they say.
- **Counting**: a disagreed source counts the other way, both directions: what
  it backs counts *against* that choice, what it opposes counts *for* it. Its
  leans flip the same way. Tallies are per choice, as before (a followed
  source's pick never counted against the other candidates either). Quick
  fill's "Go against all" keeps its own, more cautious rules (it writes picks).
- **Display**: the source's own stance is never rewritten. My ballot chips are
  coloured by how the position counts for you and carry a thumbs-down mark; the
  popover says what the source said and that it counts the other way. The race
  page lists the source's own stance with a "you disagree" tag.
- **Storage**: new key `openslate.follows.v2` (`Record<id, Standing>`), seeded
  from `openslate.follows.v1` booleans the first time. v1 is left in place so an
  older build in the same browser still reads sane state.
- **Control**: one kit `ToggleGroup` (React Aria `ToggleButtonGroup`, single
  selection, none = off) with "Follow" and "Disagree", used on the Sources page,
  the catalog and the wizard, so the three places look and behave the same.
- The left-to-right strip on Sources shows only sources you follow to agree.

## Plan / steps

1. [x] Survey; plan doc.
2. [x] `sources.ts`: `Standing`, `standingOf`, `isFollowed`; `collate.ts`:
       `countedTone`, standing on positions, inverted tallies; tests.
3. [x] `myVote.ts`: v2 store with v1 migration, `setStanding`.
4. [x] `ui/ToggleGroup.tsx` + styles.
5. [x] Sources page, catalog, My ballot chips + summary, race page, quick fill,
       ballot export.
6. [x] Wizard sources step (check `git status` for other edits first).
7. [x] README, checks, browser check, commit.

## Findings / gotchas

- React Aria's single-selection `ToggleButtonGroup` renders as a `radiogroup`
  of `radio`s, and pressing the pressed one releases it (none = `off`). That's
  its standard pattern; screen readers announce "Follow, radio button".
- Tallies are per choice. On measures the catalog records the GOP as
  "endorses No"; disagreeing makes that count *against No*, not *for Yes*.
  Same rule as before for followed sources (no cross-choice inference).
- The working tree mixes CRLF and LF files. Biome needs a CRLF copy of
  `biome.json` (`formatter.lineEnding: "crlf"`, at `%TEMP%iome-crlf`) for the
  CRLF ones; the plain config for the LF ones.
- Another thread (alpha-notice) had uncommitted edits in `Wizard.tsx`,
  `styles.css` and `README.md` at the same time; only this thread's hunks were
  committed.

## Progress log

- [x] Surveyed the follow model and every reader of it.
- [x] Model, store migration, tallies, kit control, all four screens, export,
      quick fill. `bun run typecheck`, `bun test` (271 pass), Biome, `bun run
      build` clean.
- [x] Browser check (dev server, existing profile): v1 follows migrated;
      Disagree on the CA GOP moved it to "Disagree with (1)" and wrote v2;
      My ballot chips red with a thumbs-down, "1 against", summaries flipped
      ("your sources agree: Rob Bonta"), "3 of 3 sources followed (1 to
      disagree)"; race page tag; wizard rows, release-on-second-press, footer
      "Follow 1, disagree with 1 and see my ballot →". Test data restored.

## Open questions for the user

- (none)

## Things not to do

- Don't rewrite a disagreed source's stance in exports or on the race page: the
  record shows what they said; only the tallies flip.
- Don't edit `Wizard.tsx` while the wizard-catalog-summaries thread has
  uncommitted edits in it.
