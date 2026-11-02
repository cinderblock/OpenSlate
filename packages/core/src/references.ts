import { z } from "zod";
import type { Block, GuideItem, Inline, Passage } from "./guide";
import { type Subject, subjectSchema } from "./schema";

/**
 * Where a voter guide's text mentions another thing on the same ballot. Found
 * by one rule run over every item, with no idea what any of them is about, so
 * nobody chooses which measures get linked. A mention is a fact about the text:
 * it says nothing about whether two measures are related, or how.
 *
 * Only numbered measures are matched. Letters get reused: San Francisco's
 * Prop A cites "November 2018 Proposition C", which isn't this ballot's Prop C.
 * A candidate is matched by the full name printed on the ballot, and only in a
 * statewide guide: a county's hundreds of local races repeat names (Inglewood
 * has an Alex Padilla who isn't the senator).
 */

/** Written beside a guide's items by `openslate guide sign`, and listed in its manifest. */
export const GUIDE_REFERENCES_FILE = "references.json";

export const referencePartSchema = z.enum([
  "about",
  "means",
  "summary",
  "analysis",
  "argument",
  "rebuttal",
  "paid-argument",
  "signer",
  "statement",
  "full-text",
]);
export type ReferencePart = z.infer<typeof referencePartSchema>;

export const referencePlaceSchema = z
  .object({
    part: referencePartSchema,
    /** The Yes or No it belongs to, or whose statement it is. */
    choice: z.string().min(1).optional(),
  })
  .strict();
export type ReferencePlace = z.infer<typeof referencePlaceSchema>;

export const guideReferenceSchema = z
  .object({
    /** The item whose text has the mention. */
    from: subjectSchema,
    /** The item mentioned. */
    to: subjectSchema,
    /** The candidate named, when it's a race that's mentioned. */
    choice: z.string().min(1).optional(),
    where: z.array(referencePlaceSchema).min(1),
  })
  .strict();
export type GuideReference = z.infer<typeof guideReferenceSchema>;

export const guideReferencesSchema = z
  .object({ v: z.literal(1), references: z.array(guideReferenceSchema) })
  .strict();
export type GuideReferences = z.infer<typeof guideReferencesSchema>;

