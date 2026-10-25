import { readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

// Two editions, built separately (scripts/build.ts sets OPENSLATE_FLAVOR):
// "standard" reads the public catalog live; "offline" carries a snapshot of
// it. They differ in name and identifier, so their installers don't collide
// and both can be installed side by side; each keeps its own data.
//
// No `release.baseUrl` yet: the app doesn't check for updates. Electrobun's
// update file is named only by channel and platform, so the two editions
// would need separate update locations before that's wired up.
const offline = process.env.OPENSLATE_FLAVOR === "offline";

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
} satisfies ElectrobunConfig;
