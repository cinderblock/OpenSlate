import type { SlatePayload } from "@openslate/core";
import type { DecodedSlate } from "./collate";
import { forEachConcurrently } from "./fetchProgress";
import type { Catalog, CatalogEntry } from "./query";
import type { Standing } from "./sources";

/**
 * A copy of every slate in the public catalog, for *All slates* and *All
 * races*. A voter who follows four sources has four slates; this is the rest,
 * fetched only when they ask to look beyond those, and never stored as imports:
 * it adds nothing to My ballot.
 *
 * It comes down as the catalog's bundle, one file, so the host can't tell
 * what's being looked up (fetching only the slates for Oakland would say). The
 * signatures are the slow part, about 9 ms a slate on a desktop and several
 * times that on a phone, so they're checked a little at a time and the verified
 * result is kept: the next visit needs neither the download nor the checks,
 * until the catalog changes, and then only the slates that are new.
 *
 * No storage or network here: `createCatalogLoader` takes them as `CopyDeps`
 * (wired up in allSlates.ts), so this is unit-tested in test/catalogCopy.test.ts.
 */

/** A catalog slate that verified. */
export interface CopiedSlate {
  token: string;
  payload: SlatePayload;
}

export interface CatalogCopy {
  catalogUrl: string;
  /** The catalog's `generated_at`: the same catalog needs no second download. */
  generatedAt: string;
  slates: CopiedSlate[];
  /** Entries that couldn't be used: missing, or failing their signature. */
  rejected: number;
}

export type CopyStatus =
  | { state: "idle" }
  | { state: "loading"; label: string; value: number; maxValue?: number }
  | { state: "ready"; copy: CatalogCopy }
  | { state: "error"; error: string };

export interface CopyDeps {
  fetchCatalog: (catalogUrl: string) => Promise<Catalog>;
  fetchBundle: (
    catalog: Catalog,
    catalogUrl: string,
    onProgress: (received: number, total: number | undefined) => void,
  ) => Promise<Map<string, string>>;
  fetchSlate: (entry: CatalogEntry, catalogUrl: string) => Promise<string>;
  /** The payload of a token that verifies; undefined for one that doesn't. */
  verify: (token: string) => SlatePayload | undefined;
  readCopy: (catalogUrl: string) => Promise<CatalogCopy | undefined>;
  writeCopy: (copy: CatalogCopy) => Promise<void>;
  /** Let the page paint and answer input. */
  yieldToPage: () => Promise<void>;
  now: () => number;
}

export interface CatalogLoader {
  /**
   * Show what's kept, then bring it up to date. Does nothing while running, or
   * within a few minutes of the last check.
   */
  load: (catalogUrl: string) => Promise<void>;
  status: () => CopyStatus;
  subscribe: (listener: () => void) => () => void;
}

/** How long a check of the catalog's list holds. */
const RECHECK_MS = 5 * 60 * 1000;
/** Slates downloaded at once, for a catalog with no bundle. */
const CONCURRENCY = 6;
/** Signature-checking between yields: long enough to get on, short enough not to be felt. */
const SLICE_MS = 12;

