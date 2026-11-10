import { alphabetFor, measureOrderOf } from "./ballotOrder";
import { countyOfPath } from "./counties";
import { type Area, jurisdictionLabel, parseJurisdiction } from "./jurisdictions";
import { compareByAlphabet } from "./nameOrder";
import { regionFor, regionProfile } from "./regions";

/**
 * The order a ballot prints its contests in, across every jurisdiction on
 * it. It's California's order, which is the only one checked against a real
 * ballot (`plans/ballot-order-san-mateo-check.md`); other states' races fall
 * into the same parts by the same reading of their titles until a state
 * needs its own. Pure; unit-tested in test/ballotSequence.test.ts.
 *
 * The paper ballot goes by kind of office, not by who holds the election
 * (Elections Code §13109): statewide offices, Congress and the Legislature,
 * judges, school offices (the Superintendent of Public Instruction among
 * them), county, city and district offices, and then every measure, state
 * propositions first. A voter copies their picks down from this order, so My
 * ballot, the printed ballot and focus mode all use it.
 */

/** The parts of a ballot, in the order it prints them. */
export const BALLOT_PARTS = [
  "state",
  "legislative",
  "judicial",
  "school",
  "county",
  "city",
  "district",
  "state-measures",
  "regional-measures",
  "school-measures",
  "county-measures",
  "city-measures",
  "district-measures",
  "other",
] as const;
export type BallotPart = (typeof BALLOT_PARTS)[number];

/** What a part is headed on screen and on paper. */
export const BALLOT_PART_LABEL: Record<BallotPart, string> = {
  state: "State offices",
  legislative: "Congress and Legislature",
  judicial: "Judges",
  school: "School",
  county: "County",
  city: "City",
  district: "Districts",
  "state-measures": "State measures",
  "regional-measures": "Regional measures",
  "school-measures": "School measures",
  "county-measures": "County measures",
  "city-measures": "City measures",
  "district-measures": "District measures",
  other: "Other",
};

/** The fields of a race its place on the ballot depends on. */
export interface SequencedRace {
  subject: { title: string; kind?: string };
  election?: string;
  jurisdiction?: string;
  district?: string;
  votedIn?: string[];
  ballot?: { heading?: string; number?: string; retention?: true };
}

/** Statewide and district offices in §13109's order (state, then Congress and the Legislature). */
const PARTISAN_OFFICES: Array<{ pattern: RegExp; part: BallotPart }> = [
  { pattern: /^(?:California )?Governor\b|\bGovernor of\b/i, part: "state" },
  { pattern: /\bLieutenant Governor\b/i, part: "state" },
  { pattern: /\bSecretary of State\b/i, part: "state" },
  { pattern: /\bController\b/i, part: "state" },
  { pattern: /\bTreasurer\b/i, part: "state" },
  { pattern: /\bAttorney General\b/i, part: "state" },
  { pattern: /\bInsurance Commissioner\b/i, part: "state" },
  { pattern: /\bBoard of Equalization\b/i, part: "state" },
  { pattern: /\b(?:US|U\.S\.|United States) Senat/i, part: "legislative" },
  {
    pattern:
      /\b(?:House of Representatives|(?:US|U\.S\.|United States) (?:House|Representative)|Congress)/i,
    part: "legislative",
  },
  { pattern: /\bState Senate\b|\bState Senator\b/i, part: "legislative" },
  { pattern: /\bAssembly\b/i, part: "legislative" },
];
/** Hold these before the Governor's pattern can: "Lieutenant Governor of California". */
const LIEUTENANT = /\bLieutenant Governor\b/i;

/** Judicial offices: the Supreme Court, the Courts of Appeal, then the Superior Court. */
const COURTS: RegExp[] = [/\bSupreme Court\b/i, /\bCourt of Appeal\b/i, /\bSuperior Court\b/i];

/** School offices: the state superintendent, the county's, then boards from county to elementary. */
const SCHOOL_OFFICES: RegExp[] = [
  /\bSuperintendent of Public Instruction\b/i,
  /\bSuperintendent of Schools\b/i,
  /\bBoard of Education\b|\bCounty Office of Education\b/i,
  /\bCollege\b/i,
  /\bUnified\b/i,
  /\bHigh School\b/i,
  /\bSchool\b|\bElementary\b/i,
];
/** A school district path, as a race's `district` or jurisdiction gives it. */
const SCHOOL_PATH = /\/(?:unsd|elsd|scsd|ccd|coe)-/;

/** City offices: the mayor, then the council, then the rest. */
const CITY_OFFICES: RegExp[] = [/\bMayor\b/i, /\bCouncil\b/i];
/** County offices: the board of supervisors first. */
const COUNTY_OFFICES: RegExp[] = [/\bSupervisor/i];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function rankIn(patterns: RegExp[], title: string): number {
  const at = patterns.findIndex((pattern) => pattern.test(title));
  return at === -1 ? patterns.length : at;
}

