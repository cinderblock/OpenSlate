import type { Adoption, Position } from "@openslate/core";
import { catalogEntryUrl } from "./catalogImport";
import { type DecodedSlate, electionOf } from "./collate";
import type { CatalogEntry } from "./query";
import { isBallotSource, sourceIdOf } from "./sources";
import { subjectKey } from "./subjects";

/**
 * Taking on another slate's positions while composing your own (SPEC §3.10).
 * A publisher picks how, the same three ways as `openslate adopt`. Pure (no
 * React, no storage); unit-tested in test/adoptionDraft.test.ts.
 */
export type AdoptMethod = "reference" | "snapshot" | "copy";

/** What one slate offers for an election: its newest slate per source, on that election. */
export function adoptableSlates(
  slates: DecodedSlate[],
  election: string | undefined,
  ownKey: string | undefined,
): DecodedSlate[] {
  const newest = new Map<string, DecodedSlate>();
  for (const slate of slates) {
    if (!slate.valid || isBallotSource(slate.source)) continue;
    if (!slate.source.secondhand && slate.source.signerKey === ownKey) continue;
    if (positionsFor(slate, election).length === 0) continue;
    const current = newest.get(slate.source.id);
    if (!current || slate.payload.issued_at > current.payload.issued_at) {
      newest.set(slate.source.id, slate);
    }
  }
  return [...newest.values()].sort((a, b) => a.source.name.localeCompare(b.source.name));
}

export function positionsFor(slate: DecodedSlate, election: string | undefined): Position[] {
  return slate.payload.positions.filter(
    (p) => !election || electionOf(p.subject, slate.payload) === election,
  );
}

/** Where a slate can be fetched: only its catalog entry is known to stay put. */
export function slateUri(
  slate: DecodedSlate,
  election: string | undefined,
  entries: CatalogEntry[],
  catalogUrl: string,
): string | undefined {
  const entry = entries.find(
    (e) => sourceIdOf(e) === slate.source.id && (!election || e.election === election),
  );
  return entry ? catalogEntryUrl(entry, catalogUrl) : undefined;
}

/** The `adopts` entry for the chosen positions. A reference needs a `uri`, a snapshot doesn't. */
export function adoptionFor(
  slate: DecodedSlate,
  chosen: Position[],
  method: Exclude<AdoptMethod, "copy">,
  uri: string | undefined,
): Adoption {
  const of = slate.payload.attribution?.of.name;
  const election = slate.payload.context?.election;
  const all = chosen.length === slate.payload.positions.length;
  const subjects = [...new Map(chosen.map((p) => [subjectKey(p.subject), p.subject])).values()];
  return {
    issuer: slate.payload.issuer.key,
    ...(of ? { of } : {}),
    ...(election ? { election } : {}),
    ...(uri ? { uri } : {}),
    ...(method === "snapshot" ? { slate: slate.token } : {}),
    ...(all ? {} : { subjects }),
  };
}

/**
 * The positions to add for a copy. They become the publisher's own lines:
 * their words stay, with where they came from, but a label is the other
 * slate's vocabulary and means nothing in yours.
 */
export function copiedPositions(chosen: Position[]): Position[] {
  return chosen.map(({ label: _label, ...position }) => position);
}
