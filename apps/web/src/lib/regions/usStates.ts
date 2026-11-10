import type { DistrictFamily, RegionProfile } from "./types";
import { type ListedChamber, US_DISTRICTS } from "./usDistricts.gen";

/**
 * Every US state, the District of Columbia and the territories, as plain
 * facts: name, postal code, Census FIPS code, how many seats in the House, and
 * what the legislature's chambers are called. A state with code of its own
 * (California's ballot order, its Secretary of State's count) overrides this
 * in its own directory (`regions/us-ca/`).
 *
 * District keys are the same everywhere so a slate's author never has to look
 * one up: `cd` for Congress, `sd` for the upper chamber, and for the lower one
 * `ad` where it's called an Assembly, `hd` anywhere else. Nebraska's single
 * chamber is `ld`. A state whose two chambers share one set of "legislative
 * districts" (Washington, Arizona, Idaho, New Jersey) still has `sd` and `hd`
 * (or `ad`): the key says which chamber's race it is. How many districts a
 * chamber has, and what they're called where they aren't numbered (Minnesota's
 * 12A, Massachusetts' First Middlesex), comes from the boundary data, through
 * the table scripts/geo-regions.ts writes (`usDistricts.gen.ts`).
 */

type Lower = "house" | "delegates" | "assembly" | "general-assembly";

interface StateRow {
  code: string;
  fips: string;
  name: string;
  /** Seats in the US House (2022 apportionment); 0 for a non-voting delegate. */
  house: number;
  /** The lower chamber; undefined when there's no second chamber. */
  lower?: Lower;
  /** No legislature of two chambers or one: the District of Columbia. */
  none?: true;
  /** What a county is called, when not "County". */
  countyWord?: string;
}

const row = (
  code: string,
  fips: string,
  name: string,
  house: number,
  lower?: Lower,
  extra: Partial<StateRow> = {},
): StateRow => ({ code, fips, name, house, ...(lower ? { lower } : {}), ...extra });

const ROWS: StateRow[] = [
  row("AL", "01", "Alabama", 7, "house"),
  row("AK", "02", "Alaska", 1, "house", { countyWord: "Borough" }),
  row("AZ", "04", "Arizona", 9, "house"),
  row("AR", "05", "Arkansas", 4, "house"),
  row("CA", "06", "California", 52, "assembly"),
  row("CO", "08", "Colorado", 8, "house"),
  row("CT", "09", "Connecticut", 5, "house"),
  row("DE", "10", "Delaware", 1, "house"),
  row("DC", "11", "District of Columbia", 0, undefined, { none: true, countyWord: "" }),
  row("FL", "12", "Florida", 28, "house"),
  row("GA", "13", "Georgia", 14, "house"),
  row("HI", "15", "Hawaii", 2, "house"),
  row("ID", "16", "Idaho", 2, "house"),
  row("IL", "17", "Illinois", 17, "house"),
  row("IN", "18", "Indiana", 9, "house"),
  row("IA", "19", "Iowa", 4, "house"),
  row("KS", "20", "Kansas", 4, "house"),
  row("KY", "21", "Kentucky", 6, "house"),
  row("LA", "22", "Louisiana", 6, "house", { countyWord: "Parish" }),
  row("ME", "23", "Maine", 2, "house"),
  row("MD", "24", "Maryland", 8, "delegates"),
  row("MA", "25", "Massachusetts", 9, "house"),
  row("MI", "26", "Michigan", 13, "house"),
  row("MN", "27", "Minnesota", 8, "house"),
  row("MS", "28", "Mississippi", 4, "house"),
  row("MO", "29", "Missouri", 8, "house"),
  row("MT", "30", "Montana", 2, "house"),
  row("NE", "31", "Nebraska", 3),
  row("NV", "32", "Nevada", 4, "assembly"),
  row("NH", "33", "New Hampshire", 2, "house"),
  row("NJ", "34", "New Jersey", 12, "general-assembly"),
  row("NM", "35", "New Mexico", 3, "house"),
  row("NY", "36", "New York", 26, "assembly"),
  row("NC", "37", "North Carolina", 14, "house"),
  row("ND", "38", "North Dakota", 1, "house"),
  row("OH", "39", "Ohio", 15, "house"),
  row("OK", "40", "Oklahoma", 5, "house"),
  row("OR", "41", "Oregon", 6, "house"),
  row("PA", "42", "Pennsylvania", 17, "house"),
  row("RI", "44", "Rhode Island", 2, "house"),
  row("SC", "45", "South Carolina", 7, "house"),
  row("SD", "46", "South Dakota", 1, "house"),
  row("TN", "47", "Tennessee", 9, "house"),
  row("TX", "48", "Texas", 38, "house"),
  row("UT", "49", "Utah", 4, "house"),
  row("VT", "50", "Vermont", 1, "house"),
  row("VA", "51", "Virginia", 11, "delegates"),
  row("WA", "53", "Washington", 10, "house"),
  row("WV", "54", "West Virginia", 2, "delegates"),
  row("WI", "55", "Wisconsin", 8, "assembly"),
  row("WY", "56", "Wyoming", 1, "house"),
  row("AS", "60", "American Samoa", 0, "house", { countyWord: "District" }),
  row("GU", "66", "Guam", 0, undefined, { countyWord: "" }),
  row("MP", "69", "Northern Mariana Islands", 0, "house", { countyWord: "Municipality" }),
  row("PR", "72", "Puerto Rico", 0, "house", { countyWord: "Municipio" }),
  row("VI", "78", "U.S. Virgin Islands", 0, undefined, { countyWord: "Island" }),
];

