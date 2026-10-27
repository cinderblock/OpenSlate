import { useSyncExternalStore } from "react";
import type { VerifiedSlate, verifyCatalogSlate } from "./catalogImport";
import { forEachConcurrently } from "./fetchProgress";
import type { Catalog, CatalogEntry } from "./query";

/**
 * Catalog imports that keep going in the background, so setup can hand
 * over to the ballot as soon as the voter has picked and they can look around
 * while their sources download. Slates are stored as they're checked, in
 * batches, so the ballot fills in as it goes. Imports started while one is
 * running wait their turn.
 *
 * No storage or network here: `createImportQueue` takes them as `ImportDeps`
 * (wired up in catalogImport.ts), so this is unit-tested in
 * test/importQueue.test.ts.
 */

export interface CatalogImportJob {
  /** `update`: replacing slates the user has with the catalog's newer ones (catalogUpdates.ts). */
  kind?: "import" | "update";
  catalog: Catalog;
  catalogUrl: string;
  entries: CatalogEntry[];
  /** What the bar says while the slates come in. */
  label: string;
  /** Fetch every slate in one request from the catalog's bundle, when it has one. */
  bundle?: boolean;
  /** Called for each entry whose slate is in, newly stored or already there. */
  onImported?: (entry: CatalogEntry) => void;
  /** Why an entry's checked slate mustn't be stored, or undefined when it may. */
  check?: (entry: CatalogEntry, token: string) => string | undefined;
  /** Tokens an entry's slate replaces: removed once it's stored. */
  replaces?: (entry: CatalogEntry) => readonly string[];
}

export interface ImportStatus {
  kind: "import" | "update";
  state: "running" | "done";
  /** What the bar shows. No `maxValue`: the total isn't known yet. */
  label: string;
  value: number;
  maxValue?: number;
  /** Entries of the current import whose slates are in. */
  imported: number;
  /** Entries of the current import that didn't import, each with why. */
  errors: string[];
  /** Imports waiting behind this one. */
  queued: number;
}

export interface ImportDeps {
  fetchBundle: (
    catalog: Catalog,
    catalogUrl: string,
    onProgress: (received: number, total: number | undefined) => void,
  ) => Promise<Map<string, string>>;
  fetchSlate: (entry: CatalogEntry, catalogUrl: string) => Promise<string>;
  verify: (token: string, known: { has(token: string): boolean }) => VerifyOutcome;
  /** Store checked slates, all in one transaction. */
  store: (slates: VerifiedSlate[], kind: "import" | "update") => void;
  /** Remove slates, all in one transaction. */
  remove: (tokens: string[]) => void;
  isStored: (token: string) => boolean;
}

type VerifyOutcome = ReturnType<typeof verifyCatalogSlate>;

export interface ImportQueue {
  start: (job: CatalogImportJob) => Promise<void>;
  /** The current (or last finished) import, or null when there's nothing to show. */
  status: () => ImportStatus | null;
  subscribe: (listener: () => void) => () => void;
  /** Forget a finished import's status. Does nothing while one is running. */
  dismiss: () => void;
}

/** Slates downloaded at once. */
const CONCURRENCY = 6;

