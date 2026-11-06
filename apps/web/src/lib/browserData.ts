import { del as keyvalDel, keys as keyvalKeys } from "idb-keyval";
import { z } from "zod";
import { clearStores, dumpStores, type STORE_NAMES, type StoreDump, writeStores } from "./db";
import { removeLocalKey } from "./localStore";
import { queryClient } from "./query";

/**
 * Everything OpenSlate keeps in this browser, for Settings → Your data: what
 * each piece is, a backup of all of it, restore, and reset. Nothing here talks
 * to a server: there is none holding user data (plans/browser-data-manager.md).
 *
 * The pure parts (the catalogue, `describeKey`, `parseBackup`) are unit-tested
 * in test/browserData.test.ts.
 */

export type KeyGroup = "ballot" | "sources" | "area" | "publish" | "preferences" | "notices";

export const KEY_GROUP_LABEL: Record<KeyGroup, string> = {
  ballot: "Your ballot",
  sources: "Sources you follow",
  area: "Where you vote",
  publish: "Publishing",
  preferences: "Preferences",
  notices: "Notices and setup",
};

export interface KeyInfo {
  label: string;
  description: string;
  group: KeyGroup;
}

/** Every localStorage key the current app writes. */
export const LOCAL_KEYS: Readonly<Record<string, KeyInfo>> = {
  "openslate.ballotDraft.v1": {
    label: "Picks, statements and notes",
    description: "Every mark you made on My ballot, with your statements and private notes.",
    group: "ballot",
  },
  "openslate.ballotRanking.v1": {
    label: "Rankings",
    description: "The order you ranked candidates in, for ranked-choice races.",
    group: "ballot",
  },
  "openslate.ballotOrder.v1": {
    label: "Ballot order corrections",
    description: "Races where you set the order the names print in yourself.",
    group: "ballot",
  },
  "openslate.myElection.v1": {
    label: "Election shown",
    description: "Which election My ballot shows.",
    group: "ballot",
  },
  "openslate.followedRaces.v1": {
    label: "Races you keep an eye on",
    description: "Races and candidates you follow, on your ballot or not.",
    group: "ballot",
  },
  "openslate.watch.v1": {
    label: "Live results watch list",
    description: "The places and contests the Live results page watches.",
    group: "ballot",
  },
  "openslate.raceChanges.v1": {
    label: "When watched races changed",
    description:
      "Each watched race's last numbers and when they changed, so a race says when its own count moved, not just when its source published.",
    group: "ballot",
  },
  "openslate.raceHistory.v1": {
    label: "Watched races' history",
    description:
      "Each watched race's votes and precincts reporting at every report this browser saw, for its history chart.",
    group: "ballot",
  },
  "openslate.watchView.v1": {
    label: "Live results layout",
    description: "How the Live results page sorts and groups the races you watch.",
    group: "ballot",
  },
  "openslate.follows.v3": {
    label: "How much each source counts",
    description:
      "Whether you follow, ignore or disagree with each source, and how many times it counts.",
    group: "sources",
  },
  "openslate.removedSources.v1": {
    label: "Removed sources",
    description: "Sources you removed, so nothing adds them back on its own.",
    group: "sources",
  },
  "openslate.disagreeMode.v1": {
    label: "Disagree mode",
    description: "How sources you disagree with count in two-way races.",
    group: "sources",
  },
  "openslate.friendGuides.v1": {
    label: "Unsigned friends' guides",
    description:
      "Friends' guides saved by an older version, waiting for you to sign or remove them.",
    group: "sources",
  },
  "openslate.area.v1": {
    label: "Your area",
    description: "The city, county and districts My ballot shows races for.",
    group: "area",
  },
  "openslate.address.v1": {
    label: "Address",
    description: "The address you last looked your districts up with.",
    group: "area",
  },
  "openslate.lookupConsent.v1": {
    label: "Address lookup permissions",
    description: "Which lookup services you agreed to send your address to.",
    group: "area",
  },
  "openslate.activeIdentityKey.v1": {
    label: "Signing as",
    description: "Which of your identities Publish signs with.",
    group: "publish",
  },
  "openslate.myLabels.v1": {
    label: "Your labels",
    description: "Your own words for positions (“Endorsed”, “Watch list”) used when publishing.",
    group: "publish",
  },
  "openslate.theme.v1": {
    label: "Appearance",
    description: "Light, dark or follow the system.",
    group: "preferences",
  },
  "openslate.basemap.v1": {
    label: "Map style",
    description: "The background the district maps draw on.",
    group: "preferences",
  },
  "openslate.googleCivicKey.v1": {
    label: "Google API key",
    description: "Your own Google Civic API key, if you set one.",
    group: "preferences",
  },
  "openslate:routing-prefs": {
    label: "Data routing",
    description: "Whether each data provider is reached directly or through the relay.",
    group: "preferences",
  },
  "openslate.usage-stats": {
    label: "Usage stats choice",
    description: "Whether you allow anonymous usage stats.",
    group: "preferences",
  },
  "openslate.alphaNoticeDismissed.v1": {
    label: "Alpha notice dismissed",
    description: "You closed the “this is an alpha” banner.",
    group: "notices",
  },
  "openslate.pendingSetup.v1": {
    label: "Unfinished setup",
    description: "Sources Get started was still importing when the page closed.",
    group: "notices",
  },
};

