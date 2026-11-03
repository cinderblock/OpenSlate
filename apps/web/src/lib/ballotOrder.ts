import { CA_DISTRICTS_2026, type DistrictOverlaps } from "./ballotOrderCa";
import { COUNTY_DRAWINGS_2026, type CountyDrawing } from "./ballotOrderCounties";
import { type Area, localityPathFor, NO_DISTRICT, parseJurisdiction } from "./jurisdictions";

/**
 * The order a California ballot prints a race's candidates in, for one voter.
 * Pure: no React, no storage, nothing sent anywhere. Unit-tested in
 * test/ballotOrder.test.ts; plans/ballot-order.md has the law and the data.
 *
 * Elections Code §13112: the Secretary of State draws a random order of the
 * 26 letters before each election, and names sort by it, last name first,
 * letter by letter. §13111 then rotates some offices from one Assembly
 * district to the next: the name first in one district goes last in the next.
 *
 * - (c) Statewide offices: the drawn order in AD 1, rotated once per AD after it.
 * - (d) Congress and the Board of Equalization: the drawn order in the
 *   lowest-numbered AD the district reaches, rotated once per AD after it.
 * - (e) State Senate and Assembly within one county: the drawn order, no
 *   rotation. (i) A district across counties uses each county's own drawing
 *   (`ballotOrderCounties.ts`).
 * - (f) Local offices not voted on countywide: the drawn order, no rotation.
 *   (g), (h) Countywide offices rotate by supervisorial district, or by
 *   Assembly district in a county with five or more. Charter cities may set
 *   their own rules, so local orders are "likely", not certain.
 */

/** One election's drawing, and the district overlaps rotation needs. */
export interface ElectionOrder {
  /** The Secretary of State's 26 letters as drawn, first first. */
  alphabet: string;
  districts: DistrictOverlaps;
  /** Each county's own drawing, by county name. */
  counties: Record<string, CountyDrawing>;
}

/** California elections whose drawing we have, by election date. */
const CALIFORNIA: Record<string, ElectionOrder> = {
  // Drawn 2026-08-13: https://www.sos.ca.gov/administration/news-releases-and-advisories/2026-news-releases-and-advisories/california-secretary-state-shirley-n-weber-phd-announces-results-randomized-alphabet-drawing-november-3-2026-general-election
  "2026-11-03": {
    alphabet: "HXKWCPJOZALDNSQBIRYGVEFMTU",
    districts: CA_DISTRICTS_2026,
    counties: COUNTY_DRAWINGS_2026,
  },
};

/** Where an order comes from, or why it can't be known. */
export type OrderBasis =
  /** The law, the drawing and the voter's districts fix it. */
  | "ballot"
  /** The law's default for local races; a county or charter city may differ. */
  | "likely"
  /** It differs across the race's area and the voter's district can't say which. */
  | "varies"
  /** The voter set it by hand from their own ballot. */
  | "yours";

export interface ComputedOrder {
  basis: OrderBasis;
  /** The names in ballot order; the input order when it "varies". */
  names: string[];
  /** Why the order can't be known, or may be off, for a note under the race. */
  reason?: string;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "esq"]);
const PARTICLES = new Set([
  "de",
  "del",
  "della",
  "la",
  "le",
  "van",
  "von",
  "der",
  "da",
  "di",
  "du",
  "st",
]);

