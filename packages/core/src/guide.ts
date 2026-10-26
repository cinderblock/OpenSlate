import { z } from "zod";
import { canonicalize, utf8 } from "./canonical";
import { b64url, decodePublicKey, sign as edSign } from "./crypto";
import { type DecodedSlate, decodeToken, verifySignature } from "./envelope";
import { attributionSchema, contextSchema, httpUrl, issuerSchema, subjectSchema } from "./schema";

/**
 * A voter guide: what an election authority publishes about the things on
 * the ballot (candidate statements and photos, a measure's official summary,
 * analysis, arguments and full text). Not anyone's position, so it never goes
 * in a slate. A researcher signs one small manifest per election; the manifest
 * lists every published file with its SHA-256, so each item, photo and PDF can
 * be fetched on its own and checked before use.
 */

/** JWS `typ` for a signed guide manifest. Distinct from slates (`openslate+jws`). */
export const GUIDE_TYP = "openslate-guide+jws";

const rfc3339 = z.string().datetime({ offset: true });

/** A path relative to the manifest: no scheme, no `..`, no leading slash. */
const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) => !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith("/") && !p.split("/").includes(".."),
    {
      message: "must be a relative path inside the guide",
    },
  );

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex SHA-256");

/** Inline text: plain runs, emphasis and strong emphasis, nested as published. */
export type Inline = string | { em: Inline[] } | { strong: Inline[] };
export const inlineSchema: z.ZodType<Inline> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({ em: z.array(inlineSchema) }).strict(),
    z.object({ strong: z.array(inlineSchema) }).strict(),
  ]),
);

/**
 * Block content: a small, safe subset of what voter guides print. Renderers
 * build elements from it; there is never raw HTML to inject.
 */
export type Block =
  | { type: "h"; level: 2 | 3 | 4; text: Inline[] }
  | { type: "p"; text: Inline[] }
  | { type: "ul" | "ol"; items: Block[][] }
  | { type: "table"; caption?: string; rows: { header?: boolean; text: Inline[] }[][] }
  | { type: "img"; file: string; alt?: string };
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("h"),
        level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        text: z.array(inlineSchema),
      })
      .strict(),
    z.object({ type: z.literal("p"), text: z.array(inlineSchema) }).strict(),
    z.object({ type: z.enum(["ul", "ol"]), items: z.array(z.array(blockSchema)) }).strict(),
    z
      .object({
        type: z.literal("table"),
        caption: z.string().optional(),
        rows: z.array(
          z.array(
            z.object({ header: z.boolean().optional(), text: z.array(inlineSchema) }).strict(),
          ),
        ),
      })
      .strict(),
    z.object({ type: z.literal("img"), file: relativePath, alt: z.string().optional() }).strict(),
  ]),
);

/** A passage as published: its content, where it came from, and the publisher's caveat. */
export const passageSchema = z
  .object({
    /** What the guide calls it, e.g. "Digest", "Controller's Statement on “B”". */
    title: z.string().min(1).optional(),
    /** Who wrote it, e.g. "Attorney General", "Legislative Analyst", or the candidate. */
    by: z.string().min(1).optional(),
    blocks: z.array(blockSchema),
    source: httpUrl,
    /** The publisher's own caveat, verbatim (e.g. "not checked for accuracy by any official agency"). */
    disclaimer: z.string().optional(),
  })
  .strict();
export type Passage = z.infer<typeof passageSchema>;

export const photoSchema = z
  .object({
    file: relativePath,
    alt: z.string().optional(),
    /** Where the original was published. */
    source: httpUrl,
    credit: z.string().optional(),
    license: z.string().optional(),
  })
  .strict();
export type Photo = z.infer<typeof photoSchema>;

export const candidateInfoSchema = z
  .object({
    /** Matches a slate position's `choice` on the same subject. */
    choice: z.string().min(1),
    photo: photoSchema.optional(),
    /** The candidate's own statement. Never a position: shown, not tallied. */
    statement: passageSchema.optional(),
    /** Contact lines printed with the statement (address, phone, email, web). */
    contact: z.array(z.string()).optional(),
  })
  .strict();
export type CandidateInfo = z.infer<typeof candidateInfoSchema>;

export const signerSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    organization: z.string().optional(),
  })
  .strict();
export type Signer = z.infer<typeof signerSchema>;

export const argumentSchema = z
  .object({
    /** The choice the argument asks for ("Yes" / "No" on a measure). */
    side: z.string().min(1),
    /** A rebuttal answers the other side's argument. */
    rebuttal: z.boolean(),
    /** Its headline, when the guide prints one (paid arguments usually do). */
    title: z.string().min(1).optional(),
    blocks: z.array(blockSchema),
    signers: z.array(signerSchema),
    /** A note printed under the signatures (e.g. "*For identification purposes only …"). */
    footnote: z.string().min(1).optional(),
    /**
     * Printed because someone paid the printing fee, not chosen as the official
     * argument (San Francisco prints both kinds).
     */
    paid: z.boolean().optional(),
    /** Who paid, as printed (e.g. "The true source(s) of funds for the printing fee …"). */
    funding: z.string().min(1).optional(),
    source: httpUrl,
    disclaimer: z.string().optional(),
  })
  .strict();
export type Argument = z.infer<typeof argumentSchema>;

/**
 * A full text or other original. Either mirrored (`file`, checked by hash), or
 * only linked: a page of a large original kept out of the guide, identified by
 * the SHA-256 of what was retrieved from `source`.
 */
export const documentSchema = z
  .object({
    title: z.string().min(1),
    file: relativePath.optional(),
    source: httpUrl,
    mediaType: z.string().min(1),
    /** 1-based page in the original where this document starts. */
    page: z.number().int().positive().optional(),
    /** SHA-256 of the original at `source` when it was retrieved. */
    sha256: sha256Hex.optional(),
  })
  .strict();
