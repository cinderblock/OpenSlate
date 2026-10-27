import { describe, expect, test } from "bun:test";
import {
  EMPTY_AREA,
  allDistricts,
  inArea,
  jurisdictionLabel,
  jurisdictionRank,
  noRaceReason,
  parseJurisdiction,
  placeRace,
  upgradeArea,
  withFoundLocalities,
} from "../src/lib/jurisdictions";

describe("parseJurisdiction", () => {
  test("recognises state, district and local paths", () => {
    expect(parseJurisdiction("us/ca")).toEqual({ kind: "state", path: "us/ca" });
    expect(parseJurisdiction("us/ca/cd-07")).toEqual({
      kind: "district",
      path: "us/ca/cd-07",
      state: "us/ca",
      family: "cd",
      number: "7",
    });
    expect(parseJurisdiction("us/ca/los-angeles-county")).toEqual({
      kind: "local",
      path: "us/ca/los-angeles-county",
      state: "us/ca",
      slug: "los-angeles-county",
    });
    expect(parseJurisdiction(undefined)).toEqual({ kind: "none" });
  });
});

describe("placeRace", () => {
  const hb = {
    localities: ["us/ca/huntington-beach", "us/ca/orange-county"],
    districts: {
      "us/ca/cd": "42",
      "us/ca/unsd": "none",
      "us/ca/elsd": "17880",
      "us/ca/scsd": "17910",
      "us/ca/orange-county/sup": "2",
    },
  };
  const oc = "us/ca/orange-county";

  test("without a district, a race is placed by its jurisdiction alone", () => {
    expect(placeRace(oc, undefined, hb)).toBe("in");
    expect(placeRace("us/ca/los-angeles-county", undefined, hb)).toBe("out");
    expect(placeRace(oc, "us/ca/elsd-2610", EMPTY_AREA)).toBe("in");
  });

  test("a family segment compares with the area's district of that family", () => {
    expect(placeRace(oc, "us/ca/elsd-17880", hb)).toBe("in");
    expect(placeRace(oc, "us/ca/elsd-02610", hb)).toBe("out");
    expect(placeRace(oc, `${oc}/sup-2`, hb)).toBe("in");
    expect(placeRace(oc, `${oc}/sup-4`, hb)).toBe("out");
    // In no unified school district: every unified district's races are out.
    expect(placeRace(oc, "us/ca/unsd-17760/ta-4", hb)).toBe("out");
  });

  test("what the area doesn't know is unknown, unless something else rules it out", () => {
    // Trustee areas: the school district is known, the area isn't.
    expect(placeRace(oc, "us/ca/elsd-17880/ta-4", hb)).toBe("unknown");
    expect(placeRace(oc, "us/ca/elsd-2610/ta-4", hb)).toBe("out");
    // A water district the area can't find.
    expect(placeRace(oc, "us/ca/irvine-ranch-water-district/div-5", hb)).toBe("unknown");
    expect(placeRace(oc, "us/ca/boe-2", hb)).toBe("unknown");
    // A different state's district.
    expect(placeRace(oc, "us/ny/cd-3", hb)).toBe("out");
  });

  test("a district the area puts the user in outranks the filing county", () => {
    // Fullerton Joint Union High School District crosses into LA County; OC lists it.
    const la = {
      localities: ["us/ca/la-habra-heights", "us/ca/los-angeles-county"],
      districts: { "us/ca/scsd": "14760" },
    };
    expect(placeRace(oc, "us/ca/scsd-14760/ta-1", la)).toBe("unknown");
    expect(placeRace(oc, "us/ca/scsd-14760", la)).toBe("in");
    // Another school district's: out, as before. Nothing matched: the county decides.
    expect(placeRace(oc, "us/ca/scsd-17910/ta-1", la)).toBe("out");
    expect(placeRace(oc, "us/ca/irvine-ranch-water-district/div-5", la)).toBe("out");
    expect(placeRace(oc, `${oc}/sup-2`, la)).toBe("out");
  });

  test("a place segment the area lists continues, and lettered ids count", () => {
    const cypress = {
      localities: ["us/ca/cypress-school-district", oc],
      districts: { "us/ca/cypress-school-district/ta": "b" },
    };
    expect(placeRace(oc, "us/ca/cypress-school-district/ta-B", cypress)).toBe("in");
    expect(placeRace(oc, "us/ca/cypress-school-district/ta-c", cypress)).toBe("out");
  });

  test("a regional race is on the ballot in each jurisdiction it's voted in (SPEC §3.3)", () => {
    const bayArea = "us/ca/bay-area";
    const counties = ["us/ca/alameda-county", "us/ca/contra-costa-county", "us/ca/sf"];
    const sf = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } };
    const berkeley = { localities: ["us/ca/berkeley", "us/ca/alameda-county"], districts: {} };
    const fresno = { localities: ["us/ca/fresno", "us/ca/fresno-county"], districts: {} };
    // The region's path alone puts it on nobody's ballot.
    expect(placeRace(bayArea, undefined, sf)).toBe("out");
    expect(placeRace(bayArea, undefined, sf, counties)).toBe("in");
    expect(placeRace(bayArea, undefined, berkeley, counties)).toBe("in");
    expect(placeRace(bayArea, undefined, fresno, counties)).toBe("out");
    // `voted_in` stands in for the jurisdiction: a voter who picked the region
    // as a place isn't in it unless they're in one of its counties.
    expect(placeRace(bayArea, undefined, { localities: [bayArea], districts: {} }, counties)).toBe(
      "out",
    );
    // A district still narrows it.
    const ward = { localities: ["us/ca/sf"], districts: { "us/ca/ward": "2" } };
    expect(placeRace(bayArea, "us/ca/ward-2", ward, counties)).toBe("in");
    expect(placeRace(bayArea, "us/ca/ward-3", ward, counties)).toBe("out");
    // With no area set, everything is in.
    expect(placeRace(bayArea, undefined, EMPTY_AREA, counties)).toBe("in");
  });
});

