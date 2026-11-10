import { describe, expect, test } from "bun:test";
import {
  allDistricts,
  districtCount,
  districtFamilyLabel,
  familyHasRaces,
  inArea,
  jurisdictionLabel,
  jurisdictionRank,
  noRaceReason,
  parseJurisdiction,
  stateLabel,
} from "../src/lib/jurisdictions";
import {
  allRegions,
  countyLabel,
  districtFamily,
  districtFamilyAt,
  layerFamily,
  regionByCode,
  regionFor,
  regionPathOf,
  regionProfile,
} from "../src/lib/regions";

describe("the region registry", () => {
  test("has every state, the District and the territories, each once", () => {
    const regions = allRegions();
    expect(regions).toHaveLength(56);
    expect(new Set(regions.map((r) => r.path)).size).toBe(56);
    expect(new Set(regions.map((r) => r.fips)).size).toBe(56);
    for (const region of regions) {
      expect(region.path).toBe(`us/${region.code.toLowerCase()}`);
      expect(region.fips).toMatch(/^\d\d$/);
    }
  });

  test("the House's 435 seats", () => {
    const seats = allRegions().reduce(
      (sum, region) => sum + (region.families.find((f) => f.key === "cd")?.count ?? 0),
      0,
    );
    expect(seats).toBe(435);
  });

  test("a path's region", () => {
    expect(regionPathOf("us/ca/sf")).toBe("us/ca");
    expect(regionPathOf("US/CA")).toBe("us/ca");
    expect(regionPathOf("us")).toBeUndefined();
    expect(regionPathOf(undefined)).toBeUndefined();
    expect(regionFor("us/ca/cd-11")?.name).toBe("California");
    expect(regionFor("us/va/hd-12")?.name).toBe("Virginia");
    expect(regionFor("de/by/muenchen")).toBeUndefined();
    expect(regionByCode("us", "TX")?.name).toBe("Texas");
  });

  test("California keeps its own districts and counts", () => {
    const ca = regionProfile("us/ca");
    expect(ca?.families.map((f) => f.key)).toEqual(["cd", "sd", "ad", "coa", "bart", "boe"]);
    expect(districtCount("us/ca/cd")).toBe(52);
    expect(districtCount("us/ca/sd")).toBe(40);
    expect(districtCount("us/ca/ad")).toBe(80);
    expect(districtCount("us/ca/coa")).toBe(6);
    expect(districtCount("us/ca/bart")).toBe(9);
    expect(ca?.counties).toHaveLength(58);
    expect(ca?.geoFile).toBe("us-ca.topo.json");
  });

  test("chambers go by what the state calls them", () => {
    expect(regionProfile("us/ca")?.layers).toEqual({ congress: "cd", upper: "sd", lower: "ad" });
    expect(regionProfile("us/tx")?.layers).toEqual({ congress: "cd", upper: "sd", lower: "hd" });
    expect(regionProfile("us/ny")?.layers.lower).toBe("ad");
    expect(regionProfile("us/ne")?.layers).toEqual({ congress: "cd", upper: "ld" });
    expect(regionProfile("us/dc")?.layers).toEqual({ congress: "cd" });
    expect(districtFamily("hd", "us/va")?.label).toBe("House of Delegates district");
    expect(districtFamily("hd", "us/tx")?.label).toBe("State House district");
    expect(districtFamily("sd", "us/wa")?.label).toBe("Legislative district (Senate)");
    expect(layerFamily(regionProfile("us/tx"), "ad")).toBe("hd");
    expect(layerFamily(regionProfile("us/ne"), "ad")).toBeUndefined();
    expect(layerFamily(undefined, "ad")).toBe("ad");
  });

  test("families by the path areas key them with", () => {
    expect(districtFamilyAt("us/ca/sd")?.office).toBe("State Senate");
    expect(districtFamilyAt("us/ca/orange-county/sup")?.label).toBe("Supervisorial district");
    expect(districtFamilyAt("us/ca/nope")).toBeUndefined();
  });

  test("which families have races of their own", () => {
    expect(familyHasRaces("us/ca/sd")).toBe(true);
    expect(familyHasRaces("us/ca/bart")).toBe(true);
    expect(familyHasRaces("us/va/hd")).toBe(true);
    // Filed statewide, or only narrowing a race filed elsewhere.
    expect(familyHasRaces("us/ca/boe")).toBe(false);
    expect(familyHasRaces("us/ca/unsd")).toBe(false);
    expect(familyHasRaces("us/ca/orange-county/sup")).toBe(false);
    expect(familyHasRaces("us/ca/nope")).toBe(false);
  });

  test("what a county is called", () => {
    expect(countyLabel(regionProfile("us/ca"), "Alameda")).toBe("Alameda County");
    expect(countyLabel(regionProfile("us/ca"), "San Francisco")).toBe("San Francisco");
    expect(countyLabel(regionProfile("us/la"), "Orleans")).toBe("Orleans Parish");
    expect(countyLabel(undefined, "Cook")).toBe("Cook County");
  });
});

