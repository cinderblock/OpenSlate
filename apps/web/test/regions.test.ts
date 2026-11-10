import { describe, expect, test } from "bun:test";
import {
  allDistricts,
  districtCount,
  districtFamilyLabel,
  districtName,
  familyHasRaces,
  inArea,
  inOneState,
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
  layerWords,
  linkedRegion,
  regionByCode,
  regionFor,
  regionPathOf,
  regionProfile,
} from "../src/lib/regions";
import { US_DISTRICTS } from "../src/lib/regions/usDistricts.gen";

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
    // The states' seats; the District and each territory send one delegate more.
    const delegates = ["DC", "AS", "GU", "MP", "PR", "VI"];
    const seats = (regions: ReturnType<typeof allRegions>) =>
      regions.reduce(
        (sum, region) => sum + (region.families.find((f) => f.key === "cd")?.count ?? 0),
        0,
      );
    expect(seats(allRegions().filter((r) => !delegates.includes(r.code)))).toBe(435);
    expect(seats(allRegions().filter((r) => delegates.includes(r.code)))).toBe(6);
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
    // The District has no legislature; its Council's wards stand where a chamber would.
    expect(regionProfile("us/dc")?.layers).toEqual({ congress: "cd", upper: "ward" });
    expect(jurisdictionLabel("us/dc/ward-3")).toBe("Ward 3");
    expect(districtFamily("hd", "us/va")?.label).toBe("House of Delegates district");
    expect(districtFamily("hd", "us/tx")?.label).toBe("State House district");
    // Washington's two chambers share their districts; the key still says which chamber.
    expect(districtFamily("sd", "us/wa")?.label).toBe("State Senate district");
    expect(districtFamily("hd", "us/wa")?.label).toBe("State House district");
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

describe("a link that names a state", () => {
  test("by postal code or by path", () => {
    expect(linkedRegion("?state=va")).toBe("us/va");
    expect(linkedRegion("?state=VA")).toBe("us/va");
    expect(linkedRegion("?utm=x&state=us/tx")).toBe("us/tx");
  });

  test("nothing for a state the app doesn't know, or no state", () => {
    expect(linkedRegion("?state=zz")).toBeUndefined();
    expect(linkedRegion("?state=de/by")).toBeUndefined();
    expect(linkedRegion("?state=")).toBeUndefined();
    expect(linkedRegion("")).toBeUndefined();
  });
});

