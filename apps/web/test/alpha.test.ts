import { describe, expect, test } from "bun:test";
import { isPublicSite } from "../src/lib/alpha";

describe("isPublicSite", () => {
  test("the project's own site, with or without www", () => {
    expect(isPublicSite("openslate.us")).toBe(true);
    expect(isPublicSite("www.openslate.us")).toBe(true);
    expect(isPublicSite("OpenSlate.US")).toBe(true);
  });
  test("a copy someone runs themselves", () => {
    expect(isPublicSite("localhost")).toBe(false);
    expect(isPublicSite("127.0.0.1")).toBe(false);
    expect(isPublicSite("slate.example.org")).toBe(false);
    expect(isPublicSite("openslate.us.example.org")).toBe(false);
    expect(isPublicSite("api.openslate.us")).toBe(false);
    expect(isPublicSite("")).toBe(false);
  });
});
