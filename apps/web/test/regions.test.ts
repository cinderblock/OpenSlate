import { describe, expect, test } from "bun:test";
import {
  districtCount,
  districtFamilyLabel,
  familyHasRaces,
  jurisdictionLabel,
  jurisdictionRank,
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
    expect(ca?.geoFile).toBe("geo/us-ca.topo.json");
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
