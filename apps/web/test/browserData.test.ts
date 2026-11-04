import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_FORMAT,
  buildBackup,
  CACHE_KEYS,
  describeKey,
  isOwnKey,
  LEGACY_KEYS,
  LOCAL_KEYS,
  parseBackup,
  summarizeBackup,
} from "../src/lib/browserData";
import type { StoreDump } from "../src/lib/db";

const stores: StoreDump = {
  slates: [{ token: "t1", importedAt: "2026-10-01T00:00:00Z" }],
  identities: [{ v: 1, publicKey: "ed25519:abc", secretKey: "secret", createdAt: "x" }],
  knownIdentities: [{ publicKey: "ed25519:def", source: "manual", addedAt: "x" }],
  published: [],
  subjectRaceMap: [],
};

describe("describeKey", () => {
  test("names a key the app writes", () => {
    const described = describeKey("openslate.area.v1");
    expect(described.kind).toBe("known");
    if (described.kind === "known") expect(described.group).toBe("area");
  });

  test("calls anything else a leftover", () => {
    expect(describeKey("openslate.follows.v1").kind).toBe("legacy");
    expect(describeKey("openslate.somethingOld.v0").kind).toBe("legacy");
  });
});

describe("isOwnKey", () => {
  test("only OpenSlate's keys", () => {
    expect(isOwnKey("openslate.theme.v1")).toBe(true);
    expect(isOwnKey("openslate:routing-prefs")).toBe(true);
    expect(isOwnKey("someone-else")).toBe(false);
    expect(isOwnKey("openslateish")).toBe(false);
  });
});

describe("the key catalogue", () => {
  // Every "openslate.…" / "openslate:…" string literal in the app, so a new
  // stored key can't ship without saying what it is on Settings → Your data.
  function literals(dir: string, out = new Set<string>()): Set<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) literals(path, out);
      else if (/\.tsx?$/.test(name)) {
        for (const match of readFileSync(path, "utf8").matchAll(/"(openslate[.:][\w.:-]+)"/g)) {
          if (match[1]) out.add(match[1]);
        }
      }
    }
    return out;
  }
  /** Literals that aren't storage keys. */
  const NOT_KEYS = new Set(["openslate.us", "openslate:update", BACKUP_FORMAT]);

  test("covers every key in the source", () => {
    const missing = [...literals(join(import.meta.dir, "../src"))].filter(
      (key) =>
        !NOT_KEYS.has(key) &&
        !(key in LOCAL_KEYS) &&
        !(key in LEGACY_KEYS) &&
        !CACHE_KEYS.includes(key),
    );
    expect(missing).toEqual([]);
  });
});

describe("backups", () => {
  test("round trip", () => {
    const backup = buildBackup({
      localStorage: { "openslate.area.v1": "{}", "other-site": "x" },
      stores,
      now: new Date("2026-11-03T20:00:00Z"),
    });
    expect(backup.localStorage).toEqual({ "openslate.area.v1": "{}" });
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup).toEqual(backup);
    expect(summarizeBackup(parsed.backup)).toEqual({
      slates: 1,
      identities: 1,
      contacts: 1,
      published: 0,
      settings: 1,
    });
  });

  test("can leave the secret keys out", () => {
    const backup = buildBackup({ localStorage: {}, stores, withoutIdentities: true });
    expect(backup.indexedDB.identities).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain("secret");
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
  });

  test("rejects what isn't a backup", () => {
    expect(parseBackup("not json")).toEqual({ ok: false, error: "That file isn't JSON." });
    expect(parseBackup('{"v":1}')).toEqual({
      ok: false,
      error: "That file isn't an OpenSlate backup.",
    });
  });

  test("calls a broken backup damaged", () => {
    const backup = buildBackup({ localStorage: {}, stores });
    const broken = { ...backup, indexedDB: { slates: [{ importedAt: "x" }] } };
    const parsed = parseBackup(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("damaged");
  });

  test("never restores another site's keys", () => {
    const backup = buildBackup({ localStorage: {}, stores });
    const tampered = { ...backup, localStorage: { "openslate.theme.v1": '"dark"', evil: "1" } };
    const parsed = parseBackup(JSON.stringify(tampered));
    expect(parsed.ok && parsed.backup.localStorage).toEqual({ "openslate.theme.v1": '"dark"' });
  });
});