export function createCatalogLoader(deps: CopyDeps): CatalogLoader {
  let status: CopyStatus = { state: "idle" };
  let running: Promise<void> | undefined;
  let checkedAt: number | undefined;
  const listeners = new Set<() => void>();

  function set(next: CopyStatus): void {
    status = next;
    for (const listener of listeners) listener();
  }

  /** Every entry's token: the bundle if it has one and it comes, else one by one. */
  async function fetchTokens(
    catalog: Catalog,
    catalogUrl: string,
    report: (bar: { label: string; value: number; maxValue?: number }) => void,
  ): Promise<Map<string, string>> {
    if (catalog.bundle) {
      const label = "Downloading the public catalog";
      report({ label, value: 0, ...(catalog.bundle.bytes ? { maxValue: catalog.bundle.bytes } : {}) });
      try {
        return await deps.fetchBundle(catalog, catalogUrl, (value, maxValue) =>
          report({ label, value, ...(maxValue ? { maxValue } : {}) }),
        );
      } catch {
        // Fetch them one by one instead.
      }
    }
    const tokens = new Map<string, string>();
    const maxValue = catalog.entries.length;
    let done = 0;
    await forEachConcurrently(catalog.entries, CONCURRENCY, async (entry) => {
      try {
        tokens.set(entry.path, await deps.fetchSlate(entry, catalogUrl));
      } catch {
        // Counted as rejected, with whatever else didn't come.
      }
      done++;
      report({ label: "Downloading the public catalog", value: done, maxValue });
    });
    return tokens;
  }

  async function download(
    catalog: Catalog,
    catalogUrl: string,
    known: CatalogCopy | undefined,
    report: (bar: { label: string; value: number; maxValue?: number }) => void,
  ): Promise<CatalogCopy> {
    const tokens = await fetchTokens(catalog, catalogUrl, report);
    const verified = new Map(known?.slates.map((slate) => [slate.token, slate.payload]));
    const slates: CopiedSlate[] = [];
    const maxValue = catalog.entries.length;
    const label = "Checking signatures";
    report({ label, value: 0, maxValue });
    let sliceStart = deps.now();
    for (const [index, entry] of catalog.entries.entries()) {
      const token = tokens.get(entry.path);
      const payload = token ? (verified.get(token) ?? deps.verify(token)) : undefined;
      // The index and the bundle should agree on who signed.
      if (token && payload?.issuer.key === entry.issuer.key) slates.push({ token, payload });
      if (deps.now() - sliceStart >= SLICE_MS) {
        report({ label, value: index + 1, maxValue });
        await deps.yieldToPage();
        sliceStart = deps.now();
      }
    }
    return {
      catalogUrl,
      generatedAt: catalog.generated_at,
      slates,
      rejected: maxValue - slates.length,
    };
  }

  async function run(catalogUrl: string): Promise<void> {
    const showing = status.state === "ready" ? status.copy : undefined;
    let copy = showing?.catalogUrl === catalogUrl ? showing : undefined;
    const report = (bar: { label: string; value: number; maxValue?: number }) => {
      // Whatever's on screen stays there while a newer copy comes in.
      if (!copy) set({ state: "loading", ...bar });
    };
    report({ label: "Opening the public catalog", value: 0 });
    copy ??= await deps.readCopy(catalogUrl).catch(() => undefined);
    if (copy) set({ state: "ready", copy });
    try {
      const catalog = await deps.fetchCatalog(catalogUrl);
      if (copy?.generatedAt !== catalog.generated_at) {
        const next = await download(catalog, catalogUrl, copy, report);
        // Keeping it only saves time next visit: not worth stopping for.
        await deps.writeCopy(next).catch(() => undefined);
        set({ state: "ready", copy: next });
      }
      checkedAt = deps.now();
    } catch (err) {
      // Offline, or the host is down: what's kept is still good.
      if (!copy) set({ state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    load(catalogUrl) {
      if (running) return running;
      const fresh =
        status.state === "ready" &&
        status.copy.catalogUrl === catalogUrl &&
        checkedAt !== undefined &&
        deps.now() - checkedAt < RECHECK_MS;
      if (fresh) return Promise.resolve();
      running = run(catalogUrl).finally(() => {
        running = undefined;
      });
      return running;
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The voter's imported slates and the catalog's together, each token once. A
 * catalog source they haven't imported is `off`: the default for a source
 * nobody decided about is followed, which is only right for something imported.
 */
export function gatherSlates(
  imported: DecodedSlate[],
  catalog: DecodedSlate[],
  follows: Record<string, Standing>,
): { slates: DecodedSlate[]; follows: Record<string, Standing> } {
  const tokens = new Set(imported.map((slate) => slate.token));
  const sources = new Set(imported.map((slate) => slate.source.id));
  const fresh = catalog.filter((slate) => !tokens.has(slate.token));
  const standing = { ...follows };
  for (const { source } of fresh) if (!sources.has(source.id)) standing[source.id] = "off";
  return { slates: [...imported, ...fresh], follows: standing };
}
