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
    weight: z.number().min(0).max(1).optional(),
    statement: z.string().optional(),
    source: z.string().url().optional(),
  })
  .strict();
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

export const slatePayloadSchema = z
  .object({
    v: z.literal(1),
    issuer: issuerSchema,
    issued_at: rfc3339,
    expires_at: rfc3339.optional(),
    context: contextSchema.optional(),
    positions: z.array(positionSchema),
    endorsed_by: z.array(referenceSchema).optional(),
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
