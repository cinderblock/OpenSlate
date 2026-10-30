import { describe, expect, test } from "bun:test";
import {
  countOf,
  isCount,
  isFollowed,
  normaliseEntityUri,
  sourceIdOf,
  sourceOf,
  standingOf,
  standingOfCount,
} from "../src/lib/sources";

const researcher = { key: "ed25519:RESEARCHER", name: "OpenSlate Public Endorsements" };

describe("sourceOf", () => {
  test("a firsthand slate's source is its issuer", () => {
    const source = sourceOf({
      issuer: { key: "ed25519:ALICE", name: "Alice", kind: "individual" },
    });
    expect(source).toEqual({
      id: "key:ed25519:ALICE",
      name: "Alice",
      kind: "individual",
      secondhand: false,
      signerKey: "ed25519:ALICE",
      signerName: "Alice",
    });
  });

  test("a secondhand report's source is the reported entity, not the researcher", () => {
    const source = sourceOf({
      issuer: researcher,
      attribution: { of: { name: "SPUR", uri: "https://www.spur.org/", kind: "organization" } },
    });
    expect(source.id).toBe("of:spur.org");
    expect(source.name).toBe("SPUR");
    expect(source.secondhand).toBe(true);
    expect(source.signerKey).toBe("ed25519:RESEARCHER");
    expect(source.signerName).toBe("OpenSlate Public Endorsements");
  });

  test("two orgs reported by the same researcher are different sources", () => {
    const a = sourceIdOf({ issuer: researcher, attribution: { of: { name: "SPUR" } } });
    const b = sourceIdOf({ issuer: researcher, attribution: { of: { name: "GrowSF" } } });
    expect(a).not.toBe(b);
  });

  test("the same org reported by two researchers is one source", () => {
    const of = { name: "Sierra Club California", uri: "https://www.sierraclub.org/california" };
    const a = sourceIdOf({ issuer: researcher, attribution: { of } });
    const b = sourceIdOf({
      issuer: { key: "ed25519:OTHER" },
      attribution: { of: { ...of, uri: "http://sierraclub.org/California/" } },
    });
    expect(a).toBe(b);
  });

  test("falls back to the lowercased name when there's no usable uri", () => {
    expect(sourceIdOf({ issuer: researcher, attribution: { of: { name: " LA Forward " } } })).toBe(
      "of:la forward",
    );
    expect(
      sourceIdOf({ issuer: researcher, attribution: { of: { name: "X", uri: "mailto:x@y.z" } } }),
    ).toBe("of:x");
  });
});

describe("normaliseEntityUri", () => {
  test("drops scheme, www, trailing slash, query and fragment", () => {
    expect(normaliseEntityUri("https://www.Example.org/Path/?q=1#x")).toBe("example.org/path");
  });
  test("rejects non-http and junk", () => {
    expect(normaliseEntityUri("ftp://example.org")).toBeUndefined();
    expect(normaliseEntityUri("not a url")).toBeUndefined();
    expect(normaliseEntityUri(undefined)).toBeUndefined();
  });
});

describe("standingOf / isFollowed", () => {
  test("undecided sources are followed; explicit choices win", () => {
    expect(standingOf({}, "of:spur.org")).toBe("follow");
    expect(isFollowed({}, "of:spur.org")).toBe(true);
    expect(isFollowed({ "of:spur.org": 0 }, "of:spur.org")).toBe(false);
    expect(isFollowed({ "of:spur.org": 1 }, "of:spur.org")).toBe(true);
  });
  test("a source you disagree with is still followed", () => {
    expect(standingOf({ "of:spur.org": -1 }, "of:spur.org")).toBe("disagree");
    expect(isFollowed({ "of:spur.org": -1 }, "of:spur.org")).toBe(true);
  });
});

describe("countOf / standingOfCount", () => {
  test("undecided sources count once; any number is kept, without limit", () => {
    expect(countOf({}, "of:spur.org")).toBe(1);
    expect(countOf({ "of:spur.org": 250.5 }, "of:spur.org")).toBe(250.5);
    expect(countOf({ "of:spur.org": 0 }, "of:spur.org")).toBe(0);
  });
  test("the sign says which way it counts, and 0 is off", () => {
    expect(standingOfCount(0.25)).toBe("follow");
    expect(standingOfCount(-40)).toBe("disagree");
    expect(standingOfCount(0)).toBe("off");
  });
  test("only finite numbers are counts", () => {
    expect(isCount(-1.5)).toBe(true);
    expect(isCount(Number.NaN)).toBe(false);
    expect(isCount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCount("follow")).toBe(false);
  });
});
