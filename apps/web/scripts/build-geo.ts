/**
 * Builds a state's boundary file, `public/geo/us-<code>.topo.json`: its
 * congressional, legislative, county, city and school district boundaries,
 * for finding someone's districts on their own device (the map picker and
 * "Use my location"; see src/lib/geo.ts and plans/find-my-districts.md).
 * School districts (unified, elementary, secondary) are looked up, not drawn,
 * and so are California's Board of Equalization, community college,
 * supervisorial and city council districts: they place the races only part
 * of a county or the state votes on (plans/sub-county-districts.md).
 *
 * Sources: the Census Bureau's TIGERweb "Current" map service (the boundaries
 * in force for this year's elections: the 120th Congress districts, 2026 state
 * legislative districts, school districts), and for what Census doesn't map,
 * the body that draws or keeps it (`OTHER_SOURCES`). Each layer is fetched near
 * full resolution, joined into one topology so neighbours share their border,
 * then simplified topologically (shared borders stay shared, so no slivers or
 * overlaps) and quantized.
 *
 *   bun run geo                    California: fetch (cached in the OS temp
 *                                  dir) and build
 *   bun run geo --state tx         another state, by postal code (or several:
 *                                  `--state ct,ma,ri`)
 *   bun run geo --state all        every state, the District and the territories
 *                                  Census maps; writes `index.json` beside them,
 *                                  and the states' outlines as `us.topo.json`
 *   bun run geo --out <dir>        somewhere other than public/geo
 *   bun run geo --refresh          refetch from TIGERweb
 *   bun run geo --check            also report how often the simplified
 *                                  districts disagree with full resolution
 *
 * Re-run after redistricting or when Census publishes a new vintage, and commit
 * the output.
 *
 * What differs from state to state, all from the data itself:
 * - District ids are what the Census calls them, as paths spell them
 *   (`districtId`): `11`, Minnesota's `35a`, Alaska's Senate `i`, and for the
 *   states that name theirs, `third-middlesex`, `hillsborough-10`. Anything
 *   that isn't a plain number keeps its name beside it.
 * - A state with one seat in the House has one district, `1`.
 * - Water and other land in no district ("… not defined") is left out.
 * - Nebraska and the District of Columbia have no lower chamber: that layer
 *   is there, empty.
 * - Alaska crosses the 180th meridian. Its western Aleutians are moved to
 *   west of -180 so the state is one piece (`metadata.wrap`, which
 *   src/lib/geo.ts applies to the point it looks up).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { censusDistrictId } from "@openslate/core";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { feature, merge, quantize } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { GeometryCollection, Topology } from "topojson-specification";
import { decodeStateGeo, LOOKUP_LAYERS, lookupsAt } from "../src/lib/geo";
import { slugOf } from "../src/lib/jurisdictions";
import { allRegions, type RegionProfile, regionByCode } from "../src/lib/regions";
import { townsAreBare } from "../src/lib/towns";

const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";

/**
 * Our layer name → TIGERweb layer id, which attribute becomes the feature id,
 * and for school districts the name kept beside it (their id, the LEA code,
 * says nothing to a voter).
 */
const LAYERS: Record<
  string,
  { id: number; key: string; name?: string; where?: string; fields?: string[] }
> = {
  cd: { id: 54, key: "BASENAME" }, // 120th Congressional Districts
  sd: { id: 56, key: "BASENAME" }, // 2026 State Legislative Districts - Upper
  ad: { id: 58, key: "BASENAME" }, // 2026 State Legislative Districts - Lower
  county: { id: 82, key: "BASENAME", name: "NAME" },
  // Incorporated Places. NAME ("Woodstock village") is kept only for one a
  // town goes by the name of (src/lib/towns.ts).
  place: { id: 28, key: "BASENAME", fields: ["NAME"] },
  // County Subdivisions that are governments of their own (FUNCSTAT A, or B:
  // partly consolidated, with its own officers): towns and townships. A
  // city's twin there is F, New York City's boroughs G, the Census's own
  // divisions S or N. Ids are `<County>|<NAME>`, the name kept beside it.
  town: {
    id: 22,
    key: "NAME",
    name: "BASENAME",
    where: "FUNCSTAT IN ('A','B')",
    fields: ["COUNTY"],
  },
  unsd: { id: 14, key: "GEOID", name: "NAME" }, // Unified School Districts
  elsd: { id: 18, key: "GEOID", name: "NAME" }, // Elementary School Districts
  scsd: { id: 16, key: "GEOID", name: "NAME" }, // Secondary School Districts
};

/**
 * Boundaries Census doesn't publish, each from whoever draws or keeps them, as
 * our layer name, the ArcGIS layer to query, and how a feature's attributes
 * become its id (and name). Supervisorial districts are one layer for every
 * county we have, ids `<County>|<district>` with the county as TIGER names it;
 * council districts the same per city (`<City>|<district>`, the city matched
 * to its TIGER name whatever its case). `webMapLayer`: `url` is an ArcGIS web
 * map and the features are its layer of that title (a city whose adopted map
 * is published only that way, by its redistricting consultant).
 */
