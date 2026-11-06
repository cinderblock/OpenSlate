import { useLiveQuery } from "@tanstack/react-db";
import { del, get, set } from "idb-keyval";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type CatalogCopy,
  type CopiedSlate,
  type CopyStatus,
  createCatalogLoader,
} from "./catalogCopy";
import { fetchCatalogBundle, fetchCatalogSlate } from "./catalogImport";
import { decodeSlates, type Race, rememberVerified, verifyAhead } from "./collate";
import { slatesCollection } from "./collections";
import { yieldToPage } from "./decodedSlates";
import { useKnownIdentities } from "./identities";
import { type LinedUp, type LineUpInput, lineUp } from "./lineUp";
import type { LineUpReply, LineUpRequest } from "./lineUp.worker";
import { useFollows } from "./myVote";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG, queryClient } from "./query";

/**
 * Every slate there is to see: the public catalog's and the voter's own,
 * collated. Loaded when a page asks for it, never at startup (catalogCopy.ts
 * says how), and held for the rest of the visit.
 */

/** Its own key rather than the query cache's: that blob is rewritten on every change. */
const COPY_KEY = "openslate.catalogCopy.v1";
/** A check that hasn't finished yet, kept as it goes (`readChecked` in catalogCopy.ts). */
const CHECKED_KEY = "openslate.catalogChecked.v1";

const loader = createCatalogLoader({
  fetchCatalog: (catalogUrl) => queryClient.fetchQuery(catalogQueryOptions(catalogUrl)),
  fetchBundle: fetchCatalogBundle,
  fetchSlate: (entry, catalogUrl) => fetchCatalogSlate(entry, catalogUrl, queryClient),
  verify(token) {
    const [slate] = decodeSlates([{ token, importedAt: "" }]);
    return slate?.valid ? slate.payload : undefined;
  },
  verifyAhead,
  async readCopy(catalogUrl) {
    const copy = await get<CatalogCopy>(COPY_KEY);
    if (copy?.catalogUrl !== catalogUrl) return undefined;
    // Verified when it was kept; browser storage is as trusted as the app.
    for (const slate of copy.slates) rememberVerified(slate.token, slate.payload);
    return copy;
  },
  writeCopy: (copy) => set(COPY_KEY, copy),
  async readChecked(catalogUrl) {
    const kept = await get<{ catalogUrl: string; slates: CopiedSlate[] }>(CHECKED_KEY);
    if (kept?.catalogUrl !== catalogUrl) return [];
    for (const slate of kept.slates) rememberVerified(slate.token, slate.payload);
    return kept.slates;
  },
  writeChecked: (catalogUrl, slates) =>
    slates.length ? set(CHECKED_KEY, { catalogUrl, slates }) : del(CHECKED_KEY),
  yieldToPage,
  now: () => Date.now(),
});

export interface AllRaces extends LinedUp {
  byKey: Map<string, Race>;
}

export interface AllRacesState {
  status: CopyStatus;
  /** Undefined until it's asked for, loaded and lined up. */
  all: AllRaces | undefined;
  /** The slates are in, and they're being lined up into races. */
  preparing: boolean;
  /** Try again after an error. */
  retry: () => void;
}

/** Whether this visit already has the catalog, without asking for it. */
export function useCatalogCopyReady(): boolean {
  return useSyncExternalStore(loader.subscribe, loader.status).state === "ready";
}

/** The last result, so going from page to page doesn't collate it all again. */
let last: { signature: string; all: AllRaces } | undefined;

/** The worker, once it's started; `false` once it's failed and the page does it itself. */
let worker: Worker | false | undefined;
let nextId = 0;
const waiting = new Map<number, (reply: LineUpReply | undefined) => void>();

function startWorker(): Worker | false {
  if (worker !== undefined) return worker;
  try {
    const started = new Worker(new URL("./lineUp.worker.ts", import.meta.url), {
      type: "module",
    });
    started.onmessage = (event: MessageEvent<LineUpReply>) => {
      waiting.get(event.data.id)?.(event.data);
      waiting.delete(event.data.id);
    };
    // A worker that can't start (an old browser, a blocked script): every
    // request still waiting, and every one after, is done on the page instead.
    started.onerror = (event) => {
      event.preventDefault();
      worker = false;
      started.terminate();
      for (const done of waiting.values()) done(undefined);
      waiting.clear();
    };
    worker = started;
  } catch {
    worker = false;
  }
  return worker;
}

/**
 * `lineUp` in a worker, so the page goes on answering while it runs (seconds,
 * over the whole catalog on a phone). On the page itself where there's no
 * worker, or the worker fails.
 */
async function lineUpOffPage(input: LineUpInput): Promise<LinedUp> {
  const off = typeof Worker === "undefined" ? false : startWorker();
  if (off) {
    const id = nextId++;
    const reply = await new Promise<LineUpReply | undefined>((resolve) => {
      waiting.set(id, resolve);
      off.postMessage({ id, input } satisfies LineUpRequest);
    });
    if (reply && "result" in reply) return reply.result;
  }
  // Let the page paint `preparing` first.
  await yieldToPage();
  return lineUp(input);
}

/**
 * Every race. `enabled` is the asking: the catalog isn't touched until it's
 * true. Collating takes long enough to feel on a phone, so it starts after a
 * paint, with `preparing` on the screen.
 */
export function useAllRaces(enabled: boolean): AllRacesState {
  const status = useSyncExternalStore(loader.subscribe, loader.status);
  const { data: rows, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const contacts = useKnownIdentities();
  const [follows] = useFollows();
  const [all, setAll] = useState<AllRaces | undefined>();

  useEffect(() => {
    if (enabled) void loader.load(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG);
  }, [enabled]);

  const copy = status.state === "ready" ? status.copy : undefined;
  const ready = enabled && isReady ? copy : undefined;
  const signature = ready
    ? JSON.stringify([
        ready.generatedAt,
        rows.map((row) => row.token.slice(-16)),
        follows,
        contacts.map((contact) => [contact.publicKey, contact.displayName]),
      ])
    : undefined;

  // `signature` stands for these, which can be new objects on any render.
  const inputs = useRef({ ready, rows, follows, contacts });
  inputs.current = { ready, rows, follows, contacts };

  useEffect(() => {
    if (!signature) return;
    if (last?.signature === signature) {
      setAll(last.all);
      return;
    }
    const { ready, rows, follows, contacts } = inputs.current;
    if (!ready) return;
    let live = true;
    void lineUpOffPage({
      imported: decodeSlates(rows),
      catalog: decodeSlates(
        ready.slates.map(({ token }) => ({ token, importedAt: ready.generatedAt })),
      ),
      follows,
      contacts,
      rejected: ready.rejected,
      generatedAt: ready.generatedAt,
    }).then((linedUp) => {
      const next: AllRaces = {
        ...linedUp,
        byKey: new Map(linedUp.races.map((race) => [race.key, race])),
      };
      last = { signature, all: next };
      if (live) setAll(next);
    });
    return () => {
      live = false;
    };
  }, [signature]);

  return {
    status,
    all: enabled ? all : undefined,
    preparing: Boolean(ready) && !all,
    retry: () => void loader.load(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG),
  };
}
