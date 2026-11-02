#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  type Adoption,
  ballotListing,
  buildSlate,
  createIdentity,
  decodeToken,
  deserializeIdentity,
  GUIDE_REFERENCES_FILE,
  type GuideManifest,
  guideItemFiles,
  guideItemSchema,
  guideManifestSchema,
  guideReferences,
  identityToIssuer,
  isBallotListing,
  isStatewideGuide,
  type ListedRace,
  parseSlate,
  racesByJurisdiction,
  regionsOf,
  resolveAdoptions,
  resolveChoice,
  type SignInput,
  type SlatePayload,
  type StoredIdentity,
  type Subject,
  serializeIdentity,
  sha256,
  signGuide,
  signInputSchema,
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
  openslate validate <positions.json|payload.json|->
  openslate races [--election E] [--where TEXT] [--catalog URL] [-o races.jsonl]
  openslate check <positions.json|-> [--catalog URL]
  openslate verify <token|file|url|-> [--resolve]
  openslate inspect <token|file|->
  openslate adopt <token|file|url> --mode copy|reference|embed [--uri U] [--subjects file.json]
                  [--match TEXT] [--source U] [--into positions.json]
  openslate guide check <dir>
  openslate guide sign <dir> --key <identity.json> [-o guide.jws]
  openslate guide verify <file|url> [--expect KEY] [--files]

A <positions.json> is either a JSON array of Position objects, or an object
{ "positions": [...], "endorsed_by": [...], "attribution": {...}, "adopts": [...],
  "articles": [...], "labels": [...], "context": {...} }.
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

validate is a schema-only check (no crypto) of a <positions.json> (what sign
takes) or of a complete SlatePayload (one with "v", "issuer" and "issued_at"),
useful on hand-authored research data before signing. Both are closed: a key
the schema doesn't know is an error, not silently dropped.

races prints the official ballot, one JSON race per line: the exact subject to
copy into a position, and the choices as the ballot spells them. A race only
lines up with the ballot when its title, jurisdiction and election match
exactly. --election defaults to the next election the catalog lists; --where
keeps races whose title or jurisdiction contains TEXT (a comma list means any).
check then lines a <positions.json> up against that ballot, reports every race
and name it can't place with the closest match, and exits non-zero if there
are any. Both read the ballot listings of the public catalog (--catalog for
another one) and skip any that fail verification.

