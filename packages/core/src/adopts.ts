import type { Adoption, Position, SlatePayload, Subject } from "./schema";
import { verifySlate } from "./slate";

/**
 * Collation identity of a subject: `id` when present, else title + jurisdiction +
 * election. Two positions are "on the same subject" iff these keys are equal.
 */
export function subjectIdentity(subject: Subject): string {
  return (
    subject.id ?? `t:${subject.title}|j:${subject.jurisdiction ?? ""}|e:${subject.election ?? ""}`
  );
}

/** Who a slate speaks for: its `attribution.of` when secondhand, else its issuer. */
export interface SlateEntity {
  /** Stable identity: the issuer key, plus the attributed name for secondhand slates. */
  id: string;
  name?: string;
  issuerKey: string;
  secondhand: boolean;
}

export function slateEntity(payload: SlatePayload): SlateEntity {
  const issuerKey = payload.issuer.key;
  if (payload.attribution) {
    const name = payload.attribution.of.name;
    return { id: `${issuerKey}#${name}`, name, issuerKey, secondhand: true };
  }
  return { id: issuerKey, name: payload.issuer.name, issuerKey, secondhand: false };
}

/** Whether `payload` is a slate that `adoption` can refer to (signature not checked here). */
export function adoptionMatches(adoption: Adoption, payload: SlatePayload): boolean {
  if (payload.issuer.key !== adoption.issuer) return false;
  if (adoption.of !== undefined && payload.attribution?.of.name !== adoption.of) return false;
  if (adoption.election !== undefined && payload.context?.election !== adoption.election) {
    return false;
  }
  return true;
}

/** One link in the chain from the slate being resolved to where a position was stated. */
export interface AdoptionHop {
  adoption: Adoption;
  /** The adopted slate's entity. */
  entity: SlateEntity;
}

export interface AdoptedPosition {
  position: Position;
  /** Outermost first: `via[0]` is the adoption on the slate being resolved. */
  via: AdoptionHop[];
}

export interface ResolvedAdoptions {
  positions: AdoptedPosition[];
  /** Adoptions (at any depth) for which no verifying, matching slate was found. */
  unresolved: { adoption: Adoption; depth: number }[];
}

export interface ResolveOptions {
  /** Maximum adoption depth followed (SPEC §3.10). Defaults to 4. */
  maxDepth?: number;
}

/**
 * Resolve a slate's `adopts` into the positions it takes on. `find` supplies candidate
 * tokens for an adoption: those the consumer already has, or a fetched `uri`. An embedded
 * `slate` is always tried first. Candidates must verify and match the adoption.
 *
 * Positions the slate (or an intermediate adopted slate) states itself win over adopted
 * positions on the same subject; cycles are ignored.
 */
export function resolveAdoptions(
  payload: SlatePayload,
  find: (adoption: Adoption) => Iterable<string>,
  options: ResolveOptions = {},
): ResolvedAdoptions {
  const maxDepth = options.maxDepth ?? 4;
  const positions: AdoptedPosition[] = [];
  const unresolved: ResolvedAdoptions["unresolved"] = [];
  const claimed = new Set(payload.positions.map((p) => subjectIdentity(p.subject)));

  const visit = (current: SlatePayload, via: AdoptionHop[], seen: Set<string>) => {
    for (const adoption of current.adopts ?? []) {
      const depth = via.length + 1;
      if (depth > maxDepth) {
        unresolved.push({ adoption, depth });
        continue;
      }
      const adopted = pickSlate(adoption, find);
      if (!adopted) {
        unresolved.push({ adoption, depth });
        continue;
      }
      const entity = slateEntity(adopted);
      if (seen.has(entity.id)) continue;
      const hop: AdoptionHop = { adoption, entity };
      const wanted = adoption.subjects ? new Set(adoption.subjects.map(subjectIdentity)) : null;
      const added = new Set<string>();
      for (const position of adopted.positions) {
        const key = subjectIdentity(position.subject);
        if (wanted && !wanted.has(key)) continue;
        if (claimed.has(key)) continue;
        positions.push({ position, via: [...via, hop] });
        added.add(key);
      }
      for (const key of added) claimed.add(key);
      visit(adopted, [...via, hop], new Set([...seen, entity.id]));
    }
  };

  visit(payload, [], new Set([slateEntity(payload).id]));
  return { positions, unresolved };
}

function pickSlate(
  adoption: Adoption,
  find: (adoption: Adoption) => Iterable<string>,
): SlatePayload | undefined {
  const candidates = adoption.slate ? [adoption.slate, ...find(adoption)] : find(adoption);
  let best: SlatePayload | undefined;
  for (const token of candidates) {
    const result = verifySlate(token);
    if (!result.valid || !result.payload || !adoptionMatches(adoption, result.payload)) continue;
    // Prefer the most recently issued matching slate (a re-issued live copy beats a snapshot).
    if (!best || result.payload.issued_at > best.issued_at) best = result.payload;
  }
  return best;
}
