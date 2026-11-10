import { describe, expect, test } from "bun:test";
import { censusDistrictId, districtId } from "../src/districts";

describe("districtId", () => {
  test("numbers lose their leading zeros", () => {
    expect(districtId("7")).toBe("7");
    expect(districtId("07")).toBe("7");
    expect(districtId("120")).toBe("120");
  });

  test("lettered districts go to lower case", () => {
    expect(districtId("35A")).toBe("35a");
    expect(districtId("05B")).toBe("5b");
    expect(districtId("B")).toBe("b");
    // Alaska's Senate.
    expect(districtId("I")).toBe("i");
  });

  test("named districts become slugs", () => {
    expect(districtId("Third Middlesex")).toBe("third-middlesex");
    expect(districtId("19th Suffolk")).toBe("19th-suffolk");
    expect(districtId("Hillsborough 10")).toBe("hillsborough-10");
    expect(districtId("Orleans-3")).toBe("orleans-3");
    expect(districtId("Orleans-Lamoille")).toBe("orleans-lamoille");
    expect(districtId("Norfolk and Middlesex")).toBe("norfolk-and-middlesex");
    expect(districtId("  Cape & Islands ")).toBe("cape-islands");
    expect(districtId("Añasco")).toBe("anasco");
  });

  test("an id comes back as itself", () => {
    for (const id of ["7", "35a", "third-middlesex", "orleans-3", "i"]) {
      expect(districtId(id)).toBe(id);
    }
  });
});

describe("censusDistrictId", () => {
  test("a state with one House seat has district 1", () => {
    expect(censusDistrictId("Congressional District (at Large)")).toBe("1");
    expect(censusDistrictId("Delegate District (at Large)")).toBe("1");
    expect(censusDistrictId("Resident Commissioner District (at Large)")).toBe("1");
  });

  test("land in no district has none", () => {
    expect(censusDistrictId("Congressional Districts not defined")).toBeUndefined();
    expect(censusDistrictId("State Senate Districts not defined")).toBeUndefined();
    expect(censusDistrictId(undefined)).toBeUndefined();
    expect(censusDistrictId("")).toBeUndefined();
  });

  test("everything else as districtId spells it", () => {
    expect(censusDistrictId("11")).toBe("11");
    expect(censusDistrictId("02")).toBe("2");
    expect(censusDistrictId("35A")).toBe("35a");
    expect(censusDistrictId("Third Middlesex")).toBe("third-middlesex");
  });
});
