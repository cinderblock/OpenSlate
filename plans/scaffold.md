# OpenSlate — Scaffold Plan

> Plan path: `plans/scaffold.md` — read this first when resuming.

## Goal

Build **OpenSlate**: an open standard + reference toolkit for securely sharing
**verifiable endorsements** for things people vote on (candidates, races, ballot
measures, arbitrary options).

A "slate" is a single shareable block of text (base64url, JWS-compact) carrying an
Ed25519 signature, so anyone can verify it wasn't tampered with — postable to a
webpage, Facebook wall, or email. Encoded positions range from "I voted for this"
to "I'm against this" to "leaning toward" plus full free-text endorsements.
Groups/candidates can publish both who they endorsed **and** who endorsed them.

Ships as: web app (self-hosted or cloud), desktop app (electrobun), CLI — all
sharing one core library so blocks are intercompatible everywhere. Open source,
to give citizens insight beyond simplified newspaper endorsements.

## Environment / context

- Machine: Windows 11 (Noook). Shell: PowerShell + Bash available.
- Working dir: `C:\Users\camer\git\Personal Projects\OpenSlate` (was empty at start).
- Runtime: **Bun** (electrobun is Bun-native, so this is fixed).
- Greenfield. `git init` performed during scaffold.

## Decisions already made (don't re-ask)

1. **Scope:** scaffold *everything* (core, cli, web, server, desktop) but keep it
   light. Backend is minimal + **stateless** — *no server-side user data*. Users
   store data in browser localStorage or external/user-controlled locations.
2. **UI:** React + Vite (SPA — drops into electrobun webview and static hosting).
3. **Wire format:** Canonical JSON (RFC 8785 JCS) + Ed25519, wrapped as a
   **JWS-compact** token (`header.payload.signature`, EdDSA / RFC 8037) for
   maximum cross-language interop and debuggability.
4. **Crypto libs:** `@noble/curves` (Ed25519), `@scure/base` (base64url/base58).
   JCS canonicalization implemented in-house (tiny, normative — avoid dep drift).
5. **Validation:** `zod` schemas are the single source of truth; export JSON
   Schema artifact for other-language implementers.
6. **Identity:** public key *is* the identity. Encoded `ed25519:<base58btc>`.
   Real-world trust is a separate, pluggable layer (domain attestation via
   `/.well-known/openslate.json`). did:key compatibility is roadmap.
7. **Decentralized-first:** a block is fully self-contained + verifiable offline.
   Import via paste / URL / file. Any server is optional discovery only.
8. **License:** MIT (code). Easily changed if a standards-style license is wanted.
9. **Lint/format:** Biome.
10. **Ballot/subject source of truth:** Voting Information Project
    (votinginfoproject.org) API. Accessed via a **stateless server-side proxy** —
    keeps the API key secret, stores/logs nothing (incl. the address), preserving
    the no-user-data rule. Wrapped behind a swappable `BallotSource` adapter so
    alternatives stay a one-file change. VIP contest/candidate IDs populate
    `Subject.id` (namespaced `vip:<id>`) so endorsements align on the same race.
    Web/desktop call the server proxy; ballot lookup is an *enhancement*, the app
    still works fully without it (manual subject entry).

## Monorepo layout

```
OpenSlate/
  package.json            # Bun workspaces root
  tsconfig.base.json      # strict ESM base
  biome.json
  SPEC.md                 # the open standard (normative)
  packages/
    core/                 # @openslate/core — the standard's reference impl
      src/{types,schema,canonical,crypto,envelope,slate,identity}.ts
      scripts/export-schema.ts
      test/slate.test.ts
    cli/                  # @openslate/cli — keygen/sign/verify/inspect
  apps/
    web/                  # @openslate/web — React+Vite SPA (localStorage only)
    server/               # @openslate/server — minimal stateless Hono
    desktop/              # @openslate/desktop — electrobun stub (wraps web build)
```

Key invariant: **core is the single source of truth.** web/desktop/server/cli all
import `@openslate/core`; nothing reimplements signing or the schema.

## Wire format (v1) — summary (full detail in SPEC.md)

- Token = `base64url(header) "." base64url(payload) "." base64url(signature)`.
- header = `{"alg":"EdDSA","typ":"openslate+jws","kid":"<issuer.key>"}`.
- payload = JCS-canonical JSON of `SlatePayload` (v, issuer, issued_at, positions,
  endorsed_by, context, expires_at?, nonce?).
