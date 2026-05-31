import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { jwsHeaderSchema, slatePayloadSchema } from "../src/schema";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");
mkdirSync(outDir, { recursive: true });

const files: Array<[string, unknown]> = [
  [
    "openslate.schema.json",
    zodToJsonSchema(slatePayloadSchema, { name: "SlatePayload", $refStrategy: "none" }),
  ],
  [
    "header.schema.json",
    zodToJsonSchema(jwsHeaderSchema, { name: "JwsHeader", $refStrategy: "none" }),
  ],
];

for (const [file, schema] of files) {
  writeFileSync(join(outDir, file), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${file}`);
}
