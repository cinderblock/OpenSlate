import { readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

// Two editions, built separately (scripts/build.ts sets OPENSLATE_FLAVOR):
// "standard" reads the public catalog live; "offline" carries a snapshot of
// it. They differ in name and identifier, so their installers don't collide
// and both can be installed side by side; each keeps its own data.
const offline = process.env.OPENSLATE_FLAVOR === "offline";

// Where each edition's updates come from: a release of its own, since
// Electrobun's update.json is named only by channel and platform
// (scripts/feed.ts fills it). Baked into every install, so it can't change
// without an update. OPENSLATE_UPDATE_BASE_URL points a test build elsewhere.
const updates =
  process.env.OPENSLATE_UPDATE_BASE_URL ??
  `https://github.com/cinderblock/OpenSlate/releases/download/desktop-updates-${offline ? "offline" : "standard"}`;

// A test build trusts only this key for updates, instead of the real ones
// (src/bun/update-keys.ts), so test updates and real ones never mix.
const testUpdateKey = process.env.OPENSLATE_TEST_UPDATE_KEY;

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default {
  app: {
    name: offline ? "OpenSlate Offline" : "OpenSlate",
    identifier: offline ? "us.openslate.desktop.offline" : "us.openslate.desktop",
    version,
    description: "Verifiable endorsements, and your ballot planned with the sources you trust.",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
      define: testUpdateKey ? { OPENSLATE_TEST_UPDATE_KEY: JSON.stringify(testUpdateKey) } : {},
    },
    // The web app, built for the desktop (and the catalog snapshot inside it
    // for the offline edition): staged here by scripts/build.ts, since copy
    // sources can't reach outside this folder.
    copy: {
      web: "views/mainview",
    },
    watchIgnore: ["web/**"],
    mac: {
      bundleCEF: false,
      icons: "icons/icon.iconset",
    },
    win: {
      bundleCEF: false,
      icon: "icons/icon.ico",
    },
    linux: {
      bundleCEF: false,
      icon: "icons/icon.png",
    },
  },
  release: {
    baseUrl: updates,
  },
} satisfies ElectrobunConfig;