describe("inArea", () => {
  const sf = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11", "us/ca/ad": "17" } };

  test("with no area set, every race is in", () => {
    expect(inArea("us/ca/cd-3", EMPTY_AREA)).toBe(true);
    expect(inArea("us/ny", EMPTY_AREA)).toBe(true);
  });

  test("statewide races of the area's state are in, other states' are not", () => {
    expect(inArea("us/ca", sf)).toBe(true);
    expect(inArea("us/ny", sf)).toBe(false);
    expect(inArea("us", sf)).toBe(true);
  });

  test("only the area's own district numbers are in", () => {
    expect(inArea("us/ca/cd-11", sf)).toBe(true);
    expect(inArea("us/ca/cd-12", sf)).toBe(false);
    expect(inArea("us/ca/ad-17", sf)).toBe(true);
    // A family the user hasn't set (State Senate) is out once the area is set.
    expect(inArea("us/ca/sd-11", sf)).toBe(false);
  });

  test("only the area's localities are in; races with no jurisdiction always are", () => {
    expect(inArea("us/ca/sf", sf)).toBe(true);
    expect(inArea("us/ca/oakland", sf)).toBe(false);
    expect(inArea(undefined, sf)).toBe(true);
  });
});

describe("labels and ranks", () => {
  test("labels read like a ballot", () => {
    expect(jurisdictionLabel("us/ca")).toBe("California");
    expect(jurisdictionLabel("us/ca/cd-11")).toBe("Congressional district 11");
    expect(jurisdictionLabel("us/ca/sf")).toBe("San Francisco");
    expect(jurisdictionLabel("us/ca/chula-vista")).toBe("Chula Vista");
  });

  test("statewide sorts before districts before local", () => {
    expect(jurisdictionRank("us/ca")).toBeLessThan(jurisdictionRank("us/ca/cd-1"));
    expect(jurisdictionRank("us/ca/cd-1")).toBeLessThan(jurisdictionRank("us/ca/ad-1"));
    expect(jurisdictionRank("us/ca/ad-1")).toBeLessThan(jurisdictionRank("us/ca/sf"));
  });
});

