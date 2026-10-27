import type { SlatePayload } from "@openslate/core";
import type { CatalogEntry } from "./query";
import { type SourceInput, sourceIdOf } from "./sources";

/**
 * Keeping imported catalog slates current. A catalog entry is one stream of
 * slates: the same signer reporting on the same source for the same election
 * and place. When the catalog lists a newer `issued_at` for a stream the user
 * has imported, the newer slate replaces the ones they have.
 *
 * Pure helpers; catalogImport.ts does the fetching and storing.
 */

/** A slate the user has, decoded. */
export interface StoredSlate {
  token: string;
  payload: SlatePayload;
}

/** A catalog entry with a newer slate than the user's, and the tokens it replaces. */
export interface CatalogUpdate {
  entry: CatalogEntry;
  replaces: string[];
  /** The newest `issued_at` among the slates it replaces. */
  since: string;
}

type StreamInput = SourceInput & {
  election: string | undefined;
  scope: string | undefined;
};

function streamKey({ issuer, attribution, election, scope }: StreamInput): string {
  return [issuer.key, sourceIdOf({ issuer, attribution }), election ?? "", scope ?? ""].join("|");
}

function payloadStream(payload: SlatePayload): string {
  return streamKey({
    issuer: payload.issuer,
    attribution: payload.attribution,
    election: payload.context?.election,
    scope: payload.context?.jurisdiction,
  });
}

function entryStream(entry: CatalogEntry): string {
  return streamKey({
    issuer: entry.issuer,
    attribution: entry.attribution,
    election: entry.election,
    scope: entry.scope,
  });
}

/** RFC 3339 instants compared as instants, not strings: offsets and fractions vary. */
function isLater(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

/**
 * Catalog entries newer than what the user has of the same stream. Streams the
 * user never imported are left alone, and so is anything the catalog doesn't
 * list (a slate imported by link, the user's own).
 */
export function staleImports(
  stored: readonly StoredSlate[],
  entries: readonly CatalogEntry[],
): CatalogUpdate[] {
  const byStream = new Map<string, StoredSlate[]>();
  for (const slate of stored) {
    const key = payloadStream(slate.payload);
    byStream.set(key, [...(byStream.get(key) ?? []), slate]);
  }
  const updates: CatalogUpdate[] = [];
  for (const entry of entries) {
    const mine = byStream.get(entryStream(entry));
    if (!mine) continue;
    const since = mine
      .map((slate) => slate.payload.issued_at)
      .reduce((a, b) => (isLater(b, a) ? b : a));
    if (isLater(entry.issued_at, since)) {
      updates.push({ entry, replaces: mine.map((slate) => slate.token), since });
    }
  }
  return updates;
}

/**
 * Why a downloaded slate can't stand in for `update`'s, or undefined when it
 * can: it must be the entry's stream, from the entry's signer, and newer than
 * what it replaces. Guards against a catalog whose index and files disagree.
 */
export function updateProblem(update: CatalogUpdate, payload: SlatePayload): string | undefined {
  if (payload.issuer.key !== update.entry.issuer.key) return "signed by a different key";
  if (payloadStream(payload) !== entryStream(update.entry))
    return "not the slate the catalog lists";
  if (!isLater(payload.issued_at, update.since)) return "not newer than the one you have";
  return undefined;
}