type Attributes = Record<string, unknown>;
/** California's. No other state has any yet. */
const CA_OTHER_SOURCES: {
  layer: "boe" | "ccd" | "sup" | "council";
  url: string;
  where?: string;
  webMapLayer?: string;
  id: (a: Attributes) => string;
  name?: (a: Attributes) => string;
}[] = [
  {
    // California Citizens Redistricting Commission's 2021 maps, on the state GIS.
    layer: "boe",
    url: "https://services.gis.ca.gov/arcgis/rest/services/Government/CaliforniaDistricts/MapServer/3",
    id: (a) => String(a.DISTRICT),
  },
  {
    // CCC GIS Collaborative / Foundation for California Community Colleges, from
    // the districts' legal narratives (public domain); ids are the Chancellor's
    // Office district codes (Coast = 830).
    layer: "ccd",
    url: "https://services3.arcgis.com/iUKM0a3Vouz02bg4/arcgis/rest/services/CCC_Boundaries/FeatureServer/0",
    id: (a) => String(a.DID),
    name: (a) => `${a.DistrictNa} Community College District`,
  },
  {
    // SCAG: Los Angeles, Orange, Riverside, San Bernardino, Ventura, Imperial.
    layer: "sup",
    url: "https://maps.scag.ca.gov/scaggis/rest/services/OpenData/Supervisorial_boundary_scag/MapServer/0",
    id: (a) => `${a.COUNTY}|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://gis-public.sandiegocounty.gov/arcgis/rest/services/Hosted/COSD_Boundaries/FeatureServer/1",
    id: (a) => `San Diego|${a.distno}`,
  },
  {
    layer: "sup",
    url: "https://services2.arcgis.com/tcv2cMrq63AgvbHF/arcgis/rest/services/PlanningOfficeDataService2/FeatureServer/5",
    id: (a) => `Santa Clara|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Supervisorial_Districts/FeatureServer/0",
    id: (a) => `Alameda|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://services.arcgis.com/yq3FgOI44hYHAFVZ/arcgis/rest/services/Supervisor_Districts_Land_Boundaries/FeatureServer/0",
    id: (a) => `San Mateo|${a.District}`,
  },
  {
    // DataSF, the 2022 districts.
    layer: "sup",
    url: "https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Current_Supervisor_Districts/FeatureServer/0",
    id: (a) => `San Francisco|${a.supervisor}`,
  },
  // City councils: plans/council-districts-lookup.md says how each was checked.
  {
    // OC Registrar of Voters, every city with districts. Newport Beach's are
    // residency districts every voter in the city votes on: not a lookup.
    layer: "council",
    url: "https://services3.arcgis.com/slX5MYawmKdsiRUf/arcgis/rest/services/Map_Central_District_Dissolved_Public_City_Council/FeatureServer/1657",
    where: "District_Name <> 'Newport Beach'",
    id: (a) => `${a.District_Name}|${a.Subdistrict_ID}`,
  },
  {
    // Alameda County Registrar of Voters: "CITY OF HAYWARD, DISTRICT #1".
    // San Leandro's are its 2022 districts, voted by district from this
    // November (Measure F, June 2026), its District 2 short term included.
    layer: "council",
    url: "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/City_Council_Districts/FeatureServer/0",
    id: (a) => {
      const m = /^CITY OF (.+?), DIST(?:RICT)? ?#\s*(\w+)$/.exec(String(a.DIST_NAME));
      return m ? `${m[1]}|${m[2]}` : "";
    },
  },
  {
    // SANDAG, every city in San Diego County with districts. Solana Beach has
    // an unnumbered strip offshore.
    layer: "council",
    url: "https://geo.sandag.org/server/rest/services/Hosted/Council_Districts/FeatureServer/0",
    where: "district IS NOT NULL",
    id: (a) => `${a.jur_name}|${a.district}`,
  },
  ...(
    [
      // Each city's own GIS.
      [
        "Belmont",
        "https://maps.belmont.gov/arcgis/rest/services/OpenData/OpenData/MapServer/50",
        "DISTRICT",
      ],
      [
        "Burlingame",
        "https://services3.arcgis.com/GNfQzqBlylJyDTAC/arcgis/rest/services/Council_Districts_WFL1/FeatureServer/2",
        "DISTRICT",
      ],
      [
        "Foster City",
        "https://services7.arcgis.com/CYn8XGt0yVlPlS5X/arcgis/rest/services/Foster_City_Election_Districts_-_Final_Less_Water/FeatureServer/0",
        "district",
      ],
      [
        "Half Moon Bay",
        "https://services.arcgis.com/PmM1Bg9qFLS54qH7/arcgis/rest/services/Adopted_Map_503b/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Menlo Park",
        "https://services7.arcgis.com/uRrQ0O3z2aaiIWYU/arcgis/rest/services/Adopted_Council_Districts_View/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Millbrae",
        "https://services6.arcgis.com/paH4j1JG3JAZKLhE/arcgis/rest/services/CityCouncilMap2022/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Redwood City",
        "https://gismaps.redwoodcity.org/server/rest/services/PublicMapServices/Council_Election_Districts_MS/MapServer/0",
        "DISTRICT",
      ],
      [
        "San Bruno",
        "https://services2.arcgis.com/iLsFVn6d1pmqKEfA/arcgis/rest/services/Council_Districts/FeatureServer/0",
        "DistrictName",
      ],
      [
        "San Mateo",
        "https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/City_of_San_Mateo_Council_Voting_Districts/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "South San Francisco",
        "https://services5.arcgis.com/inY93B27l4TSbT7h/arcgis/rest/services/districtlookup/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Gilroy",
        "https://services8.arcgis.com/n7NW5ijV4dJUmrID/arcgis/rest/services/City_Council_Districts_WFL1/FeatureServer/1",
        "DISTRICT",
        "DISTRICT <> ' '",
      ],
      [
        "San Jose",
        "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/120",
        "DISTRICT",
      ],
      [
        "Santa Clara",
        "https://map.santaclaraca.gov/maps/rest/services/PlanningDepartment/DistrictElectionZone/MapServer/0",
        "DISTRICTNO",
      ],
      [
        "Alhambra",
        "https://services6.arcgis.com/GZCJsJngT6kRZkzb/arcgis/rest/services/Alhambra_Base/FeatureServer/12",
        "Name",
      ],
      [
        "Arcadia",
        "https://services.arcgis.com/xsicuXZ553tglig9/arcgis/rest/services/Arcadia_Base_Map_WFL1/FeatureServer/15",
        "DISTRICT",
      ],
      [
        "Azusa",
        "https://services5.arcgis.com/LRbjc1oq5r1BMKyz/arcgis/rest/services/Voting_Districts_2024/FeatureServer/7",
        "DISTRICT",
      ],
      [
        "Carson",
        "https://services1.arcgis.com/D9ezssdp37tr9wbT/arcgis/rest/services/City_of_Carson_Council_Districts_2021_WFL1/FeatureServer/1",
        "DISTRICT",
      ],
      [
        "Diamond Bar",
        "https://services1.arcgis.com/yvWpR6DCcpIEETDL/arcgis/rest/services/Districts/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Glendora",
        "https://services2.arcgis.com/NQC8oBejgXkIxQpu/arcgis/rest/services/Glendora_Precincts/FeatureServer/0",
        "DIV_CITY",
      ],
      [
        "Inglewood",
        "https://services.arcgis.com/YkFgoL8JnWkLrVRi/arcgis/rest/services/COUNCILDISTRCITS_MARCH2026/FeatureServer/0",
        "CD",
      ],
      [
        "Los Angeles",
        "https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/13",
        "District",
      ],
      [
        "Montebello",
        "https://services8.arcgis.com/pm0XuijYmcairS9K/arcgis/rest/services/Montebello_District_Map___Shape_File_of_Approved_Map_3B/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Monterey Park",
        "https://services9.arcgis.com/ivAMP6vRMPA12GAA/arcgis/rest/services/Council_Districts/FeatureServer/0",
        "DISTRICT",
      ],
      [
        "Palmdale",
        "https://mapserver.cityofpalmdale.org/arcgis/rest/services/General_Reference/GeneralReference/FeatureServer/3",
        "DISTRICT",
      ],
      [
        "Pomona",
        "https://gismaps.ci.pomona.ca.us/arcgis/rest/services/CityCouncil/Council_Districts/FeatureServer/5",
        "DISTRICT",
      ],
      [
        // Checked against LA's sample ballot data (plans/council-maps-missing-cities.md).
        "Santa Clarita",
        "https://maps.santa-clarita.com/arcgis/rest/services/Boundary/MapServer/17",
        "District",
      ],
      [
        "West Covina",
        "https://services8.arcgis.com/WV8ogNubjFL2BKPt/arcgis/rest/services/Council_Districts_20220405_c/FeatureServer/6",
        "DISTRICT",
      ],
      // LA County Registrar-Recorder's layer (August 2023), only for cities
      // that haven't redrawn since and publish none of their own.
      [
        "Bellflower",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08BL%'",
      ],
      [
        "Claremont",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08CH%'",
      ],
      [
        "Compton",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08CO%'",
      ],
      [
        "Downey",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08DO%'",
      ],
      [
        "Duarte",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08DU%'",
      ],
      [
        "El Monte",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08EM%'",
      ],
      [
        "La Verne",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08LG%'",
      ],
      [
        "South Pasadena",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Incorporated_Cities1/FeatureServer/1",
        "DIV_CITY",
        "ABBR LIKE '08SW%'",
      ],
    ] as const
  ).map(([city, url, field, where]: readonly [string, string, string, string?]) => ({
    layer: "council" as const,
    url,
    ...(where ? { where } : {}),
    id: (a: Attributes) => `${city}|${a[field]}`,
  })),
  ...(
    [
      // Adopted maps published only in the city's consultant's (NDC's) web
      // map, beside the draft plans: the layer named as the adopted one.
      // Not Morgan Hill's: its pieces don't meet, leaving gaps throughout.
      // Huntington Park's is the web map behind the city's own district
      // locator (Ordinance 2026-04; districts new this November).
      ["Huntington Park", "64deba52c346416894c9a2997d56d10a", "Adopted (Magenta) Map"],
      ["Sunnyvale", "640698809096492c9202c2ef2a4ca631", "101 V2 C Adopted Map"],
      [
        "Pacifica",
        "265620ea3ea64333b71779843008fe35",
        "Pacifica 2022-2030 Council Election Districts",
      ],
      ["Woodside", "f83038fc64ec4f9e8542a171a32af0fc", "2022 Adopted Map"],
    ] as const
  ).map(([city, item, title]) => ({
    layer: "council" as const,
    url: `https://www.arcgis.com/sharing/rest/content/items/${item}/data`,
    webMapLayer: title,
    id: (a: Attributes) => `${city}|${a.DISTRICT ?? a.District}`,
  })),
  ...(
    [
      // The Santa Clara County Registrar of Voters' precincts, each wholly in
      // one council district, by the district its own lookup gave an address
      // inside each one (election 148, Nov 3, 2026; read 2026-10-27). For
      // cities whose maps don't serve: Campbell's and Morgan Hill's are the
      // consultant's census-block maps (Morgan Hill's with gaps throughout and
      // a wrong line on Dunne Avenue), Los Altos publishes only a parcel list.
      // Precincts with no addresses (Campbell 3866, Morgan Hill 4865, Los
      // Altos 2315, 2350) are left out.
      [
        "Campbell",
        {
          1: "3810 3818 3830 3840 3843 3845 3846 3847 3848 3849 3850 3869",
          2: "3801 3806 3807 3808 3813 3816 3825 3826 3844 3851 3852 3863 3867 3868",
          3: "3802 3804 3805 3809 3817 3821 3822 3829 3836 3853 3857 3858 3861 3862 3864 3865",
          4: "3811 3812 3819 3820 3823 3824 3838 3841 3842 3854 3856",
          5: "3814 3815 3827 3828 3831 3832 3833 3834 3835 3837 3839 3859 3860",
        },
      ],
      [
        "Los Altos",
        {
          1: "2329 2334 2337 2338 2351 2352 2353 2354 2355 2356 2357 2359",
          2: "2317 2332 2333 2336 2339 2343 2344 2345 2347 2358",
          3: "2313 2314 2316 2319 2325 2326 2328 2330 2331 2342 2348 2362",
          4: "2306 2307 2309 2310 2312 2318 2321 2322 2323 2324 2341 2346 2349 2361",
          5: "2301 2302 2303 2304 2305 2308 2311 2320 2327 2335 2340 2360",
        },
      ],
      [
        "Morgan Hill",
        {
          A: "4801 4802 4803 4804 4805 4806 4807 4808 4809 4810 4811 4812 4813 4814 4815 4816 4817",
          B: "4825 4826 4827 4828 4829 4830 4831 4832 4833 4834 4835 4836 4841 4843 4876 4877 4878 4887 4888",
          C: "4851 4852 4853 4854 4855 4856 4857 4858 4859 4860 4861 4862 4863 4866 4893",
          D: "4837 4838 4839 4840 4842 4879 4880 4881 4882 4883 4884 4885 4886 4889 4890 4891 4892",
        },
      ],
    ] as const
  ).map(([city, byDistrict]) => {
    const districtOf = new Map(
      Object.entries(byDistrict).flatMap(([district, precincts]) =>
        precincts.split(" ").map((precinct) => [precinct, district] as const),
      ),
    );
    return {
      layer: "council" as const,
      url: "https://services2.arcgis.com/nJEmhZphYC5TKA7K/arcgis/rest/services/Precinct_Boundaries_/FeatureServer/0",
      where: `Precinct IN (${[...districtOf.keys()].map((p) => `'${p}'`).join(",")})`,
      id: (a: Attributes) => `${city}|${districtOf.get(String(a.Precinct))}`,
    };
  }),
];
type OtherLayer = (typeof CA_OTHER_SOURCES)[number]["layer"];
type LayerName = keyof typeof LAYERS | OtherLayer;

