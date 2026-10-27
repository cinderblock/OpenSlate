/**
 * Each edition's update feed: a GitHub release of its own
 * (desktop-updates-standard, desktop-updates-offline) that the app's
 * release.baseUrl points at (electrobun.config.ts). Electrobun names its
 * update.json only by channel and platform, so the two editions can't share
 * one, nor live in the versioned release.
 *
 *   bun scripts/feed.ts stage <edition> <dir>
 *       From the tag's release job: uploads the signed updater files in <dir>
 *       (Electrobun's, plus scripts/sign-update.ts's signatures) without
 *       making them live: update.json, the signature and the bundle go up as
 *       v<version>-…, beside the live ones. Patches (named for the build they
 *       start from) go up as they are; nothing fetches them until update.json
 *       names a newer build.
 *   bun scripts/feed.ts publish <edition> <version>
 *       When the versioned release is published: copies v<version>-… to the
 *       live names (bundle, then signature, then update.json), then deletes
 *       files older than the version before it.
 *
 * The live bundle keeps Electrobun's own name: the next release's build
 * fetches it from there to make a patch from this version (a few KB instead
 * of the whole bundle), and won't if it's named differently.
 *
 * Uses the gh CLI, with GH_TOKEN and GH_REPO (or the current repo).
 */
import { mkdtempSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [command, edition, arg] = process.argv.slice(2);
if (edition !== "standard" && edition !== "offline")
  throw new Error("edition must be standard or offline");
const tag = `desktop-updates-${edition}`;
/** Live metadata: stable-win-x64-update.json, stable-win-x64-signature.json. */
const liveMetadata = /^[a-z]+-[a-z]+-[a-z0-9]+-(update|signature)\.json$/;

interface Manifest {
  version: string;
  artifact: { file: string };
}

function gh(...args: string[]): string {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function assets(): string[] {
  const view = JSON.parse(gh("release", "view", tag, "--json", "assets")) as {
    assets: { name: string }[];
  };
  return view.assets.map((a) => a.name);
}

function download(dir: string, ...names: string[]): void {
  gh(
    "release",
    "download",
    tag,
    ...names.flatMap((n) => ["--pattern", n]),
    "--dir",
    dir,
    "--clobber",
  );
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** The files a version staged (v<version>-assets.json), or none if it isn't there. */
function staged(version: string, dir: string): string[] {
  try {
    download(dir, `v${version}-assets.json`);
    return JSON.parse(readFileSync(join(dir, `v${version}-assets.json`), "utf8")) as string[];
  } catch {
    return [];
  }
}

/** The live update.json files' contents (none before the first publish). */
function liveManifests(dir: string): Manifest[] {
  const names = assets().filter((n) => liveMetadata.test(n) && n.endsWith("-update.json"));
  if (names.length === 0) return [];
  download(join(dir, "live"), ...names);
  return names.map((n) => readManifest(join(dir, "live", n)));
}

if (command === "stage") {
  const dir = arg;
  if (!dir) throw new Error("usage: feed.ts stage <edition> <dir>");
  const names = readdirSync(dir);
  const manifests = names.filter((n) => liveMetadata.test(n) && n.endsWith("-update.json"));
  if (manifests.length === 0) throw new Error(`no *-update.json in ${dir}`);

  const versions = new Set<string>();
  const upload: string[] = [];
  for (const name of manifests) {
    const { version, artifact } = readManifest(join(dir, name));
    versions.add(version);
    const signature = name.replace(/-update\.json$/, "-signature.json");
    if (!names.includes(signature)) throw new Error(`${name} isn't signed (no ${signature})`);
    for (const file of [name, signature, artifact.file]) {
      renameSync(join(dir, file), join(dir, `v${version}-${file}`));
      upload.push(`v${version}-${file}`);
    }
  }
  if (versions.size !== 1)
    throw new Error(`the platforms disagree on the version: ${[...versions].join(", ")}`);
  const [version] = versions as unknown as [string];
  upload.push(...names.filter((n) => n.endsWith(".patch")));
  const list = `v${version}-assets.json`;
  upload.push(list);
  await Bun.write(join(dir, list), JSON.stringify(upload, null, 2));

  try {
    gh("release", "view", tag, "--json", "tagName");
  } catch {
    const product = edition === "offline" ? "OpenSlate Offline" : "OpenSlate";
    gh(
      "release",
      "create",
      tag,
      "--prerelease",
      "--title",
      `Update feed: ${product} desktop`,
      "--notes",
      `The files ${product}'s desktop app downloads to update itself, each checked against a signature before it's installed. To install OpenSlate, download it from the latest desktop-v… release instead.`,
      ...(process.env.GITHUB_SHA ? ["--target", process.env.GITHUB_SHA] : []),
    );
    console.log(`created the ${tag} release`);
  }
  // Restaging a live version would replace what its live signatures describe.
  const live = liveManifests(mkdtempSync(join(tmpdir(), "openslate-feed-")));
  if (live.some((m) => m.version === version)) {
    throw new Error(`${version} is already live in ${tag}; release a new version instead`);
  }
  gh("release", "upload", tag, "--clobber", ...upload.map((n) => join(dir, n)));
  console.log(`staged ${version} in ${tag}:\n  ${upload.join("\n  ")}`);
} else if (command === "publish") {
  const version = arg?.replace(/^desktop-v/, "");
  if (!version) throw new Error("usage: feed.ts publish <edition> <version>");
  const dir = mkdtempSync(join(tmpdir(), "openslate-feed-"));

  const current = staged(version, dir);
  if (current.length === 0) throw new Error(`${tag} has nothing staged for ${version}`);
  const present = new Set(assets());
  const missing = current.filter((n) => !present.has(n));
  if (missing.length)
    throw new Error(`${tag} is missing files staged for ${version}: ${missing.join(", ")}`);

  // The version being replaced (none the first time).
  const previous = new Set(liveManifests(dir).map((m) => m.version));
  previous.delete(version);

  // Bundles, then signatures, then update.json: when update.json names the
  // new build, everything it leads to is already there.
  const prefix = `v${version}-`;
  const toCopy = current.filter((n) => n.startsWith(prefix) && !n.endsWith("-assets.json"));
  download(join(dir, "new"), ...toCopy);
  for (const name of toCopy)
    renameSync(join(dir, "new", name), join(dir, "new", name.slice(prefix.length)));
  const steps: [string, (n: string) => boolean][] = [
    ["bundles", (n) => n.endsWith(".tar.zst")],
    ["signatures", (n) => n.endsWith("-signature.json")],
    ["update.json", (n) => n.endsWith("-update.json")],
  ];
  const liveNames = toCopy.map((n) => n.slice(prefix.length));
  for (const [what, matches] of steps) {
    const files = liveNames.filter(matches);
    gh("release", "upload", tag, "--clobber", ...files.map((n) => join(dir, "new", n)));
    console.log(`live ${what}: ${files.join(", ")}`);
  }

  // Keep what's live, this version's files and the one before's; delete the rest.
  const keep = new Set([...liveNames, ...current]);
  for (const v of previous) for (const name of staged(v, dir)) keep.add(name);
  for (const name of present) {
    if (keep.has(name)) continue;
    gh("release", "delete-asset", tag, name, "--yes");
    console.log(`deleted ${name}`);
  }
  console.log(
    `${tag} now serves ${version}${previous.size ? ` (was ${[...previous].join(", ")})` : ""}`,
  );
} else {
  throw new Error("usage: feed.ts stage|publish <edition> …");
}
