#!/usr/bin/env bun
import {
  type Attribution,
  type Position,
  type Reference,
  type SlatePayload,
  type StoredIdentity,
  buildSlate,
  createIdentity,
  decodeToken,
  deserializeIdentity,
  identityToIssuer,
  serializeIdentity,
  signSlate,
  slatePayloadSchema,
  verifySlate,
} from "@openslate/core";

const USAGE = `openslate — generate, sign, verify, and inspect endorsements

Usage:
  openslate keygen [--name N] [--kind K] [--uri U] [-o file.json]
  openslate pubkey <identity.json>
  openslate sign <positions.json|-> --key <identity.json> [--election E] [--jurisdiction J] [-o out.txt]
  openslate validate <payload.json|->
  openslate verify <token|file|->
  openslate inspect <token|file|->

A <positions.json> is either a JSON array of Position objects, or an object
{ "positions": [...], "endorsed_by": [...], "attribution": {...}, "context": {...} }.
Use "-" for stdin.

When publishing a SECONDHAND report of another entity's public stance,
include "attribution" and sign with a researcher key (kind: "researcher").
See SPEC §3.9 and §7.1.

validate is a schema-only check (no crypto) of a complete SlatePayload JSON
file — useful for CI on hand-authored research data before signing.

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
  const file = Bun.file(arg);
  if (await file.exists()) return (await file.text()).trim();
  return arg.trim();
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
  const keyPath = strFlag(flags, "key");
  if (!keyPath) fail("sign requires --key <identity.json>");

  const stored = JSON.parse(await readText(keyPath)) as StoredIdentity;
  const identity = deserializeIdentity(stored);
  const issuer = identityToIssuer(identity);

  const raw = JSON.parse(await readText(positional[0] ?? "-")) as unknown;
  let positions: Position[] = [];
  let endorsedBy: Reference[] | undefined;
  let attribution: Attribution | undefined;
  let context: SlatePayload["context"];
  if (Array.isArray(raw)) {
    positions = raw as Position[];
  } else if (raw && typeof raw === "object") {
    const obj = raw as {
      positions?: Position[];
      endorsed_by?: Reference[];
      attribution?: Attribution;
      context?: SlatePayload["context"];
    };
    positions = obj.positions ?? [];
    endorsedBy = obj.endorsed_by;
    attribution = obj.attribution;
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
    const payload = buildSlate({ issuer, positions, endorsedBy, attribution, context });
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
    if (result.data.endorsed_by?.length) {
      console.log(`endorsed_by: ${result.data.endorsed_by.length}`);
    }
  } else {
    console.log("INVALID");
    for (const issue of result.error.issues) {
      console.log(`error:     ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
}

async function cmdVerify(rest: string[]): Promise<void> {
  const { positional } = parseFlags(rest);
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
  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(USAGE);
    break;
  default:
    fail(`unknown command: ${command}\n\n${USAGE}`);
}