guide publishes an election authority's voter guide (candidate statements and
photos, a measure's summary, analysis, arguments and full text) as reference
material, not positions. <dir> holds guide.json ({ "context", "attribution" }),
items/*.json (one GuideItem per race or measure) and the files they point at.
check validates every item and that each file it names exists. sign writes
references.json, what the items mention of each other, and also
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

async function readStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Write a file, making its directory if need be. */
async function writeText(path: string, text: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function readText(pathOrDash: string): Promise<string> {
  if (pathOrDash === "-") return await readStdin();
  return readFileSync(pathOrDash, "utf8");
}

async function resolveToken(arg: string): Promise<string> {
  if (arg === "-") return (await readStdin()).trim();
  if (/^https?:\/\//.test(arg)) return await fetchToken(arg);
  if (existsSync(arg) && statSync(arg).isFile()) return readFileSync(arg, "utf8").trim();
  return arg.trim();
}

async function fetchToken(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) fail(`could not fetch ${url}: HTTP ${response.status}`);
  return (await response.text()).trim();
}

function describeIssues(error: { issues: { path: (string | number)[]; message: string }[] }) {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/** Parse a positions.json, the input `sign` takes (core's `signInputSchema`), or say why not. */
function parseSignInput(text: string): { input: SignInput } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      errors: [`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const result = signInputSchema.safeParse(raw);
  return result.success ? { input: result.data } : { errors: describeIssues(result.error) };
}

function slateFromInput(issuer: SlatePayload["issuer"], input: SignInput): SlatePayload {
  return buildSlate({
    issuer,
    positions: input.positions,
    endorsedBy: input.endorsed_by,
    attribution: input.attribution,
    adopts: input.adopts,
    articles: input.articles,
    labels: input.labels,
    context: input.context,
  });
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
    await writeText(outPath, `${JSON.stringify(stored, null, 2)}\n`);
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

  const parsed = parseSignInput(await readText(positional[0] ?? "-"));
  if ("errors" in parsed) fail(`could not build slate:\n  ${parsed.errors.join("\n  ")}`);
  const input = parsed.input;

  const election = strFlag(flags, "election");
  const jurisdiction = strFlag(flags, "jurisdiction");
  if (election || jurisdiction) {
    input.context = {
      ...input.context,
      ...(election ? { election } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
    };
  }

  let token: string;
  try {
    token = signSlate(slateFromInput(issuer, input), identity.keyPair.secretKey);
  } catch (err) {
    fail(`could not build slate: ${err instanceof Error ? err.message : String(err)}`);
  }

  const outPath = strFlag(flags, "o", "out");
  if (outPath) {
    await writeText(outPath, `${token}\n`);
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
   * Races per jurisdiction, positions and articles alike (core's `racesByJurisdiction`), so an app
   * can match the slate to a voter's area without downloading it.
   */
  jurisdictions: Record<string, number>;
  /**
   * Each region the slate's contests are filed under, with where they're voted (core's
   * `regionsOf`), so an app can tell whether an outlet based in a region is local to a voter.
   */
  regions?: Record<string, string[]>;
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

      const parsed = parseSignInput(readFileSync(inputPath, "utf8"));
      if ("errors" in parsed) {
        console.error(`FAIL   ${slug}/${election}:\n  ${parsed.errors.join("\n  ")}`);
        process.exit(1);
      }
      try {
        const token = signSlate(slateFromInput(issuer, parsed.input), identity.keyPair.secretKey);
        await writeText(outputPath, `${token}\n`);
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
        const token = readFileSync(slatePath, "utf8").trim();
        const { payload } = parseSlate(token);
        const regions = regionsOf(payload);
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
          ...(Object.keys(regions).length ? { regions } : {}),
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
  await writeText(indexPath, `${JSON.stringify(index, null, 2)}\n`);

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
  // A payload carries the parts the signer fills in, none of which sign input may have; anything
  // else is checked as sign input, so a bundle validates by the rules `sign` applies to it.
  const isPayload =
    !!parsed &&
    typeof parsed === "object" &&
    ["v", "issuer", "issued_at"].some((key) => key in parsed);
  const result = isPayload
    ? slatePayloadSchema.safeParse(parsed)
    : signInputSchema.safeParse(parsed);
  console.log(`kind:      ${isPayload ? "SlatePayload" : "sign input"}`);
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
    for (const issue of describeIssues(result.error)) console.log(`error:     ${issue}`);
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
      if (attr.capture) console.log(`  capture run:     ${attr.capture.run}`);
    }
    console.log(`positions: ${result.payload?.positions.length ?? 0}`);
    if (result.payload?.labels?.length) {
      console.log(`labels:    ${result.payload.labels.map((l) => l.label).join(", ")}`);
    }
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
  let input: SignInput = { positions: [] };
  if (into && existsSync(into)) {
    const parsed = parseSignInput(readFileSync(into, "utf8"));
    if ("errors" in parsed)
      fail(`${into} is not valid sign input:\n  ${parsed.errors.join("\n  ")}`);
    input = parsed.input;
  }
  const entity = slateEntity(adopted);
  if (mode === "copy") {
    input.positions = [...input.positions, ...positions];
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

  const check = signInputSchema.safeParse(input);
  if (!check.success) fail(`result does not validate: ${describeIssues(check.error)[0]}`);

  const text = `${JSON.stringify(into ? input : mode === "copy" ? positions : input.adopts?.at(-1), null, 2)}\n`;
  const label = entity.name ?? entity.issuerKey;
  if (into) {
    await writeText(into, text);
    console.error(`${mode}: ${positions.length} position(s) from ${label} → ${into}`);
  } else {
    process.stdout.write(text);
  }
}

/** The catalog `races` and `check` read unless told otherwise. */
const PUBLIC_CATALOG = "https://cinderblock.github.io/openslate-public-endorsements/index.json";

interface CatalogEntry {
  election: string;
  path: string;
  attribution?: { of?: { kind?: string } };
}

/** The verified ballot listings a catalog holds, with the elections it lists them for. */
async function catalogListings(catalogUrl: string): Promise<SlatePayload[]> {
  const response = await fetch(catalogUrl);
  if (!response.ok) fail(`could not fetch ${catalogUrl}: HTTP ${response.status}`);
  const { entries } = (await response.json()) as { entries: CatalogEntry[] };
  const listed = entries.filter((entry) => isBallotListing(entry));
  const tokens = await Promise.all(
    listed.map((entry) => fetchToken(new URL(entry.path, catalogUrl).href)),
  );
  const payloads: SlatePayload[] = [];
  tokens.forEach((token, i) => {
    const result = verifySlate(token);
    if (result.valid && result.payload) payloads.push(result.payload);
    else console.error(`skipping ${listed[i]?.path}: ${result.errors.join("; ")}`);
  });
  if (payloads.length === 0) fail(`no ballot listings in ${catalogUrl}`);
  return payloads;
}

/** The next election on or after today, else the latest there is. */
function nextElection(races: Iterable<ListedRace>): string | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [...new Set([...races].map((race) => race.election))].sort();
  return dates.find((date) => date >= today) ?? dates.at(-1);
}

/** One line of `races`: what a position copies, and what the ballot says about the contest. */
function raceLine(race: ListedRace): string {
  const { ballot, ...subject } = race.subject;
  return JSON.stringify({
    subject: {
      ...subject,
      jurisdiction: race.jurisdiction,
      election: race.election,
    },
    ...(ballot?.vote_for ? { vote_for: ballot.vote_for } : {}),
    ...(ballot?.ranks ? { ranks: ballot.ranks } : {}),
    choices: race.choices.map((choice) => choice.name),
  });
}

async function cmdRaces(rest: string[]): Promise<void> {
  const { flags } = parseFlags(rest);
  const payloads = await catalogListings(strFlag(flags, "catalog") ?? PUBLIC_CATALOG);
  const races = [...ballotListing(payloads).races.values()];
  const election = strFlag(flags, "election") ?? nextElection(races);
  const where = strFlag(flags, "where")
    ?.split(",")
    .map((text) => text.trim().toLowerCase())
    .filter(Boolean);
  const lines = races
    .filter((race) => race.election === election)
    .filter(
      (race) =>
        !where ||
        where.some((text) =>
          `${race.subject.title}\n${race.jurisdiction}`.toLowerCase().includes(text),
        ),
    )
    .map(raceLine);

  const outPath = strFlag(flags, "o", "out");
  if (outPath) await writeText(outPath, `${lines.join("\n")}\n`);
  else if (lines.length > 0) console.log(lines.join("\n"));
  console.error(`${lines.length} race(s) in the ${election} election`);
}

async function cmdCheck(rest: string[]): Promise<void> {
  const { flags, positional } = parseFlags(rest);
  const parsed = parseSignInput(await readText(positional[0] ?? "-"));
  if ("errors" in parsed) fail(`not valid sign input:\n  ${parsed.errors.join("\n  ")}`);
  const { input } = parsed;

  const listing = ballotListing(await catalogListings(strFlag(flags, "catalog") ?? PUBLIC_CATALOG));
  const problems: string[] = [];
  let matched = 0;
  let uncovered = 0;
  for (const position of input.positions) {
    const resolution = resolveChoice(listing, position, input);
    const { title } = position.subject;
    const named = `"${position.choice ?? "(the race as a whole)"}" in "${title}"`;
    if (resolution.status === "listed" || resolution.status === "no-choice") matched++;
    else if (resolution.status === "uncovered") uncovered++;
    else if (resolution.status === "race-unlisted")
      problems.push(`race not on the ballot: "${title}" (${position.subject.jurisdiction ?? ""})`);
    else {
      const hint = resolution.suggestion ? `; closest is "${resolution.suggestion.name}"` : "";
      const what = resolution.status === "write-in" ? "uncertified write-in" : "not on the ballot";
      problems.push(`${what}: ${named}${hint}`);
    }
  }

  for (const problem of problems) console.log(problem);
  console.log(
    `${matched} of ${input.positions.length} position(s) line up with the ballot; ` +
      `${problems.length} problem(s); ${uncovered} where no ballot listing exists to check against`,
  );
  if (problems.length > 0) process.exit(1);
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

/**
 * Write the guide's references (what its items mention of each other) beside
 * them, so the signature covers the file. None found: no file.
 */
async function writeGuideReferences(dir: string): Promise<number> {
  const items = walkFiles(dir)
    .filter((p) => p.startsWith("items/") && p.endsWith(".json"))
    .map((p) => guideItemSchema.safeParse(JSON.parse(readFileSync(join(dir, p), "utf8"))))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const meta = JSON.parse(readFileSync(join(dir, GUIDE_META), "utf8")) as Pick<
    GuideManifest,
    "context"
  >;
  const references = guideReferences(items, {
    names: isStatewideGuide(meta.context?.jurisdiction),
  });
  const path = join(dir, GUIDE_REFERENCES_FILE);
  if (references.length > 0)
    await writeText(
      path,
      `${JSON.stringify({ v: 1, references })}
`,
    );
  else rmSync(path, { force: true });
  return references.length;
}

/** Validate a guide directory; returns the manifest minus issuer and signature details. */
async function buildGuide(dir: string): Promise<Omit<GuideManifest, "issuer" | "issued_at">> {
  const metaPath = join(dir, GUIDE_META);
  if (!existsSync(metaPath)) fail(`${metaPath} not found`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Pick<
    GuideManifest,
    "context" | "attribution"
  >;

  const paths = walkFiles(dir).filter((p) => p !== GUIDE_META && p !== GUIDE_OUT);
  const present = new Set(paths);
  const problems: string[] = [];
  const items: GuideManifest["items"] = [];
  for (const path of paths.filter((p) => p.startsWith("items/") && p.endsWith(".json"))) {
    const parsed = guideItemSchema.safeParse(JSON.parse(readFileSync(join(dir, path), "utf8")));
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
    files[path] = await sha256(new Uint8Array(readFileSync(join(dir, path))));
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
    await writeGuideReferences(target);
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
    await writeText(out, `${token}\n`);
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
          bytes = new Uint8Array(readFileSync(join(target, "..", path)));
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
  case "races":
    await cmdRaces(rest);
    break;
  case "check":
    await cmdCheck(rest);
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
