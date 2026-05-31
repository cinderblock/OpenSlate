import { createCollection } from "@tanstack/react-db";
import { z } from "zod";
import {
  type KnownIdentity,
  allIdentities,
  allKnownIdentities,
  allSlates,
  deleteIdentity,
  deleteKnownIdentity,
  deleteSlate,
  putIdentity,
  putKnownIdentity,
  putSlate,
} from "./db";

const importedSlateSchema = z.object({
  token: z.string(),
  importedAt: z.string(),
});

const storedIdentitySchema = z.object({
  v: z.literal(1),
  publicKey: z.string(),
  secretKey: z.string(),
  createdAt: z.string(),
  name: z.string().optional(),
  kind: z.string().optional(),
  uri: z.string().optional(),
});

export type StoredIdentityRow = z.infer<typeof storedIdentitySchema>;
type ImportedSlateRow = z.infer<typeof importedSlateSchema>;

// We are the source of truth for these collections (data lives in IndexedDB). With a
// custom sync source, optimistic mutations are only kept once the sync confirms them,
// so each handler persists to IndexedDB and then re-emits the change through the
// captured sync writer.

// --- Imported slates ---
let confirmSlateInsert: ((value: ImportedSlateRow) => void) | null = null;
let confirmSlateDelete: ((key: string) => void) | null = null;

export const slatesCollection = createCollection({
  id: "slates",
  schema: importedSlateSchema,
  getKey: (slate) => slate.token,
  sync: {
    sync: (params) => {
      confirmSlateInsert = (value) => {
        params.begin();
        params.write({ type: "insert", value });
        params.commit();
      };
      confirmSlateDelete = (key) => {
        params.begin();
        params.write({ type: "delete", key });
        params.commit();
      };
      void (async () => {
        try {
          params.begin();
          for (const value of await allSlates()) params.write({ type: "insert", value });
          params.commit();
        } finally {
          params.markReady();
        }
      })();
      return () => {};
    },
  },
  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    await putSlate(mutation.modified);
    confirmSlateInsert?.(mutation.modified);
  },
  onDelete: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    const key = String(mutation.key);
    await deleteSlate(key);
    confirmSlateDelete?.(key);
  },
});

// --- Active identity (kept to at most one row) ---
let confirmIdentityInsert: ((value: StoredIdentityRow) => void) | null = null;
let confirmIdentityDelete: ((key: string) => void) | null = null;

export const identityCollection = createCollection({
  id: "identities",
  schema: storedIdentitySchema,
  getKey: (identity) => identity.publicKey,
  sync: {
    sync: (params) => {
      confirmIdentityInsert = (value) => {
        params.begin();
        params.write({ type: "insert", value });
        params.commit();
      };
      confirmIdentityDelete = (key) => {
        params.begin();
        params.write({ type: "delete", key });
        params.commit();
      };
      void (async () => {
        try {
          params.begin();
          for (const value of await allIdentities()) params.write({ type: "insert", value });
          params.commit();
        } finally {
          params.markReady();
        }
      })();
      return () => {};
    },
  },
  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    await putIdentity(mutation.modified);
    confirmIdentityInsert?.(mutation.modified);
  },
  onDelete: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    const key = String(mutation.key);
    await deleteIdentity(key);
    confirmIdentityDelete?.(key);
  },
});

/** Add a new identity (no-op if a row with the same publicKey already exists). */
export function addIdentity(next: StoredIdentityRow): void {
  if (identityCollection.has(next.publicKey)) return;
  identityCollection.insert(next);
}

export function forgetIdentity(publicKey: string): void {
  identityCollection.delete(publicKey);
}

// --- Known public identities (other people's keys) ---

const knownIdentitySchema = z.object({
  publicKey: z.string(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
  source: z.enum(["manual", "from-slate"]),
  addedAt: z.string(),
});

let confirmKnownInsert: ((value: KnownIdentity) => void) | null = null;
let confirmKnownDelete: ((key: string) => void) | null = null;

export const knownIdentitiesCollection = createCollection({
  id: "knownIdentities",
  schema: knownIdentitySchema,
  getKey: (entry) => entry.publicKey,
  sync: {
    sync: (params) => {
      confirmKnownInsert = (value) => {
        params.begin();
        params.write({ type: "insert", value });
        params.commit();
      };
      confirmKnownDelete = (key) => {
        params.begin();
        params.write({ type: "delete", key });
        params.commit();
      };
      void (async () => {
        try {
          params.begin();
          for (const value of await allKnownIdentities()) params.write({ type: "insert", value });
          params.commit();
        } finally {
          params.markReady();
        }
      })();
      return () => {};
    },
  },
  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    await putKnownIdentity(mutation.modified);
    confirmKnownInsert?.(mutation.modified);
  },
  onUpdate: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    await putKnownIdentity(mutation.modified);
    confirmKnownInsert?.(mutation.modified);
  },
  onDelete: async ({ transaction }) => {
    const mutation = transaction.mutations[0];
    if (!mutation) return;
    const key = String(mutation.key);
    await deleteKnownIdentity(key);
    confirmKnownDelete?.(key);
  },
});

/** Upsert a known identity. If a row exists, only the provided fields are changed. */
export function upsertKnownIdentity(
  publicKey: string,
  fields: { displayName?: string; notes?: string; source?: "manual" | "from-slate" },
): void {
  const existing = knownIdentitiesCollection.has(publicKey)
    ? knownIdentitiesCollection.get(publicKey)
    : undefined;
  const merged: KnownIdentity = {
    publicKey,
    displayName: "displayName" in fields ? fields.displayName : existing?.displayName,
    notes: "notes" in fields ? fields.notes : existing?.notes,
    source: fields.source ?? existing?.source ?? "manual",
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  if (existing)
    knownIdentitiesCollection.update(publicKey, (draft) => Object.assign(draft, merged));
  else knownIdentitiesCollection.insert(merged);
}

export function removeKnownIdentity(publicKey: string): void {
  if (knownIdentitiesCollection.has(publicKey)) knownIdentitiesCollection.delete(publicKey);
}
