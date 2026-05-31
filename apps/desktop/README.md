# @openslate/desktop

A desktop wrapper around the OpenSlate web app, built with
[Electrobun](https://blackboard.sh/electrobun). It renders the same React UI in a
native window, so it's fully intercompatible with the web and CLI.

> **Status: stub.** The main-process entry ([`src/bun/index.ts`](./src/bun/index.ts))
> follows Electrobun's documented pattern, but the build configuration and view
> bundling still need to be generated and verified against the current Electrobun
> release. Electrobun is intentionally *not* a dependency yet, to keep the root
> install light.

## Finishing the setup

1. Add Electrobun:
   ```sh
   bun add -d electrobun
   ```
2. Generate the canonical project skeleton / build config (this writes the config
   file and view scaffolding for the installed version):
   ```sh
   bunx electrobun init
   ```
3. Point the app's `mainview` at the web build. Build the web app first
   (`bun run build` at the repo root → `apps/web/dist`) and either copy that output
   into the Electrobun views directory or configure Electrobun to bundle it as
   `views://mainview`.
4. Run it:
   ```sh
   bun run dev      # or: OPENSLATE_URL=http://localhost:5173 bun run dev
   bun run build    # package a distributable
   ```

`OPENSLATE_URL` lets you load a running Vite dev server instead of bundled assets
during development.

## How it stays in sync

The desktop app contains **no OpenSlate logic** — it loads the web UI, which imports
`@openslate/core` just like every other surface. Signing, verification, and the wire
format live in one place.