const LOWER: Record<Lower, { key: string; label: string; office: string }> = {
  house: { key: "hd", label: "State House district", office: "State House" },
  delegates: { key: "hd", label: "House of Delegates district", office: "House of Delegates" },
  assembly: { key: "ad", label: "Assembly district", office: "Assembly" },
  "general-assembly": { key: "ad", label: "Assembly district", office: "Assembly" },
};

/** A family with what the boundary data says of its districts: how many, or each by name. */
function listed(family: DistrictFamily, districts: ListedChamber | undefined): DistrictFamily {
  if (districts === undefined) return family;
  if (typeof districts === "number") return { ...family, count: districts };
  return {
    ...family,
    // A lettered district is called what its id says, in capitals: 35a, "35A".
    ids: districts.map((d) => (typeof d === "string" ? ([d, d.toUpperCase()] as const) : d)),
  };
}

function profileOf(state: StateRow): RegionProfile {
  const path = `us/${state.code.toLowerCase()}`;
  const known = US_DISTRICTS[path];
  const families: DistrictFamily[] = [
    {
      key: "cd",
      label: "Congressional district",
      office: "Congressional",
      // A state with one seat still has a district, at large, numbered 1; so
      // does a territory, for its delegate.
      count: Math.max(state.house, 1),
    },
  ];
  const layers: RegionProfile["layers"] = { congress: "cd" };
  if (state.code === "DC") {
    // No legislature, a Council: its eight wards are what the Census maps as
    // the District's upper chamber.
    families.push(listed({ key: "ward", label: "Ward", office: "Council" }, known?.upper));
    layers.upper = "ward";
  }
  if (!state.none) {
    const lower = state.lower ? LOWER[state.lower] : undefined;
    if (lower) {
      families.push(
        listed({ key: "sd", label: "State Senate district", office: "State Senate" }, known?.upper),
      );
      families.push(
        listed({ key: lower.key, label: lower.label, office: lower.office }, known?.lower),
      );
      layers.upper = "sd";
      layers.lower = lower.key;
    } else {
      // One chamber: Nebraska's Legislature, Guam's and the Virgin Islands'.
      families.push(
        listed({ key: "ld", label: "Legislative district", office: "Legislature" }, known?.upper),
      );
      layers.upper = "ld";
    }
  }
  return {
    path,
    name: state.name,
    code: state.code,
    fips: state.fips,
    families,
    layers,
    countyWord: state.countyWord ?? "County",
    ...(known?.file ? { geoFile: known.file } : {}),
  };
}

/** Every state's profile from the table, by region path. */
export const US_STATES: ReadonlyMap<string, RegionProfile> = new Map(
  ROWS.map((state) => {
    const profile = profileOf(state);
    return [profile.path, profile];
  }),
);