/**
 * Visvalingam weight (planar triangle area, degrees²) below which a point is
 * dropped. Measured with --check (2026-10-20): 1e-7 ships 1.76 MB (594 KB
 * gzipped) and puts about 1 in 4,000 random city points in a different
 * district than full resolution; 1e-6 halves the size but triples the
 * misses. The lookup warns near a district line either way.
 */
const MIN_WEIGHT = Number(process.env.GEO_MIN_WEIGHT ?? 1e-7);
/**
 * The same for borders only lookup layers use (school, BOE, community college
 * and supervisorial districts): never drawn, and a point near one of their
 * lines is left unknown (NEAR_LINE_METERS in src/lib/geo.ts), so they can be
 * coarser. Measured with --check (2026-10-25), of 20,000 random city points per
 * layer: 1e-6 ships 3.48 MB (888 KB brotli) and sets 1 supervisorial district
 * wrong; 3e-7 ships 3.74 MB (954 KB) and 1e-7 4.05 MB (1,024 KB), with none
 * wrong. Unknown (near a line) is 0.2–5% per layer at each.
 */
const LOOKUP_MIN_WEIGHT = Number(process.env.GEO_LOOKUP_MIN_WEIGHT ?? 3e-7);
/** Layers the map draws; every other layer is only looked up. */
const DRAWN = ["cd", "sd", "ad", "county", "place"];

