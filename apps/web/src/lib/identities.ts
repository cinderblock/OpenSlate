import type { StoredIdentity } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useActiveIdentityKey } from "./address";
import { identityCollection, knownIdentitiesCollection } from "./collections";
import type { KnownIdentity } from "./db";

/** All of the user's own identities (each holds a secret key). */
export function useMyIdentities(): StoredIdentity[] {
  const { data } = useLiveQuery((q) => q.from({ identity: identityCollection }));
  return [...data].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/**
 * The identity Compose signs with. Falls back to the only one when there's a single
 * identity (or to null when none). The hook exposes a setter to switch the active key.
 */
export function useActiveIdentity(): {
  active: StoredIdentity | null;
  activeKey: string;
  setActiveKey: (next: string) => void;
  all: StoredIdentity[];
} {
  const all = useMyIdentities();
  const [activeKey, setActiveKey] = useActiveIdentityKey();
  const active =
    all.find((i) => i.publicKey === activeKey) ?? (all.length === 1 ? (all[0] ?? null) : null);
  return { active, activeKey, setActiveKey, all };
}

/** Live list of known public identities (people you've imported slates from). */
export function useKnownIdentities(): KnownIdentity[] {
  const { data } = useLiveQuery((q) => q.from({ contact: knownIdentitiesCollection }));
  return [...data].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
}

/** Look up a known contact by public key (or undefined). */
export function useKnownIdentity(publicKey: string | undefined): KnownIdentity | undefined {
  const all = useKnownIdentities();
  if (!publicKey) return undefined;
  return all.find((entry) => entry.publicKey === publicKey);
}

/**
 * Display name for a public key: prefers a saved nickname, falls back to the slate's
 * self-asserted name, falls back to a shortened key.
 */
export function useDisplayName(publicKey: string | undefined, selfAsserted?: string): string {
  const known = useKnownIdentity(publicKey);
  return known?.displayName?.trim() || selfAsserted?.trim() || shortKey(publicKey);
}

export function shortKey(publicKey: string | undefined): string {
  if (!publicKey) return "unknown";
  const body = publicKey.startsWith("ed25519:") ? publicKey.slice("ed25519:".length) : publicKey;
  return `${body.slice(0, 8)}…${body.slice(-4)}`;
}
