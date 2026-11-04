/**
 * Whether the counties OpenSlate reads from HTML results pages (no feed:
 * `lvt-html`, `acvote` in src/countyResults.ts) still parse. Run on a schedule
 * by .github/workflows/county-html.yml: a failed run is the notice that a
 * county changed its page's layout.
 *
 * Fetched through the public relay (`COUNTY_CA_BASE` to point elsewhere), so a
 * check costs a county nothing beyond what the relay already asks for.
 *
 *   bun run packages/core/scripts/check-county-pages.ts
 */

import {
  ACVOTE_PAGE_PATH,
  CA_COUNTY_FEEDS,
  type CountyContest,
  type CountyFeed,
  isStateContest,
  lvtPagePath,
  parseAcvoteHtml,
  parseLvtHtml,
} from "../src/countyResults";

const BASE = process.env.COUNTY_CA_BASE ?? "https://api.openslate.us/api/county-ca";

/** Fewer than this many contests (or local ones) means the page is read wrong, not that the election shrank. */
const MIN_CONTESTS = 10;
const MIN_LOCAL = 5;

function pageOf(
  feed: CountyFeed,
):
  | { path: string; parse: (html: string) => { contests: CountyContest[]; asOf?: number } }
  | undefined {
  if (feed.kind === "lvt-html") return { path: lvtPagePath(feed), parse: parseLvtHtml };
  if (feed.kind === "acvote") return { path: ACVOTE_PAGE_PATH, parse: parseAcvoteHtml };
  return undefined;
}

const pacific = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

async function check(slug: string, feed: CountyFeed): Promise<string[]> {
  const page = pageOf(feed);
  if (!page) return [];
  const url = `${BASE}/${slug}/${page.path}`;
  const res = await fetch(url, { headers: { accept: "text/html" } });
  if (!res.ok) return [`${feed.name}: ${url} answered ${res.status}`];
  const html = await res.text();
  let read: { contests: CountyContest[]; asOf?: number };
  try {
    read = page.parse(html);
  } catch (e) {
    return [`${feed.name}: ${(e as Error).message} (${html.length} bytes from ${url})`];
  }
  const { contests, asOf } = read;
  const local = contests.filter((c) => !isStateContest(c));
  const empty = contests.filter((c) => c.choices.length === 0 || c.choices.some((x) => !x.name));
  const problems: string[] = [];
  if (contests.length < MIN_CONTESTS)
    problems.push(`${feed.name}: only ${contests.length} contests read`);
  if (local.length < MIN_LOCAL) problems.push(`${feed.name}: only ${local.length} local contests`);
  if (empty.length > 0)
    problems.push(`${feed.name}: ${empty.length} contests with a missing choice name`);
  if (asOf === undefined) problems.push(`${feed.name}: no "updated" time found on the page`);
  const when =
    asOf === undefined
      ? "?"
      : `${pacific.format(asOf)} (${new Date(asOf).toISOString().slice(11, 16)}Z)`;
  console.log(`${feed.name}: ${contests.length} contests, ${local.length} local, updated ${when}`);
  return problems;
}

const problems = (
  await Promise.all(Object.entries(CA_COUNTY_FEEDS).map(([slug, feed]) => check(slug, feed)))
).flat();
if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
