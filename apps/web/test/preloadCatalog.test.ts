import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_ENDORSEMENTS_CATALOG } from "../src/lib/query";

// vite.config.ts preloads the default catalog with the page. It can't import
// query.ts (that brings the app's dependencies into the build config), so it
// names the URL itself: a preload of anything else would fetch it twice.
test("the page preloads the catalog the app reads by default", () => {
  const config = readFileSync(join(import.meta.dir, "../vite.config.ts"), "utf8");
  expect(config).toContain(`"${PUBLIC_ENDORSEMENTS_CATALOG}"`);
});