describe("districts that aren't numbered", () => {
  const district = (path: string) => {
    const part = parseJurisdiction(path);
    return part.kind === "district" ? `${part.family} ${part.number}` : part.kind;
  };

  test("lettered and named legislative districts are districts", () => {
    expect(district("us/mn/hd-35a")).toBe("hd 35a");
    expect(district("us/ak/sd-i")).toBe("sd i");
    expect(district("us/ma/sd-third-middlesex")).toBe("sd third-middlesex");
    expect(district("us/nh/hd-hillsborough-10")).toBe("hd hillsborough-10");
    expect(district("us/vt/hd-orleans-3")).toBe("hd orleans-3");
    expect(district("us/md/hd-38c")).toBe("hd 38c");
    // Numbered ones as ever, in any family.
    expect(district("us/ma/cd-09")).toBe("cd 9");
    expect(district("us/ca/coa-4")).toBe("coa 4");
  });

  test("only in the families the state's legislature uses: a town can be called anything", () => {
    // Iowa has no `council` chamber, Texas no `ad`.
    expect(district("us/ia/council-bluffs")).toBe("local");
    expect(district("us/tx/ad-hoc-district")).toBe("local");
    expect(district("us/ca/city-of-alameda")).toBe("local");
    expect(district("us/ca/sup-b")).toBe("local");
    // A region the app has no profile for keeps the numbered rule alone.
    expect(district("de/by/sd-nord")).toBe("local");
    expect(district("de/by/sd-4")).toBe("sd 4");
  });

  test("a voter in one is on its ballot", () => {
    const area = { localities: [], districts: { "us/mn/hd": "35a", "us/mn/sd": "35" } };
    expect(inArea("us/mn/hd-35a", area)).toBe(true);
    expect(inArea("us/mn/hd-35A", area)).toBe(true);
    expect(inArea("us/mn/hd-35b", area)).toBe(false);
    expect(inArea("us/mn/sd-35", area)).toBe(true);
  });

  test("they sort by number, then letter, then name", () => {
    expect(allDistricts("us/mn/hd", ["35b", "4a", "35a", "10b"])).toEqual([
      "4a",
      "10b",
      "35a",
      "35b",
    ]);
    expect(allDistricts("us/vt/sd", ["washington", "addison"])).toEqual(["addison", "washington"]);
  });

  test("a lettered chamber has no odd and even years", () => {
    expect(noRaceReason("us/ak/sd", "b", ["a", "c", "e"], "2026-11-03")).toBe(
      "Nothing you've imported has a State Senate race in district b this election.",
    );
  });
});

describe("labels through the registry", () => {
  test("states by name, anything else by its code", () => {
    expect(stateLabel("us/ca")).toBe("California");
    expect(stateLabel("us/va")).toBe("Virginia");
    expect(stateLabel("de/by")).toBe("BY");
    expect(jurisdictionLabel("us/tx")).toBe("Texas");
    expect(jurisdictionLabel("us")).toBe("National");
  });

  test("a district by what its state calls it", () => {
    expect(jurisdictionLabel("us/ca/ad-11")).toBe("Assembly district 11");
    expect(jurisdictionLabel("us/va/hd-11")).toBe("House of Delegates district 11");
    expect(jurisdictionLabel("us/tx/hd-11")).toBe("State House district 11");
    expect(jurisdictionLabel("us/ne/ld-11")).toBe("Legislative district 11");
    // With no state given, a key goes by the first state that uses it.
    expect(districtFamilyLabel("ad")).toBe("Assembly district");
    expect(districtFamilyLabel("zz")).toBe("ZZ district");
  });

  test("districts sort Congress first, then the chambers, in any state", () => {
    const rank = jurisdictionRank;
    expect(rank("us/ca/cd-1")).toBeLessThan(rank("us/ca/sd-1"));
    expect(rank("us/ca/sd-1")).toBeLessThan(rank("us/ca/ad-1"));
    expect(rank("us/ca/ad-1")).toBeLessThan(rank("us/ca/coa-1"));
    expect(rank("us/va/cd-1")).toBeLessThan(rank("us/va/sd-1"));
    expect(rank("us/va/sd-1")).toBeLessThan(rank("us/va/hd-1"));
    expect(rank("us/va/hd-1")).toBeLessThan(rank("us/va/richmond"));
  });
});
