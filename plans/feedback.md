# Feedback: public GitHub issues and private in-app reports

`plans/feedback.md`

## Goal

Give OpenSlate users a way to report problems and ideas. Asked 2026-10-21
("do we have a feedback system?" → no → "Both", then "offer to include
screenshots on private submissions"):

1. **Public:** open a GitHub issue on `cinderblock/openslate`, through issue
   forms, prefilled from the app.
2. **Private:** an in-app form that sends the message to our own
   telemetry-collector, with an **offered, previewed, opt-in screenshot**.

## Environment / context

- Branch `feat/feedback`, worktree
  `C:\Users\camer\.t3\worktrees\OpenSlate\feat-feedback`, from master
  `257759a`. The main checkout has another thread's uncommitted light-mode
  work (`SettingsPage.tsx`, `styles.css`, `main.tsx`, `index.html`), so this
  work stays out of it.
- Web app: `apps/web` (Vite + React SPA, TanStack Router with hash history,
  React Aria kit in `src/components/ui/`). Footer is in `src/App.tsx`.
  Modals follow `Wizard.tsx`: a native `<dialog>` opened with `showModal()`.
- telemetry-collector (`~/git/Personal Projects/telemetry-collector`, live at
  `https://telemetry.tomsawyerlabs.com`). Native ingest:
  `POST <endpoint>/i/<ingestKey>`, JSON, or multipart (`report` = JSON text,
  `screenshot` = file) when there's an image. 202 `{ok, event_id, issue_id,
  stored}` on success; 400/401/413/429/410 with `{ok:false, error}`.
  Default limits: body 256 KB, blob 3 MB (`worker/src/governor.ts`). Under
  load the governor may drop the blob (`storeBlobs` needs level `full`).
  Feedback (`kind: "feedback"`) never coalesces.
  For reports (not usage) the server stores the **user-agent and
  `cf-ipcountry`** (`packages/core/src/normalize.ts`).
- The app is **not registered** in the collector yet and there is no ingest
  key (`plans/usage-analytics.md`, step 5, the user's). The SDK's 0.1.0 is
  staged on npm awaiting the user's approval.
- CSP (`apps/web/public/_headers`): `connect-src 'self' https:` allows the
  collector; `img-src data: blob:` allows the screenshot preview and
  modern-screenshot's SVG/data-URL rendering; `script-src 'self'` is fine
  for a bundled library.

## Decisions (don't re-ask)

- **Both paths, one dialog** (user: "Both"). One message box; the user then
  picks *Send privately* or *Post on GitHub*. A type picker (problem / wrong
  information / idea) chooses the GitHub issue form and tags the private
  report.
- **Screenshots only on private submissions** (user). Off by default. Taking
  one shows a preview with a plain warning that it shows everything on
  screen, including picks; the user can retake, replace with their own image,
  or remove it. The GitHub path says to paste screenshots into the issue
  themselves.
- **Private sends use `fetch` directly, not the SDK's `sendFeedback`.**
  Reasons: the SDK's `send()` swallows every failure (the UI couldn't tell
  the user it didn't arrive and offer GitHub instead), and it fills
  `url` from `location.href` when none is given, which under hash routing
  carries `#/results/<signed slate>`. The wire format is small and
  documented in the collector's README.
- **Only the route template is sent as `url`** (e.g. `/results/$token`),
  never the matched value. No breadcrumbs, no state, no slate content beyond
  what the user typed or chose to attach.
- Private path is **hidden when not configured** (`VITE_TELEMETRY_ENDPOINT`
  / `VITE_TELEMETRY_KEY` unset): the dialog says so and offers GitHub only.
  Same env names the usage plan planned for.
- Screenshot renderer: **modern-screenshot** (MIT, maintained, ~186 KB
  unpacked), lazy-loaded so it costs nothing until used. The SDK bundles no
  renderer by design.
- Optional reply email on private reports, clearly optional.

## Plan / steps

All built on `feat/feedback`; **current step: merge to master and push,
waiting on the user.**

1. ~~Plan doc~~
2. GitHub issue forms: `.github/ISSUE_TEMPLATE/{problem,wrong-info,idea}.yml`
   + `config.yml`. Field ids used for prefill: `description`, `page`,
   `version`.
3. Build version: `import.meta.env.VITE_COMMIT` defined in `vite.config.ts`
   from `WORKERS_CI_COMMIT_SHA` or `git rev-parse --short HEAD`.
4. `src/lib/feedback.ts`: config, GitHub URL builder, report payload
   builder, `sendPrivateFeedback`, image fitting under the size cap.
5. `src/lib/screenshot.ts`: viewport DOM capture via modern-screenshot,
   excluding the dialog.
