import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { deriveIngestKey } from "telemetry-collector-core";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { type ManifestOptions, VitePWA } from "vite-plugin-pwa";
import { US_STATES } from "./src/lib/regions/usStates";

// Which build this is, for feedback reports and issue links (src/lib/feedback.ts).
// Workers Builds sets WORKERS_CI_COMMIT_SHA; locally, ask git.
function buildCommit(): string {
  const ci = process.env.WORKERS_CI_COMMIT_SHA;
  if (ci) return ci.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// The public ingest key for usage stats and private feedback (src/lib/telemetry.ts,
// src/lib/feedback.ts). Workers Builds holds the collector's app secret as a
// secret build variable; the key is derived from it here, offline, and only the
// key reaches the bundle. Builds without the secret (local, forks) report
// nowhere unless an .env file sets VITE_TELEMETRY_KEY.
const appSecret = process.env.TELEMETRY_COLLECTOR_APP_SECRET?.trim() || undefined;
const ingestKey = appSecret ? await deriveIngestKey(appSecret, "openslate", "web") : undefined;

/** Fails the build if the app secret itself turns up in any output file. */
function neverBundle(secret: string | undefined): Plugin {
  return {
    name: "openslate:never-bundle-app-secret",
    apply: "build",
    generateBundle(_options, bundle) {
      if (!secret) return;
      for (const file of Object.values(bundle)) {
        const text =
          file.type === "chunk"
            ? file.code
            : typeof file.source === "string"
              ? file.source
              : new TextDecoder().decode(file.source);
        if (text.includes(secret)) this.error(`${file.fileName} contains the telemetry app secret`);
      }
    },
  };
}

// The CLI as one file with no dependencies, served beside the instructions an
// agent follows to turn a friend's voter guide into a slate
// (public/agents/import-friends-guide.md). It's emitted here, not by a package
// script, so every `vite build` ships it, and it needs nothing but Node to run.
function agentTool(): Plugin {
  return {
    name: "openslate:agent-tool",
    apply: "build",
    async generateBundle() {
      const { outputFiles } = await esbuild({
        entryPoints: [fileURLToPath(new URL("../../packages/cli/src/index.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "node20",
      });
      const source = outputFiles[0]?.contents;
      if (!source) this.error("the CLI bundle came out empty");
      this.emitFile({ type: "asset", fileName: "agents/openslate.mjs", source });
    },
  };
}

// Every page reads the catalog's list (CatalogUpdater, All races, Compare),
// but the app only asks for it once it has booted and, on All races, once its
// worker has started: 1.5-3 s into a first visit on a phone. A preload in the
// page itself starts it with the HTML, and the app's own fetch (query.ts
// `catalogQueryOptions`, a plain cross-origin GET) is answered from it. What
// the app asks for first is `shards.json`, beside the catalog's index
// (src/lib/catalogShards.ts): that's what's preloaded. The shards it names
// depend on where the voter votes, which only the app knows, and a catalog
// with no `shards.json` costs one small 404. Not for a catalog shipped with
// the app (a relative URL): that's local, and a same-origin fetch wouldn't
// match an anonymous preload.
function preloadCatalog(catalog: string | undefined): Plugin {
  const url = catalog || "https://catalog.openslate.us/index.json";
  return {
    name: "openslate:preload-catalog",
    transformIndexHtml() {
      if (!/^https:\/\//i.test(url)) return [];
      const href = new URL("shards.json", url).href;
      return [
        {
          tag: "link",
          attrs: { rel: "preload", href, as: "fetch", crossorigin: "anonymous" },
          injectTo: "head",
        },
      ];
    },
  };
}

// One app serves every state, and a state's short address is the app with the
// state's postal code after it: openslate.us/va (src/lib/regions `linkedRegion`
// reads it). Every route is after the "#", so a static host has nothing at
// /va unless a file is there: the page is written again as va.html for each
// state, which Workers static assets (and GitHub Pages) serve at /va. The
// copies are the page byte for byte; what differs is the address the app
// finds itself at. `_redirects` sends the code as people write it (/VA) to
// the lower-case one: Workers static assets read that file, other hosts
// ignore it. Not for the desktop build, whose page has one address.
function statePages(): Plugin {
  const codes = [...US_STATES.values()].map((state) => state.code.toLowerCase());
  return {
    name: "openslate:state-pages",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") this.error("no index.html to copy for the states' pages");
      for (const code of codes) {
        this.emitFile({ type: "asset", fileName: `${code}.html`, source: page.source });
      }
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: codes.map((code) => `/${code.toUpperCase()} /${code} 302\n`).join(""),
      });
    },
  };
}

// The installed app's splash screen and title bar match the page: light and
// dark --bg from src/styles.css (test/theme.test.ts checks). color_scheme_dark
// is the manifest's dark override (spec 2026; Safari has it, Chrome plans to);
// browsers without it show the light colours. vite-plugin-pwa's types don't
// know it yet, and a spread skips the excess-property check.
const manifestColors: Partial<ManifestOptions> & {
  color_scheme_dark: Pick<ManifestOptions, "theme_color" | "background_color">;
} = {
  theme_color: "#f3f4f6",
  background_color: "#f3f4f6",
  color_scheme_dark: { theme_color: "#0f1115", background_color: "#0f1115" },
};

// Alias the workspace core package to its TypeScript source so Vite compiles it
// as part of the app (Vite does not transpile TS inside node_modules by default).
//
// `--mode desktop` builds for the desktop app (apps/desktop): settings from
// .env.desktop instead of .env.production, and no service worker, since its
// pages load from views://, where service workers can't register.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // React Aria ships UI strings ("Clear search", "No results") for ~30
    // languages; the app is English-only, so keep just that. Must run first.
    { ...optimizeLocales.vite({ locales: ["en-US"] }), enforce: "pre" },
    neverBundle(appSecret),
    agentTool(),
    preloadCatalog(loadEnv(mode, process.cwd(), "VITE_").VITE_PUBLIC_ENDORSEMENTS_CATALOG),
    ...(mode === "desktop" ? [] : [statePages()]),
    VitePWA({
      disable: mode === "desktop",
      registerType: "autoUpdate",
      // PWA service worker is built only in production; dev keeps HMR clean.
      devOptions: { enabled: false },
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "OpenSlate",
        short_name: "OpenSlate",
        description: "Securely share and collate verifiable endorsements.",
        ...manifestColors,
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
        // The states' pages (statePages) are index.html again: navigateFallback
        // already answers /va with the one copy precached.
        globIgnores: ["??.html"],
        // API responses (ballot, elections) are cached client-side by TanStack
        // Query's IndexedDB persister, not by the service worker.
        navigateFallback: "/index.html",
        // /agents/ is plain files for agents (agentTool), never a route.
        navigateFallbackDenylist: [/^\/api\//, /^\/agents\//],
        // Boundary data for finding your districts on this device (src/lib/geo.ts):
        // too big to precache for everyone, kept (and refreshed in the background)
        // once someone has used it, so the map and "Use my location" work offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/geo/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "openslate-geo", expiration: { maxEntries: 8 } },
          },
          // Endorser logos, from the public catalog's host (src/lib/endorsers.ts).
          // Cross-origin images come back opaque (status 0), so accept those too.
          {
            urlPattern: ({ request, url }) =>
              request.destination === "image" && /\/orgs\/[^/]+\/logo\.[a-z]+$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "openslate-logos",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  define: {
    "import.meta.env.VITE_COMMIT": JSON.stringify(buildCommit()),
    ...(ingestKey ? { "import.meta.env.VITE_TELEMETRY_KEY": JSON.stringify(ingestKey) } : {}),
  },
  resolve: {
    alias: {
      "@openslate/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    // In dev, proxy API calls (e.g. ballot lookup) to the local server.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
}));
