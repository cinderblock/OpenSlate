import { describe, expect, test } from "bun:test";
import { type CatalogEntry, catalogEntryEvidenceUrl, isBuiltInCatalog } from "../src/lib/query";

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

describe("catalogEntryEvidenceUrl", () => {
  const entry = (evidence?: string) => ({ ...(evidence ? { evidence } : {}) }) as CatalogEntry;
  const catalog = "https://example.org/endorsements/index.json";

  test("resolves the evidence page against the catalog", () => {
    expect(catalogEntryEvidenceUrl(entry("orgs/x/2026-11-03/evidence/"), catalog)).toBe(
      "https://example.org/endorsements/orgs/x/2026-11-03/evidence/",
    );
  });

  test("none when the catalog gives none, or gives a link the app mustn't follow", () => {
    expect(catalogEntryEvidenceUrl(entry(), catalog)).toBeUndefined();
    expect(catalogEntryEvidenceUrl(entry("javascript:alert(1)"), catalog)).toBeUndefined();
  });
});
