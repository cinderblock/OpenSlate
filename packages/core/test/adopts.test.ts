import { describe, expect, test } from "bun:test";
import { resolveAdoptions, slateEntity, subjectIdentity } from "../src/adopts";
import { generateKeyPair } from "../src/crypto";
import { slatePayloadSchema } from "../src/schema";
import { createSlate, verifySlate } from "../src/slate";

const E = "2026-11-03";
const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
const ag = { title: "Attorney General", kind: "race", jurisdiction: "us/ca", election: E };
const prop1 = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: E };
const mayor = { title: "Mayor", kind: "race", jurisdiction: "us/ca/x", election: E };

const researcher = generateKeyPair();
const attribution = (name: string) => ({
  of: { name, kind: "organization" },
  mode: "scraped" as const,
  retrieved_at: "2026-10-19T00:00:00Z",
});

/** A state party's secondhand slate, signed by the same researcher key as the county's. */
function stateParty(issuedAt = "2026-10-01T00:00:00Z") {
  return createSlate({
    keyPair: researcher,
    issuer: { name: "Researcher", kind: "researcher" },
    attribution: attribution("State Party"),
    context: { election: E },
    issuedAt,
    positions: [
      { subject: gov, stance: "endorse", choice: "Alice" },
      { subject: ag, stance: "endorse", choice: "Bob" },
      { subject: prop1, stance: "endorse", choice: "Yes" },
    ],
  });
}

describe("schema", () => {
  test("an adoption needs a uri or an embedded slate", () => {
    const base = {
      v: 1,
      issuer: { key: "ed25519:x" },
      issued_at: "2026-10-19T00:00:00Z",
      positions: [],
    };
    expect(slatePayloadSchema.safeParse({ ...base, adopts: [{ issuer: "k" }] }).success).toBe(
      false,
    );
    expect(
      slatePayloadSchema.safeParse({ ...base, adopts: [{ issuer: "k", uri: "https://e.org/s" }] })
        .success,
    ).toBe(true);
    expect(
      slatePayloadSchema.safeParse({ ...base, adopts: [{ issuer: "k", uri: "x", extra: 1 }] })
        .success,
    ).toBe(false);
  });
});

describe("slateEntity / subjectIdentity", () => {
  test("secondhand slates are identified by issuer + attributed name", () => {
    const { payload } = stateParty();
    expect(slateEntity(payload)).toMatchObject({ name: "State Party", secondhand: true });
    expect(slateEntity(payload).id).toBe(`${payload.issuer.key}#State Party`);
  });

  test("subject id wins over title", () => {
    expect(subjectIdentity({ title: "A", id: "vip:1" })).toBe("vip:1");
    expect(subjectIdentity(gov)).toBe(`t:Governor|j:us/ca|e:${E}`);
  });
});

describe("resolveAdoptions", () => {
  test("adopts only the listed subjects, from a live (uri) reference", () => {
    const state = stateParty();
    const county = createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher" },
      attribution: attribution("County Party"),
      positions: [{ subject: mayor, stance: "endorse", choice: "Carol" }],
      adopts: [
        {
          issuer: state.payload.issuer.key,
          of: "State Party",
          election: E,
          uri: "https://example.org/state-party.slate",
          subjects: [gov, prop1],
        },
      ],
    });
    expect(verifySlate(county.token).valid).toBe(true);
    const result = resolveAdoptions(county.payload, () => [state.token]);
    expect(result.unresolved).toEqual([]);
    expect(result.positions.map((p) => p.position.subject.title).sort()).toEqual([
      "Governor",
      "Prop 1",
    ]);
    expect(result.positions[0]?.via[0]?.entity.name).toBe("State Party");
  });

  test("an embedded snapshot resolves with no lookup; the newest matching copy wins", () => {
    const snapshot = stateParty("2026-10-01T00:00:00Z");
    const reissued = createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher" },
      attribution: attribution("State Party"),
      context: { election: E },
      issuedAt: "2026-10-15T00:00:00Z",
      positions: [{ subject: gov, stance: "endorse", choice: "Dana" }],
    });
    const adopting = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Firsthand Club" },
      positions: [],
      adopts: [{ issuer: snapshot.payload.issuer.key, slate: snapshot.token, subjects: [gov] }],
    });
    expect(resolveAdoptions(adopting.payload, () => []).positions[0]?.position.choice).toBe(
      "Alice",
    );
    expect(
      resolveAdoptions(adopting.payload, () => [reissued.token]).positions[0]?.position.choice,
    ).toBe("Dana");
  });

  test("own positions win; mismatched or forged slates don't resolve", () => {
    const state = stateParty();
    const other = createSlate({
      keyPair: researcher,
      issuer: { name: "Researcher" },
      attribution: attribution("Some Other Org"),
      context: { election: E },
      positions: [{ subject: gov, stance: "endorse", choice: "Eve" }],
    });
    const county = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "County" },
      positions: [{ subject: gov, stance: "endorse", choice: "Zed" }],
      adopts: [{ issuer: state.payload.issuer.key, of: "State Party", uri: "https://e.org/s" }],
    });
    // Only the wrong org is available: unresolved, no positions invented.
    const none = resolveAdoptions(county.payload, () => [other.token]);
    expect(none.positions).toEqual([]);
    expect(none.unresolved).toHaveLength(1);
    // Tampered token: rejected.
    const [h, , s] = state.token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...state.payload, positions: [] })).toString("base64url")}.${s}`;
    expect(resolveAdoptions(county.payload, () => [forged]).unresolved).toHaveLength(1);
    // The real one: Governor is the county's own, so only AG + Prop 1 are adopted.
    const real = resolveAdoptions(county.payload, () => [state.token]);
    expect(real.positions.map((p) => p.position.subject.title).sort()).toEqual([
      "Attorney General",
      "Prop 1",
    ]);
  });

  test("follows chains, stops at cycles and at maxDepth", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const c = generateKeyPair();
    const slateC = createSlate({
      keyPair: c,
      issuer: { name: "C" },
      positions: [{ subject: prop1, stance: "endorse", choice: "No" }],
    });
    const keyA = createSlate({ keyPair: a, issuer: {}, positions: [] }).payload.issuer.key;
    const slateB = createSlate({
      keyPair: b,
      issuer: { name: "B" },
      positions: [{ subject: ag, stance: "endorse", choice: "Bob" }],
      adopts: [
        { issuer: slateC.payload.issuer.key, uri: "https://e.org/c" },
        { issuer: keyA, uri: "https://e.org/a" },
      ],
    });
    const slateA = createSlate({
      keyPair: a,
      issuer: { name: "A" },
      positions: [],
      adopts: [{ issuer: slateB.payload.issuer.key, uri: "https://e.org/b" }],
    });
    const all = [slateA.token, slateB.token, slateC.token];
    const find = () => all;
    const deep = resolveAdoptions(slateA.payload, find);
    expect(deep.positions.map((p) => [p.position.subject.title, p.via.length])).toEqual([
      ["Attorney General", 1],
      ["Prop 1", 2],
    ]);
    expect(deep.unresolved).toEqual([]); // B → A is a cycle, silently skipped
    const shallow = resolveAdoptions(slateA.payload, find, { maxDepth: 1 });
    expect(shallow.positions).toHaveLength(1);
    expect(shallow.unresolved.map((u) => u.depth)).toEqual([2, 2]);
  });
});
