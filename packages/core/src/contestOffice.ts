import { districtId } from "./districts";

/**
 * Which office a contest is for, read from its title as an election office
 * prints it. Fifty states word the same offices fifty ways ("U.S.
 * Representative in Congress - District No. 1", "Member, House of
 * Representatives (1st District)", "1ST DISTRICT REPRESENTATIVE IN CONGRESS 2
 * YEAR TERM (1) POSITION"); this is the one place that reads them, so a
 * state's count can be shown by office and district whatever its feed looks
 * like. Pure; unit-tested in test/contestOffice.test.ts against the titles the
 * states published for the 2026-11-03 general.
 */

export type ContestOfficeKind =
  /** The US Senate. */
  | "us-senate"
  /** The US House, a delegate included. */
  | "us-house"
  | "governor"
  /** The legislature's upper chamber, or its only one. */
  | "state-upper"
  | "state-lower"
  /** Another office the whole state elects: attorney general, treasurer. */
  | "statewide-office"
  /** Anything else: a court, a county, a town, a measure. */
  | "other";

export interface ContestOffice {
  kind: ContestOfficeKind;
  /** The district, as paths spell it (`7`, `35a`, `a`), for the House and the legislature. */
  district?: string;
  /** A seat within the district where it has several, each its own contest: Idaho's `a`, Washington's `1`. */
  seat?: string;
  /** A special election or an unexpired term: beside the regular contest for the same seat, not it. */
  special?: true;
}

export interface OfficeHints {
  /**
   * The state's lower chamber isn't called a House of Representatives (a
   * House of Delegates, an Assembly), so "House of Representatives" with
   * nothing before it is Congress: Virginia's "Member, House of
   * Representatives (1st District)".
   */
  bareHouseIsCongress?: boolean;
}

const ORDINAL_WORDS = [
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

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };

