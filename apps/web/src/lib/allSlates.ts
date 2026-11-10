import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CatalogQuestion, FromCatalogWorker, ToCatalogWorker } from "./catalog.worker";
import { storedDeps } from "./catalogDeps";
import { fetchCatalogSlate } from "./catalogImport";
import { scopeRegions, useCatalogScope } from "./catalogScope";
import {
  type CatalogService,
  type CatalogStatus,
  createCatalogService,
  type LineUpAsk,
} from "./catalogService";
import type { Race } from "./collate";
import { slatesCollection } from "./collections";
import { useKnownIdentities } from "./identities";
import type { LinedUp } from "./lineUp";
import { useFollows } from "./myVote";
import {
  type Catalog,
  catalogQueryOptions,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  queryClient,
} from "./query";

/**
 * Every slate there is to see: the public catalog's and the voter's own,
 * collated. Loaded when a page asks for it, never at startup (catalogCopy.ts
 * says how), and held for the rest of the visit.
 *
 * The work happens in the catalog worker (catalog.worker.ts): downloading and
 * parsing the bundle, checking several hundred signatures, keeping the copy,
 * lining up every race. On a phone that was most of a minute of the page
 * stuttering. Where a worker can't start, the same work runs on the page
 * (catalogService.ts), a slice at a time.
 */

/** The page's half of the worker's questions: through its query cache, which other pages share. */
function answer(question: CatalogQuestion): Promise<unknown> {
  return question.what === "catalog"
    ? queryClient.fetchQuery(catalogQueryOptions(question.catalogUrl))
    : fetchCatalogSlate(question.entry, question.catalogUrl, queryClient);
}

function onThePage(): CatalogService {
  return createCatalogService({
    ...storedDeps,
    fetchCatalog: (catalogUrl) => answer({ what: "catalog", catalogUrl }) as Promise<Catalog>,
    fetchSlate: (entry, catalogUrl) =>
      answer({ what: "slate", entry, catalogUrl }) as Promise<string>,
  });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The catalog in a worker; undefined where one can't be made. `onFail` if it dies. */
function inAWorker(onFail: () => void): CatalogService | undefined {
  if (typeof Worker === "undefined") return undefined;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./catalog.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return undefined;
  }
  let status: CatalogStatus = { state: "idle" };
  const listeners = new Set<() => void>();
  let nextId = 0;
  const waiting = new Map<number, { resolve: (v: LinedUp) => void; reject: (e: Error) => void }>();
  const send = (message: ToCatalogWorker) => worker.postMessage(message);

  worker.onmessage = (event: MessageEvent<FromCatalogWorker>) => {
    const message = event.data;
    if (message.type === "status") {
      status = message.status;
      for (const listener of listeners) listener();
    } else if (message.type === "linedUp") {
      const done = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.result) done?.resolve(message.result);
      else done?.reject(new Error(message.error ?? "nothing came back"));
    } else {
      const { id } = message;
      answer(message.question).then(
        (value) => send({ type: "answer", id, value }),
        (err) => send({ type: "answer", id, error: errorText(err) }),
      );
    }
  };
  // A worker that can't load (an old browser, a blocked script) or dies.
  worker.onerror = (event) => {
    event.preventDefault();
    worker.terminate();
    for (const done of waiting.values()) done.reject(new Error("the catalog worker stopped"));
    waiting.clear();
    onFail();
  };

  return {
    load: (catalogUrl, changed) =>
      send({ type: "load", catalogUrl, ...(changed ? { changed } : {}) }),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lineUp: (ask) =>
      new Promise<LinedUp>((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        send({ type: "lineUp", id, ask });
      }),
  };
}

const IDLE: CatalogStatus = { state: "idle" };