/** Fetch-free parse of the references file's bytes, after `checkGuideFile`. */
export function parseGuideReferences(bytes: Uint8Array): GuideReferences {
  return guideReferencesSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

/** A measure's number from its title: "43" from "California – Proposition 43 (…)". */
export function measureNumber(subject: Pick<Subject, "title" | "kind">): string | undefined {
  if (subject.kind !== "measure") return undefined;
  // Before any parenthesis: a measure's description can cite another measure.
  const [heading = ""] = subject.title.split("(");
  return /\bprop(?:osition)?\.?\s*(\d{1,3})\b/i.exec(heading)?.[1];
}

export interface MeasureMention {
  number: string;
  /** Where to link in the text: "Proposition 41", then just "42" in "or 42". */
  start: number;
  end: number;
}

const MENTION = /\bprop(?:osition)?s?\.?\s*(\d{1,3})\b((?:\s*(?:,|&|and|or)\s*\d{1,3}\b)*)/gi;
const NEXT_NUMBER = /\d{1,3}\b/g;
const YEAR_BEFORE = /\b(?:19|20)\d{2}(?:['’]s)?\s*$/;
const YEAR_AFTER = /^\s*[(,]?\s*(?:(?:of|from|in)\s+)?(?:19|20)\d{2}\b/i;

/**
 * Every numbered measure a string mentions, except one dated to some other
 * year ("Proposition 30 in 2012"), which isn't the one on this ballot.
 */
export function measureMentions(text: string): MeasureMention[] {
  const out: MeasureMention[] = [];
  for (const match of text.matchAll(MENTION)) {
    const [whole, first = "", more = ""] = match;
    const start = match.index;
    const end = start + whole.length;
    if (YEAR_BEFORE.test(text.slice(0, start)) || YEAR_AFTER.test(text.slice(end))) continue;
    out.push({ number: first, start, end: end - more.length });
    const moreStart = end - more.length;
    for (const next of more.matchAll(NEXT_NUMBER)) {
      out.push({
        number: next[0],
        start: moreStart + next.index,
        end: moreStart + next.index + next[0].length,
      });
    }
  }
  return out;
}

function inlineStrings(runs: Inline[]): string[] {
  return runs.flatMap((run) => {
    if (typeof run === "string") return [run];
    return inlineStrings("em" in run ? run.em : run.strong);
  });
}

function blockStrings(block: Block): string[] {
  switch (block.type) {
    case "h":
    case "p":
      return inlineStrings(block.text);
    case "ul":
    case "ol":
      return block.items.flatMap((item) => item.flatMap(blockStrings));
    case "table":
      return [
        ...(block.caption ? [block.caption] : []),
        ...block.rows.flatMap((row) => row.flatMap((cell) => inlineStrings(cell.text))),
      ];
    case "img":
      return block.alt ? [block.alt] : [];
  }
}

/** One item's text, a part at a time. */
function itemParts(item: GuideItem): { place: ReferencePlace; text: string[] }[] {
  const strings = (passage: Passage) => passage.blocks.flatMap(blockStrings);
  const parts: { place: ReferencePlace; text: string[] }[] = [];
  const add = (part: ReferencePart, passage: Passage | undefined, choice?: string) => {
    if (passage)
      parts.push({ place: { part, ...(choice ? { choice } : {}) }, text: strings(passage) });
  };
  add("about", item.about);
  for (const [choice, passage] of Object.entries(item.means ?? {})) add("means", passage, choice);
  add("summary", item.summary);
  add("analysis", item.analysis);
  for (const argument of item.arguments ?? []) {
    const part = argument.paid ? "paid-argument" : argument.rebuttal ? "rebuttal" : "argument";
    parts.push({
      place: { part, choice: argument.side },
      text: [...(argument.title ? [argument.title] : []), ...argument.blocks.flatMap(blockStrings)],
    });
    parts.push({
      place: { part: "signer", choice: argument.side },
      text: argument.signers.map((signer) => signer.name),
    });
  }
  add("full-text", item.fullText);
  for (const candidate of item.candidates ?? []) {
    add("statement", candidate.statement, candidate.choice);
  }
  return parts;
}

/** Whether a guide is statewide: `us/ca`, not `us/ca/alameda`. */
export function isStatewideGuide(jurisdiction: string | undefined): boolean {
  return jurisdiction !== undefined && jurisdiction.split("/").length <= 2;
}

/** A name as printed, whole: "Fiona Ma" isn't in "Fiona Mason". */
function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
}

const samePlace = (a: ReferencePlace, b: ReferencePlace) =>
  a.part === b.part && a.choice === b.choice;

/**
 * Every mention, in one guide, of another item in that guide. Each item's own
 * mentions of itself are left out, as is a statement naming its own race.
 */
export function guideReferences(
  items: GuideItem[],
  { names: matchNames = true }: { names?: boolean } = {},
): GuideReference[] {
  const numbers = new Map<string, Subject>();
  for (const { subject } of items) {
    const number = measureNumber(subject);
    if (number && !numbers.has(number)) numbers.set(number, subject);
  }
  // A first and last name at least: a yes/no choice or a lone word isn't a person.
  const names = matchNames
    ? items.flatMap(({ subject, candidates }) =>
        (candidates ?? [])
          .filter(({ choice }) => /\S\s+\S/.test(choice))
          .map(({ choice }) => ({ subject, choice, pattern: namePattern(choice) })),
      )
    : [];

  const found = new Map<string, GuideReference>();
  const note = (from: Subject, to: Subject, place: ReferencePlace, choice?: string) => {
    const id = JSON.stringify([from.title, to.title, choice ?? ""]);
    const reference = found.get(id);
    if (!reference) {
      found.set(id, { from, to, ...(choice ? { choice } : {}), where: [place] });
    } else if (!reference.where.some((seen) => samePlace(seen, place))) {
      reference.where.push(place);
    }
  };

  for (const item of items) {
    const own = measureNumber(item.subject);
    for (const { place, text } of itemParts(item)) {
      for (const line of text) {
        for (const { number } of measureMentions(line)) {
          const to = numbers.get(number);
          if (to && number !== own) note(item.subject, to, place);
        }
        for (const { subject, choice, pattern } of names) {
          if (subject.title !== item.subject.title && pattern.test(line)) {
            note(item.subject, subject, place, choice);
          }
        }
      }
    }
  }
  return [...found.values()];
}