describe("districts with no race", () => {
  test("allDistricts lists every district, plus any extra the data uses", () => {
    expect(allDistricts("us/ca/sd", ["2", "4"])).toHaveLength(40);
    expect(allDistricts("us/ca/coa", ["7"])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(allDistricts("us/xx/cd", ["3", "1"])).toEqual(["1", "3"]);
  });

  const even = Array.from({ length: 20 }, (_, i) => String(2 * i + 2));
  test("the Senate's staggered terms, from the election year", () => {
    expect(noRaceReason("us/ca/sd", "13", [], "2026-11-03")).toBe(
      "No State Senate race in district 13 this election; only even-numbered seats are up.",
    );
    expect(noRaceReason("us/ca/sd", "14", [], "2028-11-07")).toBe(
      "No State Senate race in district 14 this election; only odd-numbered seats are up.",
    );
  });
  test("staggering worked out from the data when there is no rule", () => {
    const family = "us/ca/bart";
    expect(noRaceReason(family, "3", ["2", "4", "6", "8"])).toContain("only even-numbered");
    expect(noRaceReason(family, "3", ["2", "4"])).toBe(
      "Nothing you've imported has a BART board race in district 3 this election.",
    );
    expect(noRaceReason("us/ca/sd", "13", even)).toContain("only even-numbered");
  });
  test("an even district with no race, in an even year, is a gap in the data", () => {
    expect(noRaceReason("us/ca/sd", "12", even.slice(1), "2026-11-03")).toBe(
      "Nothing you've imported has a State Senate race in district 12 this election.",
    );
  });
});

describe("upgradeArea", () => {
  test("a re-filed county's old path gains the county's own, and asks about the city", () => {
    const old = {
      localities: ["us/ca/san-diego"],
      districts: { "us/ca/cd": "50", "us/ca/san-diego/sup": "4" },
      labels: { "us/ca/san-diego/sup": "San Diego County supervisorial district 4" },
    };
    expect(upgradeArea(old)).toEqual({
      localities: ["us/ca/san-diego", "us/ca/san-diego-county"],
      districts: { "us/ca/cd": "50", "us/ca/san-diego-county/sup": "4" },
      labels: { "us/ca/san-diego-county/sup": "San Diego County supervisorial district 4" },
      recheck: ["us/ca/san-diego"],
    });
  });

  test("the City of Alameda gets its own path", () => {
    const old = { localities: ["us/ca/alameda", "us/ca/alameda-county"], districts: {} };
    expect(upgradeArea(old).localities).toEqual([
      "us/ca/alameda",
      "us/ca/alameda-county",
      "us/ca/city-of-alameda",
    ]);
  });

  test("leaves up-to-date areas alone", () => {
    const answered = { localities: ["us/ca/san-diego", "us/ca/san-diego-county"], districts: {} };
    expect(upgradeArea(answered)).toBe(answered);
    const looked = { localities: ["us/ca/san-diego"], districts: {}, found: ["us/ca/san-diego"] };
    expect(upgradeArea(looked)).toBe(looked);
    const elsewhere = { localities: ["us/ca/oakland", "us/ca/alameda-county"], districts: {} };
    expect(upgradeArea(elsewhere)).toBe(elsewhere);
  });
});

test("withFoundLocalities adds what the lookup found that races now use", () => {
  const area = {
    localities: ["us/ca/chula-vista"],
    districts: {},
    found: ["us/ca/chula-vista", "us/ca/city-of-chula-vista", "us/ca/san-diego-county"],
  };
  expect(
    withFoundLocalities(area, ["us/ca/chula-vista", "us/ca/san-diego-county"]).localities,
  ).toEqual(["us/ca/chula-vista", "us/ca/san-diego-county"]);
  expect(withFoundLocalities(area, ["us/ca/chula-vista"])).toBe(area);
});