/** Arc indexes a geometry collection uses, at any depth. */
function arcsOf(object: GeometryCollection): Set<number> {
  const out = new Set<number>();
  const walk = (arcs: unknown): void => {
    if (typeof arcs === "number") out.add(arcs < 0 ? ~arcs : arcs);
    else if (Array.isArray(arcs)) for (const a of arcs) walk(a);
  };
  for (const geometry of object.geometries) walk((geometry as { arcs?: unknown }).arcs);
  return out;
}
/** Grid size per axis; across California's ~10° that is about 5 m. */
const QUANTIZATION = 2e5;
/**
 * The same for the states' outlines (`us.topo.json`): only to tell which
 * state's file to load, so about a kilometre is plenty.
 */
const OUTLINE_MIN_WEIGHT = 1e-4;
const OUTLINE_QUANTIZATION = 1e4;

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(tmpdir(), "openslate-geo-cache");
const args = new Set(process.argv.slice(2));
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
const outDir = option("--out") ?? join(here, "..", "public", "geo");

/** Boundaries Census doesn't publish, by region: only California has any. */
function otherSources(region: RegionProfile): typeof CA_OTHER_SOURCES {
  return region.path === "us/ca" ? CA_OTHER_SOURCES : [];
}

/**
 * Query an ArcGIS layer as GeoJSON, cached as `<cacheName>.geojson`. The default
 * offset, ~1 m, is near full resolution but drops TIGER's collinear vertices.
 */
async function fetchGeoJSON(
  layerUrl: string,
  where: string,
  outFields: string,
  cacheName: string,
  maxAllowableOffset = "0.00001",
  allowEmpty = false,
): Promise<FeatureCollection> {
  const cached = join(cacheDir, `${cacheName}.geojson`);
  if (!args.has("--refresh") && existsSync(cached)) {
    return JSON.parse(readFileSync(cached, "utf8")) as FeatureCollection;
  }
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    maxAllowableOffset,
    geometryPrecision: "6",
    f: "geojson",
  });
  console.log(`fetching ${cacheName} (${layerUrl})…`);
  const collection: FeatureCollection = { type: "FeatureCollection", features: [] };
  // A big layer (Texas's cities) comes a page at a time.
  for (let page = 0; ; page++) {
    if (page > 0) {
      params.set("resultOffset", String(collection.features.length));
      params.set("orderByFields", "OBJECTID");
    }
    // Some servers answer a heavy query with an occasional 500, or drop the
    // connection: try again.
    let part:
      | (FeatureCollection & { exceededTransferLimit?: boolean; error?: unknown })
      | undefined;
    for (let attempt = 0; attempt < 5 && !part; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      try {
        const response = await fetch(`${layerUrl}/query?${params}`);
        if (response.status >= 500) continue;
        if (!response.ok) throw new Error(`${cacheName}: HTTP ${response.status}`);
        const body = (await response.json()) as NonNullable<typeof part>;
        // ArcGIS reports some failures as a 200 with an error inside.
        if (!body.error) part = body;
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
    if (!part) throw new Error(`${cacheName}: no answer after 5 tries`);
    collection.features.push(...(part.features ?? []));
    const more =
      part.exceededTransferLimit ??
      (part as { properties?: { exceededTransferLimit?: boolean } }).properties
        ?.exceededTransferLimit;
    if (!more) break;
    if (!part.features?.length) throw new Error(`${cacheName}: result truncated`);
  }
  if (!collection.features.length && !allowEmpty) throw new Error(`${cacheName}: no features`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify(collection));
  return collection;
}

function fetchLayer(region: RegionProfile, name: keyof typeof LAYERS): Promise<FeatureCollection> {
  const { id, key, name: nameKey, where, fields = [] } = LAYERS[name] ?? { id: 0, key: "" };
  const outFields = [...new Set([key, "GEOID", ...(nameKey ? [nameKey] : []), ...fields])].join(
    ",",
  );
  return fetchGeoJSON(
    `${SERVICE}/${id}`,
    `STATE='${region.fips}'${where ? ` AND ${where}` : ""}`,
    outFields,
    `${region.code.toLowerCase()}-${name}`,
    undefined,
    // A state needn't have every layer: no lower chamber, no unified districts.
    true,
  );
}

/** Web Mercator (EPSG:3857) to longitude, latitude. */
function fromWebMercator([x = 0, y = 0]: Position): Position {
  const r = 6378137;
  const lon = (x / r) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / r)) - Math.PI / 2) * (180 / Math.PI);
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

