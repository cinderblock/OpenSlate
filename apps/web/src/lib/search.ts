import type { Subject } from "@openslate/core";
import { designation } from "./ballotView";
import type { Race } from "./collate";
import { formatElectionDate } from "./dates";
import { jurisdictionLabel } from "./jurisdictions";
import type { Source } from "./sources";

/**
 * Lowercase with accents stripped, so "jose" finds "José" and "PROP" finds
 * "Prop". Searched text and queries both go through it.
 */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The words of a search box's query, folded. None: nothing to filter by. */
export function searchTerms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * Every term appears somewhere in the text (from `raceSearchText` and kin).
 * Words can match in any order and across fields: "oakland mayor" finds the
 * Mayor race filed under Oakland.
 *
 * A term that's all digits matches a whole number only, so "prop 1" doesn't
 * find Prop 10 and "district 2" doesn't find District 20 (or every race in
 * 2026). Anything else matches anywhere: "sier" finds Sierra Club.
 */
export function matchesSearch(text: string, terms: readonly string[]): boolean {
  return terms.every((term) => {
    if (!/^\d+$/.test(term)) return text.includes(term);
    return wholeNumber(term).test(text);
  });
}

const numberPatterns = new Map<string, RegExp>();
function wholeNumber(digits: string): RegExp {
  let pattern = numberPatterns.get(digits);
  if (!pattern) {
    pattern = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
    numberPatterns.set(digits, pattern);
  }
  return pattern;
}

/**
 * Join the parts an item is found by into one folded string, a line apart,
 * for `matchesSearch`. Work it out once per item, not once per keystroke.
 */
export function searchTextOf(parts: Array<string | undefined>): string {
  // A newline between parts: no query term holds one, so a term never matches
  // across the seam of two fields.
  return foldText(parts.filter(Boolean).join("\n"));
}

/**
 * What a race on My ballot is found by: its title (the seat or measure), where
 * it's voted on, each choice (candidate or option) with its party or ballot
 * designation, and the sources with a position on it.
 */
export function raceSearchText(race: Race): string {
  return searchTextOf([
    race.subject.title,
    race.jurisdiction && jurisdictionLabel(race.jurisdiction),
    race.district && jurisdictionLabel(race.district),
    ...race.choices.flatMap((choice) => [
      choice.choice,
      designation(choice),
      ...choice.positions.flatMap((p) => [p.source.name, p.written]),
    ]),
  ]);
}

/**
 * What an imported source is found by: its name, the researcher who reported
 * it, its link, and the elections it covers (as dated, and as shown).
 */
export function sourceSearchText(source: Source, elections: readonly string[]): string {
  return searchTextOf([
    source.name,
    source.signerName,
    source.uri,
    ...elections.flatMap((date) => [date, formatElectionDate(date)]),
  ]);
}

/**
 * What one position (a slate's, or a pick of yours) is found by: the race or
 * measure, the choice, where it's voted on, its election, and the statement.
 */
export function positionSearchText(position: {
  subject: Subject;
  choice?: string;
  statement?: string;
}): string {
  const { subject } = position;
  return searchTextOf([
    subject.title,
    position.choice,
    subject.jurisdiction && jurisdictionLabel(subject.jurisdiction),
    subject.district && jurisdictionLabel(subject.district),
    subject.election,
    subject.election && formatElectionDate(subject.election),
    position.statement,
  ]);
}
