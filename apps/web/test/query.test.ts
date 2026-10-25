import { describe, expect, test } from "bun:test";
import { isBuiltInCatalog } from "../src/lib/query";

describe("isBuiltInCatalog", () => {
  test("a catalog relative to the page ships with the app", () => {
    expect(isBuiltInCatalog("catalog/index.json")).toBe(true);
    expect(isBuiltInCatalog("/catalog/index.json")).toBe(true);
  });

  test("the live catalog, or any other on the web, doesn't", () => {
    expect(isBuiltInCatalog(undefined)).toBe(false);
    expect(isBuiltInCatalog("https://example.org/index.json")).toBe(false);
    expect(isBuiltInCatalog("views://mainview/catalog/index.json")).toBe(false);
  });
});