export type GuideDocument = z.infer<typeof documentSchema>;

/** Everything published about one subject: one race, or one measure. */
export const guideItemSchema = z
  .object({
    v: z.literal(1),
    subject: subjectSchema,
    retrieved_at: rfc3339,
    /** The office or measure in brief (e.g. what the office does; the ballot label). */
    about: passageSchema.optional(),
    candidates: z.array(candidateInfoSchema).optional(),
    /** What a Yes or a No vote means, keyed by choice. */
    means: z.record(z.string(), passageSchema).optional(),
    summary: passageSchema.optional(),
    analysis: passageSchema.optional(),
    arguments: z.array(argumentSchema).optional(),
    /**
     * The measure's full text, when the guide publishes it as text rather than as a
     * document (e.g. HTML on a county's site).
     */
    fullText: passageSchema.optional(),
    /** Full text and other originals, mirrored (e.g. the proposed law as a PDF). */
    documents: z.array(documentSchema).optional(),
  })
  .strict();
export type GuideItem = z.infer<typeof guideItemSchema>;

export const guideManifestSchema = z
  .object({
    v: z.literal(1),
    issuer: issuerSchema,
    issued_at: rfc3339,
    context: contextSchema.optional(),
    /** Whose material this is: the election authority that published it. */
    attribution: attributionSchema,
    items: z.array(z.object({ subject: subjectSchema, file: relativePath }).strict()),
    /** Every published file under the manifest, by relative path, with its SHA-256. */
    files: z.record(relativePath, sha256Hex),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const [i, item] of manifest.items.entries()) {
      if (!(item.file in manifest.files)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "file"],
          message: "not listed in files",
        });
      }
    }
  });
export type GuideManifest = z.infer<typeof guideManifestSchema>;

export const guideHeaderSchema = z
  .object({ alg: z.literal("EdDSA"), typ: z.literal(GUIDE_TYP), kid: z.string().min(1) })
  .strict();

/** Lowercase hex SHA-256 of some bytes (WebCrypto: the same in Bun and browsers). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  // Copied so the digest always gets an ArrayBuffer-backed view (never a SharedArrayBuffer).
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign a manifest. The issuer's key must match `secretKey`; check with `verifyGuide`. */
export function signGuide(manifest: GuideManifest, secretKey: Uint8Array): string {
  const payload = guideManifestSchema.parse(manifest);
  const header = { alg: "EdDSA", typ: GUIDE_TYP, kid: payload.issuer.key };
  const headerSeg = b64url.encode(utf8(canonicalize(header)));
  const payloadSeg = b64url.encode(utf8(canonicalize(payload)));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  return `${signingInput}.${b64url.encode(edSign(utf8(signingInput), secretKey))}`;
}

export interface GuideVerifyResult {
  valid: boolean;
  manifest?: GuideManifest;
  errors: string[];
}

export interface GuideVerifyOptions {
  /** The key the guide must be signed with (from the catalog that listed it). */
  expectedKey?: string;
}

/** Parse, schema-check and verify a signed guide manifest. */
export function verifyGuide(token: string, options: GuideVerifyOptions = {}): GuideVerifyResult {
  const errors: string[] = [];
  let decoded: DecodedSlate;
  try {
    decoded = decodeToken(token);
  } catch (err) {
    return { valid: false, errors: [errorMessage(err)] };
  }

  const header = guideHeaderSchema.safeParse(decoded.header);
  if (!header.success) errors.push(`header: expected alg EdDSA and typ ${GUIDE_TYP}`);

  const parsed = guideManifestSchema.safeParse(decoded.payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`manifest ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return { valid: false, errors };
  }
  const manifest = parsed.data;

  if (decoded.header.kid !== manifest.issuer.key)
    errors.push("header kid does not match issuer.key");
  if (options.expectedKey && manifest.issuer.key !== options.expectedKey) {
    errors.push(`signed by ${manifest.issuer.key}, expected ${options.expectedKey}`);
  }

  try {
    if (!verifySignature(decoded, decodePublicKey(manifest.issuer.key))) {
      errors.push("signature verification failed");
    }
  } catch (err) {
    errors.push(`invalid issuer key: ${errorMessage(err)}`);
  }

  return { valid: errors.length === 0, manifest, errors };
}

/** Whether some fetched bytes are the file the manifest lists at `path`. */
export async function checkGuideFile(
  manifest: GuideManifest,
  path: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const expected = manifest.files[path];
  return expected !== undefined && expected === (await sha256(bytes));
}

/** Fetch-free parse of an item file's bytes, after `checkGuideFile`. */
export function parseGuideItem(bytes: Uint8Array): GuideItem {
  return guideItemSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every file an item points at (photos, images inside passages, documents), for build-time checks. */
export function guideItemFiles(item: GuideItem): string[] {
  const files = new Set<string>();
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === "img") files.add(block.file);
      else if (block.type === "ul" || block.type === "ol")
        for (const entry of block.items) walk(entry);
    }
  };
  const passages = [
    item.about,
    item.summary,
    item.analysis,
    item.fullText,
    ...Object.values(item.means ?? {}),
  ];
  for (const passage of passages) if (passage) walk(passage.blocks);
  for (const candidate of item.candidates ?? []) {
    if (candidate.photo) files.add(candidate.photo.file);
    if (candidate.statement) walk(candidate.statement.blocks);
  }
  for (const argument of item.arguments ?? []) walk(argument.blocks);
  for (const document of item.documents ?? []) if (document.file) files.add(document.file);
  return [...files];
}