/**
 * The features of a web map's layer titled `title` (a feature collection
 * stored in the map itself), as GeoJSON, cached like `fetchGeoJSON`. Esri
 * says rings run clockwise round an outside and anticlockwise round a hole,
 * but consultants' maps don't all keep to it, so a ring is a hole when an
 * odd number of the feature's other rings contain it.
 */
async function fetchWebMapLayer(
  url: string,
  title: string,
  cacheName: string,
): Promise<FeatureCollection> {
  const cached = join(cacheDir, `${cacheName}.geojson`);
  if (!args.has("--refresh") && existsSync(cached)) {
    return JSON.parse(readFileSync(cached, "utf8")) as FeatureCollection;
  }
  console.log(`fetching ${cacheName} (${url}, "${title}")…`);
  const response = await fetch(`${url}?f=json`);
  if (!response.ok) throw new Error(`${cacheName}: HTTP ${response.status}`);
  type EsriFeature = { attributes: Attributes; geometry?: { rings?: Position[][] } };
  const map = (await response.json()) as {
    operationalLayers?: {
      title?: string;
      featureCollection?: {
        layers?: {
          layerDefinition?: { spatialReference?: { wkid?: number } };
          featureSet?: { features?: EsriFeature[]; spatialReference?: { wkid?: number } };
        }[];
      };
    }[];
  };
  const matches = (map.operationalLayers ?? []).filter((l) => l.title === title);
  const layers = matches[0]?.featureCollection?.layers ?? [];
  if (matches.length !== 1 || layers.length !== 1) {
    throw new Error(`${cacheName}: no single layer "${title}"`);
  }
  const layer = layers[0];
  const wkid =
    layer?.featureSet?.spatialReference?.wkid ?? layer?.layerDefinition?.spatialReference?.wkid;
  if (wkid !== 102100 && wkid !== 3857) throw new Error(`${cacheName}: spatial reference ${wkid}`);
  const features = (layer?.featureSet?.features ?? []).map((f): Feature => {
    const rings = (f.geometry?.rings ?? []).map((r) => r.map(fromWebMercator));
    const around = (ring: Position[]) =>
      rings.filter((other) => {
        const [x = 0, y = 0] = ring[0] ?? [];
        return other !== ring && ringContains(other, x, y);
      });
    const outsides = rings.filter((r) => around(r).length % 2 === 0);
    const polygons: Position[][][] = outsides.map((r) => [r]);
    for (const hole of rings.filter((r) => around(r).length % 2 === 1)) {
      // The hole of the innermost outside around it.
      const owners = around(hole).filter((r) => outsides.includes(r));
      const owner = owners.find((o) =>
        owners.every((p) => p === o || !ringContains(o, ...(p[0] as [number, number]))),
      );
      polygons[outsides.indexOf(owner ?? [])]?.push(hole);
    }
    return {
      type: "Feature",
      properties: f.attributes,
      geometry: { type: "MultiPolygon", coordinates: polygons },
    };
  });
  if (features.length === 0) throw new Error(`${cacheName}: no features`);
  const collection: FeatureCollection = { type: "FeatureCollection", features };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify(collection));
  return collection;
}

/**
 * One `OTHER_SOURCES` layer from all its sources, slimmed to id (and name),
 * with a district a source splits into several features joined into one.
 * `places`: every city's TIGER name, for council ids.
 */
async function fetchOther(
  sources: typeof CA_OTHER_SOURCES,
  layer: OtherLayer,
  places: readonly string[],
): Promise<FeatureCollection> {
  const placeByName = new Map(places.map((p) => [p.toLowerCase(), p]));
  const byId = new Map<string, { name?: string; polygons: Position[][][] }>();
  for (const src of sources) {
    if (src.layer !== layer) continue;
    // Cached by what is fetched, so adding or removing a source can't mix them up.
    const key = createHash("sha256")
      .update(JSON.stringify([src.url, src.where, src.webMapLayer]))
      .digest("hex")
      .slice(0, 12);
    const collection = src.webMapLayer
      ? await fetchWebMapLayer(src.url, src.webMapLayer, `${layer}-${key}`)
      : await fetchGeoJSON(src.url, src.where ?? "1=1", "*", `${layer}-${key}`);
    for (const f of collection.features) {
      const attributes = (f.properties ?? {}) as Attributes;
      let id = src.id(attributes);
      if (!id || /undefined|null/.test(id)) throw new Error(`${layer}: feature without an id`);
      if (layer === "council") {
        // `<City>|<district>`: the city as TIGER names it, the district as the
        // last word of whatever the source says ("District 3", 3).
        const [city = "", district = ""] = id.split("|");
        const place = placeByName.get(city.trim().toLowerCase());
        const n = /(\w+)\s*$/.exec(district)?.[1];
        if (!place) throw new Error(`council: no city named ${city}`);
        if (!n) throw new Error(`council: ${city} district "${district}"`);
        id = `${place}|${/^\d+$/.test(n) ? String(Number(n)) : n.toUpperCase()}`;
      }
      const entry = byId.get(id) ?? { polygons: [] };
      const name = src.name?.(attributes);
      if (name) entry.name = name;
      if (f.geometry?.type === "Polygon") entry.polygons.push(f.geometry.coordinates);
      else if (f.geometry?.type === "MultiPolygon") entry.polygons.push(...f.geometry.coordinates);
      byId.set(id, entry);
    }
  }
  return {
    type: "FeatureCollection",
    features: [...byId].map(
      ([id, { name, polygons }]): Feature => ({
        type: "Feature",
        id,
        properties: name ? { name } : {},
        geometry: { type: "MultiPolygon", coordinates: dissolve(polygons) },
      }),
    ),
  };
}