export function createImportQueue(
  deps: ImportDeps,
  {
    /** Store what's been checked at most this often, so the ballot fills in as it goes. */
    flushMs = 1500,
  }: { flushMs?: number } = {},
): ImportQueue {
  let status: ImportStatus | null = null;
  /** Imports waiting their turn, each with how to tell its caller it's done. */
  const waiting: Array<{ job: CatalogImportJob; done: () => void }> = [];
  let active = false;
  const listeners = new Set<() => void>();

  function set(next: ImportStatus | null): void {
    status = next;
    for (const listener of listeners) listener();
  }

  async function run(job: CatalogImportJob): Promise<void> {
    const kind = job.kind ?? "import";
    const errors: string[] = [];
    let imported = 0;
    const report = (bar: { label: string; value: number; maxValue?: number }) =>
      set({
        kind,
        state: "running",
        ...bar,
        imported,
        errors: [...errors],
        queued: waiting.length,
      });

    // Everything at once from the catalog's bundle when it has one, so even
    // the order of requests says nothing about which sources were picked.
    let bundled: Map<string, string> | undefined;
    if (job.bundle && job.catalog.bundle) {
      const label = "Downloading every organization's endorsements";
      const bar = (value: number, maxValue: number | undefined) =>
        report({ label, value, ...(maxValue ? { maxValue } : {}) });
      bar(0, job.catalog.bundle.bytes);
      try {
        bundled = await deps.fetchBundle(job.catalog, job.catalogUrl, bar);
      } catch {
        // Fetch them one by one instead.
      }
    }

    const total = job.entries.length;
    report({ label: job.label, value: 0, maxValue: total });
    const pending: VerifiedSlate[] = [];
    /** Replaced slates, removed after their replacements are stored so the ballot never lacks both. */
    const replaced: string[] = [];
    const seen = new Set<string>();
    const known = { has: (token: string) => seen.has(token) || deps.isStored(token) };
    let stored = 0;
    let flushedAt = Date.now();
    const flush = () => {
      stored += pending.length;
      if (pending.length > 0) deps.store(pending.splice(0), kind);
      if (replaced.length > 0) deps.remove(replaced.splice(0));
      flushedAt = Date.now();
    };
    // Each store re-collates the whole ballot (after the call returns, so its
    // cost can't be timed here). Waiting for as many new slates as are stored
    // already keeps the stores few as it grows: all of them together cost at
    // most about twice the last one.
    const due = () => Date.now() - flushedAt >= flushMs && pending.length >= Math.max(1, stored);

    let done = 0;
    try {
      await forEachConcurrently(job.entries, CONCURRENCY, async (entry) => {
        const name = entry.attribution?.of.name ?? entry.slug;
        let token = bundled?.get(entry.path);
        try {
          token ??= await deps.fetchSlate(entry, job.catalogUrl);
        } catch (err) {
          errors.push(`${name}: ${errorMessage(err)}`);
        }
        if (token) {
          const result = deps.verify(token, known);
          const problem = result.kind === "error" ? result.error : job.check?.(entry, token);
          if (problem) {
            errors.push(`${name}: ${problem}`);
          } else if (result.kind !== "error") {
            if (result.kind === "verified") {
              pending.push(result.slate);
              seen.add(result.slate.token);
            }
            for (const old of job.replaces?.(entry) ?? []) if (old !== token) replaced.push(old);
            imported++;
            job.onImported?.(entry);
          }
          // Checking hundreds of signatures in a row would freeze the page.
          await new Promise((resolve) => setTimeout(resolve));
        }
        done++;
        if (due()) flush();
        report({ label: job.label, value: done, maxValue: total });
      });
      flush();
    } catch (err) {
      errors.push(errorMessage(err));
    }
    set({
      kind,
      state: "done",
      label: job.label,
      value: done,
      maxValue: total,
      imported,
      errors,
      queued: waiting.length,
    });
  }

  /** Run the waiting imports one after another. `run` reports its first status before it awaits. */
  async function drain(): Promise<void> {
    active = true;
    for (let next = waiting.shift(); next; next = waiting.shift()) {
      await run(next.job);
      next.done();
    }
    active = false;
  }

  return {
    start(job) {
      return new Promise((done) => {
        waiting.push({ job, done });
        if (!active) void drain();
        else if (status) set({ ...status, queued: waiting.length });
      });
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismiss() {
      if (status?.state === "done") set(null);
    },
  };
}

export function useImportStatus(queue: ImportQueue): ImportStatus | null {
  return useSyncExternalStore(queue.subscribe, queue.status);
}

/** Whether an import is running; unlike `useImportStatus`, doesn't re-render on every tick. */
export function useImportRunning(queue: ImportQueue): boolean {
  return useSyncExternalStore(queue.subscribe, () => queue.status()?.state === "running");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
