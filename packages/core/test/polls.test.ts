import { describe, expect, test } from "bun:test";
import {
  US_STATE_NAMES,
  inferOfficeFromTitle,
  inferUsHouseDistrict,
  inferUsStateCode,
  inferYear,
} from "../src/polls";
import type { Subject } from "../src/schema";

const s = (title: string, jurisdiction?: string, election?: string): Subject => ({
  title,
  ...(jurisdiction ? { jurisdiction } : {}),
  ...(election ? { election } : {}),
});

describe("inferOfficeFromTitle", () => {
  test("governor", () => {
    expect(inferOfficeFromTitle(s("Governor of California"))).toBe("governor");
    expect(inferOfficeFromTitle(s("Texas Gubernatorial Election"))).toBe("governor");
  });
  test("senator", () => {
    expect(inferOfficeFromTitle(s("U.S. Senate from Florida"))).toBe("senator");
    expect(inferOfficeFromTitle(s("US Senator (Ohio)"))).toBe("senator");
  });
  test("representative", () => {
    expect(inferOfficeFromTitle(s("U.S. House CA-22"))).toBe("representative");
    expect(inferOfficeFromTitle(s("Representative for the 22nd"))).toBe("representative");
    expect(inferOfficeFromTitle(s("Congresswoman from Texas"))).toBe("representative");
  });
  test("attorney general", () => {
    expect(inferOfficeFromTitle(s("Attorney General of California"))).toBe("attorney_general");
  });
  test("mayor", () => {
    expect(inferOfficeFromTitle(s("Mayor of San Francisco"))).toBe("mayor");
  });
  test("president", () => {
    expect(inferOfficeFromTitle(s("President of the United States"))).toBe("president");
  });
  test("measure", () => {
    expect(inferOfficeFromTitle(s("California Proposition 50"))).toBe("measure");
    expect(inferOfficeFromTitle(s("Amendment 1"))).toBe("measure");
    expect(inferOfficeFromTitle(s("Statewide referendum"))).toBe("measure");
  });
  test("other when nothing matches", () => {
    expect(inferOfficeFromTitle(s("Local Library Trustee"))).toBe("other");
  });
});

describe("inferYear", () => {
  test("bare year", () => {
    expect(inferYear(s("x", undefined, "2024"))).toBe("2024");
  });
  test("YYYY-MM-DD", () => {
    expect(inferYear(s("x", undefined, "2026-11-03"))).toBe("2026");
  });
  test("RFC 3339 datetime", () => {
    expect(inferYear(s("x", undefined, "2026-11-03T05:00:00Z"))).toBe("2026");
  });
  test("undefined / non-date", () => {
    expect(inferYear(s("x"))).toBeUndefined();
    expect(inferYear(s("x", undefined, "not a date"))).toBeUndefined();
  });
});

describe("inferUsStateCode", () => {
  test("us/ca/sf → CA", () => {
    expect(inferUsStateCode(s("x", "us/ca/sf"))).toBe("CA");
  });
  test("us/ny → NY", () => {
    expect(inferUsStateCode(s("x", "us/ny"))).toBe("NY");
  });
  test("USA/tx → TX", () => {
    expect(inferUsStateCode(s("x", "USA/tx"))).toBe("TX");
  });
  test("non-US jurisdiction → undefined", () => {
    expect(inferUsStateCode(s("x", "gb/eng"))).toBeUndefined();
  });
  test("missing → undefined", () => {
    expect(inferUsStateCode(s("x"))).toBeUndefined();
    expect(inferUsStateCode(s("x", "us"))).toBeUndefined();
  });
});

describe("inferUsHouseDistrict", () => {
  test("CA-22 in title", () => {
    expect(inferUsHouseDistrict(s("U.S. House CA-22"))).toBe("CA-22");
  });
  test("single-digit pads", () => {
    expect(inferUsHouseDistrict(s("CA-3 Representative"))).toBe("CA-03");
  });
  test("with space", () => {
    expect(inferUsHouseDistrict(s("Texas TX 7 district"))).toBe("TX-07");
  });
  test("no match", () => {
    expect(inferUsHouseDistrict(s("Mayor of San Francisco"))).toBeUndefined();
  });
});

describe("US_STATE_NAMES", () => {
  test("covers all 50 + DC + 5 territories", () => {
    expect(Object.keys(US_STATE_NAMES).length).toBe(56);
  });
  test("a few sanity entries", () => {
    expect(US_STATE_NAMES.CA).toBe("California");
    expect(US_STATE_NAMES.NY).toBe("New York");
    expect(US_STATE_NAMES.DC).toBe("District of Columbia");
    expect(US_STATE_NAMES.PR).toBe("Puerto Rico");
  });
});
