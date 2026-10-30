import { parseSlate, verifySlate } from "@openslate/core";
import type { QueryClient } from "@tanstack/react-query";
import { type StoredSlate, staleImports, updateProblem } from "./catalogUpdates";
import { slatesCollection, upsertKnownIdentity } from "./collections";
import { readTextWithProgress } from "./fetchProgress";
import { createImportQueue } from "./importQueue";
import { followsStore, removedSourcesStore, setStanding } from "./myVote";
import {
  addPending,
  type PendingSetup,
  pendingEntries,
  pendingSetupStore,
  settlePending,
} from "./pendingSetup";
import {
  type Catalog,
  type CatalogBundleEntry,
  type CatalogEntry,
  queryClient,
  slateFromUrlOptions,
} from "./query";
import { sourceIdOf } from "./sources";
import { track } from "./usage";

/**
 * Import one catalog entry: fetch its slate, verify it, store it. Shared by
 * the catalog browser's row and bulk buttons and by setup (My ballot),
 * so they stay in sync. Resolves with the token even when it was
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
    const outcome = verifyCatalogSlate(
      await fetchCatalogSlate(entry, catalogUrl, queryClient),
      knownTokens,
    );
    if (outcome.kind !== "verified") return outcome;
    storeSlates([outcome.slate]);
    return { kind: "imported", token: outcome.slate.token };
  } catch (err) {
    return { kind: "error", error: errorMessage(err) };
  }
}

/**
 * Import the catalog slates other slates adopt positions from (SPEC §3.10). A
 * voter who follows California Professional Firefighters needs the IAFF slate
 * it adopts its House picks from, but never asked to follow the IAFF, so it
 * comes in unfollowed unless they've already decided about it.
 */
export async function importAdoptedEntries(
  entries: CatalogEntry[],
  catalogUrl: string,
  knownTokens: ReadonlySet<string>,
  queryClient: QueryClient,
): Promise<void> {
  for (const entry of entries) {
    const sourceId = sourceIdOf(entry);
    if (followsStore.get()[sourceId] === undefined) setStanding(sourceId, "off");
    await importCatalogEntry(entry, catalogUrl, knownTokens, queryClient);
  }
}

/** Download one entry's slate (cached by URL). */
export function fetchCatalogSlate(
  entry: CatalogEntry,
  catalogUrl: string,
  queryClient: QueryClient,
): Promise<string> {
  return queryClient.fetchQuery({
    ...slateFromUrlOptions(catalogEntryUrl(entry, catalogUrl)),
    // The catalog's slates don't change under a running import; one fetched a
    // moment ago needn't be downloaded again.
    staleTime: 1000 * 60 * 5,
  });
}

/** A downloaded slate that checked out and isn't stored yet. */
export interface VerifiedSlate {
  token: string;
  issuerKey?: string;
  issuerName?: string;
}

/** Check a downloaded slate's signature; `verified` ones are ready for `storeSlates`. */
export function verifyCatalogSlate(
  token: string,
  knownTokens: { has(token: string): boolean },
): { kind: "verified"; slate: VerifiedSlate } | Exclude<ImportOutcome, { kind: "imported" }> {
  try {
    const result = verifySlate(token);
    if (!result.valid) {
      return { kind: "error", error: result.errors[0] ?? "slate did not verify" };
    }
    if (knownTokens.has(token)) return { kind: "already-imported", token };
    const issuerName = result.payload?.issuer.name;
    return {
      kind: "verified",
      slate: {
        token,
        ...(result.issuerKey ? { issuerKey: result.issuerKey } : {}),
        ...(issuerName ? { issuerName } : {}),
      },
    };
  } catch (err) {
    return { kind: "error", error: errorMessage(err) };
  }
}

/**
 * Store verified slates in one transaction, so a bulk import makes the ballot
 * re-collate once instead of once per slate.
 */
export function storeSlates(slates: VerifiedSlate[], kind: "import" | "update" = "import"): void {
  if (slates.length === 0) return;
  const importedAt = new Date().toISOString();
  slatesCollection.insert(slates.map(({ token }) => ({ token, importedAt })));
  // A catalog's slates mostly share one signer (its researcher): record each once.
  const issuers = new Map<string, string | undefined>();
  for (const slate of slates) {
    if (kind === "import") track({ name: "slate.import", dims: { source: "catalog" } });
    if (slate.issuerKey) issuers.set(slate.issuerKey, slate.issuerName);
  }
  for (const [issuerKey, displayName] of issuers) {
    upsertKnownIdentity(issuerKey, { displayName, source: "from-slate" });
  }
}

/** Remove slates in one transaction (a catalog update dropping the ones it replaced). */
export function removeSlates(tokens: string[]): void {
  const present = tokens.filter((token) => slatesCollection.has(token));
  if (present.length > 0) slatesCollection.delete(present);
}

/** The banner's label while news coverage alone is being added. */
export const ADDING_NEWS = "Adding news coverage";

/**
 * Bring the user's slates from `catalog` up to date: each entry newer than
 * what they have of its stream replaces it (catalogUpdates.ts), and news
 * coverage they don't have yet (`news`, from `missingNews`) comes along,
 * through the background queue so ImportBanner shows it. Returns how many
 * entries it fetches.
 */
