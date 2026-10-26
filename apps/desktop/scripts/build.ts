/**
 * Builds the desktop app: stages the web app (built for the desktop) in web/,
 * adds the catalog snapshot for the offline edition, then runs Electrobun.
 *
 *   bun run build                      the standard edition → artifacts/
 *   bun run build --flavor offline     the offline edition (catalog built in)
 *   bun run dev [--flavor offline]     build and launch a dev copy
 *
 *   --snapshot <dir>    use a snapshot already taken (apps/web's
 *                       `bun run snapshot`) instead of taking one now; CI takes
 *                       one and shares it, so every platform carries the same
 *   --skip-web          reuse what's already staged in web/
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const web = join(desktop, "..", "web");
const staged = join(desktop, "web");

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const flavor = option("--flavor") ?? process.env.OPENSLATE_FLAVOR ?? "standard";
if (flavor !== "standard" && flavor !== "offline") {
  throw new Error(`--flavor must be standard or offline, not ${flavor}`);
}
const dev = args.includes("--dev");
const snapshot = option("--snapshot");

function run(command: string[], cwd: string, env: Record<string, string> = {}): void {
  console.log(`$ ${command.join(" ")}`);
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

if (!args.includes("--skip-web")) {
  rmSync(staged, { recursive: true, force: true });
  // The offline edition reads the catalog from the copy beside index.html.
  const catalogEnv: Record<string, string> =
    flavor === "offline" ? { VITE_PUBLIC_ENDORSEMENTS_CATALOG: "catalog/index.json" } : {};
  run(
    ["bun", "x", "vite", "build", "--mode", "desktop", "--outDir", staged, "--emptyOutDir"],
    web,
    catalogEnv,
  );
  if (flavor === "offline") {
    const catalog = join(staged, "catalog");
    if (snapshot) {
      const from = resolve(snapshot);
      if (!existsSync(join(from, "index.json"))) throw new Error(`${from} has no index.json`);
      cpSync(from, catalog, { recursive: true });
    } else {
      run(["bun", "run", "scripts/snapshot-catalog.ts", "--out", catalog], web);
    }
  }
}

run(["bun", "x", "electrobun", dev ? "dev" : "build", ...(dev ? [] : ["--env=stable"])], desktop, {
  OPENSLATE_FLAVOR: flavor,
});
