import { describe, expect, test } from "bun:test";
import { utf8 } from "../src/canonical";
import { encodePublicKey, generateKeyPair } from "../src/crypto";
import {
  checkGuideFile,
  type GuideItem,
  type GuideManifest,
  guideItemFiles,
  guideItemSchema,
  parseGuideItem,
  sha256,
  signGuide,
  verifyGuide,
} from "../src/guide";

const SUBJECT = {
  title: "California — Proposition 1 (Housing Bonds)",
  kind: "measure",
  jurisdiction: "us/ca",
  election: "2026-11-03",
};
const SOURCE = "https://voterguide.sos.ca.gov/propositions/1/";

const ITEM: GuideItem = {
  v: 1,
  subject: SUBJECT,
  retrieved_at: "2026-10-22T20:00:00Z",
  summary: {
    by: "Attorney General",
    blocks: [
      {
        type: "ul",
        items: [[{ type: "p", text: ["Authorizes ", { strong: ["$10 billion"] }, "."] }]],
      },
    ],
    source: SOURCE,
  },
  arguments: [
    {
      side: "Yes",
      rebuttal: false,
      blocks: [
        { type: "p", text: [{ em: ["VOTE YES"] }] },
        { type: "img", file: "img/1/chart.jpg" },
      ],
      signers: [{ name: "Jane Doe", title: "President", organization: "Housing Now" }],
      source: SOURCE,
      disclaimer: "Arguments printed on this page are the opinions of the authors.",
    },
  ],
  documents: [
    {
      title: "Text of proposed law",
      file: "pdf/prop1.pdf",
      source: SOURCE,
      mediaType: "application/pdf",
    },
  ],
};

async function manifestFor(
  item: GuideItem,
  key: string,
): Promise<{ manifest: GuideManifest; bytes: Uint8Array }> {
  const bytes = utf8(JSON.stringify(item));
  return {
    bytes,
    manifest: {
      v: 1,
      issuer: { key, name: "Test researcher", kind: "researcher" },
      issued_at: "2026-10-22T20:00:00Z",
      context: { election: "2026-11-03", jurisdiction: "us/ca" },
      attribution: {
        of: { name: "California Secretary of State", kind: "election-authority" },
        mode: "scraped",
        retrieved_at: "2026-10-22T20:00:00Z",
      },
      items: [{ subject: SUBJECT, file: "items/prop-1.json" }],
      files: { "items/prop-1.json": await sha256(bytes) },
    },
  };
}

describe("guide", () => {
  test("sha256 matches a known vector", async () => {
    expect(await sha256(utf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("a signed manifest verifies, and its files check by hash", async () => {
    const keys = generateKeyPair();
    const key = encodePublicKey(keys.publicKey);
    const { manifest, bytes } = await manifestFor(ITEM, key);
    const token = signGuide(manifest, keys.secretKey);

    const result = verifyGuide(token, { expectedKey: key });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    if (!result.manifest) throw new Error("expected a manifest");

    expect(await checkGuideFile(result.manifest, "items/prop-1.json", bytes)).toBe(true);
    expect(await checkGuideFile(result.manifest, "items/prop-1.json", utf8("tampered"))).toBe(
      false,
    );
    expect(await checkGuideFile(result.manifest, "items/other.json", bytes)).toBe(false);
    expect(parseGuideItem(bytes)).toEqual(ITEM);
  });

  test("a different signer than the catalog expects is rejected", async () => {
    const keys = generateKeyPair();
    const { manifest } = await manifestFor(ITEM, encodePublicKey(keys.publicKey));
    const token = signGuide(manifest, keys.secretKey);
    const other = encodePublicKey(generateKeyPair().publicKey);
    const result = verifyGuide(token, { expectedKey: other });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("expected");
  });

  test("tampering breaks the signature", async () => {
    const keys = generateKeyPair();
    const { manifest } = await manifestFor(ITEM, encodePublicKey(keys.publicKey));
    const token = signGuide(manifest, keys.secretKey);
    const [h, p, s] = token.split(".") as [string, string, string];
    const forged = JSON.parse(Buffer.from(p, "base64url").toString());
    forged.files["items/prop-1.json"] = "0".repeat(64);
    const result = verifyGuide(
      `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("signature verification failed");
  });

  test("a slate token is not a guide", async () => {
    const keys = generateKeyPair();
    const { manifest } = await manifestFor(ITEM, encodePublicKey(keys.publicKey));
    const token = signGuide(manifest, keys.secretKey);
    const [, p, s] = token.split(".") as [string, string, string];
    const slateHeader = Buffer.from(
      JSON.stringify({ alg: "EdDSA", kid: manifest.issuer.key, typ: "openslate+jws" }),
    ).toString("base64url");
    expect(verifyGuide(`${slateHeader}.${p}.${s}`).valid).toBe(false);
  });

  test("paths must stay inside the guide", () => {
    for (const file of ["../secret.json", "/etc/passwd", "https://evil.example/x.jpg"]) {
      const bad = {
        ...ITEM,
        documents: [{ title: "Text", file, source: SOURCE, mediaType: "application/pdf" }],
      };
      expect(guideItemSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("an item's files include images inside passages, photos and documents", () => {
    expect(guideItemFiles(ITEM).sort()).toEqual(["img/1/chart.jpg", "pdf/prop1.pdf"]);
  });

  test("a document may be linked at a page instead of mirrored", () => {
    const linked = {
      ...ITEM,
      documents: [
        {
          title: "Legal text",
          source: SOURCE,
          mediaType: "application/pdf",
          page: 150,
          sha256: "a".repeat(64),
        },
      ],
    };
    const parsed = guideItemSchema.parse(linked);
    expect(guideItemFiles(parsed)).toEqual(["img/1/chart.jpg"]);
    const badPage = { ...linked, documents: [{ ...linked.documents[0], page: 0 }] };
    expect(guideItemSchema.safeParse(badPage).success).toBe(false);
  });

  test("a measure's full text may be a passage, and its images count as files", () => {
    const withText = guideItemSchema.parse({
      ...ITEM,
      fullText: {
        title: "Full text of Measure C",
        blocks: [
          { type: "p", text: ["Section 1."] },
          { type: "img", file: "img/c/map.png" },
        ],
        source: SOURCE,
      },
    });
    expect(guideItemFiles(withText)).toContain("img/c/map.png");
  });

  test("paid arguments carry who paid for them", () => {
    const paid = {
      ...ITEM,
      arguments: [
        {
          side: "No",
          rebuttal: false,
          title: "Vote no",
          blocks: [{ type: "p", text: ["No."] }],
          signers: [{ name: "Jane Doe" }],
          paid: true,
          funding: "The true source(s) of funds for the printing fee of this argument: Jane Doe.",
          source: SOURCE,
        },
      ],
    };
    expect(guideItemSchema.safeParse(paid).success).toBe(true);
  });
});
