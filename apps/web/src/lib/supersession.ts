import { type SlatePayload, type Subject, verifySlate } from "@openslate/core";
import { subjectKey } from "./subjects";

/**
 * Helpers for SPEC §3.9 supersession: per-position, prefer a firsthand slate
 * over any secondhand report covering the same subject.
 *
 * The SPEC says verifiers SHOULD supersede secondhand reports with firsthand
 * ones, but only when the firsthand slate's `issuer.key` is "associated with
 * the entity via domain attestation or trust layer" — infrastructure we don't
 * have yet. So we don't auto-hide; we surface a count of subjects that *could*
 * be cross-referenced firsthand and let the user navigate from there.
 *
 * Pure helpers — no React, no IndexedDB. Suitable for unit tests.
 */

/** Lift the verifiable payloads out of a list of tokens, discarding unparseable ones. */
export function payloadsFromTokens(tokens: string[]): SlatePayload[] {
  const out: SlatePayload[] = [];
  for (const token of tokens) {
    const result = verifySlate(token);
    if (result.payload) out.push(result.payload);
  }
  return out;
}

/** Set of subject keys covered firsthand across the supplied payloads. */
export function firsthandSubjectKeys(payloads: SlatePayload[]): Set<string> {
  const keys = new Set<string>();
  for (const payload of payloads) {
    if (payload.attribution) continue;
    for (const position of payload.positions) keys.add(subjectKey(position.subject));
  }
  return keys;
}

export interface SupersessionInfo {
  /** Total positions on the secondhand slate. */
  total: number;
  /** Positions whose subject is also covered by some firsthand slate in scope. */
  coveredFirsthand: number;
  /** Subjects covered firsthand, in the order they appear on the secondhand slate. */
  coveredSubjects: Subject[];
}

/**
 * For a single payload, count how many of its positions are covered firsthand
 * by the supplied set of firsthand subject keys. Returns `null` for firsthand
 * payloads (the question doesn't apply).
 */
export function supersessionFor(
  payload: SlatePayload,
  firsthandKeys: Set<string>,
): SupersessionInfo | null {
  if (!payload.attribution) return null;
  const coveredSubjects: Subject[] = [];
  for (const position of payload.positions) {
    if (firsthandKeys.has(subjectKey(position.subject))) {
      coveredSubjects.push(position.subject);
    }
  }
  return {
    total: payload.positions.length,
    coveredFirsthand: coveredSubjects.length,
    coveredSubjects,
  };
}
