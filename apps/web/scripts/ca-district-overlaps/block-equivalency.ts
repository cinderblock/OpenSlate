// Builds the congressional and Board of Equalization tables in
// src/lib/regions/us-ca/districtOverlaps.ts (California district overlaps for the ballot order)
// from the official census-block equivalency files: every 2020 Census
// block, and the district each plan puts it in. Two districts overlap when
// they share a block, people or not: the Secretary of State rotates names
// through every Assembly district a race is voted in, by map territory (a San
// Mateo County ballot proved it: CD 16 reaches AD 21 through one empty block
// in the Crystal Springs watershed). plans/ballot-order-san-mateo-check.md.
//
// Which counties a Senate or Assembly district reaches stays as steps 1-3 of
// this directory found it, by people: a county with no voters in a district
// prints no ballot for it. By blocks alone, AD 18 would reach San Francisco
// through bay water, and Alameda County voters would wrongly get Alameda's own
// letter order. This script keeps those tables as they are in the file.
//
// Run from apps/web, after steps 1-3 if those were rerun:
//   bun scripts/ca-district-overlaps/block-equivalency.ts src/lib/regions/us-ca/districtOverlaps.ts
// Downloads go in the OS temp dir (openslate-block-equivalency). Unzipping
// uses `tar`, which reads zip files on Windows and macOS, or `unzip` elsewhere.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const target = process.argv[2];
if (!target) throw new Error("usage: block-equivalency.ts <out.ts>");

/** The plans, where they're published. */
const PLANS = {
  // Prop 50 (AB 604, 2025): the congressional lines for 2026 to 2030.
  cd: "https://statewidedatabase.org/pub/data/d25/AB604.zip",
  // The Citizens Redistricting Commission's 2021 final maps.
  ad: "https://wedrawthelines.ca.gov/wp-content/uploads/sites/64/2023/01/OneDrive_2023-01-19-6.zip",
  boe: "https://wedrawthelines.ca.gov/wp-content/uploads/sites/64/2023/01/OneDrive_2023-01-19.zip",
} as const;
type Plan = keyof typeof PLANS;

const work = join(tmpdir(), "openslate-block-equivalency");
mkdirSync(work, { recursive: true });

async function download(plan: Plan): Promise<string> {
  const dir = join(work, plan);
  const zip = join(work, `${plan}.zip`);
  if (!existsSync(zip)) {
    const response = await fetch(PLANS[plan], {
      headers: { "user-agent": "OpenSlate district overlaps (+https://openslate.us)" },
    });
    if (!response.ok) throw new Error(`${PLANS[plan]}: HTTP ${response.status}`);
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  }
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length === 0) {
    // Windows' own tar (bsdtar) reads zips; Git Bash's GNU tar, earlier on the PATH, doesn't.
    const windowsTar = join(process.env.SystemRoot ?? "C:Windows", "System32", "tar.exe");
    const tool =
      process.platform === "win32"
        ? spawnSync(windowsTar, ["-xf", zip, "-C", dir])
        : process.platform === "darwin"
          ? spawnSync("tar", ["-xf", zip, "-C", dir])
          : spawnSync("unzip", ["-q", zip, "-d", dir]);
    if (tool.status !== 0) throw new Error(`unzip ${zip}: ${tool.stderr}`);
  }
  return dir;
}

/** The one .csv a plan's download holds. */
function csvIn(dir: string): string {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.toLowerCase().endsWith(".csv")) found.push(path);
    }
  };
  walk(dir);
  if (found.length !== 1) throw new Error(`${dir}: expected one .csv, found ${found.length}`);
  return found[0] as string;
}

/** Block GEOID → district number, from a `"block","district"` file. */
function readPlan(path: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const [block, district] = line.split(",").map((cell) => cell.replace(/"/g, "").trim());
    if (!block || !district || !/^\d+$/.test(block) || !/^\d+$/.test(district)) continue;
    out.set(block.padStart(15, "0"), Number(district));
  }
  if (out.size < 500_000) throw new Error(`${path}: only ${out.size} blocks`);
  return out;
}

const plans = {} as Record<Plan, Map<string, number>>;
for (const plan of Object.keys(PLANS) as Plan[]) {
  plans[plan] = readPlan(csvIn(await download(plan)));
  console.error(`${plan}: ${plans[plan].size} blocks`);
}

/** District → what its blocks reach, sorted. */
function reach(
  plan: Map<string, number>,
  other: (block: string) => number | undefined,
): Record<string, number[]> {
  const sets = new Map<number, Set<number>>();
  for (const [block, district] of plan) {
    const value = other(block);
    if (value === undefined) throw new Error(`block ${block}: not in the other plan`);
    let set = sets.get(district);
    if (!set) {
      set = new Set();
      sets.set(district, set);
    }
    set.add(value);
  }
  return Object.fromEntries(
    [...sets]
      .sort(([a], [b]) => a - b)
      .map(([district, values]) => [String(district), [...values].sort((a, b) => a - b)]),
  );
}

const current = (await import(resolve(target))) as {
  CA_DISTRICTS_2026: { sdCounties: Record<string, string[]>; adCounties: Record<string, string[]> };
};
const data = {
  cd: reach(plans.cd, (block) => plans.ad.get(block)),
  boe: reach(plans.boe, (block) => plans.ad.get(block)),
  sdCounties: current.CA_DISTRICTS_2026.sdCounties,
  adCounties: current.CA_DISTRICTS_2026.adCounties,
};

const table = (record: Record<string, unknown[]>) =>
  `{\n${Object.entries(record)
    .map(([k, v]) => `    "${k}": ${JSON.stringify(v).replace(/,/g, ", ")},`)
    .join("\n")}\n  }`;

const out = `/**
 * California district overlaps for the November 3, 2026 ballot order
 * (\`ballotOrder.ts\`). Generated by
 * \`scripts/ca-district-overlaps/block-equivalency.ts\`; don't edit.
 *
 * \`cd\`, \`boe\`: from the official census-block equivalency files (Prop 50's
 * congressional plan, AB 604; the Citizens Redistricting Commission's 2021
 * Assembly and Board of Equalization plans). Two districts overlap when they
 * share a 2020 Census block, whether or not anyone lives in it: names rotate
 * through every Assembly district a race is voted in, by map territory.
 *
 * \`sdCounties\`, \`adCounties\`: from Census TIGERweb geometry, a county counting
 * when at least one 2020 Census resident lives in its part of the district
 * (steps 1-3 of the script directory). A county with no voters in a district
 * prints no ballot for it.
 */
export interface DistrictOverlaps {
  /** Congressional district → the Assembly districts it reaches, lowest first. */
  cd: Record<string, number[]>;
  /** Board of Equalization district → Assembly districts, lowest first. */
  boe: Record<string, number[]>;
  /** State Senate district → the counties it reaches. */
  sdCounties: Record<string, string[]>;
  /** Assembly district → the counties it reaches. */
  adCounties: Record<string, string[]>;
}

export const CA_DISTRICTS_2026: DistrictOverlaps = {
  cd: ${table(data.cd)},
  boe: ${table(data.boe)},
  sdCounties: ${table(data.sdCounties)},
  adCounties: ${table(data.adCounties)},
};
`;
writeFileSync(resolve(target), out);
console.error(`wrote ${target}`);