/** A retention question: a judge's yes/no "Shall … be elected?" */
function isRetention(race: SequencedRace): boolean {
  return race.ballot?.retention === true || /\bRetain (?:\w+ )?Justice\b/i.test(race.subject.title);
}

function isMeasure(race: SequencedRace): boolean {
  return race.subject.kind === "measure" && !isRetention(race);
}

function isSchool(race: SequencedRace): boolean {
  return (
    SCHOOL_PATH.test(race.district ?? "") ||
    SCHOOL_PATH.test(race.jurisdiction ?? "") ||
    rankIn(SCHOOL_OFFICES, race.subject.title) < SCHOOL_OFFICES.length
  );
}

/** A county's path: one its region lists (`countyOfPath`), or any `<name>-county` (`-parish`, `-borough`). */
function isCountyPath(path: string): boolean {
  if (countyOfPath(path) !== undefined || /-county$/.test(path)) return true;
  const word = regionFor(path)?.countyWord.toLowerCase();
  return !!word && word !== "county" && path.endsWith(`-${word}`);
}

/** Whether a district family is Congress or a chamber of the region's legislature. */
function isLegislativeFamily(state: string, family: string): boolean {
  const layers = regionProfile(state)?.layers;
  if (!layers) return family === "cd" || family === "sd" || family === "ad";
  return family === layers.congress || family === layers.upper || family === layers.lower;
}

/** Which part of the ballot a race prints in. */
export function ballotPart(race: SequencedRace): BallotPart {
  const where = parseJurisdiction(race.jurisdiction);
  const title = race.subject.title;
  if (where.kind === "none") return "other";

  if (isMeasure(race)) {
    if (where.kind === "state") return "state-measures";
    if (race.votedIn && race.votedIn.length > 1) return "regional-measures";
    if (isSchool(race)) return "school-measures";
    if (where.kind === "district") return "district-measures";
    if (race.district) return "district-measures";
    return isCountyPath(where.path) ? "county-measures" : "city-measures";
  }

  if (isRetention(race) || rankIn(COURTS, title) < COURTS.length) return "judicial";
  if (where.kind === "district" && where.family === "coa") return "judicial";
  if (rankIn(SCHOOL_OFFICES, title) === 0) return "school";
  if (where.kind !== "state" && isSchool(race)) return "school";

  if (where.kind === "state" || where.kind === "district") {
    const office = PARTISAN_OFFICES.find(({ pattern }) => pattern.test(title));
    if (office) return office.part;
    if (where.kind === "district") {
      if (isLegislativeFamily(where.state, where.family)) return "legislative";
      if (where.family === "boe") return "state";
      return "district";
    }
    return "state";
  }

  // Local.
  if (isCountyPath(where.path)) {
    // A county's own board and officers; anything filed under the county with
    // a district that isn't a supervisorial or school one is a special district.
    if (race.district && !/\/sup-\d+$/.test(race.district)) return "district";
    return "county";
  }
  return "city";
}

/** Where a partisan office falls in §13109's list. */
function partisanRank(title: string): number {
  if (LIEUTENANT.test(title)) return 1;
  const at = PARTISAN_OFFICES.findIndex(({ pattern }) => pattern.test(title));
  return at === -1 ? PARTISAN_OFFICES.length : at;
}

/** A district's number, for ordering several of one office ("District 4" before "District 12"). */
function districtNumber(race: SequencedRace): number {
  const where = parseJurisdiction(race.jurisdiction);
  // A lettered district by its number (35a with 35); a named one after the numbered.
  if (where.kind === "district") return Number.parseInt(where.number, 10) || 0;
  const n = race.district?.match(/-(\d+)$/)?.[1];
  return n ? Number(n) : 0;
}

/** A court's division, from the listing's heading: "…, Division Two" → 2. */
function divisionOf(race: SequencedRace): number {
  const said = race.ballot?.heading?.match(/\bDivision (\w+)/i)?.[1]?.toLowerCase();
  if (!said) return 0;
  return NUMBER_WORDS[said] ?? (Number(said) || 0);
}

/** The chief or presiding justice leads their court or division. */
function leadsCourt(race: SequencedRace): boolean {
  return /\b(?:Chief|Presiding) Justice\b/i.test(race.ballot?.heading ?? race.subject.title);
}

/** The judge a retention question names. */
function judgeName(race: SequencedRace): string {
  return race.subject.title.match(/\bRetain (?:\w+ )?Justice (.+)$/i)?.[1] ?? race.subject.title;
}

/**
 * Judges: court by court (Supreme Court, then each Court of Appeal district
 * by number, then the Superior Court), division by division, the chief or
 * presiding justice first, then the rest by the drawn alphabet (§13111(j)).
 * Checked against a San Mateo County ballot's First District.
 */
