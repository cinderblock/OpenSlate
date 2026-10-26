# Alpha notice: say early and plainly that OpenSlate is alpha, AI-written

## Goal

Tell people, early and prominently, that OpenSlate is alpha software written by
AI with a human watching over it: things might be wrong, change, or break, so
check what matters, and come help when you find a problem. Strongest on the
public site (openslate.us) and the README; lighter in copies people run
themselves.

## Decisions already made (don't re-ask)

- **Public site vs. self-run is decided at runtime by hostname** (`openslate.us`
  or `www.openslate.us`), not by a build variable: `.env.production` applies to
  any `vite build`, so a fork building from source on its own domain would
  otherwise get the public site's treatment.
- **Public site:** an expanded banner at the top of every page until the
  visitor clicks "Got it" (remembered in localStorage); after that, and always
  on self-run copies, a small "Alpha" button beside the brand re-opens it.
- **Welcome screen (wizard):** on the public site a warn-styled callout right
  under the intro, above the two choices; on self-run copies a single item in
  "What is OpenSlate?". The wizard is modal, so the page banner behind it
  doesn't count as "early".
- **README:** a GitHub `[!WARNING]` callout right under the tagline, replacing
  the stale "Status: early scaffold" line at the end of the intro.

## Progress log

- [x] `apps/web/src/lib/alpha.ts` (`isPublicSite`, dismissal) + test
- [x] `AlphaNotice.tsx` banner and badge, wired into `App.tsx`
- [x] Wizard welcome callout / list item
- [x] README callout and description
- [x] typecheck, tests, checked in the browser (public and self-run)
- [x] committed
- [x] deployed: merged with origin in a temporary worktree (`95c5a0e`, carrying
      only `bb2e377` and the six commits before it) and pushed; live on
      openslate.us 2026-10-24 10:13 PM PDT (05:13Z), checked in a fresh browser

## Follow-up: legal disclaimer in the footer

Asked for 2026-10-25: a general "don't hold us liable" line, framed as what
OpenSlate is (public information in one consistent format, filtered to where
you vote), plus collating it with endorsements shared privately and your own
picks, whose views are their authors', not OpenSlate's. Plain language, not
lawyer-reviewed.

- **Every copy, not just the public site:** it names "its authors, and whoever
  runs this copy", so it reads right on forks too.
- **Where:** a small `.footer-legal` paragraph under the usage switch in
  `App.tsx`; the README's License section (now "License and disclaimer") says
  the same. The MIT license already covers the code itself.

- [x] footer paragraph + style, README section
- [x] typecheck, tests, checked in the browser (desktop and phone)
- [x] committed
- [x] deployed: another thread merged it into fix/sub-county-districts and
      pushed (`5fce7fe`); live on openslate.us 2026-10-25 12:54 AM PDT (07:54Z)

## Follow-up: more protection, and fewer repeats

Proposed and approved ("do it all") 2026-10-25:

- **Footer, tightened:** the same length as before, now also saying OpenSlate
  endorses no one and that a name or logo doesn't mean its owner endorses
  OpenSlate. The README section matches, and adds that being in the public
  catalog isn't an endorsement.
- **Corrections:** the secondhand-report banner asks "Does this misstate
  <org>'s positions? Tell us so it can be corrected" (opens Send feedback).
- **Printed picks:** print hides the footer, so the picks sheet ends with
  "Printed from OpenSlate on <date>. One voter's picks, not an official or
  sample ballot..."
- **Wizard counts as "Got it":** the banner state moved from per-component
  React state to a small shared store in `lib/alpha.ts`, so the wizard's
  alpha note can close (and remember closing) the page banner. A first-time
  visitor now reads the warning once, in the wizard; the badge still
  reopens the banner. I had suggested holding this until after the
  2026-11-03 election; the user chose to do it now.

- [x] all of the above, typecheck, lint, 496 tests
- [x] checked in the browser with localhost temporarily counted as the public
      site: wizard closes the banner, the badge reopens it, the corrections
      line on 350 SF Action's secondhand report, the print note text
- [x] committed
- [x] deployed with the user's OK (carrying another thread's docs commit
      `9254da1`); live on openslate.us 2026-10-25 1:10 AM PDT (08:10Z), checked in
      a fresh browser: wizard note shown, banner closed, new footer text

## Findings / gotchas

- **Checking the public-site look locally** means pretending localhost is
  openslate.us: add `"localhost"` to `PUBLIC_SITE_HOSTS` in
  `apps/web/src/lib/alpha.ts` for the session, and never commit it. Clear
  `openslate.alphaNoticeDismissed.v1` from localStorage to see the banner again.
- **Phone layout:** with flex-wrap, the banner either put the icon on its own
  row or squeezed the text beside "Got it". It's a grid now, and under 40rem
  "Got it" drops below the text.
- **The wizard and styles.css are shared** with the disagree-sources thread's
  uncommitted work; this task's commit staged only its own hunks.
