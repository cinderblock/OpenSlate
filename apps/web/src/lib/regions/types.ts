/**
 * What the app knows about one region: a US state today, any country's
 * first-level division tomorrow. A region is the first two segments of a
 * jurisdiction path (`us/ca`); everything under it (`us/ca/sf`,
 * `us/ca/cd-11`) is read with its region's profile.
 *
 * Data only, so anything may import it (jurisdictions.ts does). Behaviour that
 * differs by region (the order a ballot prints names in, who counts the
 * votes, where to read up on a race) is registered beside the code that asks
 * for it: see `regions/ballotOrders.ts`, `regions/liveSources.ts`,
 * `regions/links.ts`.
 */

/** One family of districts: `cd` in `us/ca/cd-11`. */
export interface DistrictFamily {
  /** The key in a jurisdiction path. */
  key: string;
  /** What one is called: "Congressional district". */
  label: string;
  /** The office its races fill, for "No Congressional race in district 9": "Congressional". */
  office?: string;
  /** How many there are, when they're numbered 1 to `count`. */
  count?: number;
  /**
   * Every one of them, where they aren't numbered 1 to n: lettered
   * (Minnesota's House, `35a` "35A"), named (Massachusetts' Senate,
   * `third-middlesex` "Third Middlesex"), or numbered with gaps. Each an id
   * and what it's called.
   */
  ids?: ReadonlyArray<readonly [id: string, name: string]>;
  /**
   * Staggered terms: which half of the seats a regular election in a given
   * year fills, when the region's law says. Undefined in a year it doesn't.
   */
  seatsUp?: (year: number) => "even" | "odd" | undefined;
  /**
   * Its districts only narrow races filed somewhere else (a subject's
   * `district`): no race has one as its jurisdiction, so a district of it
   * with nothing on the ballot is nothing to remark on.
   */
  narrows?: true;
}

/**
 * The three district layers the boundary data draws, and the family each is
 * in this region: Congress, the legislature's upper chamber, its lower one.
 * A region with one chamber has no `lower`; one with none (the District of
 * Columbia) has neither.
 */
export interface LegislativeLayers {
  congress: string;
  upper?: string;
  lower?: string;
}

export interface RegionProfile {
  /** The region's path: `us/ca`. */
  path: string;
  /** "California". */
  name: string;
  /** The postal abbreviation, upper case: "CA". */
  code: string;
  /** The Census Bureau's FIPS code, for boundary and geocoder data: "06". */
  fips?: string;
  /** Districts drawn across the whole region, in the order a ballot lists them. */
  families: DistrictFamily[];
  /** Which family each drawn boundary layer is. */
  layers: LegislativeLayers;
  /** What a county is called here: "County", "Parish", "Borough". */
  countyWord: string;
  /** Its counties, by the name the Census uses ("Santa Clara"), where the app lists them. */
  counties?: readonly string[];
  /**
   * Counties a city shares its name with: the bare path (`us/ca/fresno`) is
   * the city's, so only `<name>-county` is the county.
   */
  namesakeCities?: readonly string[];
  /** Counties that are one city and county: their name stands alone ("San Francisco"). */
  consolidated?: readonly string[];
  /** Locality slugs that aren't just the name in lower case: `sf` → "San Francisco". */
  localityNames?: Readonly<Record<string, string>>;
  /**
   * Districts a county implies: `{ coa: { Alameda: "1" } }` puts everyone in
   * Alameda County in Court of Appeal district 1.
   */
  byCounty?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Its boundary file's name, where the app has one (`geoUrl` in geo.ts says where they are). */
  geoFile?: string;
  /**
   * Paths the catalog once filed differently, for areas saved before
   * (`upgradeArea`): counties that sat under their city's path, and cities
   * filed as `city-of-<name>` while the bare name was the county's.
   */
  refiled?: {
    counties?: Readonly<Record<string, string>>;
    cities?: Readonly<Record<string, string>>;
  };
}
