import { describe, expect, test } from "bun:test";
import { httpHref } from "../src/lib/httpHref";

describe("httpHref", () => {
  test("keeps http(s) links", () => {
    expect(httpHref("https://example.org/a b")).toBe("https://example.org/a%20b");
    expect(httpHref("HTTP://example.org")).toBe("http://example.org/");
  });

  test("drops anything else", () => {
    for (const uri of [
      undefined,
      "",
      "javascript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,x",
      "//example.org",
      "https://",
    ])
      expect(httpHref(uri)).toBeUndefined();
  });
});
