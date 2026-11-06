import {
  type CatalogCopy,
  type CopyDeps,
  type CopyStatus,
  createCatalogLoader,
} from "./catalogCopy";
import { type DecodedSlate, decodeSlates, verifyAhead } from "./collate";
import { type LinedUp, type LineUpInput, lineUp } from "./lineUp";
import { yieldToPage } from "./yieldToPage";

/**
 * The public catalog, held where it's checked and lined up: in the catalog
 * worker (catalog.worker.ts) normally, on the page where a worker can't start
 * (allSlates.ts picks). Either way the page sees only this: how loading is
 * going, and the races once it asks. The catalog's slates (several MB of
 * payloads) never cross to the page, which never needs them.
 */

/** What the page needs to know of a ready copy. */
export interface CatalogSummary {
  catalogUrl: string;
  generatedAt: string;
  /** Slates that verified. */
  slates: number;
  /** Entries that couldn't be used. */
  rejected: number;
}

export type CatalogStatus =
  | Exclude<CopyStatus, { state: "ready" }>
  | { state: "ready"; copy: CatalogSummary };

/** An imported slate, as the database holds it. */
export interface ImportedRow {
  token: string;
  importedAt: string;
}

/** What lining up needs besides the catalog: the voter's own slates and settings. */
export interface LineUpAsk {
  rows: ImportedRow[];
  follows: LineUpInput["follows"];
  contacts: LineUpInput["contacts"];
}

export interface CatalogService {
  load: (catalogUrl: string) => void;
  status: () => CatalogStatus;
  subscribe: (listener: () => void) => () => void;
  /** Every race, from the copy that's ready and the voter's own slates. */
  lineUp: (ask: LineUpAsk) => Promise<LinedUp>;
}

export function summarize(status: CopyStatus): CatalogStatus {
  if (status.state !== "ready") return status;
  const { catalogUrl, generatedAt, slates, rejected } = status.copy;
  return { state: "ready", copy: { catalogUrl, generatedAt, slates: slates.length, rejected } };
}

export function createCatalogService(deps: CopyDeps): CatalogService {
  const loader = createCatalogLoader(deps);
  // The same object back while nothing changed, as useSyncExternalStore needs.
  let seen: CopyStatus | undefined;
  let summary: CatalogStatus = { state: "idle" };
  const status = () => {
    const now = loader.status();
    if (now !== seen) {
      seen = now;
      summary = summarize(now);
    }
    return summary;
  };
  // The copy's slates decoded once, not on every lining up.
  const decoded = new WeakMap<CatalogCopy, DecodedSlate[]>();

  return {
    load: (catalogUrl) => void loader.load(catalogUrl),
    status,
    subscribe: loader.subscribe,
    async lineUp({ rows, follows, contacts }) {
      const current = loader.status();
      if (current.state !== "ready") throw new Error("the catalog isn't loaded");
      const copy = current.copy;
      let catalog = decoded.get(copy);
      if (!catalog) {
        catalog = decodeSlates(
          copy.slates.map(({ token }) => ({ token, importedAt: copy.generatedAt })),
        );
        decoded.set(copy, catalog);
      }
      // The voter's own, all at once through the browser's Ed25519.
      await verifyAhead(rows.map((row) => row.token));
      // On the page, let it paint `preparing` before the long part.
      await yieldToPage();
      return lineUp({
        imported: decodeSlates(rows),
        catalog,
        follows,
        contacts,
        rejected: copy.rejected,
        generatedAt: copy.generatedAt,
      });
    },
  };
}
