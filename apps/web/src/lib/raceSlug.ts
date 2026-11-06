import type { Subject } from "@openslate/core";
import { subjectFromKey } from "./subjectKey";

/**
 * A race's readable address: `<election>/<jurisdiction path>/<title>`, e.g.
 * `2026-11-03/us/ca/governor`, shown as `#/race/2026-11-03/us/ca/governor`.
 *
 * It's built only from the subject's identity fields (SPEC §3.10: title,
 * jurisdiction, election), so it's a function of the subject key and any link
 * that has the key can build it. A missing election is `_`; a missing
 * jurisdiction has no segments. Slugging loses case and punctuation, so two
 * identities can share a slug; the race page lists them when they do.
 */

/** Lowercase ASCII words joined by `-`: "Voters' Ability" → "voters-ability". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The slug of a subject's identity. An `id` doesn't enter into it. */
export function subjectSlug(subject: Pick<Subject, "title" | "jurisdiction" | "election">): string {
  const election = subject.election ? slugify(subject.election) : "";
  const area = (subject.jurisdiction ?? "").split("/").map(slugify).filter(Boolean);
  return [election || "_", ...area, slugify(subject.title) || "race"].join("/");
}

/** The slug for a subject key, or undefined for an `id` key, which doesn't carry the subject. */
export function raceSlug(key: string): string | undefined {
  if (slugOfKey.has(key)) return slugOfKey.get(key);
  const subject = subjectFromKey(key);
  const slug = subject ? subjectSlug(subject) : undefined;
  // A race page looks through every race's slug for its own: remembered, as
  // a key's slug never changes. Bounded, so a long visit can't grow it forever.
  if (slugOfKey.size >= SLUG_CACHE_MAX) slugOfKey.clear();
  slugOfKey.set(key, slug);
  return slug;
}

const SLUG_CACHE_MAX = 50_000;
const slugOfKey = new Map<string, string | undefined>();

/** What a slug says: the election and jurisdiction as written, and the slugged title. */
export interface ParsedRaceSlug {
  slug: string;
  election?: string;
  jurisdiction?: string;
  titleSlug: string;
}

/** A `/race/…` path back into its parts, or undefined if it can't be a slug. */
export function parseRaceSlug(path: string): ParsedRaceSlug | undefined {
  const segments = path.toLowerCase().split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const [first, ...rest] = segments;
  const titleSlug = rest.pop();
  if (!first || !titleSlug) return undefined;
  const jurisdiction = rest.join("/");
  return {
    slug: segments.join("/"),
    ...(first !== "_" ? { election: first } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    titleSlug,
  };
}