- signing input = ASCII(`b64url(header).b64url(payload)`); signature = Ed25519 over it.
- verify: decode → schema-validate → check `kid == issuer.key` → Ed25519 verify
  using `payload.issuer.key` → expiry check (warning).

## Plan / steps

1. [in progress] Living plan doc.
2. Root tooling (package.json, tsconfig.base, biome, .gitignore, .editorconfig,
   LICENSE, README) + `git init`.
3. SPEC.md.
4. `@openslate/core` + Bun tests.
5. `@openslate/cli`.
6. `apps/web` (React+Vite).
7. `apps/server` (Hono, stateless) + VIP ballot proxy (`/api/ballot`, swappable
   `BallotSource` adapter, `VIP_API_KEY` env, stores nothing).
8. `apps/desktop` (electrobun stub).
9. `bun install`, run tests, typecheck, CLI round-trip; fix issues.

## Status — scaffold COMPLETE (2026-05-28)

All 9 steps done. Verified green:
- `bun test` → 9 pass (sign/verify round-trip, tamper detection, unknown-field
  rejection, expiry warning, identity serialization, JCS).
- `bun run typecheck` → core, cli, web, server all exit 0 (desktop intentionally
  excluded — no electrobun dep yet, so no typecheck script).
- `bun run build` → web builds (63 modules, ~247 kB / 77 kB gzip; core bundled via
  the Vite alias).
- `bun run lint` → clean (Biome; 36 files).
- Server smoke test → `/api/health` ok, `/api/ballot` 501 without key, `/api/verify`
  returns `valid:true` for a CLI-signed token (proves CLI <-> server intercompat).
- CLI round-trip keygen -> sign -> verify -> inspect works.

### Next steps (post-scaffold)
1. Wire a real `VIP_API_KEY`; confirm `normalize()` against live voterInfoQuery data.
2. Add a ballot view to the web app that calls `/api/ballot` and pre-fills subjects
   (filter-to-my-ballot, manage selections).
3. Finish desktop: `bun add -d electrobun`, `bunx electrobun init`, bundle web build.
4. `endorsed_by` cross-endorsement proving (fetch + verify referenced slates).
5. Domain attestation tooling (`/.well-known/openslate.json`) end-to-end.

## TanStack refactor (web shell) — decided 2026-05-29

Adopt Router + Query + DB for `apps/web` (keep `@openslate/core` + server untouched).
Versions (npm latest at decision): `@tanstack/react-router` ^1.170.9,
`@tanstack/react-query` ^5.100.14, `@tanstack/react-query-persist-client` ^5.100.14,
`@tanstack/react-db` ^0.1.85, `@tanstack/db` ^0.6.7, `idb-keyval` ^6.2.4 (keep `idb` ^8).

File map:
- `lib/db.ts` — idb stores `slates` (keyPath token) + `identities` (keyPath publicKey).
- `lib/collections.ts` — TanStack DB collections seeded async from idb via custom
  `sync` ({begin,write,commit,markReady}); mutations persisted via onInsert/onDelete.
  Helpers `setActiveIdentity`/`forgetIdentity` (one active identity).
- `lib/query.ts` — QueryClient + idb-keyval Persister; on-demand slate-from-URL query.
- `router.tsx` — code-based routes (`/` identity, `/compose`, `/import`, `/collate`) + Register.
- `App.tsx` — RootLayout (nav Links + Outlet).
- panels read via `useLiveQuery`, mutate via `collection.insert/delete`; ImportVerify
  fetches URLs through Query. `store.ts` removed.

Confirmed API facts: localOnly collection only has SYNC `initialData`, so async
IndexedDB seed needs raw `createCollection` + custom `sync`. PendingMutation fields:
`type,key,modified,changes,original`. `useLiveQuery` supports `groupBy`+`count`, but
collation groups in JS (grouping key needs the crypto-verified payload, not a column).

### TanStack refactor — VERIFIED 2026-05-29

Static: typecheck (all), `bun test` (9), web build, Biome lint — all green. Browser
smoke test (Vite dev + Chrome): Router SPA nav works, identity generate (real Ed25519
keygen) → renders, **persists across full reload** (IndexedDB → collection `sync`
seed), forget/delete works, `useLiveQuery` is reactive, Compose route renders.
FULL LOOP verified: Compose signs a real JWS → Import verifies VALID (matching issuer)
→ Save → Collate groups by race ("Mayor of Springfield → ENDORSE A. Candidate — Alice").
Imported slate persists across a hard `/collate` reload AND a dev-server restart
(IndexedDB is client-side). Deep-link `/collate` falls back to index.html (Vite SPA).
PROD NOTE: static hosts must be configured for SPA fallback (serve index.html for
unknown routes); the optional Hono server could add `serveStatic` for this.