/**
 * Polygons that share borders joined into one (a district a source splits
 * into several features), so no line runs through a district to be near.
 * Pieces whose borders almost meet (precincts a server generalized one at a
 * time) leave hairline rings along the seams: dropped, or the lookup would
 * call every point within NEAR_LINE_METERS of one "near a line".
 */
function dissolve(polygons: Position[][][]): Position[][][] {
  if (polygons.length < 2) return polygons;
  return mergePieces(polygons)
    .filter(([outer = []]) => !isSeam(outer))
    .map(([outer = [], ...holes]) => [outer, ...holes.filter((hole) => !isSeam(hole))]);
}

/**
 * A ring whose mean width (twice its area over its perimeter) is under 2 m.
 * Measured 2026-10-27 over every dissolved council district: the seams are
 * all under 0.4 m wide; the narrowest real hole (a county pocket) is 11 m.
 */
function isSeam(ring: Position[]): boolean {
  let twiceArea = 0;
  let perimeter = 0;
  const kx = 111_320 * Math.cos(((ring[0]?.[1] ?? 0) * Math.PI) / 180);
  const ky = 110_574;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    twiceArea += (xj - xi) * kx * (yj + yi) * ky;
    perimeter += Math.hypot((xj - xi) * kx, (yj - yi) * ky);
  }
  return Math.abs(twiceArea) / perimeter < 2;
}

function mergePieces(polygons: Position[][][]): Position[][][] {
  const pieces = topology({
    pieces: {
      type: "FeatureCollection",
      features: polygons.map(
        (coordinates): Feature => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates },
        }),
      ),
    },
  });
  const object = pieces.objects.pieces as GeometryCollection;
  return merge(pieces, object.geometries as Parameters<typeof merge>[1]).coordinates;
}

/** The legislative layers, whose ids are districts' (`districtId`). */
const DISTRICT_LAYER_NAMES = ["cd", "sd", "ad"];

/** Land and water in no district: "Congressional Districts not defined", GEOID `33ZZ`. */
function isUndefinedArea(properties: Feature["properties"]): boolean {
  return (
    /not defined/i.test(String(properties?.BASENAME ?? properties?.NAME ?? "")) ||
    /ZZ$/.test(String(properties?.GEOID ?? ""))
  );
}

/**
 * Move a geometry's points east of the 180th meridian to west of -180 (Alaska's
 * far Aleutians), so a state that crosses it is one piece.
 */
function wrapWest(geometry: Geometry | null): Geometry | null {
  const shift = (ring: Position[]): Position[] =>
    ring.map(([x = 0, y = 0]) => [x > 0 ? x - 360 : x, y]);
  if (geometry?.type === "Polygon")
    return { ...geometry, coordinates: geometry.coordinates.map(shift) };
  if (geometry?.type === "MultiPolygon")
    return { ...geometry, coordinates: geometry.coordinates.map((p) => p.map(shift)) };
  return geometry;
}

/**
 * Keep only the id (and a name where the id doesn't say it): every byte here
 * ships to every visitor who opens the map.
 * - A school district's GEOID loses its state prefix, leaving the 5-digit LEA
 *   code that `district` paths use (`us/ca/elsd-18030`).
 * - A legislative district's id is its Census name as paths spell it
 *   (`districtId`), with the name kept when that isn't a plain number
 *   ("Third Middlesex"). A state's one at-large House district is `1`.
 * - A county keeps its full name when it isn't "<Name> County" (a parish, a
 *   borough, a census area, a municipio).
 */
function slim(
  collection: FeatureCollection,
  layer: keyof typeof LAYERS,
  region: RegionProfile,
  wrap: boolean,
  context: {
    /** Counties' names by their FIPS code within the state. */
    countyByFips: ReadonlyMap<string, string>;
    /** The names towns of the state go by bare, as path segments. */
    bareTowns: ReadonlySet<string>;
  },
): FeatureCollection {
  const { key, name: nameKey } = LAYERS[layer] ?? { key: "" };
  const fips = region.fips ?? "";
  return {
    type: "FeatureCollection",
    features: collection.features
      .filter((f) => !isUndefinedArea(f.properties))
      .map((f): Feature => {
        const value = f.properties?.[key];
        if (typeof value !== "string" || !value) throw new Error(`feature without ${key}`);
        const geometry = wrap ? wrapWest(f.geometry) : f.geometry;
        if (DISTRICT_LAYER_NAMES.includes(layer)) {
          const id = censusDistrictId(value);
          if (!id) throw new Error(`${layer}: no id for "${value}"`);
          const named = !/^\d+$/.test(id);
          return { type: "Feature", id, properties: named ? { name: value } : {}, geometry };
        }
        if (layer === "town") {
          const county = context.countyByFips.get(String(f.properties?.COUNTY));
          const basename = f.properties?.BASENAME;
          if (!county || typeof basename !== "string" || !basename)
            throw new Error(`town "${value}": no county or name`);
          return {
            type: "Feature",
            id: `${county}|${value}`,
            properties: { name: basename },
            geometry,
          };
        }
        if (layer === "place") {
          // A village, borough or city whose name a town goes by: its whole name too.
          const whole = f.properties?.NAME;
          const namesake = context.bareTowns.has(slugOf(value));
          if (namesake && (typeof whole !== "string" || !whole))
            throw new Error(`place "${value}" needs its NAME: refetch with --refresh`);
          return {
            type: "Feature",
            id: value,
            properties: namesake ? { name: whole } : {},
            geometry,
          };
        }
        const id = key === "GEOID" ? value.slice(fips.length) : value;
        const name = nameKey ? f.properties?.[nameKey] : undefined;
        if (nameKey && (typeof name !== "string" || !name))
          throw new Error(`${id} without ${nameKey}`);
        // A county's name only where it isn't the usual "<Name> County".
        const keep = layer === "county" ? name !== `${id} County` : Boolean(name);
        return { type: "Feature", id, properties: keep ? { name } : {}, geometry };
      }),
  };
}

