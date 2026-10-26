// Self-updates: Electrobun's updater fetches and installs them, and this
// checks each one is ours before it may be installed (update-signature.ts).
//
// Shortly after launch, then every few hours: ask the feed whether there's an
// update; if so, fetch its signed statement and check it (a trusted key, the
// same update Electrobun found, newer than this version); let Electrobun
// download it; hash the bundle it prepared against the signed checksum. Only
// then does the page offer "Restart to update", and the restart checks the
// bundle once more before handing it to Electrobun to install.
//
// For testing a build by hand or in a script:
//   OPENSLATE_UPDATE_LOG=<file>       appends what happens, one JSON line each
//   OPENSLATE_UPDATE_AUTO_APPLY=1     installs a checked update without asking
import { appendFileSync, createReadStream, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Electrobun, { type BrowserWindow, Updater } from "electrobun/main";
import { TRUSTED_UPDATE_KEYS } from "./update-keys";
import { type UpdateStatement, signatureFileName, verifyUpdate } from "./update-signature";

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

const PLATFORM =
  process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";

const logFile = process.env.OPENSLATE_UPDATE_LOG;
const autoApply = process.env.OPENSLATE_UPDATE_AUTO_APPLY === "1";

function log(event: string, details: Record<string, unknown> = {}): void {
  const line = { at: new Date().toISOString(), event, ...details };
  console.log("[update]", JSON.stringify(line));
  if (logFile) appendFileSync(logFile, `${JSON.stringify(line)}\n`);
}

type LocalInfo = Awaited<ReturnType<typeof Updater.getLocalInfo>>;

/** An update that's downloaded, checked, and waiting for a restart. */
let ready: UpdateStatement | undefined;

// One thing at a time: a check, or installing what an earlier one found.
let queue: Promise<void> = Promise.resolve();
function serially(task: () => Promise<void>): Promise<void> {
  queue = queue
    .then(task)
    .catch((error) => log("failed", { error: String(error?.message ?? error) }));
  return queue;
}

/** Starts checking for updates, and lets the page in `window` offer them. */
export function startUpdates(window: BrowserWindow): void {
  if (logFile)
    Updater.onStatusChange((entry) =>
      log(`electrobun:${entry.status}`, { message: entry.message }),
    );

  const announce = () => {
    if (!ready) return;
    const detail = JSON.stringify({ version: ready.version });
    window.webview.executeJavascript(
      `window.__openslateUpdate = ${detail}; window.dispatchEvent(new CustomEvent("openslate:update", { detail: window.__openslateUpdate }));`,
    );
  };
  // A reloaded page asks again by loading.
  window.webview.on("dom-ready", announce);

  Electrobun.events.on("host-message", (event) => {
    const detail = (event as { data?: { detail?: { openslateUpdate?: unknown } } }).data?.detail;
    if (detail?.openslateUpdate === "apply") void serially(install);
  });

  const run = () =>
    serially(async () => {
      if (!(await check())) return;
      announce();
      if (autoApply) await install();
    });
  setTimeout(run, FIRST_CHECK_MS);
  setInterval(run, CHECK_EVERY_MS);
}

/** Finds, downloads and checks an update; says whether one is ready. */
async function check(): Promise<boolean> {
  const local = await Updater.getLocalInfo();
  if (!local.baseUrl || local.channel === "dev") return false;

  const found = await Updater.checkForUpdate();
  if (found.error) throw new Error(found.error);
  log("checked", {
    current: local.version,
    latest: found.version,
    updateAvailable: found.updateAvailable,
  });
  if (!found.updateAvailable) return false;
  if (ready?.hash === found.hash) return true;

  const url = `${local.baseUrl.replace(/\/+$/, "")}/${signatureFileName(local.channel, PLATFORM, ARCH)}`;
  const response = await fetch(`${url}?${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`no signature for the update (HTTP ${response.status} for ${url})`);
  const statement = verifyUpdate(await response.json(), TRUSTED_UPDATE_KEYS, {
    identifier: local.identifier,
    channel: local.channel,
    platform: PLATFORM,
    arch: ARCH,
    currentVersion: local.version,
    version: found.version,
    hash: found.hash,
  });
  log("signature-verified", { version: statement.version, hash: statement.hash });

  // A patch builds the new bundle from this version's; if what it built (or
  // a full download) doesn't match, drop it and the patch base, and try once
  // more with a full download.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await Updater.downloadUpdate();
    const info = Updater.updateInfo();
    if (!info.updateReady || info.hash !== statement.hash) {
      throw new Error(info.error || "the update didn't download");
    }
    const problem = await checkBundle(local, statement);
    if (!problem) {
      ready = statement;
      log("ready", { version: statement.version });
      return true;
    }
    log("bundle-rejected", { attempt, problem });
    await discard(local, statement);
  }
  throw new Error("the downloaded update doesn't match its signature");
}

/** Hands the checked update to Electrobun, which quits, installs it and restarts. */
async function install(): Promise<void> {
  if (!ready) return;
  const local = await Updater.getLocalInfo();
  const problem = await checkBundle(local, ready);
  if (problem) {
    log("bundle-rejected", { problem, at: "install" });
    await discard(local, ready);
    ready = undefined;
    return;
  }
  log("installing", { version: ready.version });
  await Updater.applyUpdate();
}

/** The update Electrobun has prepared to install: its record, and the bundle it names. */
async function prepared(local: LocalInfo) {
  const folder = join(await Updater.appDataFolder(), "self-extraction");
  const record = join(folder, ".electrobun-prepared-update.json");
  const bundle = (hash: string) => resolve(join(folder, `${hash}.tar`));
  return { folder, record, bundle, patchBase: bundle(local.hash) };
}

/** Why the prepared bundle isn't the signed one, or undefined if it is. */
async function checkBundle(
  local: LocalInfo,
  statement: UpdateStatement,
): Promise<string | undefined> {
  const { record, bundle } = await prepared(local);
  let preparedUpdate: { hash?: unknown; retained_tar_path?: unknown };
  try {
    preparedUpdate = JSON.parse(readFileSync(record, "utf8"));
  } catch {
    return "nothing is prepared";
  }
  const path = bundle(statement.hash);
  if (
    preparedUpdate.hash !== statement.hash ||
    typeof preparedUpdate.retained_tar_path !== "string"
  ) {
    return "a different update is prepared";
  }
  if (resolve(preparedUpdate.retained_tar_path) !== path)
    return "the prepared bundle is somewhere else";

  const size = statSync(path, { throwIfNoEntry: false })?.size;
  if (size !== statement.tarBytes)
    return `the bundle is ${size ?? "no"} bytes, not ${statement.tarBytes}`;
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  const sha256 = hasher.digest("hex");
  return sha256 === statement.tarSha256 ? undefined : `the bundle's SHA-256 is ${sha256}`;
}

/** Forgets a prepared update, and the patch base, so the next try downloads it whole. */
async function discard(local: LocalInfo, statement: UpdateStatement): Promise<void> {
  const { record, bundle, patchBase } = await prepared(local);
  for (const path of [record, bundle(statement.hash), patchBase]) rmSync(path, { force: true });
}
