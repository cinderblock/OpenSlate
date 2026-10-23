import { z } from "zod";

/** Allowed stances toward a subject. */
export const STANCES = [
  "endorse",
  "oppose",
  "lean_for",
  "lean_against",
  "neutral",
  "abstain",
] as const;

export const stanceSchema = z.enum(STANCES);
export type Stance = z.infer<typeof stanceSchema>;

/** RFC 3339 date-time with a timezone offset (e.g. `2026-05-28T17:00:00Z`). */
const rfc3339 = z.string().datetime({ offset: true });

export const subjectSchema = z
  .object({
    title: z.string().min(1),
    id: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    jurisdiction: z.string().min(1).optional(),
    election: z.string().min(1).optional(),
    uri: z.string().url().optional(),
  })
  .strict();
export type Subject = z.infer<typeof subjectSchema>;

export const positionSchema = z
  .object({
    subject: subjectSchema,
    stance: stanceSchema,
    choice: z.string().min(1).optional(),
    /** Catalog id of the choice, from a ballot listing (SPEC §3.11). */
    choice_id: z.string().min(1).optional(),
    /** The choice isn't printed on the ballot (SPEC §3.12). Never `false`: omit it. */
    write_in: z.literal(true).optional(),
    weight: z.number().min(0).max(1).optional(),
    statement: z.string().optional(),
    source: z.string().url().optional(),
  })
  .strict()
  .refine((p) => p.choice !== undefined || (p.choice_id === undefined && !p.write_in), {
    message: "choice_id and write_in need a choice",
  });
export type Position = z.infer<typeof positionSchema>;

export const issuerSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().optional(),
    kind: z.string().min(1).optional(),
    uri: z.string().url().optional(),
  })
  .strict();
export type Issuer = z.infer<typeof issuerSchema>;

export const referenceSchema = z
  .object({
    issuer: z.string().min(1),
    name: z.string().optional(),
    slate: z.string().optional(),
    uri: z.string().url().optional(),
    note: z.string().optional(),
  })
  .strict();
export type Reference = z.infer<typeof referenceSchema>;

export const contextSchema = z
  .object({
    election: z.string().min(1).optional(),
    jurisdiction: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  })
  .strict();
export type Context = z.infer<typeof contextSchema>;

/** Modes by which a researcher may have obtained a third party's stance. */
export const ATTRIBUTION_MODES = ["scraped", "transcribed", "inferred"] as const;
export const attributionModeSchema = z.enum(ATTRIBUTION_MODES);
export type AttributionMode = z.infer<typeof attributionModeSchema>;

/**
 * Optional secondhand-report marker. When present, the slate's issuer (the
 * signer) is reporting what the entity in `of` is claimed to have said —
 * NOT claiming to BE that entity. Verifiers MUST surface attribution
 * prominently so consumers see "secondhand by <issuer> about <of>" and can
 * supersede with a firsthand slate if/when one is published.
 */
export const attributionSchema = z
  .object({
    of: z
      .object({
        name: z.string().min(1),
        uri: z.string().url().optional(),
        kind: z.string().min(1).optional(),
      })
      .strict(),
    mode: attributionModeSchema,
    retrieved_at: rfc3339,
    sources: z.array(z.string().url()).optional(),
  })
  .strict();
export type Attribution = z.infer<typeof attributionSchema>;

/**
 * Adopt another slate's positions by reference instead of copying them (SPEC §3.10).
 * The adopting slate's entity claims the selected positions of the slate signed by
 * `issuer` (and, for a secondhand slate, reporting on `of`). `slate` embeds a snapshot;
 * `uri` points at a live copy. At least one is required.
 */
export const adoptionSchema = z
  .object({
    issuer: z.string().min(1),
    of: z.string().min(1).optional(),
    election: z.string().min(1).optional(),
    uri: z.string().url().optional(),
    slate: z.string().min(1).optional(),
    subjects: z.array(subjectSchema).optional(),
    source: z.string().url().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((a) => a.uri !== undefined || a.slate !== undefined, {
    message: "an adoption needs a uri or an embedded slate",
  });
export type Adoption = z.infer<typeof adoptionSchema>;

export const slatePayloadSchema = z
  .object({
    v: z.literal(1),
    issuer: issuerSchema,
    issued_at: rfc3339,
    expires_at: rfc3339.optional(),
    context: contextSchema.optional(),
    positions: z.array(positionSchema),
    endorsed_by: z.array(referenceSchema).optional(),
    attribution: attributionSchema.optional(),
    adopts: z.array(adoptionSchema).optional(),
    nonce: z.string().optional(),
  })
  .strict();
export type SlatePayload = z.infer<typeof slatePayloadSchema>;

export const jwsHeaderSchema = z
  .object({
    alg: z.literal("EdDSA"),
    typ: z.literal("openslate+jws"),
    kid: z.string().min(1),
  })
  .strict();
export type JwsHeader = z.infer<typeof jwsHeaderSchema>;
