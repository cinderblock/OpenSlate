import { describe, expect, test } from "bun:test";
import { encodePublicKey, generateKeyPair } from "@openslate/core";
import {
  compareVersions,
  type SignedUpdate,
  STATEMENT_TYPE,
  signUpdate,
  type UpdateExpectation,
  type UpdateStatement,
  verifyUpdate,
} from "../src/bun/update-signature";

const release = generateKeyPair();
const recovery = generateKeyPair();
const stranger = generateKeyPair();
const trusted = [encodePublicKey(release.publicKey), encodePublicKey(recovery.publicKey)];

const statement: UpdateStatement = {
  type: STATEMENT_TYPE,
  identifier: "us.openslate.desktop",
  channel: "stable",
  platform: "win",
  arch: "x64",
  version: "0.2.0",
  hash: "179yarn4vcbku",
  tarSha256: "a".repeat(64),
  tarBytes: 1234,
};

const expected: UpdateExpectation = {
  identifier: "us.openslate.desktop",
  channel: "stable",
  platform: "win",
  arch: "x64",
  currentVersion: "0.1.0",
  version: "0.2.0",
  hash: "179yarn4vcbku",
};

describe("verifyUpdate", () => {
  test("accepts an update signed by a trusted key", () => {
    expect(verifyUpdate(signUpdate(statement, [release.secretKey]), trusted, expected)).toEqual(
      statement,
    );
  });

  test("accepts the recovery key alone, or alongside an untrusted one", () => {
    expect(verifyUpdate(signUpdate(statement, [recovery.secretKey]), trusted, expected)).toEqual(
      statement,
    );
    const both = signUpdate(statement, [stranger.secretKey, recovery.secretKey]);
    expect(verifyUpdate(both, trusted, expected)).toEqual(statement);
  });

  test("rejects a key the app doesn't trust", () => {
    expect(() =>
      verifyUpdate(signUpdate(statement, [stranger.secretKey]), trusted, expected),
    ).toThrow("isn't signed by a key this app trusts");
  });

  test("rejects a trusted key's name on someone else's signature", () => {
    const forged = signUpdate(statement, [stranger.secretKey]);
    const entry = forged.signatures[0] as SignedUpdate["signatures"][number];
    entry.key = trusted[0] as string;
    expect(() => verifyUpdate(forged, trusted, expected)).toThrow("isn't signed");
  });

  test("rejects a statement changed after signing", () => {
    const signed = signUpdate(statement, [release.secretKey]);
    const tampered = {
      ...signed,
      statement: signed.statement.replace("a".repeat(64), "b".repeat(64)),
    };
    expect(() => verifyUpdate(tampered, trusted, expected)).toThrow("isn't signed");
  });

  test("rejects an update for another app, platform or build", () => {
    const signed = signUpdate(statement, [release.secretKey]);
    expect(() =>
      verifyUpdate(signed, trusted, { ...expected, identifier: "us.openslate.desktop.offline" }),
    ).toThrow("identifier");
    expect(() => verifyUpdate(signed, trusted, { ...expected, platform: "linux" })).toThrow(
      "platform",
    );
    expect(() => verifyUpdate(signed, trusted, { ...expected, arch: "arm64" })).toThrow("arch");
    expect(() => verifyUpdate(signed, trusted, { ...expected, hash: "otherbuild" })).toThrow(
      "hash",
    );
    expect(() => verifyUpdate(signed, trusted, { ...expected, version: "0.3.0" })).toThrow(
      "version",
    );
  });

  test("rejects an old signed release served again (no going back)", () => {
    const old = signUpdate({ ...statement, version: "0.1.0" }, [release.secretKey]);
    expect(() => verifyUpdate(old, trusted, { ...expected, version: "0.1.0" })).toThrow(
      "isn't newer",
    );
    const older = signUpdate({ ...statement, version: "0.0.9" }, [release.secretKey]);
    expect(() => verifyUpdate(older, trusted, { ...expected, version: "0.0.9" })).toThrow(
      "isn't newer",
    );
  });

  test("rejects malformed files and statements", () => {
    expect(() => verifyUpdate(null, trusted, expected)).toThrow("malformed");
    expect(() => verifyUpdate({ statement: "{}" }, trusted, expected)).toThrow("malformed");
    const notOurs = signUpdate({ ...statement, type: "something-else" } as never, [
      release.secretKey,
    ]);
    expect(() => verifyUpdate(notOurs, trusted, expected)).toThrow(
      "isn't an OpenSlate desktop update",
    );
    const badHash = signUpdate({ ...statement, tarSha256: "xyz" }, [release.secretKey]);
    expect(() => verifyUpdate(badHash, trusted, expected)).toThrow("tarSha256");
    const badSize = signUpdate({ ...statement, tarBytes: 0 }, [release.secretKey]);
    expect(() => verifyUpdate(badSize, trusted, expected)).toThrow("tarBytes");
  });
});

describe("compareVersions", () => {
  test("orders releases and prereleases like semver", () => {
    const ordered = [
      "0.1.0",
      "0.1.1-rc.1",
      "0.1.1-rc.2",
      "0.1.1-rc.10",
      "0.1.1",
      "0.2.0",
      "0.10.0",
      "1.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i] as string, ordered[i + 1] as string)).toBe(-1);
      expect(compareVersions(ordered[i + 1] as string, ordered[i] as string)).toBe(1);
    }
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  test("refuses things that aren't versions", () => {
    expect(() => compareVersions("1.0", "1.0.0")).toThrow("not a version");
    expect(() => compareVersions("v1.0.0", "1.0.0")).toThrow("not a version");
  });
});
