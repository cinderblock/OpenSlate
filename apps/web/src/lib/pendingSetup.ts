import { createLocalStore } from "./localStore";
import type { CatalogEntry } from "./query";
import { isStanding, type Standing, sourceIdOf } from "./sources";

/**
 * What setup has started downloading and not finished yet, so a download cut
 * short (the tab closed or reloaded, a phone dropping it in the background)
 * picks up where it left off on the next visit, picks and all. Without it the
 * ballot lists that made it in hide setup, and the picks never land.
 */
export interface PendingSetup {
  catalogUrl: string;
  /** Catalog entry paths still to import. */
  paths: string[];
  /** Entry path → how the voter picked it. Not here = imported unfollowed or as reference. */
  picks: Record<string, Exclude<Standing, "off">>;
  /** Fetch from the catalog's bundle (Download all). */
  bundle?: boolean;
}

export const pendingSetupStore = createLocalStore<PendingSetup | null>(
  "openslate.pendingSetup.v1",
  null,
  (raw) => (isPendingSetup(raw) ? raw : undefined),
);

function isPendingSetup(raw: unknown): raw is PendingSetup {
  if (typeof raw !== "object" || raw === null) return false;
  const { catalogUrl, paths, picks, bundle } = raw as Record<keyof PendingSetup, unknown>;
  return (
    typeof catalogUrl === "string" &&
    Array.isArray(paths) &&
    paths.every((path) => typeof path === "string") &&
    typeof picks === "object" &&
    picks !== null &&
    !Array.isArray(picks) &&
    Object.values(picks).every((standing) => isStanding(standing) && standing !== "off") &&
    (bundle === undefined || typeof bundle === "boolean")
  );
}

/**
 * Add a download to what's pending. One that's still running from earlier
 * (a resumed download, or setup run twice) keeps its entries; a path picked
 * again takes its newest standing.
 */
export function addPending(current: PendingSetup | null, next: PendingSetup): PendingSetup {
  if (!current || current.catalogUrl !== next.catalogUrl) return next;
  return {
    catalogUrl: next.catalogUrl,
    paths: [...new Set([...current.paths, ...next.paths])],
    picks: { ...current.picks, ...next.picks },
    ...(current.bundle || next.bundle ? { bundle: true } : {}),
  };
}

/** Done with these paths, imported or failed; null once nothing is left. */
export function settlePending(
  current: PendingSetup | null,
  paths: Iterable<string>,
): PendingSetup | null {
  if (!current) return null;
  const done = new Set(paths);
  const rest = current.paths.filter((path) => !done.has(path));
  if (rest.length === 0) return null;
  const picks = Object.fromEntries(
    Object.entries(current.picks).filter(([path]) => !done.has(path)),
  );
  return { ...current, paths: rest, picks };
}

/**
 * The catalog entries a pending download still has to fetch: those the catalog
 * still lists, leaving out any source the voter has removed since.
 */
export function pendingEntries(
  pending: PendingSetup,
  entries: readonly CatalogEntry[],
  removed: ReadonlySet<string>,
): CatalogEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return pending.paths.flatMap((path) => {
    const entry = byPath.get(path);
    return entry && !removed.has(sourceIdOf(entry)) ? [entry] : [];
  });
}
