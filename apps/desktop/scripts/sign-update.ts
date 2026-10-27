/**
 * Signs the updates in a folder of Electrobun's updater files for one edition
 * (the release job gathers each platform's there): for every
 * <channel>-<os>-<arch>-update.json, unpacks the bundle it names, hashes it,
 * and writes the signed statement beside it as
 * <channel>-<os>-<arch>-signature.json (src/bun/update-signature.ts).
 *
 *   OPENSLATE_UPDATE_SIGNING_KEY=ed25519:… bun scripts/sign-update.ts <dir>
 *
 * The variable holds one or more secret keys (whitespace or comma between);
 * each signs. Lines starting with # are ignored, so a key file can be used
 * as is.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSecretKey, encodePublicKey, publicKeyFromSecret } from "@openslate/core";
import {
  STATEMENT_TYPE,
  signatureFileName,
  signUpdate,
  type UpdateStatement,
} from "../src/bun/update-signature";

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun scripts/sign-update.ts <dir>");

const keys = (process.env.OPENSLATE_UPDATE_SIGNING_KEY ?? "")
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("#"))
  .join(" ")
  .split(/[\s,]+/)
  .filter(Boolean)
  .map(decodeSecretKey);
if (keys.length === 0) throw new Error("OPENSLATE_UPDATE_SIGNING_KEY is empty");
for (const key of keys) console.log(`signing with ${encodePublicKey(publicKeyFromSecret(key))}`);

let signed = 0;
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith("-update.json")) continue;
  const manifest = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
    identifier: string;
    channel: string;
    platform: string;
    arch: string;
    version: string;
    hash: string;
    artifact: { file: string };
  };
  const tar = Bun.zstdDecompressSync(readFileSync(join(dir, manifest.artifact.file)));
  const statement: UpdateStatement = {
    type: STATEMENT_TYPE,
    identifier: manifest.identifier,
    channel: manifest.channel,
    platform: manifest.platform,
    arch: manifest.arch,
    version: manifest.version,
    hash: manifest.hash,
    tarSha256: new Bun.CryptoHasher("sha256").update(tar).digest("hex"),
    tarBytes: tar.byteLength,
  };
  const out = signatureFileName(manifest.channel, manifest.platform, manifest.arch);
  writeFileSync(join(dir, out), `${JSON.stringify(signUpdate(statement, keys), null, 2)}\n`);
  console.log(
    `${out}: ${statement.identifier} ${statement.version} (${statement.hash}), tar ${statement.tarSha256}`,
  );
  signed++;
}
if (signed === 0) throw new Error(`no *-update.json in ${dir}`);