/** Keys an older version wrote that the current one only reads to migrate, if at all. */
export const LEGACY_KEYS: Readonly<Record<string, string>> = {
  "openslate.follows.v1": "Follow choices from an early version (already carried over).",
  "openslate.follows.v2": "Follow choices from an earlier version (already carried over).",
};

/** Whether a localStorage key is OpenSlate's. Nothing else on the origin is touched. */
export function isOwnKey(key: string): boolean {
  return key.startsWith("openslate.") || key.startsWith("openslate:");
}

export type DescribedKey =
  | ({ kind: "known"; key: string } & KeyInfo)
  | { kind: "legacy"; key: string; description: string };

export function describeKey(key: string): DescribedKey {
  const known = LOCAL_KEYS[key];
  if (known) return { kind: "known", key, ...known };
  return {
    kind: "legacy",
    key,
    description: LEGACY_KEYS[key] ?? "Left by an older version; the current one doesn't use it.",
  };
}

export interface LocalEntry {
  key: string;
  /** Characters stored (≈ bytes for the ASCII-heavy JSON stored here). */
  size: number;
  described: DescribedKey;
}

/** OpenSlate's localStorage entries, as they are now. */
export function readLocalEntries(): LocalEntry[] {
  const entries: LocalEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !isOwnKey(key)) continue;
      const value = localStorage.getItem(key) ?? "";
      entries.push({ key, size: key.length + value.length, described: describeKey(key) });
    }
  } catch {
    // Storage unavailable: nothing persisted to list.
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/** Caches kept in idb-keyval: re-fetched when missing, never the user's own data. */
export const CACHE_KEYS = [
  "openslate.query-cache",
  "openslate.catalogCopy.v1",
  "openslate.catalogChecked.v1",
];

/** Forget downloaded data (catalog, results, polls). Reloads fetch it again. */
export async function clearCaches(): Promise<void> {
  // Empty the live cache too, or its persister writes it straight back.
  queryClient.clear();
  const present = new Set((await keyvalKeys()).map(String));
  await Promise.all(CACHE_KEYS.filter((key) => present.has(key)).map((key) => keyvalDel(key)));
}

/** How much the browser says this site stores, all of it (app files included). */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    return (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    return {};
  }
}

// --- Backup and restore ---

export const BACKUP_FORMAT = "openslate.browser-backup";

const recordWith = (field: string) =>
  z.record(z.unknown()).refine((record) => typeof record[field] === "string", {
    message: `each record needs a string ${field}`,
  });