/** "iv" → 4; undefined for anything that isn't a small roman numeral. */
function roman(text: string): number | undefined {
  if (!/^[ivx]{1,6}$/.test(text)) return undefined;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN[text[i] ?? ""] ?? 0;
    const next = ROMAN[text[i + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 && total < 40 ? total : undefined;
}

/**
 * The district a title names, as paths spell it: "District No.  1" → `1`,
 * "District 01" → `1`, "District 1A" → `1a`, "Dist II" → `2`, "Senate
 * District A" → `a`, "(20th District)" → `20`, "First District" → `1`,
 * "State Senator 12" → `12`. `title` is lower case, spaces collapsed.
 */
function districtOf(title: string): string | undefined {
  const named = title.match(
    /\b(?:district|dist\.?)\s*(?:no\.?|number|#)?\s*(\d{1,3}[a-z]?|[ivx]{1,6}|[a-z])(?![a-z0-9])/,
  );
  if (named?.[1]) {
    const value = named[1];
    if (/^\d/.test(value)) return districtId(value);
    // "Dist II" is 2; "District I" could be Alaska's Senate district I, so a
    // lone letter stays a letter and only a longer numeral is read as one.
    if (value.length === 1) return value;
    const n = roman(value);
    return n === undefined ? undefined : String(n);
  }
  const ordinal = title.match(/\b(\d{1,3})(?:st|nd|rd|th)\b(?! united states congress)/);
  if (ordinal?.[1]) return districtId(ordinal[1]);
  const word = ORDINAL_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(title));
  if (word >= 0 && /\bdistrict\b/.test(title)) return String(word + 1);
  // "State Senator 12", "Kansas House of Representatives 2": the number is all there is.
  const last = title.replace(/\s*\([^)]*\)\s*$/g, "").match(/\s(\d{1,3}[a-z]?)$/);
  return last?.[1] ? districtId(last[1]) : undefined;
}

const US = String.raw`(?:u\.?\s?s\.?|united states)`;
const US_SENATE = new RegExp(
  String.raw`\b${US}\s+senat(?:e|or)\b|\bsenator in congress\b|\bunited states senate\b`,
);
const US_HOUSE = new RegExp(
  [
    String.raw`\b${US}\s+(?:house|representative|congress)\b`,
    String.raw`\brepresentative (?:in|to)(?: the \d+\w* united states)? congress\b`,
    String.raw`\bdelegate to the (?:${US} )?house of representatives\b`,
    String.raw`\bcongressional district\b.*\brepresentative\b`,
    String.raw`\brepresentative\b.*\bcongressional district\b`,
  ].join("|"),
);
/** Offices that name a congressional district without being Congress: a state board elected by one. */
const NOT_A_LEGISLATOR =
  /\b(?:board|regent|education|judge|justice|court|commission(?:er)?|trustee|school|attorney|solicitor|sheriff|council)\b/;
const GOVERNOR = /^(?:for )?governor\b/;
const UPPER =
  /\bsenat(?:e|or)\b|\bsenatorial district\b|\bmember of the legislature\b|\blegislature\b.*\bdistrict\b/;
const LOWER =
  /\bstate (?:representative|house|assembly)\b|\bhouse of (?:representatives|delegates)\b|^house district\b|\brepresentative in (?:the )?(?:general assembly|state legislature)\b|\b(?:member of the )?(?:state )?assembly\b.*\bdistrict\b|\bassembly district\b|\blegislative district\b.*\brepresentative\b|\brepresentative\b.*\blegislative district\b/;
const STATEWIDE_OFFICE =
  /^(?:for )?(?:lieutenant governor|lt\.? governor|secretary of state|attorney general|(?:state |general )?treasurer|treasurer of state|(?:state )?auditor(?: general)?|auditor of state|(?:state )?(?:controller|comptroller)(?: general)?|(?:state )?superintendent of (?:public instruction|education|schools)|state (?:school )?superintendent|(?:state )?commissioner of [a-z ]+|secretary of agriculture|(?:corporation|insurance|agriculture|land|railroad|labor|public service|public lands) commissioner|state mine inspector|chief financial officer)\b/;

/** The seat a title names within its district, in lower case: "Seat A" → `a`, "Pos. 2" → `2`. */
export function seatOf(title: string): string | undefined {
  return title.toLowerCase().match(/\b(?:seat|pos(?:ition)?\.?)\s*#?\s*([a-z]|\d{1,2})\b/)?.[1];
}

/**
 * The office a contest's title names. `other` for everything this doesn't
 * know: a wrong guess would put a town's race among the state's.
 */
export function contestOffice(rawTitle: string, hints: OfficeHints = {}): ContestOffice {
  const title = rawTitle.toLowerCase().replace(/\s+/g, " ").trim();
  const special = /\bunexpired\b|\bspecial\b|\bvacancy\b/.test(title)
    ? { special: true as const }
    : {};
  const seat = seatOf(title);
  const seated = seat ? { seat } : {};
  const legislator = !NOT_A_LEGISLATOR.test(title);

  if (US_SENATE.test(title) && legislator) return { kind: "us-senate", ...special };
  const bareHouse =
    hints.bareHouseIsCongress === true &&
    /\bhouse of representatives\b/.test(title) &&
    !/\bstate\b/.test(title);
  if ((US_HOUSE.test(title) || bareHouse) && legislator) {
    // A state with one seat prints no district: it is district 1 (SPEC §3.3).
    return { kind: "us-house", district: districtOf(title) ?? "1", ...special };
  }
  if (GOVERNOR.test(title)) return { kind: "governor", ...special };
  // A commission elected by district (Nebraska's Public Service Commission) isn't statewide.
  if (STATEWIDE_OFFICE.test(title))
    return /\bdistrict\b/.test(title)
      ? { kind: "other" }
      : { kind: "statewide-office", ...special };
  if (!legislator) return { kind: "other" };
  for (const [kind, pattern] of [
    ["state-upper", UPPER],
    ["state-lower", LOWER],
  ] as const) {
    if (!pattern.test(title)) continue;
    const district = districtOf(title);
    // A chamber's race with no district isn't one this can place.
    return district ? { kind, district, ...seated, ...special } : { kind: "other" };
  }
  return { kind: "other" };
}

/**
 * Whether a measure's title reads as one the whole state votes on: "Proposed
 * Constitutional Amendment 1", "PROPOSITION 141", "Initiative Measure No.
 * IP26-645", "State Issue 3". A title that names a city, a county, a school
 * or another district first is local.
 */
export function isStatewideMeasureTitle(rawTitle: string): boolean {
  const title = rawTitle.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    /\b(?:city|town|village|county|borough|township|parish|school|college|library|fire|hospital|park|water|sewer|port|transit|pud|utility|cemetery|road|levy|bonds?)\b/.test(
      title.split(/[:–—]| - /)[0] ?? "",
    )
  )
    return false;
  return /^(?:[a-z]+ )?(?:proposed )?(?:constitutional )?(?:amendment|measure|initiative|referendum|proposition|proposal|question|issue)\b|^(?:state|statewide)(?: ballot)? (?:issue|question|measure|proposition)\b|^advisory (?:question|vote)\b|^(?:bm|ci|cr|lr|i|c)[-#]? ?\d+\b|\bconstitutional (?:amendment|convention|measure|initiative)\b/.test(
    title,
  );
}
