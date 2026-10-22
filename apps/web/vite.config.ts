import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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
export default defineConfig({
  plugins: [
    react(),
    // React Aria ships UI strings ("Clear search", "No results") for ~30
    // languages; the app is English-only, so keep just that. Must run first.
    { ...optimizeLocales.vite({ locales: ["en-US"] }), enforce: "pre" },
    VitePWA({
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
        ],
      },
    }),
  ],
  define: {
    "import.meta.env.VITE_COMMIT": JSON.stringify(buildCommit()),
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
});