function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry: Geometry | null, x: number, y: number): boolean {
  if (!geometry) return false;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some(
    (rings) =>
      ringContains(rings[0] ?? [], x, y) && !rings.slice(1).some((h) => ringContains(h, x, y)),
  );
}

function whichFeature(collection: FeatureCollection, x: number, y: number): string | undefined {
  return collection.features.find((f) => geometryContains(f.geometry, x, y))?.id as
    | string
    | undefined;
}

/** [minX, maxX] of a geometry's points, for telling which side of the map it's on. */
function bboxOf(geometry: Geometry | null): number[] {
  const rings: Position[][] =
    geometry?.type === "Polygon"
      ? geometry.coordinates
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates.flat()
        : [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [x = 0] of ring) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  return Number.isFinite(min) ? [min, max] : [];
}

/** A state's outline: its counties as one shape, for the file that finds a point's state. */
function stateOutline(counties: FeatureCollection): Feature {
  const polygons = counties.features.flatMap((f) =>
    f.geometry?.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry?.type === "MultiPolygon"
        ? f.geometry.coordinates
        : [],
  );
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: mergePieces(polygons) },
  };
}

/** What one state's build reports, for `index.json` and the outlines. */
interface Built {
  region: string;
  file: string;
  bytes: number;
  counts: Record<string, number>;
  wrap?: true;
  /** Each legislative layer's districts: an id, or `[id, name]` where the id isn't a number. */
  districts: Record<"cd" | "sd" | "ad", Array<string | [string, string]>>;
  outline: Feature;
}

let vintage = "unknown";