export function updateFromCatalog(
  catalog: Catalog,
  catalogUrl: string,
  stored: readonly StoredSlate[],
  news: readonly CatalogEntry[] = [],
): number {
  const updates = staleImports(stored, catalog.entries);
  const entries = [...updates.map((update) => update.entry), ...news];
  if (entries.length === 0) return 0;
  const byPath = new Map(updates.map((update) => [update.entry.path, update]));
  track({ name: "catalog.update" });
  void backgroundImports.start({
    kind: "update",
    catalog,
    catalogUrl,
    entries,
    label:
      updates.length === 0
        ? ADDING_NEWS
        : entries.length === 1
          ? "Updating 1 source"
          : `Updating ${entries.length} sources`,
    // The bundle is every slate at once: only worth it when most have changed.
    bundle: entries.length > catalog.entries.length / 2,
    check: (entry, token) => {
      const update = byPath.get(entry.path);
      // Already verified by the queue; this only reads it. A new addition has nothing to match.
      return update ? updateProblem(update, parseSlate(token).payload) : undefined;
    },
    replaces: (entry) => byPath.get(entry.path)?.replaces ?? [],
  });
  return entries.length;
}

/**
 * Setup's download: `entries` into the background queue, each pick's standing
 * set once its slate is in (so a source that failed isn't left followed).
 * Recorded as pending until each entry is settled, so a download cut short
 * resumes on the next visit (`resumeSetupImport`).
 */
export function startSetupImport({
  catalog,
  catalogUrl,
  entries,
  picks,
  label,
  bundle = false,
}: {
  catalog: Catalog;
  catalogUrl: string;
  entries: CatalogEntry[];
  picks: PendingSetup["picks"];
  label: string;
  bundle?: boolean;
}): Promise<void> {
  const paths = entries.map((entry) => entry.path);
  pendingSetupStore.set((current) =>
    addPending(current, { catalogUrl, paths, picks, ...(bundle ? { bundle } : {}) }),
  );
  return backgroundImports
    .start({
      catalog,
      catalogUrl,
      entries,
      label,
      bundle,
      onImported: (entry) => {
        const standing = picks[entry.path];
        if (standing) setStanding(sourceIdOf(entry), standing);
        pendingSetupStore.set((current) => settlePending(current, [entry.path]));
      },
    })
    .then(() => {
      // What's left failed (the banner lists why): try again from Sources,
      // not on every visit. A download the page dropped never gets here.
      pendingSetupStore.set((current) => settlePending(current, paths));
    });
}

/**
 * Carry on with a setup download an earlier visit didn't finish. Returns how
 * many entries it fetches.
 */
export function resumeSetupImport(catalog: Catalog, catalogUrl: string): number {
  const pending = pendingSetupStore.get();
  if (!pending || pending.catalogUrl !== catalogUrl) return 0;
  const entries = pendingEntries(pending, catalog.entries, new Set(removedSourcesStore.get()));
  // Gone from the catalog, or removed by the voter since: nothing to fetch.
  const fetching = new Set(entries.map((entry) => entry.path));
  pendingSetupStore.set((current) =>
    settlePending(
      current,
      pending.paths.filter((path) => !fetching.has(path)),
    ),
  );
  if (entries.length === 0) return 0;
  const picks = Object.fromEntries(
    Object.entries(pending.picks).filter(([path]) => fetching.has(path)),
  );
  void startSetupImport({
    catalog,
    catalogUrl,
    entries,
    picks,
    label: "Finishing the download you started",
    bundle: Boolean(pending.bundle) && entries.length > catalog.entries.length / 2,
  });
  return entries.length;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Download a catalog's bundle (every entry's slate in one file) and return the
 * tokens by entry path. Reports bytes received against the bundle's
 * uncompressed size; `total` is undefined when the catalog doesn't say.
 */
export async function fetchCatalogBundle(
  catalog: Catalog,
  catalogUrl: string,
  onProgress: (received: number, total: number | undefined) => void,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  if (!catalog.bundle) throw new Error("this catalog has no bundle");
  const total = catalog.bundle.bytes;
  const response = await fetch(new URL(catalog.bundle.path, catalogUrl), { signal });
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
  const text = await readTextWithProgress(response, (received) => onProgress(received, total));
  const bundle = JSON.parse(text) as { entries?: CatalogBundleEntry[] };
  const tokens = new Map<string, string>();
  for (const entry of bundle.entries ?? []) {
    if (typeof entry.path === "string" && typeof entry.token === "string") {
      tokens.set(entry.path, entry.token.trim());
    }
  }
  return tokens;
}

/**
 * Imports that carry on after setup hands over to the ballot. ImportBanner
 * shows how far along they are.
 */
export const backgroundImports = createImportQueue({
  fetchBundle: (catalog, catalogUrl, onProgress) =>
    fetchCatalogBundle(catalog, catalogUrl, onProgress),
  fetchSlate: (entry, catalogUrl) => fetchCatalogSlate(entry, catalogUrl, queryClient),
  verify: verifyCatalogSlate,
  store: storeSlates,
  remove: removeSlates,
  isStored: (token) => slatesCollection.has(token),
});