function compareJudges(a: SequencedRace, b: SequencedRace): number {
  const court = (race: SequencedRace) => {
    const where = parseJurisdiction(race.jurisdiction);
    if (where.kind === "district" && where.family === "coa") return 1;
    return Math.min(rankIn(COURTS, race.subject.title), COURTS.length);
  };
  const byCourt = court(a) - court(b) || districtNumber(a) - districtNumber(b);
  if (byCourt) return byCourt;
  const byDivision = divisionOf(a) - divisionOf(b) || Number(leadsCourt(b)) - Number(leadsCourt(a));
  if (byDivision) return byDivision;
  if (isRetention(a) && isRetention(b)) {
    const alphabet = alphabetFor(a.election ?? b.election, a.jurisdiction ?? b.jurisdiction);
    if (alphabet) return compareByAlphabet(alphabet, judgeName(a), judgeName(b));
  }
  return 0;
}

/**
 * Measures within a part: the county's own sequence where we have it (San
 * Mateo prints its county measures L, AA, J, U, as its drawing lists them,
 * not by letter), else by number or letter.
 */
function compareMeasures(a: SequencedRace, b: SequencedRace, area: Area | undefined): number {
  const order = measureOrderOf(a, area);
  if (order && order === measureOrderOf(b, area)) {
    const at = (race: SequencedRace) => {
      const i = order.indexOf(race.ballot?.number ?? "");
      return i === -1 ? order.length : i;
    };
    const byCounty = at(a) - at(b);
    if (byCounty) return byCounty;
  }
  const numberOf = (race: SequencedRace) => race.ballot?.number ?? "";
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na && nb && na !== nb) {
    // Letters run A…Z, then AA, BB…: the longer label comes later.
    return na.length - nb.length || collator.compare(na, nb);
  }
  return 0;
}

function officeRankIn(part: BallotPart, title: string): number {
  switch (part) {
    case "state":
    case "legislative":
      return partisanRank(title);
    case "school":
      return rankIn(SCHOOL_OFFICES, title);
    case "county":
      return rankIn(COUNTY_OFFICES, title);
    case "city":
      return rankIn(CITY_OFFICES, title);
    default:
      return 0;
  }
}

/**
 * Ballot order between two races, for this voter. Within a part: office by
 * office in §13109's order, judges court by court, measures as the county
 * numbers them; then the place (a voter normally has one city), the district
 * number, and the title.
 */
export function compareBallotOrder(
  a: SequencedRace,
  b: SequencedRace,
  area?: Area | undefined,
): number {
  return compareKeyed(a, orderKey(a), b, orderKey(b), area);
}

/**
 * Sort into ballot order (`compareBallotOrder`), in place. Each race's part,
 * place and district are worked out once, not on every comparison: a whole
 * catalog's races take thousands of comparisons.
 */
export function sortByBallotOrder<T>(
  items: T[],
  area: Area | undefined,
  raceOf: (item: T) => SequencedRace,
): T[] {
  const keyed = items.map((item) => {
    const race = raceOf(item);
    return { item, race, key: orderKey(race) };
  });
  keyed.sort((x, y) => compareKeyed(x.race, x.key, y.race, y.key, area));
  for (const [i, { item }] of keyed.entries()) items[i] = item;
  return items;
}

/** What ballot order compares, worked out from one race alone. */
interface OrderKey {
  part: BallotPart;
  partIndex: number;
  office: number;
  place: string;
  district: number;
}

function orderKey(race: SequencedRace): OrderKey {
  const part = ballotPart(race);
  return {
    part,
    partIndex: BALLOT_PARTS.indexOf(part),
    office: officeRankIn(part, race.subject.title),
    place: jurisdictionLabel(race.jurisdiction),
    district: districtNumber(race),
  };
}

function compareKeyed(
  a: SequencedRace,
  ka: OrderKey,
  b: SequencedRace,
  kb: OrderKey,
  area: Area | undefined,
): number {
  const byPart = ka.partIndex - kb.partIndex;
  if (byPart) return byPart;
  const within =
    ka.part === "judicial"
      ? compareJudges(a, b)
      : ka.part.endsWith("-measures")
        ? compareMeasures(a, b, area)
        : ka.office - kb.office;
  return (
    within ||
    collator.compare(ka.place, kb.place) ||
    ka.district - kb.district ||
    collator.compare(a.subject.title, b.subject.title)
  );
}

/** Consecutive races under the heading of the part they print in. */
export function ballotSections<R extends SequencedRace>(
  races: R[],
): Array<{ part: BallotPart; label: string; races: R[] }> {
  const out: Array<{ part: BallotPart; label: string; races: R[] }> = [];
  for (const race of races) {
    const part = ballotPart(race);
    const last = out.at(-1);
    if (last?.part === part) last.races.push(race);
    else out.push({ part, label: BALLOT_PART_LABEL[part], races: [race] });
  }
  return out;
}