/** Fetch and build one state's file. Undefined when Census maps nothing to build it from. */
async function build(region: RegionProfile): Promise<Built | undefined> {
  const source: Record<LayerName, FeatureCollection> = {} as Record<LayerName, FeatureCollection>;
  const raw: Record<string, FeatureCollection> = {};
  for (const name of Object.keys(LAYERS)) raw[name] = await fetchLayer(region, name);
  if (!raw.county?.features.length) {
    console.log(`${region.name}: Census maps no counties for it; skipped`);
    return undefined;
  }
  // A state that reaches across the 180th meridian (Alaska): one piece, west of -180.
  const lons = (raw.county?.features ?? []).flatMap((f) => bboxOf(f.geometry));
  const wrap = lons.some((x) => x > 170) && lons.some((x) => x < -170);
  const fips = region.fips ?? "";
  const context = {
    countyByFips: new Map(
      (raw.county?.features ?? []).map((f) => [
        String(f.properties?.GEOID).slice(fips.length),
        String(f.properties?.BASENAME),
      ]),
    ),
    bareTowns: new Set(
      townsAreBare(region.path)
        ? (raw.town?.features ?? []).map((f) => slugOf(String(f.properties?.BASENAME)))
        : [],
    ),
  };
  for (const name of Object.keys(LAYERS)) {
    source[name] = slim(raw[name] as FeatureCollection, name, region, wrap, context);
  }
  // Most states have no towns: their files have no town layer at all.
  if (source.town.features.length === 0) delete (source as Partial<typeof source>).town;
  else {
    const ids = source.town.features.map((f) => String(f.id));
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (twice.length > 0) throw new Error(`towns named twice in one county: ${twice.join(", ")}`);
  }
  const placeNames = source.place.features.map((f) => String(f.id));
  const others = otherSources(region);
  for (const layer of new Set(others.map((s) => s.layer))) {
    source[layer] = await fetchOther(others, layer, placeNames);
  }

  const full = topology(source);
  const weighted = presimplify(full);
  // Points on borders no drawn layer uses are dropped below LOOKUP_MIN_WEIGHT:
  // zero their weight there, and `simplify` drops them with the rest.
  const drawn = new Set<number>();
  for (const name of DRAWN)
    for (const arc of arcsOf(weighted.objects[name] as GeometryCollection)) drawn.add(arc);
  for (const [i, arc] of weighted.arcs.entries()) {
    if (drawn.has(i)) continue;
    for (const point of arc) if ((point[2] ?? 0) < LOOKUP_MIN_WEIGHT) point[2] = 0;
  }
  const simplified = quantize(simplify(weighted, MIN_WEIGHT), QUANTIZATION) as Topology & {
    metadata?: unknown;
  };
  simplified.metadata = {
    source: [
      `${SERVICE} (layers ${Object.entries(LAYERS)
        .map(([name, { id }]) => `${name}=${id}`)
        .join(", ")})`,
      ...others.map((s) => `${s.layer}: ${s.url}`),
    ].join("; "),
    vintage,
    builtAt: new Date().toISOString().slice(0, 10),
    minWeight: MIN_WEIGHT,
    lookupMinWeight: LOOKUP_MIN_WEIGHT,
    quantization: QUANTIZATION,
    ...(wrap ? { wrap: true } : {}),
  };

  const outFile = join(outDir, `us-${region.code.toLowerCase()}.topo.json`);
  mkdirSync(dirname(outFile), { recursive: true });
  const json = JSON.stringify(simplified);
  writeFileSync(outFile, json);
  console.log(
    `wrote ${outFile}: ${(json.length / 1024).toFixed(0)} KB, ${simplified.arcs.length} arcs`,
  );
  const counts: Record<string, number> = {};
  for (const name of Object.keys(source)) {
    const object = simplified.objects[name] as GeometryCollection;
    counts[name] = object.geometries.length;
  }
  console.log(
    `  ${Object.entries(counts)
      .map(([name, n]) => `${name} ${n}`)
      .join(", ")}`,
  );

  if (args.has("--check")) {
    // Random points inside cities (where people live and districts follow
    // streets): how often does the shipped file put one in a different district
    // than full resolution does?
    const places = source.place.features;
    const randomCityPoint = (): [number, number] => {
      for (;;) {
        const place = places[Math.floor(Math.random() * places.length)] as Feature;
        const ring = (
          place.geometry?.type === "Polygon"
            ? place.geometry.coordinates[0]
            : place.geometry?.type === "MultiPolygon"
              ? place.geometry.coordinates[0]?.[0]
              : undefined
        ) as Position[] | undefined;
        if (!ring) continue;
        const xs = ring.map((p) => p[0] as number);
        const ys = ring.map((p) => p[1] as number);
        const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
        const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
        if (geometryContains(place.geometry, x, y)) return [x, y];
      }
    };
    for (const name of ["cd", "sd", "ad"] as const) {
      const shipped = feature(simplified, simplified.objects[name] as GeometryCollection);
      let compared = 0;
      let differ = 0;
      while (compared < 20000) {
        const [x, y] = randomCityPoint();
        const truth = whichFeature(source[name], x, y);
        if (truth === undefined) continue;
        compared++;
        if (whichFeature(shipped, x, y) !== truth) differ++;
      }
      console.log(`  check ${name}: ${differ} of ${compared} random city points differ`);
    }
    // Lookup layers, as the app reads them (src/lib/geo.ts): a point near a line
    // is left unknown, so what matters is how often a district it does set is
    // wrong (a race hidden that's on the ballot), and how often it's unknown.
    const geo = decodeStateGeo(region.path, simplified);
    const counts = Object.fromEntries(
      LOOKUP_LAYERS.map((l) => [l, { compared: 0, wrong: 0, unknown: 0 }]),
    );
    for (let i = 0; i < 20000; i++) {
      const [x, y] = randomCityPoint();
      const within = {
        county: whichFeature(source.county, x, y),
        place: whichFeature(source.place, x, y),
      };
      const found = lookupsAt(geo, x, y, within)?.lookups ?? {};
      for (const layer of LOOKUP_LAYERS) {
        const truth = whichFeature(source[layer], x, y);
        const count = counts[layer];
        if (truth === undefined || !count) continue;
        count.compared++;
        const id = found[layer]?.id;
        if (id === undefined) count.unknown++;
        else if (id !== truth) count.wrong++;
      }
    }
    for (const [layer, { compared, wrong, unknown }] of Object.entries(counts)) {
      console.log(
        `  check ${layer}: of ${compared} random city points, ${wrong} wrong, ${unknown} unknown`,
      );
    }
  }

  const districts = (name: "cd" | "sd" | "ad") =>
    source[name].features.map((f): [string, string] | string => {
      const called = (f.properties as { name?: string } | null)?.name;
      return called ? [String(f.id), called] : String(f.id);
    });
  return {
    region: region.path,
    file: `us-${region.code.toLowerCase()}.topo.json`,
    bytes: json.length,
    counts,
    ...(wrap ? { wrap: true } : {}),
    districts: { cd: districts("cd"), sd: districts("sd"), ad: districts("ad") },
    outline: stateOutline(source.county),
  };
}

const which = (option("--state") ?? "ca").toLowerCase();
const regions =
  which === "all"
    ? allRegions().filter((region) => region.path.startsWith("us/"))
    : which
        .split(",")
        .map((code) => regionByCode("us", code))
        .filter((r): r is RegionProfile => r !== undefined);
if (regions.length === 0 || (which !== "all" && regions.length !== which.split(",").length))
  throw new Error(`no state "${which}"`);

const meta = (await (await fetch(`${SERVICE}?f=json`)).json()) as {
  documentInfo?: { Comments?: string };
};
vintage = meta.documentInfo?.Comments ?? "unknown";

const built: Built[] = [];
const failed: string[] = [];
for (const region of regions) {
  try {
    const result = await build(region);
    if (result) built.push(result);
  } catch (err) {
    // One state's bad day at the Census shouldn't stop the other fifty.
    if (regions.length === 1) throw err;
    failed.push(region.code);
    console.error(`${region.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (which === "all") {
  // Which files there are, and what each state's districts are called.
  const index = {
    vintage,
    builtAt: new Date().toISOString().slice(0, 10),
    states: built.map(({ outline: _, ...state }) => state),
  };
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index)}\n`);

  // Every state's outline in one small file: which state a point is in, before
  // any state's own file is loaded. Coarse on purpose; a point near a border
  // is settled by the states' files themselves.
  const outlines: FeatureCollection = {
    type: "FeatureCollection",
    features: built.map(({ region, outline }) => ({ ...outline, id: region })),
  };
  const national = quantize(
    simplify(presimplify(topology({ state: outlines })), OUTLINE_MIN_WEIGHT),
    OUTLINE_QUANTIZATION,
  ) as Topology & { metadata?: unknown };
  national.metadata = { vintage, builtAt: index.builtAt };
  const text = JSON.stringify(national);
  writeFileSync(join(outDir, "us.topo.json"), text);
  const total = built.reduce((sum, state) => sum + state.bytes, 0);
  console.log(
    `\n${built.length} states, ${(total / 1024 / 1024).toFixed(1)} MB in all; us.topo.json ${(text.length / 1024).toFixed(0)} KB`,
  );
  if (failed.length) {
    console.error(`FAILED: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}
