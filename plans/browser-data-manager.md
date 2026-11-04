# Browser data manager ("Your data")

## Goal

The user opened openslate.us on their phone. Old example slates they had imported long ago
showed on My ballot as raw public keys (`ed25519:…`) instead of names. They had no easy way
to see or clean up what the browser holds. Asked for: a "manage browser data" page that
lists everything OpenSlate keeps in this browser and makes it easy to remove things, back
everything up, restore, and reset.

## Environment / context

- App: `apps/web` (Vite + React 18, TanStack Router with hash history, react-aria-components kit in `src/components/ui`).
- Storage layers, all client-side (no central server, a hard constraint):
  - **localStorage**: every key starts `openslate.` or `openslate:`. Most go through
    `createLocalStore` (`src/lib/localStore.ts`), which caches values and keeps a
    memory fallback, so a plain `localStorage.removeItem` is not seen by a live store.
  - **IndexedDB `openslate`** (`src/lib/db.ts`, v5): stores `slates`, `identities`
    (holds secret keys), `knownIdentities` (contacts), `published`, `subjectRaceMap`.
    The app reads them through TanStack DB collections (`src/lib/collections.ts`).
  - **idb-keyval default DB** (`keyval-store`): `openslate.query-cache` (persisted
    react-query cache) and `openslate.catalogCopy.v1` (catalog copy). Both are re-fetchable caches.
  - **Cache Storage**: PWA service worker app shell (vite-plugin-pwa). Left alone.

## Root cause of the "hashed" names

`sourceOf()` (`src/lib/sources.ts`) names a source `entity.name ?? input.issuer.key`.
A slate signed by an identity with no name therefore shows its full public key wherever
sources are named (My ballot, Sources). The immediate workaround is Sources → remove on
those rows.

## Decisions already made (don't re-ask)

- Build the full page, not just a reset button (user picked "Yes, full page").
- Lives under Settings at `/settings/data`. Settings gets a panel linking to it. My ballot's
  "Export" stays: it exports the ballot, which is a different thing.

## Plan / steps

1. `localStore.ts`: a registry of live stores plus `reset()`, so the data page can clear a key and every reader sees it.
2. `lib/browserData.ts`: a key catalogue (label, description, group) for every known
   localStorage key, an inventory of what's present, unknown/legacy detection, backup
   build/parse (zod), restore (replace or merge), clear caches, reset everything.
3. `removeSlates` in `lib/myVote.ts`: the Sources page's remove logic extracted, so both pages
   behave the same (delete slates, mark source removed, forget follow).
4. `components/BrowserDataPage.tsx`: storage use, backup/restore, imported slates
   (grouped, multi-select, remove), identities/contacts/published counts with links,
   settings entries (reset each), leftovers from older versions, caches, reset everything.
5. Unnamed signers: show a short key (`a1b2c3d4…wxyz`) rather than the whole public key.
6. Tests for the pure parts (backup parse/round trip, key classification).
7. README: mention the page.

## Findings / gotchas

- `createLocalStore.readRaw` returns `localStorage.getItem(key) ?? memory`, so after a raw
  `removeItem` the store keeps serving the old value from memory. Reset has to go through the store.
- Restore and reset-everything reload the page afterwards: collections and stores hold
  in-memory copies, and reloading is the reliable way to re-read everything.
- The catalogue guard test caught `openslate.watchView.v1` (another thread's Live layout
  key) on its first run: any new stored key must get an entry in `LOCAL_KEYS`.
- After reset, `openslate.ballotDraft.v1` comes straight back as an empty draft: the app
  writes it on load. Harmless.

## Progress log

- [x] localStore registry + reset (`removeLocalKey`)
- [x] browserData lib (catalogue, backup/restore, caches, reset)
- [x] removal shared with Sources: `removeSlates` in `lib/myVote.ts` (not a separate file)
- [x] BrowserDataPage + `/settings/data` route + Settings panel
- [x] short key for unnamed signers (`shortKey` moved to `lib/sources.ts`)
- [x] tests: `test/browserData.test.ts`, including a guard that every `openslate.*` key in the source is catalogued
- [x] README
- [x] typecheck, tests, build; headless check of the built app at a phone viewport: list, backup, remove unnamed slate, remove leftover key, merge-restore, reset everything, no console errors
- [x] deployed: on master via another thread's push, live on openslate.us on 2026-11-03

## Open questions for the user

(none)

## Things not to do

- Don't clear Cache Storage or unregister the service worker in "reset everything": that
  breaks offline use and doesn't hold user data.
- Don't `deleteDB("openslate")` while the app holds a connection (it blocks). Clear the stores instead.