6. `src/components/FeedbackDialog.tsx` + footer button + `lib/feedback`
   open/close store (like `lib/wizard`).
7. Tests (`test/feedback.test.ts`), typecheck, build, lint on touched files.
8. Browser check against a local stub collector (verify the exact multipart
   body: route template only, no href).
9. README; commit.

## Findings / gotchas

- telemetry-collector SDK `send()` sets `payload.url ??= location.href`.
  With hash routing that's the full route, e.g. a shared slate token.
  **Relevant to the usage wiring too** (usage events don't go through
  `send()`, but anything that does would leak it).
- The SDK's `send()` also catches every error and only logs under `debug`,
  and `noteStatus` ignores everything but 410, so `sendFeedback` resolves the
  same whether or not the report arrived.
- A 202 isn't always "kept": the response's `stored` is `full`,
  `issue-only` or `counted`. Under load the governor can count a report
  without storing its text, so anything but `full` is shown as a failure.
- **Shared `TextArea` bug, fixed here:** it auto-sizes in a layout effect,
  and inside a `<dialog>` that isn't open yet (children's layout effects run
  before the parent's `showModal`) it measured 0 and pinned `height: 2px`. It
  now skips sizing while `getClientRects()` is empty. Only showed in the
  built app, because in dev I'd typed before looking.
- A flex-column `<dialog>` with `max-height` + `overflow-y: auto` squeezes
  its children instead of scrolling; `.feedback-dialog > * { flex-shrink: 0 }`.
- `showModal()` focuses the first focusable element (the type picker), and
  React's `autoFocus` loses to it; the dialog focuses the textarea itself
  after `showModal`.
- Testing: the PWA service worker serves stale assets after a rebuild under
  `wrangler dev`; unregister it and clear caches before re-checking. React
  Aria's visually hidden radio/checkbox inputs time out on role locators;
  click the label text.

## Verification (2026-10-21, 10:25–10:35 PM PDT (05:25–05:35Z Oct 22))

- 16 new tests in `apps/web/test/feedback.test.ts` (250 total pass),
  typecheck, biome (CRLF) on touched files, `bun run build` green. The
  dialog is a 6.6 KB lazy chunk; modern-screenshot is a separate ~27 KB
  chunk loaded only when a screenshot is taken.
- Dev server + a stand-in collector on :8799: the multipart request carried
  exactly `report` + `screenshot`; report =
  `{kind, level, message, tags:{type}, release:"257759a",
  environment, timestamp, url:"/sources"}`. No href, no hash. The saved
  PNG was the visible viewport (2560×1600 at DPR 2) with the dialog left out.
- Collector down → "Couldn't reach the feedback server… post it on GitHub
  below", draft kept. iPhone 12 Pro size: layout fine, screenshot 780×1688.
- GitHub link: `template=wrong-info.yml`, title from the first line,
  `description`, `page=/results`, `version`.
- Built app under `wrangler dev` with the production CSP header: screenshot
  renders (no CSP violations), textarea sized correctly after the fix.

## Progress log

- [x] Plan
- [x] Issue forms (`problem`, `wrong-info`, `idea`, `config.yml`)
- [x] Build version (`VITE_COMMIT`)
- [x] lib/feedback + lib/screenshot
- [x] Dialog + footer
- [x] Tests / typecheck / build
- [x] Browser check (dev + stub collector, phone size, production CSP)
- [x] README, commit
- [ ] Merge `feat/feedback` to master and push (user's go-ahead)
- [ ] Private path live: needs the collector's `openslate` app and ingest
      key (see question 1)

## Open questions for the user

1. **Private feedback is off on openslate.us until there's an ingest key.**
   Register app `openslate` in the collector's admin UI, then the key goes in
   `apps/web/.env.production` as `VITE_TELEMETRY_KEY`, with
   `VITE_TELEMETRY_ENDPOINT=https://telemetry.tomsawyerlabs.com`. Same step as
   `plans/usage-analytics.md` step 5. Until then the dialog says private
   feedback isn't set up and offers GitHub.
2. Create a `data` label on GitHub for the "Wrong or missing information"
   form? GitHub skips labels that don't exist (`bug` and `enhancement`
   exist). Recommendation: yes.
3. Merge `feat/feedback` into master and push (deploys)? Recommendation: yes.

## Things not to do

- Don't send `location.href` (or anything from the hash) with a report.
- Don't take a screenshot without the user asking for one, and never send one
  they haven't seen.
- Don't call the SDK's `installBrowserHandlers` / breadcrumbs.
- Don't add third-party script or loosen `script-src`.
