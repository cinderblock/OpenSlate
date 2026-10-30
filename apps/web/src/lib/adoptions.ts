import { type Adoption, adoptionMatches, resolveAdoptions } from "@openslate/core";
import { type DecodedSlate, decodeSlates } from "./collate";
import type { CatalogEntry } from "./query";
import { sourceIdOf } from "./sources";

/**
 * Adoptions (SPEC §3.10): a slate taking on another slate's positions by
 * reference instead of copying them. Pure (no React, no storage); unit-tested
 * in test/adoptions.test.ts.
 */

/** Cached verification, so resolving a slate's adoptions doesn't re-check signatures. */
function verifyCached(token: string): { valid: boolean; payload?: DecodedSlate["payload"] } {
  const [decoded] = decodeSlates([{ token, importedAt: "" }]);
  return decoded ? { valid: decoded.valid, payload: decoded.payload } : { valid: false };
}

/**
 * Add each slate's adopted positions to its own, so everything downstream
 * (races, sources, ballot checks) sees them as that source's. They go after
 * the slate's own positions, and `adoptedFrom` says where each came from, by
 * position index. A slate the adoption's target isn't imported for keeps what
 * it has, and says so in `unresolved`: nothing is ever made up.
 */
export function expandAdoptions(slates: DecodedSlate[]): DecodedSlate[] {
  if (!slates.some((slate) => slate.payload.adopts?.length)) return slates;
  const find = (adoption: Adoption) =>
    slates.filter((s) => adoptionMatches(adoption, s.payload)).map((s) => s.token);
  return slates.map((slate) => {
    if (!slate.payload.adopts?.length) return slate;
    const { positions, unresolved } = resolveAdoptions(slate.payload, find, {
      verify: verifyCached,
    });
    return {
      ...slate,
      payload: {
        ...slate.payload,
        positions: [...slate.payload.positions, ...positions.map((p) => p.position)],
      },
      adoptedFrom: [
        ...slate.payload.positions.map(() => undefined),
        // The entity that stated it: the end of the chain.
        ...positions.map((p) => p.via.at(-1)?.entity.name),
      ],
      ...(unresolved.length > 0 ? { unresolved: unresolved.map((u) => u.adoption) } : {}),
    };
  });
}

/** How many of a slate's positions are adopted, by the entity they came from. */
export function adoptedCounts(slate: DecodedSlate): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const name of slate.adoptedFrom ?? []) {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

/**
 * The catalog entries that would resolve these slates' unresolved adoptions.
 * Only ever the catalog: a signed slate can name any URL in `uri`, and opening
 * one shouldn't make the browser call a server the voter never chose.
 */
export function adoptedEntries(
  slates: DecodedSlate[],
  entries: CatalogEntry[],
  removed: ReadonlySet<string>,
): CatalogEntry[] {
  const wanted = new Map<string, CatalogEntry>();
  for (const slate of slates) {
    for (const adoption of slate.unresolved ?? []) {
      const entry = entries.find((e) => catalogEntryMatches(adoption, e));
      if (entry && !removed.has(sourceIdOf(entry))) wanted.set(entry.path, entry);
    }
  }
  return [...wanted.values()];
}

function catalogEntryMatches(adoption: Adoption, entry: CatalogEntry): boolean {
  if (entry.issuer.key !== adoption.issuer) return false;
  if (adoption.of !== undefined && entry.attribution?.of.name !== adoption.of) return false;
  return adoption.election === undefined || entry.election === adoption.election;
}