KEY GOTCHA (cost real debugging time): a TanStack DB **local collection with a custom
async `sync`** treats the sync as authoritative, so `collection.insert()` is silently
rolled back unless the sync **re-emits** the change. Fix: capture `begin/write/commit`
from the sync params and call them in `onInsert`/`onDelete` after persisting to
IndexedDB (see `lib/collections.ts`). Symptom was: insert throws no error, IndexedDB
stays empty, UI never updates. Direct `collection.insert` from devtools "worked" only
because... it didn't persist either until the confirm pattern was added.
NOTE: automated ref-clicks didn't dispatch to React in Chrome MCP; coordinate clicks did.

## Findings / gotchas

- electrobun: main process `import { BrowserWindow } from "electrobun/bun"`, load
  UI via `url: "views://mainview/index.html"` (bundled assets). Scaffold canonical
  config with `bunx electrobun init`. Exact config schema NOT confirmed — desktop
  kept a light stub; verify against https://blackboard.sh/electrobun/docs/ .
- Vite + workspace TS dep: Vite won't transpile TS in node_modules by default.
  Fix: alias `@openslate/core` → its `src/index.ts` in vite.config so it's compiled
  as app source. Mirror with tsconfig `paths` for tsc.
- electrobun NOT added to deps yet (pre-1.0, version uncertain) so `bun install`
  stays green. Desktop README instructs `bun add -d electrobun` / `bunx electrobun init`.
- JCS: our payloads only use strings + one bounded number (weight 0..1), so
  `JSON.stringify` number formatting is JCS-compliant; in-house JCS = recursive
  key-sort + JSON.stringify. JWS verify uses *transmitted* bytes, so canonical form
  only matters for reproducible creation, not verification robustness.
- VIP API: CONFIRMED. Access is via the Google Civic Information API `voterInfoQuery`:
  `GET https://www.googleapis.com/civicinfo/v2/voterinfo?address=&electionId=&key=`
  (Google API-key auth, ~25k/day free). API is active — only the *representatives*
  endpoint was deprecated, not elections/voterinfo. KEY GOTCHA: contests have NO
  stable per-contest id (only `district.id` + election id). So `normalize()`
  synthesizes a deterministic `Subject.id = vip:<electionId>:<district>:<slug(office
  |referendumTitle)>` so different issuers' endorsements align. Contest fields:
  type, office, referendumTitle/Subtitle/Text, candidates[], district{name,id,scope}.
  Adapter lives in apps/server/src/ballot.ts (swappable `BallotSource`, `GOOGLE_API_KEY`).
- CORRECTION (what the user ACTUALLY has): NOT a Civic Information API key. They were
  approved for the **Voting Information Tool customizer** (customize.votinginfotool.org)
  — a brandable, hosted, CLIENT-SIDE ballot-lookup widget. So the server `/api/ballot`
  proxy is OPTIONAL / self-host-only (env renamed `GOOGLE_API_KEY`). The VIT fits
  the user's hard "no central server" rule (Google/DW run the lookup, not us); open
  question is whether it exposes structured contest data to pre-fill subjects or is
  display-only. Low priority per user ("if not, whatever"). See [[openslate-no-central-server]].
- Storage: user chose **IndexedDB** (via `idb`). Done in apps/web: `lib/db.ts` (kv +
  per-slate `slates` store) + `lib/store.ts` (in-memory snapshot for sync React reads,
  async hydrate, write-through). Old localStorage `storage.ts` removed.
- OPEN: user asked whether to rebuild the web app's plumbing on **TanStack** (Router /
  Query / DB / Start). Pending decision — keep `@openslate/core` regardless; only the
  app shell (routing/state/fetch/cache) is in scope. See open questions.

## Open questions for the user

1. License — MIT assumed. Prefer Apache-2.0 (patent grant) for the standard? (rec: keep MIT for now)
2. ~~Subject identifiers~~ RESOLVED → use Voting Information Project as source of
   truth; VIP IDs populate `Subject.id` as `vip:<id>`. Free-form title remains for
   off-ballot/manual items. (Still open: which exact VIP endpoint/auth — see findings.)

## Things not to do

- Do NOT persist user data server-side. Server stays stateless.
- Do NOT reimplement signing/schema outside core.
- Do NOT fabricate electrobun config — keep desktop a flagged stub until confirmed.
- Do NOT add heavy state/UI libraries; keep web lean (plain React + CSS).
