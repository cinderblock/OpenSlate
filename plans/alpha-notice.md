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
