import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { jwsHeaderSchema, slatePayloadSchema } from "../src/schema";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");
mkdirSync(outDir, { recursive: true });

/**
 * Canonical schema URLs. Reimplementations should treat these as opaque
 * identifiers; resolution is best-effort (the raw GitHub URL works today).
 */
const BASE = "https://raw.githubusercontent.com/cinderblock/openslate/master/packages/core/schema";
const SLATE_ID = `${BASE}/openslate.schema.json`;
const HEADER_ID = `${BASE}/header.schema.json`;

function extractDefinition(schema: ReturnType<typeof zodToJsonSchema>, name: string): unknown {
  const top = schema as { definitions?: Record<string, unknown> };
  const def = top.definitions?.[name];
  if (!def) throw new Error(`expected definitions.${name} in generated schema`);
  return def;
}

const slateGen = zodToJsonSchema(slatePayloadSchema, {
  name: "SlatePayload",
  $refStrategy: "none",
});
const headerGen = zodToJsonSchema(jwsHeaderSchema, {
  name: "JwsHeader",
  $refStrategy: "none",
});

// zod refinements don't reach JSON Schema; restate the Position one (SPEC §3.4).
const slateDef = extractDefinition(slateGen, "SlatePayload") as {
  properties: {
    positions: { items: Record<string, unknown> };
    articles: { items: Record<string, unknown> };
  };
};
slateDef.properties.positions.items.dependencies = {
  choice_id: ["choice"],
  write_in: ["choice"],
  ballot: ["choice"],
};
slateDef.properties.articles.items.dependencies = { choice_id: ["choice"] };

// The `ballot` objects (SPEC §3.14): never empty, and not both `vote_for` and `ranks`.
function ballotRules(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) ballotRules(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const object = node as Record<string, unknown>;
  const properties = object.properties as Record<string, unknown> | undefined;
  if (properties && "vote_for" in properties && "ranks" in properties) {
    object.minProperties = 1;
    object.not = { required: ["vote_for", "ranks"] };
  } else if (properties && "incumbent" in properties && "designation" in properties) {
    object.minProperties = 1;
  }
  for (const value of Object.values(object)) ballotRules(value);
}
ballotRules(slateDef);

// `httpUrl` (SPEC §3.13) is a refinement too: every URL is http: or https:.
function httpOnly(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) httpOnly(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const object = node as Record<string, unknown>;
  if (object.format === "uri") object.pattern = "^[Hh][Tt][Tt][Pp][Ss]?:";
  for (const value of Object.values(object)) httpOnly(value);
}
httpOnly(slateDef);

// Combined schema: top-level $ref points to SlatePayload; both SlatePayload
// and JwsHeader are reachable via definitions so a single fetch is enough.
const combined = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: SLATE_ID,
  title: "OpenSlate v1",
  description:
    "An OpenSlate token is a JWS-compact (RFC 7515) string: " +
    "BASE64URL(JCS(header)) + '.' + BASE64URL(JCS(payload)) + '.' + BASE64URL(signature). " +
    "The 'header' conforms to #/definitions/JwsHeader, the 'payload' to #/definitions/SlatePayload. " +
    "See SPEC.md and vectors/ for the normative format and conformance test vectors.",
  $ref: "#/definitions/SlatePayload",
  definitions: {
    SlatePayload: slateDef,
    JwsHeader: extractDefinition(headerGen, "JwsHeader"),
  },
};

// Standalone header schema for tools that only validate the header segment.
const headerOnly = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: HEADER_ID,
  title: "OpenSlate JWS Header",
  $ref: "#/definitions/JwsHeader",
  definitions: { JwsHeader: extractDefinition(headerGen, "JwsHeader") },
};

const files: Array<[string, unknown]> = [
  ["openslate.schema.json", combined],
  ["header.schema.json", headerOnly],
];

for (const [file, schema] of files) {
  writeFileSync(join(outDir, file), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${file}`);
}
