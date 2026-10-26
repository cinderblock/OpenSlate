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

## Proposed plan (awaiting user's calls; see Open questions)

1. Drop the welcome fork. The first visit goes straight to the voter flow.
2. Reorder to address → sources → ballot. Election auto-selects the next
   upcoming one, with a small "change election" control rather than a step.
3. Replace the header mode switch with a quiet "Publish" entry point. Inside
   `/publish/*` keep the Publish tabs plus a clear way back to My ballot.
4. Taglines and copy: voter language everywhere by default.
5. Keep `IdentityStep` reachable from the Publish side (first visit to
   `/publish` with no identity), not from the voter onboarding.
6. Usage telemetry: `wizard.finish` `path` dim may lose "publish"; update
   `USAGE_SCHEMA` accordingly.
7. README: update the "how it's used" framing.

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

## Progress

- [x] User's answers on the open questions (see Decisions)
- [ ] **Current:** waiting for add-more-endorsements thread to commit
- [ ] Implementation
- [ ] typecheck, lint, test; checked in browser at desktop and phone widths
- [ ] README updated

## Things not to do

- Don't touch the add-more-endorsements thread's uncommitted hunks.
- Don't remove `/publish/*` routes or legacy redirects; shared links depend on them.