/** The key each store's records are keyed by (`db.ts`'s `keyPath`s). */
const STORE_KEY_FIELD = {
  slates: "token",
  identities: "publicKey",
  knownIdentities: "publicKey",
  published: "token",
  subjectRaceMap: "subjectKey",
} as const satisfies Record<(typeof STORE_NAMES)[number], string>;

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  localStorage: z.record(z.string()),
  indexedDB: z.object({
    slates: z.array(recordWith(STORE_KEY_FIELD.slates)).optional(),
    identities: z.array(recordWith(STORE_KEY_FIELD.identities)).optional(),
    knownIdentities: z.array(recordWith(STORE_KEY_FIELD.knownIdentities)).optional(),
    published: z.array(recordWith(STORE_KEY_FIELD.published)).optional(),
    subjectRaceMap: z.array(recordWith(STORE_KEY_FIELD.subjectRaceMap)).optional(),
  }),
});

export type Backup = z.infer<typeof backupSchema>;

export interface BackupInput {
  localStorage: Record<string, string>;
  stores: StoreDump;
  /** Leave out signing identities (their secret keys). */
  withoutIdentities?: boolean;
  now?: Date;
}

/** Pure: the backup file's contents. Only OpenSlate's own keys go in. */
export function buildBackup(input: BackupInput): Backup {
  const local = Object.fromEntries(
    Object.entries(input.localStorage).filter(([key]) => isOwnKey(key)),
  );
  const { identities, ...rest } = input.stores;
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: (input.now ?? new Date()).toISOString(),
    localStorage: local,
    indexedDB: input.withoutIdentities
      ? (rest as Backup["indexedDB"])
      : ({ ...rest, identities } as Backup["indexedDB"]),
  };
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string };

/** Pure: read a backup file's text, rejecting anything that isn't one. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't JSON." };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const format = (raw as { format?: unknown } | null)?.format;
    return {
      ok: false,
      error:
        format === BACKUP_FORMAT
          ? `That backup is damaged: ${parsed.error.issues[0]?.message ?? "unreadable"}.`
          : "That file isn't an OpenSlate backup.",
    };
  }
  // A backup only ever restores OpenSlate's own keys.
  const backup = parsed.data;
  backup.localStorage = Object.fromEntries(
    Object.entries(backup.localStorage).filter(([key]) => isOwnKey(key)),
  );
  return { ok: true, backup };
}

export interface BackupSummary {
  slates: number;
  identities: number;
  contacts: number;
  published: number;
  settings: number;
}

export function summarizeBackup(backup: Backup): BackupSummary {
  const db = backup.indexedDB;
  return {
    slates: db.slates?.length ?? 0,
    identities: db.identities?.length ?? 0,
    contacts: db.knownIdentities?.length ?? 0,
    published: db.published?.length ?? 0,
    settings: Object.keys(backup.localStorage).length,
  };
}

function readAllLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && isOwnKey(key)) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    // Storage unavailable: nothing to back up from it.
  }
  return out;
}

/** The backup of everything here now, as file text. */
export async function createBackup(options: { withoutIdentities: boolean }): Promise<string> {
  const backup = buildBackup({
    localStorage: readAllLocal(),
    stores: await dumpStores(),
    withoutIdentities: options.withoutIdentities,
  });
  return JSON.stringify(backup, null, 2);
}

export function backupFileName(now = new Date()): string {
  return `openslate-backup-${now.toLocaleDateString("en-CA")}.json`;
}

function clearOwnLocal(): void {
  for (const key of Object.keys(readAllLocal())) removeLocalKey(key);
}

/**
 * Put a backup's data in this browser. `replace` empties everything first;
 * otherwise records join what's here (same key: the backup's wins) and the
 * backup's settings overwrite these. The caller reloads afterwards, so every
 * view reads it fresh.
 */
export async function restoreBackup(
  backup: Backup,
  { replace }: { replace: boolean },
): Promise<void> {
  if (replace) {
    clearOwnLocal();
    await clearStores();
  }
  await writeStores(backup.indexedDB as Partial<StoreDump>, { replace: false });
  for (const [key, value] of Object.entries(backup.localStorage)) {
    localStorage.setItem(key, value);
  }
}

/** Forget everything OpenSlate keeps here. The caller reloads afterwards. */
export async function resetEverything(): Promise<void> {
  clearOwnLocal();
  await clearStores();
  await clearCaches();
}
