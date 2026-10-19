import { verifySlate } from "@openslate/core";
import type { QueryClient } from "@tanstack/react-query";
import { slatesCollection, upsertKnownIdentity } from "./collections";
import { type CatalogEntry, slateFromUrlOptions } from "./query";
import { track } from "./usage";

/**
 * Import one catalog entry: fetch its slate, verify it, store it. Shared by
 * the catalog browser's row and bulk buttons and by the getting-started
 * wizard, so they stay in sync. Resolves with the token even when it was
 * already imported, so callers can still flip their row state.
 */
export type ImportOutcome =
  | { kind: "imported"; token: string }
  | { kind: "already-imported"; token: string }
  | { kind: "error"; error: string };

export function catalogEntryUrl(entry: CatalogEntry, catalogUrl: string): string {
  return new URL(entry.path, catalogUrl).href;
}

export async function importCatalogEntry(
  entry: CatalogEntry,
  catalogUrl: string,
  knownTokens: ReadonlySet<string>,
  queryClient: QueryClient,
): Promise<ImportOutcome> {
  try {
    const token = await queryClient.fetchQuery({
      ...slateFromUrlOptions(catalogEntryUrl(entry, catalogUrl)),
      // The wizard fetches entries to preview them; importing right after
      // shouldn't download them again.
      staleTime: 1000 * 60 * 5,
    });
    const result = verifySlate(token);
    if (!result.valid) {
      throw new Error(result.errors[0] ?? "slate did not verify");
    }
    if (knownTokens.has(token)) {
      return { kind: "already-imported", token };
    }
    slatesCollection.insert({ token, importedAt: new Date().toISOString() });
    track({ name: "slate.import", dims: { source: "catalog" } });
    if (result.issuerKey) {
      upsertKnownIdentity(result.issuerKey, {
        displayName: result.payload?.issuer.name,
        source: "from-slate",
      });
    }
    return { kind: "imported", token };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
