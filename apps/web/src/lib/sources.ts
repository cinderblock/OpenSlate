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
 * The entity kind of an election authority (a Secretary of State, a county
 * registrar). Its slates are *ballot sources*: one `neutral` position per
 * candidate on the ballot, so a race shows its whole field rather than only the
 * names someone endorsed. Not a recommendation, so never a matter of following.
 */
export const ELECTION_AUTHORITY = "election-authority";

export function isBallotSource(source: Pick<Source, "kind">): boolean {
  return source.kind === ELECTION_AUTHORITY;
}

/**
 * How much each source counts for a voter, by source id: a signed number with
 * no limit, fractions included. 1 counts once, 3 counts three times, 0 not at
 * all. Below zero it counts the other way, that many times.
 */
export type Follows = Record<string, number>;

/**
 * Which way that number points. `follow`: its picks count for what it backs.
 * `disagree`: followed too, but its picks count the other way (what it backs
 * counts against, what it opposes counts for). `off`: imported for comparison
 * only, so it shows on race pages but not on My ballot.
 */
export type Standing = "follow" | "disagree" | "off";

/** The number each of Follow, Disagree and off sets. */
export const STANDING_COUNT: Record<Standing, number> = { follow: 1, disagree: -1, off: 0 };

export const STANDINGS: readonly Standing[] = ["follow", "disagree", "off"];

export function isStanding(value: unknown): value is Standing {
  return STANDINGS.includes(value as Standing);
}

export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * How much a source counts. A source nobody has decided about counts once:
 * importing a slate is usually a sign you want it. Bulk imports that shouldn't
 * land on the ballot record an explicit 0.
 */
export function countOf(follows: Follows, sourceId: string): number {
  return follows[sourceId] ?? 1;
}

export function standingOfCount(count: number): Standing {
  return count > 0 ? "follow" : count < 0 ? "disagree" : "off";
}

/** Which way a source counts. */
export function standingOf(follows: Follows, sourceId: string): Standing {
  return standingOfCount(countOf(follows, sourceId));
}

/** Whether a source is on My ballot: followed, to agree or to disagree. */
export function isFollowed(follows: Follows, sourceId: string): boolean {
  return standingOf(follows, sourceId) !== "off";
}
