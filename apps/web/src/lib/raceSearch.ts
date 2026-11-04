import { foldText } from "./search";

/**
 * Ranked search for the race picker ("Add one race" on Results): every race
 * the state and the chosen county report, found by what a voter types, with
 * the best match on top.
 *
 * - Words match whole or as the start of a word ("joy" finds Jamie Joyce), any
 *   order. A word of four letters or more also matches inside a word.
 * - Numbers match whole: "District 1" doesn't find District 12. "12th",
 *   "Twelfth", "CD12" and "012" are all 12.
 * - The letter after "Measure" (or the number after "Prop") must be the
 *   measure's own: "Measure O" doesn't find a title that just has an "o" in it.
 * - County abbreviations match their words and back ("USD" ↔ "Unified School
 *   District", "TA 4" ↔ "Trustee Area 4", "AJ" ↔ "Associate Justice").
 * - Best first: the race's whole name, then its measure letter or number, the
 *   words in order, the name over a candidate's, a candidate over the details.
 *   Ties keep the list's own order.
 *
 * Pure; unit-tested in test/raceSearch.test.ts.
 */

export interface RaceSearchEntry {
  /** The race's name as shown: "City of East Palo Alto, Measure O (2/3 Approval Required)". */
  name: string;
  /** Other names it goes by, matched like the name but not shown: "CD 12", "Prop 5". */
  aliases?: readonly string[];
  /** Who's running. */
  people?: readonly string[];
  /** Quieter context: the county, the feed's category, a proposition's summary. */
  detail?: string;
  /** A measure's letter ("O") or a proposition's number ("5"). */
  measure?: string;
}

interface Field {
  words: string[];
  /** The words joined, padded with spaces: " east palo alto measure o ". */
  text: string;
}

export interface PreparedRace {
  name: Field;
  /** Aliases, and the words abbreviations stand for (or back). */
  extra: Field[];
  people: Field[];
  detail: Field;
  measure?: string;
}

/** Dropped from both sides: they carry nothing and county titles use them unevenly. */
const STOP = new Set(["of", "the", "for", "and", "to", "race", "races", "contest", "results"]);

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];
const ORDINAL = new Map(ORDINALS.map((w, i) => [w, String(i + 1)]));

/** Words that put a measure's letter or a proposition's number next. */
const MEASURE_WORDS = new Set(["measure", "measures", "meas", "prop", "props", "proposition"]);

/**
 * Text as search words: folded (case, accents), apostrophes dropped, ordinals
 * and zero-padded numbers as plain numbers, letters split from digits ("cd12"
 * → "cd 12"), filler words left out.
 */
export function searchWords(text: string): string[] {
  const spaced = foldText(text)
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2");
  const out: string[] = [];
  for (const raw of spaced.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const word = /^\d+$/.test(raw) ? String(Number(raw)) : (ORDINAL.get(raw) ?? raw);
    if (!STOP.has(word)) out.push(word);
  }
  return out;
}

function field(words: string[]): Field {
  return { words, text: ` ${words.join(" ")} ` };
}

/**
 * Abbreviations county titles use, both ways: a title with the short form also
 * answers to the long one, and the other way round. Each pair is words as
 * `searchWords` leaves them.
 */
const ABBREVIATIONS: [string, string][] = [
  ["usd", "unified school district"],
  ["jusd", "joint unified school district"],
  ["esd", "elementary school district"],
  ["hsd", "high school district"],
  ["uhsd", "union high school district"],
  ["sd", "school district"],
  ["ccd", "community college district"],
  ["comm", "community"],
  ["jt", "joint"],
  ["elem", "elementary"],
  ["ta", "trustee area"],
  ["dist", "district"],
  ["div", "division"],
  ["aj", "associate justice"],
  ["pj", "presiding justice"],
  ["assoc", "associate"],
  ["pres", "presiding"],
  ["ct", "court"],
  ["app", "appeal"],
  ["appellate", "appeal"],
  ["mbr", "member"],
  ["gov", "governing"],
  ["bd", "board"],
  ["boe", "board education"],
  ["bos", "board supervisors"],
  ["supv", "supervisor"],
  ["mt", "mount"],
  ["ft", "fort"],
  ["school board", "board education"],
  // San Mateo titles it "Regional Transit Measure", other counties "Measure RTM".
  ["rtm", "regional transit measure"],
  ["la", "los angeles"],
  ["sf", "san francisco"],
  ["councilmember", "council member"],
  ["councilmember", "council"],
  ["judge", "justice"],
  ["judge", "court"],
];

function expansions(text: string): string[][] {
  const out: string[][] = [];
  for (const [short, long] of ABBREVIATIONS) {
    if (text.includes(` ${short} `)) out.push(long.split(" "));
    if (text.includes(` ${long} `)) out.push(short.split(" "));
  }
  return out;
}

/** Work an entry out once, not on every keystroke. */
export function prepareRace(entry: RaceSearchEntry): PreparedRace {
  const name = field(searchWords(entry.name));
  const aliases = (entry.aliases ?? []).map((a) => field(searchWords(a)));
  const measure = entry.measure ? searchWords(entry.measure)[0] : undefined;
  const extra = [
    ...aliases,
    // The name's only: an alias like "SD 12" (State Senate) isn't a school district.
    ...expansions(name.text).map(field),
    // Orange titles a measure "C – City of Costa Mesa, …": it still answers to "Measure C".
    ...(measure ? [field(["measure", measure])] : []),
  ];
  return {
    name,
    extra,
    people: (entry.people ?? []).map((p) => field(searchWords(p))),
    detail: field(searchWords(entry.detail ?? "")),
    ...(measure ? { measure } : {}),
  };
}

