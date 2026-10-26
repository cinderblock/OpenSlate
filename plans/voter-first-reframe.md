# Voter-first reframe

## Goal

Visitors are, by default, here to get help voting (user, 2026-10-26). The site
should go straight into collecting trusted endorsements and, once it has their
address, showing their ballot. Publishing endorsements/reviews stays available
behind a deliberately less obvious entry point.

## Environment / context

- Web app `apps/web` (React, TanStack Router with hash history). Checks:
  `bun run typecheck`, `bun run lint`, `bun test`.
- Current shell: `App.tsx` header has a `[My vote | Publish]` mode switch with
  equal weight, plus "Get started" and Settings. Tagline switches per mode.
- Current onboarding: `WizardHost.tsx` opens the modal `Wizard.tsx` on a first
  visit. Steps: welcome (fork: Plan my vote / Publish endorsements) →
  election → area (`AreaPicker` → `FindDistricts`: map, location, address) →
  sources. Publish branch: `IdentityStep`.
- My ballot (`/`, `MyBallotPanel.tsx`) has an empty state with a button that
  reopens the wizard (~line 556) and its own `AreaPicker` (~line 653).
- **Contention:** another thread (plans/add-more-endorsements.md) has
  uncommitted edits in `MyBallotPanel.tsx`, `SourcesPanel.tsx`, `Wizard.tsx`,
  `router.tsx`, `styles.css`, `ContactsCard.tsx`, `ImportVerifyPanel.tsx` as of
  2026-10-26. Don't stage or overwrite them.

## Findings (what stands between a voter and their ballot today)

1. The welcome fork makes every visitor choose voter vs publisher first.
2. Election is asked before address; the address is what actually matters,
   and the election can default to the next upcoming one.
3. Publish has equal billing with My vote in the header on every page.
4. The voter flow is a modal over an empty page, not the page itself.

## Plan (design settled 2026-10-26)

1. **`GetStarted.tsx`** (from `Wizard.tsx`, via `git mv`): an inline page, not a
   dialog. My ballot renders it when nothing is imported yet (and not
   importing), or on `/?setup=true` (a re-entry linked from Sources' "Add
   endorsements"). Two numbered cards: *Where do you vote?* (AreaPicker, with an
   Election select only when the catalog has more than one) then, once that's
   confirmed, *Whose endorsements do you trust?* (the old sources step).
   "…and see my ballot" starts the background import exactly as before. No
   welcome fork, no Skip nudge (it's a page; leaving is just navigating).
   "What is OpenSlate?" becomes a collapsed `<details>`.
2. **Delete** `WizardHost.tsx`, `lib/wizard.ts`, `onboardingStore` (only the
   auto-open used it), `AlphaWizardNote` (the page-top alpha banner already
   covers an inline page; the note only existed so a modal didn't double it).
3. **Header**: the `[My vote | Publish]` switch and "Get started" go. Quiet
   header link: "Publish" (or "My ballot" while under `/publish/*`), beside
   Settings. Footer: "Publish your own endorsements". Settings: a short
   "Publish your own endorsements" card linking there.
4. **Publish side**: `IdentityStep` becomes `CreateIdentity`, shown inside
   Compose's signing card when there's no identity yet (create, then back up).
5. **Telemetry**: `wizard.finish {path}` + `wizard.skip` → `setup.finish` (no
   dims). Nothing reads event names server-side (checked: only web app + tests).
6. CSS: `wizard-*` → `setup-*`; drop dialog-only rules (backdrop, progress,
   choices, skip nudge, sticky footer, inner 50vh scroll).
7. README: rewrite the getting-started paragraphs.

## Decisions already made (don't re-ask)

1. **Onboarding is inline on My ballot**, not a modal: with no address/sources
   yet, `/` itself asks where you vote, then whose endorsements you trust, and
   the ballot fills in below. (User, 2026-10-26.)
2. **Publish entry: both** a quiet header link (replacing the mode switch) and
   footer + Settings entries. (User, 2026-10-26.)
3. **Wait for the add-more-endorsements thread to commit** before editing the
   shared files, then build on top of its work in the shared tree. (User,
   2026-10-26.)

## Open questions for the user

None right now.

## Findings / gotchas

- Inline, the sources list is ~7000px tall (no dialog to scroll inside), so
  its action bar is `position: sticky` at the bottom of the screen; otherwise
  "…and see my ballot" is a long scroll away.
- `CreateIdentity` must stay on screen after the key exists (for the backup
  step), but Compose's "no identity" condition flips the moment it's added.
  Compose keeps it up with `settingUpIdentity` until *Continue to signing*.
- `bunx biome check` on the whole tree reports ~116 pre-existing issues
  (CRLF working copies, plus lint in untouched `BallotTags.tsx` /
  `ballotCheck.ts`). Checked changed files on LF-normalized content instead.
- `@openslate/desktop` typecheck fails on this machine: `electrobun` isn't
  installed (module-not-found). Unrelated; web typechecks clean.

## Progress

- [x] User's answers on the open questions (see Decisions)
- [x] Waited for add-more-endorsements to commit (`bd1aa89`)
- [x] Implementation (plan items 1–7)
- [x] typecheck (web), biome on changed files, `bun test` (575 pass)
- [x] Checked in the browser, fresh profile: setup → follow → ballot; Publish
  → create identity → backup → signing; phone width; `/?setup=true` re-entry
- [x] README updated

## Things not to do

- Don't touch the add-more-endorsements thread's uncommitted hunks.
- Don't remove `/publish/*` routes or legacy redirects; shared links depend on them.
