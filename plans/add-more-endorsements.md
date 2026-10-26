# Make "add more endorsements" obvious after setup

## Goal

Feedback from a friend (2026-10-26): "the workflow to add new endorsements after
you do the initial setup is not obvious". They're a **voter**: they ran the
Get started wizard, followed some sources, and then couldn't see how to bring
in more. (Not the Publish/Compose flow; the user confirmed this.)

## Environment / context

- Web app `apps/web`. My ballot is `/` (`MyBallotPanel.tsx`), Sources is
  `/sources` (`SourcesPanel.tsx`), hash history, TanStack Router.
- Adding happens in the "Add sources" section of Sources: the catalog browser
  (Follow/Disagree imports in one click) and Link/file/QR/paste.

## Findings

- From My ballot, the only way to Sources is the small "38 of 42 sources
  followed" link in the summary strip, or the Sources tab. Nothing says "add".
- On a phone (one column), "Add sources" sits below the Ballot data card, the
  whole Following list, the spectrum strip, everything else above it. With a
  few dozen sources it's far down the page.
- The friend's word is "endorsements", the app's is "sources".

## Plan

1. My ballot toolbar: an "Add endorsements" button that goes to Sources and
   lands on the add section (`/sources?add=true`; the page scrolls there,
   focuses the heading, then drops the param).
2. Sources: a jump button near the top on narrow screens ("Add endorsements ↓").
   On a wide screen the add column is already beside the lists.
3. Name the section "Add endorsements" so it matches the button and the tagline.
4. Point "Follow some" (My ballot's empty-followed state) and the empty-state
   "browse sources yourself" link at the add section too.

## Progress

- [x] 1–4 implemented
- [x] typecheck, tests (375 pass), Biome (CRLF config) clean on touched files
- [x] Checked in the browser, 1280×800 and iPhone 12 Pro: the My ballot button
      lands on the section and focuses its heading; `?add` is dropped after.
      On a phone it scrolls ~9,000px (that's how buried it was); on a wide
      screen it doesn't scroll at all, since the add column is already in view.
- [x] committed

## Findings (implementation)

- The scroll only happens when the heading is off-screen or below half the
  viewport. Scrolling unconditionally on a wide screen just hid the page title.
- Dropping `?add` passes `resetScroll: false`, so the router's default
  reset-to-top can't undo the jump (not tested without it).
