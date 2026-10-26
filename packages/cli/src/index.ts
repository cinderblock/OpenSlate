#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type Adoption,
  type Article,
  type Attribution,
  type GuideManifest,
  type Position,
  type Reference,
  type SlatePayload,
  type StoredIdentity,
  type Subject,
  buildSlate,
  createIdentity,
  decodeToken,
  deserializeIdentity,
  guideItemFiles,
  guideItemSchema,
  guideManifestSchema,
  identityToIssuer,
  parseSlate,
  racesByJurisdiction,
  resolveAdoptions,
  serializeIdentity,
  sha256,
  signGuide,
  signSlate,
  slateEntity,
  slatePayloadSchema,
  subjectIdentity,
  verifyGuide,
  verifySlate,
} from "@openslate/core";

const USAGE = `openslate — generate, sign, verify, and inspect endorsements

Usage:
  openslate keygen [--name N] [--kind K] [--uri U] [-o file.json]
  openslate pubkey <identity.json>
  openslate sign <positions.json|-> --key <identity.json> [--election E] [--jurisdiction J] [-o out.txt]
  openslate sign --batch <dir> --key <identity.json> [--force]
  openslate validate <payload.json|->
  openslate verify <token|file|url|-> [--resolve]
  openslate inspect <token|file|->
  openslate adopt <token|file|url> --mode copy|reference|embed [--uri U] [--subjects file.json]
                  [--match TEXT] [--source U] [--into positions.json]
  openslate guide check <dir>
  openslate guide sign <dir> --key <identity.json> [-o guide.jws]
  openslate guide verify <file|url> [--expect KEY] [--files]

A <positions.json> is either a JSON array of Position objects, or an object
{ "positions": [...], "endorsed_by": [...], "attribution": {...}, "adopts": [...],
  "articles": [...], "context": {...} }.
Use "-" for stdin.

adopt takes on another slate's positions, three ways (SPEC §3.10):
  copy       append the positions themselves to "positions"
  reference  add an "adopts" entry pointing at the slate's uri (a live link)
  embed      add an "adopts" entry that embeds the token (a snapshot), plus
             the uri when one is known
--subjects is a JSON array of Subjects to take (default: all); --match keeps
subjects whose title contains TEXT (repeatable as a comma list). --source is
where the adopting entity published the adoption. Without --into, the result
is printed. verify --resolve fetches each adoption's uri and reports what it
resolves to.

When publishing a SECONDHAND report of another entity's public stance,
include "attribution" and sign with a researcher key (kind: "researcher").
See SPEC §3.9 and §7.1.

sign --batch walks <dir>/orgs/<slug>/<election>/positions.json, writes
signed.slate next to each, and emits <dir>/index.json. Bundles whose
signed.slate already exists are skipped unless --force.

validate is a schema-only check (no crypto) of a complete SlatePayload JSON
file — useful for CI on hand-authored research data before signing.

guide publishes an election authority's voter guide (candidate statements and
photos, a measure's summary, analysis, arguments and full text) as reference
material, not positions. <dir> holds guide.json ({ "context", "attribution" }),
items/*.json (one GuideItem per race or measure) and the files they point at.
check validates every item and that each file it names exists. sign also
hashes every file under <dir> into a manifest and signs it (default output
<dir>/guide.jws). verify checks a signed manifest; --files fetches or reads
every file it lists and checks its hash.

Keys are Ed25519, encoded "ed25519:<base58>". keygen output contains the SECRET
key — keep it safe.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function strFlag(flags: Record<string, string | boolean>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = flags[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function parseFlags(rest: string[]): {
  flags: Record<string, string | boolean>;
  positional: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    let key: string | undefined;
    if (arg.startsWith("--")) key = arg.slice(2);
    else if (arg.startsWith("-") && arg.length === 2) key = arg.slice(1);

    if (key !== undefined) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function readText(pathOrDash: string): Promise<string> {
  if (pathOrDash === "-") return await Bun.stdin.text();
  return await Bun.file(pathOrDash).text();
}

async function resolveToken(arg: string): Promise<string> {
  if (arg === "-") return (await Bun.stdin.text()).trim();
  if (/^https?:\/\//.test(arg)) return await fetchToken(arg);
  const file = Bun.file(arg);
  if (await file.exists()) return (await file.text()).trim();
  return arg.trim();
}

async function fetchToken(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) fail(`could not fetch ${url}: HTTP ${response.status}`);
  return (await response.text()).trim();
}

/** The parts of a positions.json input `sign` understands. */
interface SignInput {
  positions?: Position[];
  endorsed_by?: Reference[];
  attribution?: Attribution;
  adopts?: Adoption[];
  articles?: Article[];
  context?: SlatePayload["context"];
}

async function cmdKeygen(rest: string[]): Promise<void> {
  const { flags } = parseFlags(rest);
  const identity = createIdentity({
    name: strFlag(flags, "name"),
    kind: strFlag(flags, "kind"),
    uri: strFlag(flags, "uri"),
  });
  const stored = serializeIdentity(identity);
  const outPath = strFlag(flags, "o", "out");
  if (outPath) {
    await Bun.write(outPath, `${JSON.stringify(stored, null, 2)}\n`);
    console.error(`Wrote identity to ${outPath} (contains SECRET key — keep it safe).`);
    console.log(stored.publicKey);
  } else {
    console.error("This JSON contains your SECRET key. Save it somewhere safe.");
    console.log(JSON.stringify(stored, null, 2));
  }
}

async function cmdPubkey(rest: string[]): Promise<void> {
  const { positional } = parseFlags(rest);
  const path = positional[0];
  if (!path) fail("usage: openslate pubkey <identity.json>");
  const stored = JSON.parse(await readText(path)) as StoredIdentity;
  console.log(stored.publicKey ?? identityToIssuer(deserializeIdentity(stored)).key);
}

async function cmdSign(rest: string[]): Promise<void> {
  const { flags, positional } = parseFlags(rest);
  const batchDir = strFlag(flags, "batch");
  if (batchDir !== undefined) {
    await cmdSignBatch(batchDir, flags);
    return;
  }
  const keyPath = strFlag(flags, "key");
  if (!keyPath) fail("sign requires --key <identity.json>");

  const stored = JSON.parse(await readText(keyPath)) as StoredIdentity;
  const identity = deserializeIdentity(stored);
  const issuer = identityToIssuer(identity);

  const raw = JSON.parse(await readText(positional[0] ?? "-")) as unknown;
  let positions: Position[] = [];
  let endorsedBy: Reference[] | undefined;
  let attribution: Attribution | undefined;
  let adopts: Adoption[] | undefined;
  let articles: Article[] | undefined;
  let context: SlatePayload["context"];
  if (Array.isArray(raw)) {
    positions = raw as Position[];
  } else if (raw && typeof raw === "object") {
    const obj = raw as SignInput;
    positions = obj.positions ?? [];
    endorsedBy = obj.endorsed_by;
    attribution = obj.attribution;
    adopts = obj.adopts;
    articles = obj.articles;
    context = obj.context;
  }

  const election = strFlag(flags, "election");
  const jurisdiction = strFlag(flags, "jurisdiction");
  if (election || jurisdiction) {
    context = {
      ...context,
      ...(election ? { election } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
    };
  }

  let token: string;
  try {
    const payload = buildSlate({
      issuer,
      positions,
      endorsedBy,
      attribution,
      adopts,
      articles,
      context,
    });
    token = signSlate(payload, identity.keyPair.secretKey);
  } catch (err) {
    fail(`could not build slate: ${err instanceof Error ? err.message : String(err)}`);
  }

  const outPath = strFlag(flags, "o", "out");
  if (outPath) {
    await Bun.write(outPath, `${token}\n`);
    console.error(`Wrote token to ${outPath}`);
  } else {
    console.log(token);
  }
}

interface IndexEntry {
  slug: string;
  election: string;
  path: string;
  issuer: { key: string; name?: string; kind?: string };
  attribution?: SlatePayload["attribution"];
  positions: number;
  /** Links attached to ballot items (SPEC §3.15), when there are any. */
  articles?: number;
  /** The slate's `context.jurisdiction`: where it publishes for. */
  scope?: string;
  /**
   * Races per position jurisdiction (core's `racesByJurisdiction`), so an app
   * can match the slate to a voter's area without downloading it.
   */
  jurisdictions: Record<string, number>;
  /** Adoptions by reference (SPEC §3.10): which entities' positions this slate takes on. */
  adopts?: { issuer: string; of?: string; election?: string; uri?: string; subjects?: number }[];
  issued_at: string;
}

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

async function cmdSignBatch(
  batchDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const keyPath = strFlag(flags, "key");
  if (!keyPath) fail("sign --batch requires --key <identity.json>");
  const force = flags.force === true;

  const orgsDir = join(batchDir, "orgs");
  if (!existsSync(orgsDir)) fail(`no orgs/ directory under ${batchDir}`);

  const stored = JSON.parse(await readText(keyPath)) as StoredIdentity;
  const identity = deserializeIdentity(stored);
  const issuer = identityToIssuer(identity);

  let signed = 0;
  let skipped = 0;
  for (const slug of listSubdirs(orgsDir)) {
    for (const election of listSubdirs(join(orgsDir, slug))) {
      const bundleDir = join(orgsDir, slug, election);
      const inputPath = join(bundleDir, "positions.json");
      const outputPath = join(bundleDir, "signed.slate");
      if (!existsSync(inputPath)) continue;
      if (existsSync(outputPath) && !force) {
        console.error(`skip   ${slug}/${election} (signed.slate exists; --force to re-sign)`);
        skipped++;
        continue;
      }

      const raw = JSON.parse(await Bun.file(inputPath).text()) as SignInput;
      try {
        const payload = buildSlate({
          issuer,
          positions: raw.positions ?? [],
          endorsedBy: raw.endorsed_by,
          attribution: raw.attribution,
          adopts: raw.adopts,
          context: raw.context,
        });
        const token = signSlate(payload, identity.keyPair.secretKey);
        await Bun.write(outputPath, `${token}\n`);
        console.error(`sign   ${slug}/${election}`);
        signed++;
      } catch (err) {
        console.error(
          `FAIL   ${slug}/${election}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    }
  }

  const entries: IndexEntry[] = [];
  for (const slug of listSubdirs(orgsDir)) {
    for (const election of listSubdirs(join(orgsDir, slug))) {
      const bundleDir = join(orgsDir, slug, election);
      const slatePath = join(bundleDir, "signed.slate");
      if (!existsSync(slatePath)) continue;
      try {
        const token = (await Bun.file(slatePath).text()).trim();
        const { payload } = parseSlate(token);
        entries.push({
          slug,
          election,
          path: `orgs/${slug}/${election}/signed.slate`,
          issuer: {
            key: payload.issuer.key,
            ...(payload.issuer.name ? { name: payload.issuer.name } : {}),
            ...(payload.issuer.kind ? { kind: payload.issuer.kind } : {}),
          },
          ...(payload.attribution ? { attribution: payload.attribution } : {}),
          positions: payload.positions.length,
          ...(payload.articles?.length ? { articles: payload.articles.length } : {}),
          ...(payload.context?.jurisdiction ? { scope: payload.context.jurisdiction } : {}),
          jurisdictions: racesByJurisdiction(payload),
          ...(payload.adopts?.length
            ? {
                adopts: payload.adopts.map((a) => ({
                  issuer: a.issuer,
                  ...(a.of ? { of: a.of } : {}),
                  ...(a.election ? { election: a.election } : {}),
                  ...(a.uri ? { uri: a.uri } : {}),
                  ...(a.subjects ? { subjects: a.subjects.length } : {}),
                })),
              }
            : {}),
          issued_at: payload.issued_at,
        });
      } catch (err) {
        console.error(
          `WARN   could not parse ${slug}/${election}/signed.slate: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    entries: entries.sort(
      (a, b) => a.slug.localeCompare(b.slug) || a.election.localeCompare(b.election),
    ),
  };
  const indexPath = join(batchDir, "index.json");
  await Bun.write(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  console.error(
    `\nbatch: ${signed} signed, ${skipped} skipped, ${entries.length} entries in index.json`,
  );
  console.error(`wrote ${indexPath}`);
}

async function cmdValidate(rest: string[]): Promise<void> {
  const { positional } = parseFlags(rest);
  const text = await readText(positional[0] ?? "-");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    fail(`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = slatePayloadSchema.safeParse(parsed);
  if (result.success) {
    console.log("VALID");
    console.log(`positions: ${result.data.positions.length}`);
    if (result.data.articles?.length) console.log(`articles: ${result.data.articles.length}`);
    if (result.data.endorsed_by?.length) {
      console.log(`endorsed_by: ${result.data.endorsed_by.length}`);
    }
    if (result.data.adopts?.length) console.log(`adopts:    ${result.data.adopts.length}`);
  } else {
    console.log("INVALID");
    for (const issue of result.error.issues) {
      console.log(`error:     ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
}

function describeAdoption(adoption: Adoption): string {
  const who = adoption.of ? `${adoption.of} (signed by ${adoption.issuer})` : adoption.issuer;
  const what = adoption.subjects ? `${adoption.subjects.length} subject(s)` : "all positions";
  const where = [adoption.slate ? "embedded snapshot" : "", adoption.uri ?? ""]
    .filter(Boolean)
    .join(" + ");
  return `${what} from ${who}${adoption.election ? ` for ${adoption.election}` : ""} [${where}]`;
}

async function printAdoptions(payload: SlatePayload, resolve: boolean): Promise<void> {
  const adopts = payload.adopts ?? [];
  if (adopts.length === 0) return;
  console.log(`adopts:    ${adopts.length}`);
  for (const adoption of adopts) console.log(`  - ${describeAdoption(adoption)}`);
  // Embedded snapshots resolve offline; --resolve also fetches each uri once.
  const fetched = new Map<string, string>();
  if (resolve) {
    for (const adoption of adopts) {
      if (!adoption.uri || fetched.has(adoption.uri)) continue;
      try {
        const response = await fetch(adoption.uri);
        if (response.ok) fetched.set(adoption.uri, (await response.text()).trim());
        else console.log(`warning:   ${adoption.uri}: HTTP ${response.status}`);
      } catch (err) {
        console.log(`warning:   ${adoption.uri}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  const resolved = resolveAdoptions(payload, (a) => {
    const token = a.uri ? fetched.get(a.uri) : undefined;
    return token ? [token] : [];
  });
  const byVia = new Map<string, number>();
  for (const { via } of resolved.positions) {
    const name = via.map((hop) => hop.entity.name ?? hop.entity.issuerKey).join(" → ");
    byVia.set(name, (byVia.get(name) ?? 0) + 1);
  }
  for (const [name, count] of byVia) console.log(`adopted:   ${count} position(s) via ${name}`);
  for (const { adoption, depth } of resolved.unresolved) {
    const hint = resolve || adoption.slate ? "" : " (use --resolve to fetch)";
    console.log(`unresolved: depth ${depth}: ${describeAdoption(adoption)}${hint}`);
  }
}

async function cmdVerify(rest: string[]): Promise<void> {
  const { flags, positional } = parseFlags(rest);
  const token = await resolveToken(positional[0] ?? "-");
  const result = verifySlate(token);
  if (result.valid) {
    console.log("VALID");
    console.log(`issuer:    ${result.issuerKey}`);
    if (result.payload?.issuer.name)
      console.log(`name:      ${result.payload.issuer.name} (self-asserted)`);
    const attr = result.payload?.attribution;
    if (attr) {
      console.log("SECONDHAND REPORT — not signed by the named entity:");
      console.log(`  reported entity: ${attr.of.name}`);
      console.log(`  mode:            ${attr.mode}`);
      console.log(`  retrieved_at:    ${attr.retrieved_at}`);
    }
    console.log(`positions: ${result.payload?.positions.length ?? 0}`);
    if (result.payload?.articles?.length) {
      console.log(`articles:  ${result.payload.articles.length}`);
    }
    if (result.payload) await printAdoptions(result.payload, flags.resolve === true);
    for (const warning of result.warnings) console.log(`warning:   ${warning}`);
  } else {
    console.log("INVALID");
    for (const error of result.errors) console.log(`error:     ${error}`);
    for (const warning of result.warnings) console.log(`warning:   ${warning}`);
    process.exit(1);
  }
}

async function cmdInspect(rest: string[]): Promise<void> {
  const { positional } = parseFlags(rest);
  const token = await resolveToken(positional[0] ?? "-");
  try {
    const { header, payload } = decodeToken(token);
    console.log(JSON.stringify({ header, payload }, null, 2));
  } catch (err) {
    fail(`could not decode token: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const ADOPT_MODES = ["copy", "reference", "embed"] as const;
type AdoptMode = (typeof ADOPT_MODES)[number];

async function cmdAdopt(rest: string[]): Promise<void> {
  const { flags, positional } = parseFlags(rest);
  const target = positional[0];
  const mode = strFlag(flags, "mode") as AdoptMode | undefined;
  if (!target || !mode || !ADOPT_MODES.includes(mode)) {
    fail(
      "usage: openslate adopt <token|file|url> --mode copy|reference|embed [--uri U] " +
        "[--subjects file.json] [--match TEXT] [--source U] [--into positions.json]",
    );
  }
  const token = await resolveToken(target);
  const verified = verifySlate(token);
  if (!verified.valid || !verified.payload) {
    fail(`the slate to adopt does not verify:\n  ${verified.errors.join("\n  ")}`);
  }
  const adopted = verified.payload;
  const uri = strFlag(flags, "uri") ?? (/^https?:\/\//.test(target) ? target : undefined);
  if (mode === "reference" && !uri) fail("--mode reference needs a uri: pass --uri or a URL");

  // Which positions: an explicit subject list and/or title substrings, else all of them.
  let positions = adopted.positions;
  const subjectsPath = strFlag(flags, "subjects");
  if (subjectsPath) {
    const wanted = new Set(
      (JSON.parse(await readText(subjectsPath)) as Subject[]).map(subjectIdentity),
    );
    positions = positions.filter((p) => wanted.has(subjectIdentity(p.subject)));
  }
  const match = strFlag(flags, "match");
  if (match) {
    const needles = match.split(",").map((s) => s.trim().toLowerCase());
    positions = positions.filter((p) =>
      needles.some((n) => p.subject.title.toLowerCase().includes(n)),
    );
  }
  if (positions.length === 0) fail("no positions selected");
  const selectedAll = positions.length === adopted.positions.length;
  const source = strFlag(flags, "source");

  const into = strFlag(flags, "into");
  const input: SignInput =
    into && (await Bun.file(into).exists())
      ? (JSON.parse(await Bun.file(into).text()) as SignInput)
      : {};
  const entity = slateEntity(adopted);
  if (mode === "copy") {
    input.positions = [...(input.positions ?? []), ...positions];
  } else {
    const subjects = [
      ...new Map(positions.map((p) => [subjectIdentity(p.subject), p.subject])).values(),
    ];
    const adoption: Adoption = {
      issuer: adopted.issuer.key,
      ...(entity.secondhand && entity.name ? { of: entity.name } : {}),
      ...(adopted.context?.election ? { election: adopted.context.election } : {}),
      ...(uri ? { uri } : {}),
      ...(mode === "embed" ? { slate: token } : {}),
      ...(selectedAll ? {} : { subjects }),
      ...(source ? { source } : {}),
    };
    input.adopts = [...(input.adopts ?? []), adoption];
  }

  const check = slatePayloadSchema.safeParse({
    v: 1,
    issuer: { key: "ed25519:check" },
    issued_at: new Date().toISOString(),
    positions: input.positions ?? [],
    ...(input.adopts ? { adopts: input.adopts } : {}),
  });
  if (!check.success) fail(`result does not validate: ${check.error.issues[0]?.message}`);

  const text = `${JSON.stringify(into ? input : mode === "copy" ? positions : input.adopts?.at(-1), null, 2)}\n`;
  const label = entity.name ?? entity.issuerKey;
  if (into) {
    await Bun.write(into, text);
    console.error(`${mode}: ${positions.length} position(s) from ${label} → ${into}`);
  } else {
    process.stdout.write(text);
  }
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const GUIDE_META = "guide.json";
const GUIDE_OUT = "guide.jws";

/** Validate a guide directory; returns the manifest minus issuer and signature details. */
async function buildGuide(dir: string): Promise<Omit<GuideManifest, "issuer" | "issued_at">> {
  const metaPath = join(dir, GUIDE_META);
  if (!existsSync(metaPath)) fail(`${metaPath} not found`);
  const meta = JSON.parse(await Bun.file(metaPath).text()) as Pick<
    GuideManifest,
    "context" | "attribution"
  >;

  const paths = walkFiles(dir).filter((p) => p !== GUIDE_META && p !== GUIDE_OUT);
  const present = new Set(paths);
  const problems: string[] = [];
  const items: GuideManifest["items"] = [];
  for (const path of paths.filter((p) => p.startsWith("items/") && p.endsWith(".json"))) {
    const parsed = guideItemSchema.safeParse(JSON.parse(await Bun.file(join(dir, path)).text()));
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        problems.push(`${path} ${issue.path.join(".")}: ${issue.message}`);
      continue;
    }
    for (const file of guideItemFiles(parsed.data)) {
      if (!present.has(file)) problems.push(`${path}: names ${file}, which is missing`);
    }
    items.push({ subject: parsed.data.subject, file: path });
  }
  if (problems.length > 0) fail(`guide ${dir} has problems:\n  ${problems.join("\n  ")}`);

  const files: Record<string, string> = {};
  for (const path of paths)
    files[path] = await sha256(new Uint8Array(await Bun.file(join(dir, path)).arrayBuffer()));
  return { v: 1, ...meta, items, files };
}

async function cmdGuide(rest: string[]): Promise<void> {
  const [sub, ...args] = rest;
  const { flags, positional } = parseFlags(args);
  const target = positional[0];
  if (!target) fail(`usage: openslate guide check|sign|verify ...\n\n${USAGE}`);

  if (sub === "check") {
    const guide = await buildGuide(target);
    console.error(`ok: ${guide.items.length} item(s), ${Object.keys(guide.files).length} file(s)`);
    return;
  }

  if (sub === "sign") {
    const keyPath = strFlag(flags, "key");
    if (!keyPath) fail("guide sign needs --key <identity.json>");
    const identity = deserializeIdentity(JSON.parse(await readText(keyPath)) as StoredIdentity);
    const guide = await buildGuide(target);
    const manifest = guideManifestSchema.parse({
      ...guide,
      issuer: identityToIssuer(identity),
      issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    const token = signGuide(manifest, identity.keyPair.secretKey);
    const check = verifyGuide(token);
    if (!check.valid) fail(`signed guide does not verify: ${check.errors.join("; ")}`);
    const out = strFlag(flags, "o", "out") ?? join(target, GUIDE_OUT);
    await Bun.write(out, `${token}\n`);
    console.error(
      `signed ${manifest.items.length} item(s), ${Object.keys(manifest.files).length} file(s) → ${out}`,
    );
    console.log(manifest.issuer.key);
    return;
  }

  if (sub === "verify") {
    const isUrl = /^https?:\/\//.test(target);
    const token = await resolveToken(target);
    const result = verifyGuide(token, { expectedKey: strFlag(flags, "expect") });
    if (!result.valid || !result.manifest) fail(`INVALID guide:\n  ${result.errors.join("\n  ")}`);
    const manifest = result.manifest;
    console.error(
      `valid guide by ${manifest.issuer.name ?? manifest.issuer.key} (${manifest.issuer.key}), ${manifest.items.length} item(s)`,
    );
    if (flags.files) {
      const bad: string[] = [];
      for (const [path, expected] of Object.entries(manifest.files)) {
        let bytes: Uint8Array;
        if (isUrl) {
          const response = await fetch(new URL(path, target));
          if (!response.ok) {
            bad.push(`${path}: HTTP ${response.status}`);
            continue;
          }
          bytes = new Uint8Array(await response.arrayBuffer());
        } else {
          bytes = new Uint8Array(await Bun.file(join(target, "..", path)).arrayBuffer());
        }
        if ((await sha256(bytes)) !== expected) bad.push(`${path}: hash mismatch`);
      }
      if (bad.length > 0) fail(`files that don't match the manifest:\n  ${bad.join("\n  ")}`);
      console.error(`all ${Object.keys(manifest.files).length} file(s) match`);
    }
    return;
  }

  fail(`unknown guide command: ${sub}\n\n${USAGE}`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "keygen":
    await cmdKeygen(rest);
    break;
  case "pubkey":
    await cmdPubkey(rest);
    break;
  case "sign":
    await cmdSign(rest);
    break;
  case "validate":
    await cmdValidate(rest);
    break;
  case "verify":
    await cmdVerify(rest);
    break;
  case "inspect":
    await cmdInspect(rest);
    break;
  case "adopt":
    await cmdAdopt(rest);
    break;
  case "guide":
    await cmdGuide(rest);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(USAGE);
    break;
  default:
    fail(`unknown command: ${command}\n\n${USAGE}`);
}
