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

/**
 * An absolute `http:` or `https:` URL (SPEC §3.13). Links in slates get
 * clicked, so a `javascript:` or `data:` URL is an attack, not a link.
 */
export const httpUrl = z
  .string()
  .url()
  // Runs even when `.url()` has already failed. `.url()` checks it parses.
  .refine((value) => /^https?:/i.test(value), {
    message: "must be an http: or https: URL",
  });

/** At least one field: an empty object says nothing. */
const notEmpty = (value: object) => Object.keys(value).length > 0;

/**
 * How the ballot prints a contest (SPEC §3.14), as data: nothing has to be
 * read out of `title`. Not part of identity; a ballot listing's wins.
 */
export const ballotContestSchema = z
  .object({
    /** The heading as printed: "Proposition 43", "Measure A", "Attorney General". */
    heading: z.string().min(1).optional(),
    /** A measure's number or letter as printed: "43", "A". */
    number: z.string().min(1).optional(),
    /** Printed under the heading: a measure's ballot label, a retention question. */
    label: z.string().min(1).optional(),
    /** A measure's type as printed: "Initiative Statute", "Bond Measure". */
    measure_type: z.string().min(1).optional(),
    /** The most choices a voter may mark: "Vote for no more than N". */
    vote_for: z.number().int().min(1).optional(),
    /** Ranked choice: a voter ranks up to this many choices. */
    ranks: z.number().int().min(2).optional(),
    /** A retention question: Yes or No on keeping someone in office. Never `false`: omit it. */
    retention: z.literal(true).optional(),
  })
  .strict()
  .refine(notEmpty, { message: "ballot needs at least one field" })
  .refine((b) => b.vote_for === undefined || b.ranks === undefined, {
    message: "ballot: vote_for and ranks can't both be given",
  });
export type BallotContest = z.infer<typeof ballotContestSchema>;

/** How the ballot prints a choice (SPEC §3.14): party, designation, incumbency. */
export const ballotChoiceSchema = z
  .object({
    /** Party or party preference as printed: "Democratic", "No Party Preference". */
    party: z.string().min(1).optional(),
    /** The ballot designation as printed: the candidate's occupation or title. */
    designation: z.string().min(1).optional(),
    /** The listing marks the candidate as the incumbent. Never `false`: omit it. */
    incumbent: z.literal(true).optional(),
  })
  .strict()
  .refine(notEmpty, { message: "ballot needs at least one field" });
export type BallotChoice = z.infer<typeof ballotChoiceSchema>;

export const subjectSchema = z
  .object({
    title: z.string().min(1),
    id: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    jurisdiction: z.string().min(1).optional(),
    /** Whose voters decide it, when narrower than `jurisdiction` (SPEC §3.3). Not identity. */
    district: z.string().min(1).optional(),
    /** The jurisdictions whose voters decide it together, when `jurisdiction` is a region (SPEC §3.3). Not identity. */
    voted_in: z.array(z.string().min(1)).min(1).optional(),
    election: z.string().min(1).optional(),
    uri: httpUrl.optional(),
    /** How the ballot prints the contest (SPEC §3.14). Not identity. */
    ballot: ballotContestSchema.optional(),
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
    /** How the ballot prints the choice (SPEC §3.14). */
    ballot: ballotChoiceSchema.optional(),
    /** The issuer's order of preference: 1 is their first choice (SPEC §3.16). */
    rank: z.number().int().min(1).optional(),
    weight: z.number().min(0).max(1).optional(),
    /** The issuer's own term for the position, shown in place of a stance word (SPEC §3.17). */
    label: z.string().min(1).optional(),
    statement: z.string().optional(),
    source: httpUrl.optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.choice !== undefined ||
      (p.choice_id === undefined && !p.write_in && p.ballot === undefined && p.rank === undefined),
    { message: "choice_id, write_in, ballot and rank need a choice" },
  )
  .refine((p) => p.rank === undefined || p.stance === "endorse" || p.stance === "lean_for", {
    message: "rank is only for endorse or lean_for",
    path: ["rank"],
  });
export type Position = z.infer<typeof positionSchema>;

export const issuerSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().optional(),
    kind: z.string().min(1).optional(),
    uri: httpUrl.optional(),
  })
  .strict();
export type Issuer = z.infer<typeof issuerSchema>;

