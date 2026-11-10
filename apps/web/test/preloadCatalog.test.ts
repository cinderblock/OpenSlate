import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchShardList } from "../src/lib/catalogShards";
import { PUBLIC_ENDORSEMENTS_CATALOG } from "../src/lib/query";

// vite.config.ts preloads the default catalog with the page. It can't import
// query.ts (that brings the app's dependencies into the build config), so it
// names the URL itself: a preload of anything else would fetch it twice.
test("the page preloads the catalog the app reads by default", () => {
  const config = readFileSync(join(import.meta.dir, "../vite.config.ts"), "utf8");
  expect(config).toContain(`"${PUBLIC_ENDORSEMENTS_CATALOG}"`);
});

// The first thing the app asks a catalog for is its shard list, beside the
// index (catalogShards.ts `fetchShardList`): the preload has to be that file,
// at exactly that address, or it's a download nobody reads.
test("what's preloaded is the catalog's shard list, where the app looks for it", async () => {
  const config = readFileSync(join(import.meta.dir, "../vite.config.ts"), "utf8");
  expect(config).toContain('new URL("shards.json", url).href');
  const asked: string[] = [];
  await fetchShardList(PUBLIC_ENDORSEMENTS_CATALOG, async (url) => {
    asked.push(url);
    return { ok: false, status: 404 };
  });
  expect(asked).toEqual([new URL("shards.json", PUBLIC_ENDORSEMENTS_CATALOG).href]);
});
