const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(input: string): Uint8Array {
  return encoder.encode(input);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * RFC 8785 (JCS) canonical JSON for the subset OpenSlate uses (objects, arrays,
 * strings, booleans, finite numbers, null). Object members are emitted with keys
 * sorted by UTF-16 code unit and no insignificant whitespace; members whose value
 * is `undefined` are omitted. Two implementations canonicalizing the same logical
 * value MUST produce identical output.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "bigint") throw new Error("cannot canonicalize a bigint");

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
  }

  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${members.join(",")}}`;
  }

  throw new Error(`cannot canonicalize value of type ${type}`);
}