/** Letters only, accents dropped, upper case. */
function letters(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/**
 * A name's sort parts: last name, then first, then the rest. "Xavier Becerra"
 * → BECERRA, XAVIER. Nicknames in quotes or parentheses, suffixes (Jr., III)
 * and a trailing comma's part are left out; a particle before the last name
 * ("Kevin de León") belongs to it.
 */
export function sortParts(name: string): string[] {
  const words = name
    .replace(/"[^"]*"|“[^”]*”|\([^)]*\)/g, " ")
    .split(/[\s,]+/)
    .filter((word) => letters(word) !== "");
  while (words.length > 1 && SUFFIXES.has(letters(words.at(-1) ?? "").toLowerCase())) words.pop();
  if (words.length === 0) return [letters(name)];
  let lastStart = words.length - 1;
  while (
    lastStart > 1 &&
    PARTICLES.has((words[lastStart - 1] ?? "").toLowerCase().replace(/\.$/, ""))
  )
    lastStart--;
  const last = letters(words.slice(lastStart).join(""));
  const [first = "", ...middle] = words.slice(0, lastStart);
  return [last, letters(first), letters(middle.join(""))];
}

/** Compare two names by a drawn alphabet: last name, then first, then middle, letter by letter. */
export function compareByAlphabet(alphabet: string, a: string, b: string): number {
  const rank = (letter: string) => alphabet.indexOf(letter);
  const pa = sortParts(a);
  const pb = sortParts(b);
  for (let part = 0; part < Math.max(pa.length, pb.length); part++) {
    const x = pa[part] ?? "";
    const y = pb[part] ?? "";
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const diff = rank(x[i] as string) - rank(y[i] as string);
      if (diff !== 0) return diff;
    }
    if (x.length !== y.length) return x.length - y.length;
  }
  return 0;
}

/** Move the first `offset` names to the end, as §13111 does once per district. */
function rotate<T>(list: T[], offset: number): T[] {
  if (list.length === 0) return list;
  const n = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}

const BOE_TITLE = /Board of Equalization,? District (\d+)/i;

/** California's 58 counties, by the name the Census and the district data use. */
const COUNTIES = [
  "Alameda",
  "Alpine",
  "Amador",
  "Butte",
  "Calaveras",
  "Colusa",
  "Contra Costa",
  "Del Norte",
  "El Dorado",
  "Fresno",
  "Glenn",
  "Humboldt",
  "Imperial",
  "Inyo",
  "Kern",
  "Kings",
  "Lake",
  "Lassen",
  "Los Angeles",
  "Madera",
  "Marin",
  "Mariposa",
  "Mendocino",
  "Merced",
  "Modoc",
  "Mono",
  "Monterey",
  "Napa",
  "Nevada",
  "Orange",
  "Placer",
  "Plumas",
  "Riverside",
  "Sacramento",
  "San Benito",
  "San Bernardino",
  "San Diego",
  "San Francisco",
  "San Joaquin",
  "San Luis Obispo",
  "San Mateo",
  "Santa Barbara",
  "Santa Clara",
  "Santa Cruz",
  "Shasta",
  "Sierra",
  "Siskiyou",
  "Solano",
  "Sonoma",
  "Stanislaus",
  "Sutter",
  "Tehama",
  "Trinity",
  "Tulare",
  "Tuolumne",
  "Ventura",
  "Yolo",
  "Yuba",
];

/**
 * Counties a city shares its name with: their bare path (`us/ca/fresno`) is
 * the city's, so only `<name>-county` is the county (`localityCandidates`).
 */
const NAMESAKE_CITIES = new Set([
  "Alameda",
  "Amador",
  "Colusa",
  "Fresno",
  "Imperial",
  "Los Angeles",
  "Madera",
  "Merced",
  "Monterey",
  "Napa",
  "Nevada",
  "Orange",
  "Riverside",
  "Sacramento",
  "San Bernardino",
  "San Diego",
  "San Luis Obispo",
  "San Mateo",
  "Santa Barbara",
  "Santa Clara",
  "Santa Cruz",
  "Sonoma",
  "Tehama",
  "Tulare",
  "Ventura",
  "Yuba",
]);

/** The county a locality path is, if it is one: `us/ca/marin-county`, `us/ca/marin`, `us/ca/sf`. */
export function countyOfPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (path === "us/ca/sf") return "San Francisco";
  return COUNTIES.find((county) => {
    const base = localityPathFor("us/ca", county);
    return path === `${base}-county` || (path === base && !NAMESAKE_CITIES.has(county));
  });
}

/** The counties the voter's area puts them in (normally one). */
export function voterCounties(area: Area | undefined): string[] {
  if (!area) return [];
  const paths = new Set([...area.localities, ...(area.found ?? [])]);
  return [...new Set([...paths].map(countyOfPath).filter((c): c is string => !!c))];
}

