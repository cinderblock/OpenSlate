import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import react from "@vitejs/plugin-react";
import { deriveIngestKey } from "telemetry-collector-core";
import { type Plugin, defineConfig } from "vite";
import { type ManifestOptions, VitePWA } from "vite-plugin-pwa";

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
        // API responses (ballot, elections) are cached client-side by TanStack
        // Query's IndexedDB persister, not by the service worker.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
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