/** The worker once something asks, or the page if the worker can't be had. */
const catalog = (() => {
  let current: CatalogService | undefined;
  let unsubscribe: (() => void) | undefined;
  let loading: string | undefined;
  /** The regions the catalog was last asked for, to tell a change of them from a revisit. */
  let askedFor: string | undefined;
  /** Counts switches to the page, so a lining up the worker dropped is asked again. */
  let generation = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  function use(next: CatalogService) {
    unsubscribe?.();
    current = next;
    unsubscribe = next.subscribe(notify);
  }
  function fallBack() {
    generation++;
    const page = onThePage();
    use(page);
    if (loading) page.load(loading);
    notify();
  }
  function started(): CatalogService {
    if (!current) use(inAWorker(fallBack) ?? onThePage());
    return current as CatalogService;
  }
  return {
    /** `regions`: the voter's (catalogScope.ts), so new ones are fetched now, not at the next check. */
    load(catalogUrl: string, regions: string) {
      const changed = askedFor !== undefined && askedFor !== regions;
      askedFor = regions;
      loading = catalogUrl;
      started().load(catalogUrl, changed);
    },
    status: () => current?.status() ?? IDLE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lineUp: (ask: LineUpAsk) => started().lineUp(ask),
    generation: () => generation,
  };
})();

export interface AllRaces extends LinedUp {
  byKey: Map<string, Race>;
}

export interface AllRacesState {
  status: CatalogStatus;
  /** Undefined until it's asked for, loaded and lined up. */
  all: AllRaces | undefined;
  /** The slates are in, and they're being lined up into races. */
  preparing: boolean;
  /** Try again after an error. */
  retry: () => void;
}

/** Whether this visit already has the catalog, without asking for it. */
export function useCatalogCopyReady(): boolean {
  return useSyncExternalStore(catalog.subscribe, catalog.status).state === "ready";
}

/** The last result, so going from page to page doesn't collate it all again. */
let last: { signature: string; all: AllRaces } | undefined;

/**
 * Every race. `enabled` is the asking: the catalog isn't touched until it's
 * true. Until it's lined up, `preparing` is on the screen.
 */
export function useAllRaces(enabled: boolean): AllRacesState {
  const status = useSyncExternalStore(catalog.subscribe, catalog.status);
  const { data: rows, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const contacts = useKnownIdentities();
  const [follows] = useFollows();
  const [all, setAll] = useState<AllRaces | undefined>();
  const [scope] = useCatalogScope();
  const regions = scopeRegions(scope).join();

  useEffect(() => {
    if (enabled) catalog.load(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG, regions);
  }, [enabled, regions]);

  // A copy for other regions is being replaced: its races aren't these regions'.
  const replacing = status.state === "loading";
  useEffect(() => {
    if (replacing) setAll(undefined);
  }, [replacing]);

  const copy = status.state === "ready" ? status.copy : undefined;
  const ready = enabled && isReady ? copy : undefined;
  const signature = ready
    ? JSON.stringify([
        catalog.generation(),
        ready.revision,
        rows.map((row) => row.token.slice(-16)),
        follows,
        contacts.map((contact) => [contact.publicKey, contact.displayName]),
      ])
    : undefined;

  // `signature` stands for these, which can be new objects on any render.
  const inputs = useRef({ rows, follows, contacts });
  inputs.current = { rows, follows, contacts };

  useEffect(() => {
    if (!signature) return;
    if (last?.signature === signature) {
      setAll(last.all);
      return;
    }
    const { rows, follows, contacts } = inputs.current;
    let live = true;
    catalog
      .lineUp({
        // Plain rows: they cross to the worker.
        rows: rows.map(({ token, importedAt }) => ({ token, importedAt })),
        follows,
        contacts: contacts.map(({ publicKey, displayName }) => ({
          publicKey,
          ...(displayName !== undefined ? { displayName } : {}),
        })),
      })
      .then(
        (linedUp) => {
          const next: AllRaces = {
            ...linedUp,
            byKey: new Map(linedUp.races.map((race) => [race.key, race])),
          };
          last = { signature, all: next };
          if (live) setAll(next);
        },
        // The worker stopped (the page picks it up, and `generation` asks
        // again), or a newer copy is on its way: either way, nothing to show.
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [signature]);

  return {
    status,
    all: enabled ? all : undefined,
    preparing: Boolean(ready) && !all,
    retry: () => catalog.load(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG, regions),
  };
}