/** A rotation offset and the alphabet it rotates, or why the order can't be told. */
type Rule =
  | { offset: number; alphabet: string; basis?: OrderBasis; reason?: string }
  | { reason: string };

/** The law's default for local races: a county or charter city may set its own. */
const LIKELY = {
  basis: "likely" as const,
  reason: "State law's order for local races; a county or charter city can set its own.",
};

/**
 * The rule for this race and voter: which alphabet, rotated how far, or why
 * it can't be told. `undefined`: no rule applies here (not a California
 * office we order, or not an election we have).
 */
function ruleFor(
  race: RaceForOrder,
  area: Area | undefined,
  order: ElectionOrder,
): Rule | undefined {
  const where = parseJurisdiction(race.jurisdiction);
  const state = order.alphabet;
  const ad = area?.districts["us/ca/ad"];
  const voterAd = ad && ad !== NO_DISTRICT ? Number(ad) : undefined;
  const counties = voterCounties(area);
  const acrossAds = (
    ads: number[] | undefined,
    unsure: number[] | undefined,
    label: string,
  ): Rule | undefined => {
    if (!ads?.length) return undefined;
    if (voterAd === undefined)
      return { reason: `It changes from one Assembly district to the next across ${label}.` };
    if (!ads.includes(voterAd) || unsure?.some((n) => n <= voterAd))
      return {
        reason: `It changes from one Assembly district to the next across ${label}, and we can't tell where yours falls.`,
      };
    return { offset: ads.indexOf(voterAd), alphabet: state };
  };

  if (where.kind === "state" && where.path === "us/ca") {
    const boe = race.title.match(BOE_TITLE)?.[1];
    if (boe) {
      const n = String(Number(boe));
      return acrossAds(
        order.districts.boe[n],
        order.districts.boeUnsure[n],
        `Board of Equalization District ${n}`,
      );
    }
    if (voterAd === undefined)
      return { reason: "Statewide races change order from one Assembly district to the next." };
    return { offset: voterAd - 1, alphabet: state };
  }

  if (where.kind === "district" && where.state === "us/ca") {
    const n = where.number;
    if (where.family === "cd")
      return acrossAds(
        order.districts.cd[n],
        order.districts.cdUnsure[n],
        `Congressional District ${n}`,
      );
    if (where.family === "sd" || where.family === "ad") {
      const reaches = (
        where.family === "sd" ? order.districts.sdCounties : order.districts.adCounties
      )[n];
      if (!reaches) return undefined;
      if (reaches.length === 1) return { offset: 0, alphabet: state };
      // §13111(i): each county orders its part with its own drawing.
      const mine = counties.filter((county) => reaches.includes(county));
      if (mine.length !== 1)
        return {
          reason: `The district reaches ${reaches.length} counties, each with its own letter order, and we can't tell which county you're in.`,
        };
      const county = mine[0] as string;
      const drawing = order.counties[county];
      if (!drawing)
        return {
          reason: `The district reaches ${reaches.length} counties, each with its own letter order, and we haven't found ${county} County's.`,
        };
      return { offset: 0, alphabet: drawing.alphabet };
    }
    return undefined;
  }

  if (where.kind === "local" && where.state === "us/ca") {
    // §13111(f)-(h).
    const raceCounty = countyOfPath(where.path);
    const county = raceCounty ?? (counties.length === 1 ? counties[0] : undefined);
    if (!county && Object.values(order.counties).some((d) => d.local))
      return {
        reason:
          "Some counties use their own letter order for local races, and we can't tell your county.",
      };
    const drawing = county ? order.counties[county] : undefined;
    const alphabet = drawing?.local ? drawing.alphabet : state;
    // Countywide offices rotate: by Assembly district in a county with five or
    // more, else by supervisorial district (§13111(g), (h)).
    if (raceCounty && !race.district) {
      const ads = Object.entries(order.districts.adCounties)
        .filter(([, reach]) => reach.includes(raceCounty))
        .map(([n]) => Number(n))
        .sort((a, b) => a - b);
      if (ads.length >= 5) {
        if (voterAd === undefined || !ads.includes(voterAd))
          return {
            reason: `Countywide races in ${raceCounty} County change order from one Assembly district to the next.`,
          };
        return { offset: ads.indexOf(voterAd), alphabet, ...LIKELY };
      }
      const sup = area?.districts[`${where.path}/sup`];
      const supN = sup && sup !== NO_DISTRICT ? Number(sup) : Number.NaN;
      if (Number.isNaN(supN))
        return {
          reason: `Countywide races in ${raceCounty} County change order from one supervisorial district to the next.`,
        };
      return { offset: supN - 1, alphabet, ...LIKELY };
    }
    return { offset: 0, alphabet, ...LIKELY };
  }
  return undefined;
}

