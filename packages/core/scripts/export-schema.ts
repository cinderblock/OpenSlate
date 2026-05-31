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
    SlatePayload: extractDefinition(slateGen, "SlatePayload"),
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
