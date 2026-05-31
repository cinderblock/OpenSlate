import type { StoredIdentity } from "@openslate/core";
import { type IDBPDatabase, openDB } from "idb";

export interface ImportedSlate {
  token: string;
  importedAt: string;
}

export interface KnownIdentity {
  /** ed25519:<base58> — the contact's public key, used as the row key. */
  publicKey: string;
  /** Optional local nickname; falls back to the slate's self-asserted name. */
  displayName?: string;
  /** Optional notes about this contact. */
  notes?: string;
  /** Where this entry came from. */
  source: "manual" | "from-slate";
  addedAt: string;
}

const DB_NAME = "openslate";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        // One record per imported slate, keyed by its token.
        if (!database.objectStoreNames.contains("slates")) {
          database.createObjectStore("slates", { keyPath: "token" });
        }
        // The user's own identities (now multiple allowed), keyed by public key.
        if (!database.objectStoreNames.contains("identities")) {
          database.createObjectStore("identities", { keyPath: "publicKey" });
        }
        // Other people's public identities — keys we know but don't control.
        // Auto-populated when the user saves an imported slate, plus manual adds.
        if (!database.objectStoreNames.contains("knownIdentities")) {
          database.createObjectStore("knownIdentities", { keyPath: "publicKey" });
        }
      },
    });
  }
  return dbPromise;
}

export async function allSlates(): Promise<ImportedSlate[]> {
  return (await db()).getAll("slates") as Promise<ImportedSlate[]>;
}

export async function putSlate(record: ImportedSlate): Promise<void> {
  await (await db()).put("slates", record);
}

export async function deleteSlate(token: string): Promise<void> {
  await (await db()).delete("slates", token);
}

export async function allIdentities(): Promise<StoredIdentity[]> {
  return (await db()).getAll("identities") as Promise<StoredIdentity[]>;
}

export async function putIdentity(record: StoredIdentity): Promise<void> {
  await (await db()).put("identities", record);
}

export async function deleteIdentity(publicKey: string): Promise<void> {
  await (await db()).delete("identities", publicKey);
}

export async function allKnownIdentities(): Promise<KnownIdentity[]> {
  return (await db()).getAll("knownIdentities") as Promise<KnownIdentity[]>;
}

export async function putKnownIdentity(record: KnownIdentity): Promise<void> {
  await (await db()).put("knownIdentities", record);
}

export async function deleteKnownIdentity(publicKey: string): Promise<void> {
  await (await db()).delete("knownIdentities", publicKey);
}
