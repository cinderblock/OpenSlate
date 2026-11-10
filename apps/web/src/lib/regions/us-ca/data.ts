import type { RegionProfile } from "../types";
import { US_STATES } from "../usStates";

/**
 * California's facts beyond the table every state has: the districts only it
 * draws (Courts of Appeal, the Board of Equalization, BART), how its Senate's
 * terms are staggered, and what its catalog paths were once called.
 */

/**
 * California Courts of Appeal by county (Gov. Code §69100–69106). Retention
 * races for appellate justices are filed under `us/ca/coa-<n>`.
 */
export const COURT_OF_APPEAL_BY_COUNTY: Record<string, string> = Object.fromEntries(
  Object.entries({
    1: "Alameda, Contra Costa, Del Norte, Humboldt, Lake, Marin, Mendocino, Napa, San Francisco, San Mateo, Solano, Sonoma",
    2: "Los Angeles, San Luis Obispo, Santa Barbara, Ventura",
    3: "Alpine, Amador, Butte, Calaveras, Colusa, El Dorado, Glenn, Lassen, Modoc, Mono, Nevada, Placer, Plumas, Sacramento, San Joaquin, Shasta, Sierra, Siskiyou, Sutter, Tehama, Trinity, Yolo, Yuba",
    4: "Imperial, Inyo, Orange, Riverside, San Bernardino, San Diego",
    5: "Fresno, Kern, Kings, Madera, Mariposa, Merced, Stanislaus, Tulare, Tuolumne",
    6: "Monterey, San Benito, Santa Clara, Santa Cruz",
  }).flatMap(([n, counties]) => counties.split(", ").map((county) => [county, n])),
);

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
const NAMESAKE_CITIES = [
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
];

const base = US_STATES.get("us/ca");
if (!base) throw new Error("the states table has no California");

export const CALIFORNIA: RegionProfile = {
  ...base,
  families: [
    { key: "cd", label: "Congressional district", office: "Congressional", count: 52 },
    {
      key: "sd",
      label: "State Senate district",
      office: "State Senate",
      count: 40,
      // Const. art. IV §2: even-numbered districts in gubernatorial years
      // (2026), odd ones in presidential years.
      seatsUp: (year) => (year % 4 === 2 ? "even" : "odd"),
    },
    { key: "ad", label: "Assembly district", office: "Assembly", count: 80 },
    { key: "coa", label: "Court of Appeal district", office: "Court of Appeal", count: 6 },
    { key: "bart", label: "BART district", office: "BART board", count: 9 },
    // Its races are filed statewide and named for the district.
    { key: "boe", label: "Board of Equalization district", narrows: true },
  ],
  counties: COUNTIES,
  namesakeCities: NAMESAKE_CITIES,
  consolidated: ["San Francisco"],
  localityNames: {
    sf: "San Francisco",
    ebmud: "EBMUD",
    ebrpd: "East Bay Regional Parks",
    laccd: "LA Community College District",
    "san-dieguito-uhsd": "San Dieguito Union High School District",
  },
  byCounty: { coa: COURT_OF_APPEAL_BY_COUNTY },
  geoFile: "geo/us-ca.topo.json",
  refiled: {
    // Filed under their city's path until 2026-10-25, then under their own.
    counties: {
      "us/ca/san-diego": "us/ca/san-diego-county",
      "us/ca/imperial": "us/ca/imperial-county",
    },
    // Filed as `city-of-<name>` while their county's races sat under the bare name.
    cities: {
      "us/ca/alameda": "us/ca/city-of-alameda",
    },
  },
};
