import type { StoredIdentity } from "@openslate/core";
import { type IDBPDatabase, openDB } from "idb";
import { setDbStatus } from "./dbStatus";

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

/** A slate the user signed in this browser. */
export interface PublishedSlate {
  token: string;
  /** ed25519:<base58> of the identity that signed it. */
  issuerKey: string;
  publishedAt: string;
}

export interface SubjectRaceMapping {
  /** Canonicalised subject key — see `subjectKey` in lib/results.ts. */
  subjectKey: string;
  /** Provider tag — `civicapi` today; lets future providers coexist. */
  provider: string;
  /** The provider's race ID, as returned by `/race/search`. */
  raceId: string;
  /** Where the mapping came from. `manual` overrides survive auto re-resolution. */
  source: "auto" | "manual";
  setAt: string;
}

const DB_NAME = "openslate";
const DB_VERSION = 5;

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
        // Maps a canonical Subject key to a results-provider race id. Persists
        // both auto-resolved matches (so we don't re-search every render) and
        // manual user overrides (which auto re-resolution must not clobber).
        if (!database.objectStoreNames.contains("subjectRaceMap")) {
          database.createObjectStore("subjectRaceMap", { keyPath: "subjectKey" });
        }
        // Slates the user signed here, keyed by token, so My vote can show
        // what they've already put their name to on a race.
        if (!database.objectStoreNames.contains("published")) {
          database.createObjectStore("published", { keyPath: "token" });
        }
      },
      // Another tab still runs an older version with the database open. The
      // open waits (without this, silently and forever) until that tab lets go.
      blocked() {
        setDbStatus({ state: "blocked" });
      },
      // A newer version opened in another tab and needs to upgrade. Let go so
      // it can; this tab's code is now stale, so it has to reload.
      blocking() {
        void dbPromise?.then((database) => database.close());
        setDbStatus({ state: "outdated" });
      },
      // The browser closed the connection (storage cleared, disk trouble).
      // Open afresh on the next call.
      terminated() {
        dbPromise = null;
      },
    }).then(
      (database) => {
        setDbStatus({ state: "ok" });
        return database;
      },
      (error: unknown) => {
        dbPromise = null;
        setDbStatus({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      },
    );
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

export async function getSubjectRace(subjectKey: string): Promise<SubjectRaceMapping | undefined> {
  return (await db()).get("subjectRaceMap", subjectKey) as Promise<SubjectRaceMapping | undefined>;
}

export async function putSubjectRace(record: SubjectRaceMapping): Promise<void> {
  await (await db()).put("subjectRaceMap", record);
}

export async function deleteSubjectRace(subjectKey: string): Promise<void> {
  await (await db()).delete("subjectRaceMap", subjectKey);
}

export async function allPublished(): Promise<PublishedSlate[]> {
  return (await db()).getAll("published") as Promise<PublishedSlate[]>;
}

export async function putPublished(record: PublishedSlate): Promise<void> {
  await (await db()).put("published", record);
}

export async function deletePublished(token: string): Promise<void> {
  await (await db()).delete("published", token);
}

/** Every object store, for Settings → Your data's backup, restore and reset. */
export const STORE_NAMES = [
  "slates",
  "identities",
  "knownIdentities",
  "published",
  "subjectRaceMap",
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export type StoreDump = Record<StoreName, unknown[]>;

export async function dumpStores(): Promise<StoreDump> {
  const database = await db();
  const entries = await Promise.all(
    STORE_NAMES.map(async (name) => [name, await database.getAll(name)] as const),
  );
  return Object.fromEntries(entries) as StoreDump;
}

export async function countStores(): Promise<Record<StoreName, number>> {
  const database = await db();
  const entries = await Promise.all(
    STORE_NAMES.map(async (name) => [name, await database.count(name)] as const),
  );
  return Object.fromEntries(entries) as Record<StoreName, number>;
}

/**
 * Write records into the stores in one transaction. With `replace`, each store
 * named in `records` is emptied first; others are left alone.
 */
export async function writeStores(
  records: Partial<StoreDump>,
  { replace }: { replace: boolean },
): Promise<void> {
  const names = STORE_NAMES.filter((name) => records[name] !== undefined);
  if (names.length === 0) return;
  const tx = (await db()).transaction(names, "readwrite");
  for (const name of names) {
    const store = tx.objectStore(name);
    if (replace) await store.clear();
    for (const record of records[name] ?? []) await store.put(record);
  }
  await tx.done;
}

/** Empty every store. Clears rather than deleting the database, which an open connection would block. */
export async function clearStores(): Promise<void> {
  const tx = (await db()).transaction([...STORE_NAMES], "readwrite");
  await Promise.all([...STORE_NAMES.map((name) => tx.objectStore(name).clear()), tx.done]);
}
