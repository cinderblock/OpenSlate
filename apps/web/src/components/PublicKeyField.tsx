import { decodePublicKey, KEY_PREFIX } from "@openslate/core";
import { type ReactNode, useState } from "react";
import { TextField } from "./ui/TextField";

/** Whether `key` is a well-formed `ed25519:` public key. */
export function isPublicKey(key: string): boolean {
  try {
    decodePublicKey(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * An Ed25519 public key. The `ed25519:` prefix is drawn in the box rather
 * than typed, a pasted full key is accepted as-is, and the key is checked as
 * you type: a tick when it decodes, an error once you leave a bad one.
 * `value` and `onChange` carry the full key (with prefix), or "".
 */
export function PublicKeyField({
  label,
  value,
  onChange,
  placeholder = "paste a key",
}: {
  label?: ReactNode;
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
}) {
  const [touched, setTouched] = useState(false);
  const body = value.startsWith(KEY_PREFIX) ? value.slice(KEY_PREFIX.length) : value;
  const valid = body !== "" && isPublicKey(KEY_PREFIX + body);

  return (
    <TextField
      label={label}
      aria-label={label == null ? "Public key" : undefined}
      monospace
      value={body}
      onChange={(text) => {
        const trimmed = text.trim();
        const next = trimmed.startsWith(KEY_PREFIX) ? trimmed.slice(KEY_PREFIX.length) : trimmed;
        onChange(next ? KEY_PREFIX + next : "");
      }}
      onBlur={() => setTouched(true)}
      placeholder={placeholder}
      prefix={<span className="key-prefix">{KEY_PREFIX}</span>}
      suffix={
        valid ? (
          <span className="ok">
            <span aria-hidden="true">✓</span>
            <span className="sr-only">valid key</span>
          </span>
        ) : undefined
      }
      errorMessage={touched && body !== "" && !valid ? "Not a valid Ed25519 public key" : undefined}
    />
  );
}
