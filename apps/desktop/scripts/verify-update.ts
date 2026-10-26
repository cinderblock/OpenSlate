/**
 * Checks signed updates the way the app does: for every
 * <channel>-<os>-<arch>-update.json in <dir>, that its signature file is
 * signed by a trusted key and names the same update, and that the bundle
 * unpacks to the signed size and SHA-256.
 *
 *   bun scripts/verify-update.ts <dir> [--key ed25519:…]…
 *
 * Trusts the app's keys (src/bun/update-keys.ts) unless --key names others.
 * The files go by their live names, as Electrobun built them or as a feed
 * serves them.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TRUSTED_UPDATE_KEYS } from "../src/bun/update-keys";
import { verifyUpdate } from "../src/bun/update-signature";

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error("usage: bun scripts/verify-update.ts <dir> [--key ed25519:…]…");
const keys = args.flatMap((a, i) => (args[i - 1] === "--key" ? [a] : []));
const trusted = keys.length ? keys : TRUSTED_UPDATE_KEYS;

let checked = 0;
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith("-update.json")) continue;
  const manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
  const signature = JSON.parse(
    readFileSync(join(dir, name.replace(/-update\.json$/, "-signature.json")), "utf8"),
  );
  const statement = verifyUpdate(signature, trusted, {
    identifier: manifest.identifier,
    channel: manifest.channel,
    platform: manifest.platform,
    arch: manifest.arch,
    currentVersion: "0.0.0",
    version: manifest.version,
    hash: manifest.hash,
  });
  const tar = Bun.zstdDecompressSync(readFileSync(join(dir, manifest.artifact.file)));
  const sha256 = new Bun.CryptoHasher("sha256").update(tar).digest("hex");
  if (tar.byteLength !== statement.tarBytes || sha256 !== statement.tarSha256) {
    throw new Error(
      `${manifest.artifact.file} unpacks to ${tar.byteLength} bytes, SHA-256 ${sha256}: not what's signed`,
    );
  }
  console.log(`${name}: ${statement.identifier} ${statement.version} (${statement.hash}) ✓`);
  checked++;
}
if (checked === 0) throw new Error(`no *-update.json in ${dir}`);
