import type { SlatePayload } from "@openslate/core";

/**
 * A *source* is whoever's recommendations a slate carries: the entity a voter
 * decides to trust or not. It is not always the signer.
 *
 * - Firsthand slate: the source is the issuer, identified by its key.
 * - Secondhand report (SPEC §3.9): the source is `attribution.of`, the entity
 *   being reported on. The signer is only the researcher. Every slate in the
 *   public catalog is signed by the same researcher key, so keying follow state
 *   by signer would follow all ~40 catalog orgs at once.
 *
 * Source ids are stable across elections, so following an org carries over to
 * its next slate.
 *
 * Pure helpers: no React, no storage. Unit-tested in test/sources.test.ts.
 */
export interface Source {
  /** `key:<ed25519 key>` for firsthand, `of:<uri or name>` for secondhand. */
  id: string;
  /** Display name: the reported entity's name, or the issuer's self-asserted name. */
  name: string;
  /** Entity kind as asserted (`organization`, `individual`, …). */
  kind?: string;
  uri?: string;
  /** True for secondhand reports: the named entity did not sign. */
  secondhand: boolean;
  /** The key that actually signed. */
  signerKey: string;
  signerName?: string;
}

/** The parts of a payload `sourceOf` reads; a catalog entry has the same shape. */
export interface SourceInput {
  issuer: { key: string; name?: string; kind?: string; uri?: string };
  attribution?: { of: { name: string; uri?: string; kind?: string } };
}

/**
 * Normalise an entity URI for identity: lowercase host without `www.`, path
 * without a trailing slash, no scheme, query or fragment. Returns undefined for
 * anything that isn't a parseable http(s) URL.
 */
export function normaliseEntityUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

export function sourceIdOf(input: SourceInput): string {
  const of = input.attribution?.of;
  if (!of) return `key:${input.issuer.key}`;
  return `of:${normaliseEntityUri(of.uri) ?? of.name.trim().toLowerCase()}`;
}

export function sourceOf(input: SourceInput | SlatePayload): Source {
  const of = input.attribution?.of;
  const entity = of ?? input.issuer;
  const source: Source = {
    id: sourceIdOf(input),
    name: entity.name ?? input.issuer.key,
    secondhand: Boolean(of),
    signerKey: input.issuer.key,
  };
  if (entity.kind) source.kind = entity.kind;
  if (entity.uri) source.uri = entity.uri;
  if (input.issuer.name) source.signerName = input.issuer.name;
  return source;
}

/**
 * Whether a source is followed. A source nobody has decided about is followed:
 * importing a slate is usually a sign you want it. Bulk imports that shouldn't
 * land on the ballot record an explicit `false`.
 */
export function isFollowed(follows: Record<string, boolean>, sourceId: string): boolean {
  return follows[sourceId] ?? true;
}
