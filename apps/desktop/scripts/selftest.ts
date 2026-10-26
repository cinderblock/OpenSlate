/**
 * Runs the self-test (src/bun/selftest.ts) on this machine: launches a dev
 * build of the app twice, each time letting it check itself and quit, then
 * checks both reports (scripts/check-selftest.ts). Stage the web app first
 * (`bun scripts/build.ts [--flavor offline]`). On Linux without a display,
 * run it under `xvfb-run -a`.
 *
 *   bun run selftest [--flavor offline]
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--flavor");
const flavor = (i >= 0 ? args[i + 1] : undefined) ?? process.env.OPENSLATE_FLAVOR ?? "standard";
const out = mkdtempSync(join(tmpdir(), "openslate-selftest-"));

const reports = [1, 2].map((run) => {
  const report = join(out, `run-${run}.json`);
  console.log(`self-test run ${run} (${flavor}) → ${report}`);
  const result = Bun.spawnSync(["bun", "x", "electrobun", "dev"], {
    cwd: desktop,
    env: { ...process.env, OPENSLATE_FLAVOR: flavor, OPENSLATE_SELFTEST: report },
    stdio: ["inherit", "inherit", "inherit"],
    timeout: 5 * 60_000,
  });
  if (result.exitCode !== 0) {
    console.error(`the app exited with ${result.exitCode}`);
    process.exit(1);
  }
  return report;
});

const check = Bun.spawnSync(
  [
    "bun",
    join(desktop, "scripts", "check-selftest.ts"),
    ...reports,
    ...(flavor === "offline" ? ["--offline"] : []),
  ],
  { stdio: ["inherit", "inherit", "inherit"] },
);
process.exit(check.exitCode ?? 1);