export interface RaceForOrder {
  election?: string;
  jurisdiction?: string;
  /** Who votes on it, when narrower than the jurisdiction (a supervisorial district). */
  district?: string;
  title: string;
  kind?: string;
  /** A judge's yes/no retention question. */
  retention?: boolean;
}

/**
 * The race's printed names in this voter's ballot order. `undefined` when no
 * rule here applies (keep the listing's order): measures, retention
 * questions, other states, elections we have no drawing for.
 */
export function ballotOrderFor(
  race: RaceForOrder,
  names: string[],
  area: Area | undefined,
): ComputedOrder | undefined {
  if (!race.election || race.kind === "measure" || race.retention) return undefined;
  const order = CALIFORNIA[race.election];
  if (!order) return undefined;
  const rule = ruleFor(race, area, order);
  if (!rule) return undefined;
  if (!("offset" in rule)) {
    return names.length < 2
      ? { basis: "ballot", names }
      : { basis: "varies", names, reason: rule.reason };
  }
  const drawn = [...names].sort((a, b) => compareByAlphabet(rule.alphabet, a, b));
  return {
    basis: rule.basis ?? "ballot",
    names: rotate(drawn, rule.offset),
    ...(rule.reason ? { reason: rule.reason } : {}),
  };
}

/**
 * Elections Code §13109: the order of offices on a California ballot. State
 * offices, Congress, the Legislature, then judges, then school, county, city
 * and district offices. An office the list doesn't name comes after the ones
 * it does, by title. Counties may reorder the local groups (§13109(o)), so
 * the local part is the code's order, not a promise.
 */
const STATE_OFFICES: RegExp[] = [
  /^(?:California )?Governor\b/i,
  /\bLieutenant Governor\b/i,
  /\bSecretary of State\b/i,
  /\bController\b/i,
  /\bTreasurer\b/i,
  /\bAttorney General\b/i,
  /\bInsurance Commissioner\b/i,
  /\bBoard of Equalization\b/i,
  /\b(?:US|U\.S\.|United States) Senat/i,
  /\b(?:House of Representatives|(?:US|U\.S\.|United States) (?:House|Representative)|Congress)/i,
  /\bState Senate\b|\bState Senator\b/i,
  /\bAssembly\b/i,
  /\bSupreme Court\b/i,
  /\bCourt of Appeal\b/i,
  /\bSuperior Court\b/i,
  /\bSuperintendent of Public Instruction\b/i,
];
const LOCAL_OFFICES: RegExp[] = [
  /\bSuperior Court\b/i,
  /\bSuperintendent of Schools\b/i,
  /\bBoard of Education\b/i,
  /\bCollege\b/i,
  /\bUnified\b/i,
  /\bHigh School\b/i,
  /\b(?:Elementary|School)\b/i,
  /\bSupervisor/i,
  /\bMayor\b/i,
  /\bCouncil\b/i,
];

/** Where an office falls in §13109's order (lower first), for races in one ballot section. */
export function officeRank(race: { jurisdiction?: string; title: string }): number {
  const local = parseJurisdiction(race.jurisdiction).kind === "local";
  const list = local ? LOCAL_OFFICES : STATE_OFFICES;
  const at = list.findIndex((pattern) => pattern.test(race.title));
  return at === -1 ? list.length : at;
}
