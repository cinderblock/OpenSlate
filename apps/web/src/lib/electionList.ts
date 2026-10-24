import type { CivicElection, SlatePayload } from "@openslate/core";
import { electionOf } from "./collate";

export interface ElectionEntry {
  id: string;
  name?: string;
  electionDay?: string;
  ocdDivisionId?: string;
  sources: { google: boolean; slates: number; drafts: number };
  /** undefined = unknown date (no electionDay). */
  past: boolean | undefined;
}

/** Draft rows are keyed by election date; older ones carried a Google election id. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every election we know about, merged by Google election id or by date: from
 * Google's list (only when a self-hosted server provides it), from imported
 * slates, and from draft rows. A slate names its elections by date (a subject's
 * `election`, else its context's) or by the Google id in a `vip:<id>:…` subject
 * id, and counts once per election either way.
 */
export function electionEntries(
  google: CivicElection[],
  slates: SlatePayload[],
  draftElectionIds: string[],
  today: string,
): ElectionEntry[] {
  const map = new Map<string, ElectionEntry>();
  /** The entry for a Google id or a date, made if it's new. */
  const entryFor = (key: string): ElectionEntry => {
    const existing = map.get(key) ?? [...map.values()].find((e) => e.electionDay === key);
    if (existing) return existing;
    const dated = DATE.test(key);
    const entry: ElectionEntry = {
      id: key,
      ...(dated ? { electionDay: key } : {}),
      sources: { google: false, slates: 0, drafts: 0 },
      past: dated ? key < today : undefined,
    };
    map.set(key, entry);
    return entry;
  };

  for (const election of google) {
    map.set(election.id, {
      id: election.id,
      name: election.name,
      electionDay: election.electionDay,
      ...(election.ocdDivisionId ? { ocdDivisionId: election.ocdDivisionId } : {}),
      sources: { google: true, slates: 0, drafts: 0 },
      past: election.electionDay ? election.electionDay < today : undefined,
    });
  }

  for (const payload of slates) {
    const keys = new Set<string>();
    for (const position of payload.positions) {
      if (position.subject.id?.startsWith("vip:")) {
        const electionId = position.subject.id.slice(4).split(":")[0];
        if (electionId) keys.add(electionId);
      }
      const election = electionOf(position.subject, payload);
      if (election && DATE.test(election)) keys.add(election);
    }
    for (const entry of new Set([...keys].map(entryFor))) entry.sources.slates++;
  }

  for (const id of draftElectionIds) entryFor(id).sources.drafts++;

  return [...map.values()];
}