interface QueryTerm {
  word: string;
  /** A measure letter or a number: whole words only. */
  whole: boolean;
  /** Follows "Measure" or "Prop": the measure's own letter or number. */
  designator: boolean;
}

export interface RaceQuery {
  terms: QueryTerm[];
  /** The terms joined, as `Field.text` is: " measure o". */
  phrase: string;
  designator?: string;
}

export function parseRaceQuery(query: string): RaceQuery {
  const words = searchWords(query);
  const terms = words.map((word, i): QueryTerm => {
    const prev = i > 0 ? words[i - 1] : undefined;
    const designator =
      prev !== undefined && MEASURE_WORDS.has(prev) && /^([a-z]{1,3}|\d+)$/.test(word);
    // One or two letters after "Measure" are its letter; three may still be a word being typed.
    const whole = /^\d+$/.test(word) || (designator && word.length <= 2);
    return { word, whole, designator };
  });
  const designator = terms.find((t) => t.designator)?.word;
  return { terms, phrase: ` ${words.join(" ")}`, ...(designator ? { designator } : {}) };
}

/** How well one word of the query matches one field: whole word, start of a word, inside a word. */
function wordScore(f: Field, t: QueryTerm, whole: number, start: number, inside: number): number {
  if (f.words.includes(t.word)) return whole;
  if (t.whole) return 0;
  if (f.words.some((w) => w.startsWith(t.word))) return start;
  if (t.word.length >= 4 && f.text.includes(t.word)) return inside;
  return 0;
}

/** The phrase in a field, its last word maybe still being typed (a number must be whole). */
function hasPhrase(f: Field, q: RaceQuery): boolean {
  const last = q.terms.at(-1);
  return f.text.includes(last?.whole ? `${q.phrase} ` : q.phrase);
}

/** How well a race matches, 0 for not at all. */
export function scoreRace(p: PreparedRace, q: RaceQuery): number {
  if (q.terms.length === 0) return 1;
  let score = 0;
  let allInName = true;
  for (const t of q.terms) {
    const inName = wordScore(p.name, t, 10, 7, 2);
    let best = inName;
    for (const f of p.extra) best = Math.max(best, wordScore(f, t, 8, 6, 0));
    for (const f of p.people) best = Math.max(best, wordScore(f, t, 9, 7, 2));
    best = Math.max(best, wordScore(p.detail, t, 4, 3, 1));
    if (best === 0) return 0;
    if (inName === 0) allInName = false;
    score += best;
  }
  const said = q.phrase.trim();
  if (p.name.text.trim() === said) score += 100;
  else if (p.extra.some((f) => f.text.trim() === said)) score += 90;
  else if (p.name.text.startsWith(q.phrase)) score += 30;
  if (q.designator !== undefined && p.measure === q.designator) score += 40;
  if (hasPhrase(p.name, q)) score += 15;
  else if (p.extra.some((f) => hasPhrase(f, q))) score += 12;
  if (p.people.some((f) => f.text.trim() === said)) score += 25;
  else if (p.people.some((f) => hasPhrase(f, q))) score += 15;
  if (allInName) score += 10;
  return score;
}

const OFFICE_ALIASES: Record<string, string[]> = {
  governor: ["Gov"],
  "lieutenant-governor": ["Lt Governor", "Lt Gov"],
  "secretary-of-state": ["SOS"],
  controller: ["State Controller"],
  treasurer: ["State Treasurer"],
  "attorney-general": ["AG"],
  "insurance-commissioner": ["Insurance"],
  "superintendent-of-public-instruction": ["SPI", "State Superintendent", "Schools Superintendent"],
};

/** What voters call the state's district seats, by the API's path. */
const DISTRICT_ALIASES: Record<string, (n: string) => string[]> = {
  "us-rep": (n) => [
    `CD ${n}`,
    `Congress ${n}`,
    `Congressional District ${n}`,
    `US Representative ${n}`,
    `Rep ${n}`,
    `House of Representatives ${n}`,
  ],
  "state-senate": (n) => [`SD ${n}`, `State Senator ${n}`, `Senate ${n}`],
  "state-assembly": (n) => [`AD ${n}`, `Assembly Member ${n}`, `Assemblymember ${n}`],
  "board-of-equalization": (n) => [`BOE ${n}`, `Equalization ${n}`],
};

/**
 * Other names for a state contest (by its id, `us-rep/district/12`,
 * `prop/5`, `governor`), so "CD 12", "Prop 5" and "Lt Gov" find it.
 */
export function contestAliases(id: string): string[] {
  const prop = id.match(/^prop\/(\d+)$/);
  if (prop) return [`Prop ${prop[1]}`, `Measure ${prop[1]}`];
  const district = id.match(/^([a-z-]+)\/district\/(\d+)$/);
  if (district?.[1] && district[2]) return DISTRICT_ALIASES[district[1]]?.(district[2]) ?? [];
  return OFFICE_ALIASES[id] ?? [];
}

/**
 * The items that match, best first; ties in their own order. An empty query
 * keeps everything as it was. `prepared[i]` is `items[i]`'s.
 */
export function rankRaces<T>(
  items: readonly T[],
  prepared: readonly PreparedRace[],
  query: string,
): T[] {
  const q = parseRaceQuery(query);
  if (q.terms.length === 0) return [...items];
  const scored: { item: T; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const p = prepared[at];
    const score = p ? scoreRace(p, q) : 0;
    if (score > 0) scored.push({ item, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.map((s) => s.item);
}