export const referenceSchema = z
  .object({
    issuer: z.string().min(1),
    name: z.string().optional(),
    slate: z.string().optional(),
    uri: httpUrl.optional(),
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
 * Which capture of the sources this slate was built from (SPEC §3.9.1), so the
 * signature covers it. A pointer with a hash, not a claim of its own: a verifier
 * recomputes what a run shows from the run itself.
 */
export const attributionCaptureSchema = z
  .object({
    run: z.string().min(1),
    /** SHA-256 of the run's manifest file: what its proofs are made over. */
    manifest_sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex digits"),
    /** Where this slate's provenance record is. */
    provenance: z
      .string()
      .url()
      .regex(/^https:\/\//, "must be an https: URL"),
  })
  .strict();
export type AttributionCapture = z.infer<typeof attributionCaptureSchema>;

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
        uri: httpUrl.optional(),
        kind: z.string().min(1).optional(),
      })
      .strict(),
    mode: attributionModeSchema,
    retrieved_at: rfc3339,
    sources: z.array(httpUrl).optional(),
    capture: attributionCaptureSchema.optional(),
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
    uri: httpUrl.optional(),
    slate: z.string().min(1).optional(),
    subjects: z.array(subjectSchema).optional(),
    source: httpUrl.optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((a) => a.uri !== undefined || a.slate !== undefined, {
    message: "an adoption needs a uri or an embedded slate",
  });
export type Adoption = z.infer<typeof adoptionSchema>;

/**
 * A link (news, analysis, an explainer) attached to a ballot item (SPEC
 * §3.15). Not a position: it never counts for or against anything.
 */
export const articleSchema = z
  .object({
    subject: subjectSchema,
    /** The choice within the subject it's about (a candidate profile). */
    choice: z.string().min(1).optional(),
    choice_id: z.string().min(1).optional(),
    uri: httpUrl,
    /** The headline. */
    title: z.string().min(1),
    publisher: z.string().min(1).optional(),
    /** RFC 3339 full-date (`2026-10-01`) or date-time. */
    published_at: z.union([z.string().date(), rfc3339]).optional(),
    /** `news` | `analysis` | `opinion` | `explainer` | `guide` | other. */
    kind: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
  })
  .strict()
  .refine((a) => a.choice !== undefined || a.choice_id === undefined, {
    message: "choice_id needs a choice",
  });
export type Article = z.infer<typeof articleSchema>;

/** What one of the issuer's own position labels means (SPEC §3.17). */
export const labelDefinitionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .strict();
export type LabelDefinition = z.infer<typeof labelDefinitionSchema>;

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
    articles: z.array(articleSchema).optional(),
    labels: z.array(labelDefinitionSchema).optional(),
    nonce: z.string().optional(),
  })
  .strict()
  .superRefine(checkLabels);
export type SlatePayload = z.infer<typeof slatePayloadSchema>;

/**
 * What `openslate sign` takes, a bundle's positions.json: the payload's content without the parts
 * the signer fills in (`v`, `issuer`, `issued_at`, `expires_at`, `nonce`), or a bare array of
 * positions. Closed like the payload, so a misspelt key fails here rather than being dropped when
 * the bundle is signed.
 */
export const signInputSchema = z.preprocess(
  (raw) => (Array.isArray(raw) ? { positions: raw } : raw),
  z
    .object({
      context: contextSchema.optional(),
      positions: z.array(positionSchema).default([]),
      endorsed_by: z.array(referenceSchema).optional(),
      attribution: attributionSchema.optional(),
      adopts: z.array(adoptionSchema).optional(),
      articles: z.array(articleSchema).optional(),
      labels: z.array(labelDefinitionSchema).optional(),
    })
    .strict()
    .superRefine(checkLabels),
);
export type SignInput = z.output<typeof signInputSchema>;

/** Labels are unique, and when listed, every position's label is one of them (SPEC §3.17). */
function checkLabels(
  payload: { positions: Position[]; labels?: LabelDefinition[] },
  ctx: z.RefinementCtx,
): void {
  if (!payload.labels) return;
  const defined = new Set<string>();
  payload.labels.forEach((definition, i) => {
    if (defined.has(definition.label)) {
      ctx.addIssue({
        code: "custom",
        message: `labels lists "${definition.label}" twice`,
        path: ["labels", i, "label"],
      });
    }
    defined.add(definition.label);
  });
  payload.positions.forEach((position, i) => {
    if (position.label !== undefined && !defined.has(position.label)) {
      ctx.addIssue({
        code: "custom",
        message: `label "${position.label}" isn't in labels`,
        path: ["positions", i, "label"],
      });
    }
  });
}

export const jwsHeaderSchema = z
  .object({
    alg: z.literal("EdDSA"),
    typ: z.literal("openslate+jws"),
    kid: z.string().min(1),
  })
  .strict();
export type JwsHeader = z.infer<typeof jwsHeaderSchema>;