describe("what a state calls the layers on its map", () => {
  const tabs = (path: string) =>
    (["cd", "sd", "ad", "county", "place"] as const).map(
      (layer) => layerWords(regionProfile(path), layer)?.tab,
    );

  test("California as it has always read", () => {
    expect(tabs("us/ca")).toEqual(["Congress", "Senate", "Assembly", "Counties", "Cities"]);
    expect(layerWords(regionProfile("us/ca"), "ad")).toEqual({
      one: "Assembly district",
      many: "assembly districts",
      tab: "Assembly",
    });
  });

  test("a House, a House of Delegates, parishes and boroughs", () => {
    expect(tabs("us/tx")).toEqual(["Congress", "Senate", "House", "Counties", "Cities"]);
    expect(tabs("us/va")[2]).toBe("House of Delegates");
    expect(tabs("us/la")[3]).toBe("Parishes");
    expect(tabs("us/ak")[3]).toBe("Boroughs");
    expect(layerWords(regionProfile("us/la"), "county")?.many).toBe("parishes");
  });

  test("no tab for a chamber a state doesn't have", () => {
    expect(tabs("us/ne")).toEqual(["Congress", "Legislature", undefined, "Counties", "Cities"]);
    expect(tabs("us/dc")).toEqual(["Congress", "Council", undefined, "Counties", "Cities"]);
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
    // A region the app lists no districts for: just the ones given, in order.
    expect(allDistricts("de/by/hd", ["35b", "4a", "35a", "10b"])).toEqual([
      "4a",
      "10b",
      "35a",
      "35b",
    ]);
    expect(allDistricts("de/by/sd", ["washington", "addison"])).toEqual(["addison", "washington"]);
  });

  test("a state's own are all offered, from its boundary data", () => {
    // Minnesota: 67 Senate districts, each split into an A and a B House district.
    const house = allDistricts("us/mn/hd", []);
    expect(house).toHaveLength(134);
    expect(house.slice(0, 4)).toEqual(["1a", "1b", "2a", "2b"]);
    expect(house.at(-1)).toBe("67b");
    expect(allDistricts("us/mn/sd", [])).toHaveLength(67);
    // Alaska's Senate is lettered A to T.
    expect(allDistricts("us/ak/sd", []).join("")).toBe("abcdefghijklmnopqrst");
    // Massachusetts names both chambers'.
    expect(allDistricts("us/ma/sd", [])).toContain("third-middlesex");
    expect(allDistricts("us/ma/hd", [])).toHaveLength(160);
  });

  test("each goes by what its state calls it", () => {
    expect(districtName("us/mn/hd", "35a")).toBe("35A");
    expect(districtName("us/ak/sd", "i")).toBe("I");
    expect(districtName("us/ma/sd", "third-middlesex")).toBe("Third Middlesex");
    // A one-word name keeps its own capitals, not a lettered district's.
    expect(districtName("us/vt/sd", "washington")).toBe("Washington");
    expect(districtName("us/vt/hd", "washington-4")).toBe("Washington-4");
    expect(districtName("us/ca/sd", "11")).toBe("11");
    expect(jurisdictionLabel("us/ma/sd-third-middlesex")).toBe(
      "State Senate district Third Middlesex",
    );
    expect(jurisdictionLabel("us/mn/hd-35a")).toBe("State House district 35A");
    expect(jurisdictionLabel("us/ak/sd-i")).toBe("State Senate district I");
  });

  test("the table agrees with the House's apportionment", () => {
    for (const [path, listed] of Object.entries(US_DISTRICTS)) {
      const count = regionProfile(path)?.families.find((f) => f.key === "cd")?.count;
      expect(`${path} ${listed.cd}`).toBe(`${path} ${count}`);
    }
  });

  test("a lettered chamber has no odd and even years", () => {
    expect(noRaceReason("us/ak/sd", "b", ["a", "c", "e"], "2026-11-03")).toBe(
      "Nothing you've imported has a State Senate race in district B this election.",
    );
    expect(noRaceReason("us/vt/sd", "washington", [], "2026-11-03")).toBe(
      "Nothing you've imported has a State Senate race in district Washington this election.",
    );
  });
});

describe("someone votes in one state", () => {
  const both = {
    localities: ["us/ca/sf", "us/tx/austin"],
    districts: { "us/ca/cd": "11", "us/tx/cd": "37", "us/ca/sf/sup": "3" },
    labels: { "us/ca/sf/sup": "San Francisco supervisorial district 3" },
    found: ["us/ca/sf", "us/tx/travis-county"],
    answers: { "us/ca/sf/council-3": true, "us/tx/austin/council-9": false },
  };

  test("setting something in another state leaves the first behind", () => {
    expect(inOneState(both, "us/tx")).toEqual({
      localities: ["us/tx/austin"],
      districts: { "us/tx/cd": "37" },
      found: ["us/tx/travis-county"],
      answers: { "us/tx/austin/council-9": false },
    });
    expect(inOneState(both, "us/ca").districts).toEqual({ "us/ca/cd": "11", "us/ca/sf/sup": "3" });
  });

  test("an area already in one state comes back as it is", () => {
    const texas = inOneState(both, "us/tx");
    expect(inOneState(texas, "us/tx")).toBe(texas);
    expect(inOneState(both, undefined)).toBe(both);
  });

  test("a state is not a prefix of another's path", () => {
    const area = { localities: ["us/ca/sf"], districts: { "us/c/cd": "1" } };
    expect(inOneState(area, "us/c").localities).toEqual([]);
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
