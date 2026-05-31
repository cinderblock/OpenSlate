import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Alias the workspace core package to its TypeScript source so Vite compiles it
// as part of the app (Vite does not transpile TS inside node_modules by default).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // PWA service worker is built only in production; dev keeps HMR clean.
      devOptions: { enabled: false },
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "OpenSlate",
        short_name: "OpenSlate",
        description: "Securely share and collate verifiable endorsements.",
        theme_color: "#0f1115",
        background_color: "#0f1115",
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
      },
    }),
  ],
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
