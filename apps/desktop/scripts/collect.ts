/**
 * Copies this machine's installer from artifacts/ into release/, named for
 * the release: OpenSlate[-Offline]-<version>-<os>-<arch><suffix>, e.g.
 * OpenSlate-Offline-0.1.0-windows-x64-Setup.zip. Electrobun's own names
 * (win-x64-OpenSlateOffline-Setup.zip) carry neither version nor a readable
 * edition. Only installers go: the updater files (stable-*) go to the
 * edition's update feed instead (sign-update.ts, feed.ts).
 *
 *   bun scripts/collect.ts
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as {
  version: string;
};
const OS: Record<string, string> = { win: "windows", macos: "macos", linux: "linux" };
const EDITION: Record<string, string> = {
  OpenSlate: "OpenSlate",
  OpenSlateOffline: "OpenSlate-Offline",
};

const from = join(desktop, "artifacts");
const to = join(desktop, "release");
mkdirSync(to, { recursive: true });

let collected = 0;
for (const name of readdirSync(from)) {
  if (name.startsWith("stable-") || name.startsWith("canary-") || name.endsWith(".patch")) continue;
  const match = /^(win|macos|linux)-(x64|arm64)-(OpenSlate|OpenSlateOffline)([-.].*)$/.exec(name);
  if (!match) throw new Error(`unexpected artifact ${name}: has Electrobun's naming changed?`);
  const [, os, arch, app, suffix] = match as unknown as [string, string, string, string, string];
  const target = `${EDITION[app]}-${version}-${OS[os]}-${arch}${suffix}`;
  copyFileSync(join(from, name), join(to, target));
  console.log(`${name} → release/${target}`);
  collected++;
}
if (collected === 0) throw new Error(`no installer in ${from}`);
