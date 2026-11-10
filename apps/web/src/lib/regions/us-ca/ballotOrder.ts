import type { BallotOrderRules, ComputedOrder, OrderBasis, RaceForOrder } from "../../ballotOrder";
import { countyOfPath, voterCounties } from "../../counties";
import { type Area, NO_DISTRICT, parseJurisdiction } from "../../jurisdictions";
import { compareByAlphabet, rotate } from "../../nameOrder";
import { COUNTY_DRAWINGS_2026, type CountyDrawing } from "./countyDrawings";
import { CA_DISTRICTS_2026, type DistrictOverlaps } from "./districtOverlaps";

/**
 * The order a California ballot prints a race's candidates in, for one voter.
 * Pure: no React, no storage, nothing sent anywhere. Reached through
 * `ballotOrder.ts`; unit-tested in test/ballotOrder.test.ts.
 * plans/ballot-order.md has the law and the data.
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
 *   (`countyDrawings.ts`).
 * - (f) Local offices not voted on countywide: the drawn order, no rotation.
 *   (g), (h) Countywide offices rotate by supervisorial district, or by
 *   Assembly district in a county with five or more. Charter cities may set
 *   their own rules, so local orders are "likely", not certain.
 */

/** One election's drawing, and the district overlaps rotation needs. */
interface ElectionOrder {
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

const BOE_TITLE = /Board of Equalization,? District (\d+)/i;

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
  const acrossAds = (ads: number[] | undefined, label: string): Rule | undefined => {
    if (!ads?.length) return undefined;
    if (voterAd === undefined)
      return { reason: `It changes from one Assembly district to the next across ${label}.` };
    if (!ads.includes(voterAd))
      return {
        reason: `It changes from one Assembly district to the next across ${label}, and we can't tell where yours falls.`,
      };
    return { offset: ads.indexOf(voterAd), alphabet: state };
  };

  if (where.kind === "state" && where.path === "us/ca") {
    const boe = race.title.match(BOE_TITLE)?.[1];
    if (boe) {
      const n = String(Number(boe));
      return acrossAds(order.districts.boe[n], `Board of Equalization District ${n}`);
    }
    if (voterAd === undefined)
      return { reason: "Statewide races change order from one Assembly district to the next." };
    return { offset: voterAd - 1, alphabet: state };
  }

  if (where.kind === "district" && where.state === "us/ca") {
    const n = where.number;
    if (where.family === "cd")
      return acrossAds(order.districts.cd[n], `Congressional District ${n}`);
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

/** The race's printed names in this voter's ballot order, by California's law. */
function orderFor(
  race: RaceForOrder,
  names: string[],
  area: Area | undefined,
): ComputedOrder | undefined {
  const order = race.election ? CALIFORNIA[race.election] : undefined;
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
 * The order a county prints its local measures in, by letter, if it says
 * (`CountyDrawing.measures`): the race's county, else the voter's one county.
 */
function measureOrderOf(
  race: { election?: string; jurisdiction?: string },
  area: Area | undefined,
): string[] | undefined {
  const order = race.election ? CALIFORNIA[race.election] : undefined;
  if (!order) return undefined;
  const where = parseJurisdiction(race.jurisdiction);
  if (where.kind === "state" || where.kind === "none") return undefined;
  const counties = voterCounties(area);
  const county =
    (where.kind === "local" ? countyOfPath(where.path) : undefined) ??
    (counties.length === 1 ? counties[0] : undefined);
  return county ? order.counties[county]?.measures : undefined;
}

export const CA_BALLOT_ORDER: BallotOrderRules = {
  alphabetFor: (election) => (election ? CALIFORNIA[election]?.alphabet : undefined),
  orderFor,
  measureOrderOf,
};
