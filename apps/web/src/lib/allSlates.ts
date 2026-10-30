import { useLiveQuery } from "@tanstack/react-db";
import { get, set } from "idb-keyval";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { expandAdoptions } from "./adoptions";
import { translateSlates } from "./ballotCheck";
import {
  type CatalogCopy,
  type CopyStatus,
  createCatalogLoader,
  gatherSlates,
} from "./catalogCopy";
import { fetchCatalogBundle, fetchCatalogSlate } from "./catalogImport";
import {
  collateRaces,
  type DecodedSlate,
  decodeSlates,
  type ElectionSummary,
  electionsOf,
  type Race,
  rememberVerified,
} from "./collate";
import { slatesCollection } from "./collections";
import { useKnownIdentities } from "./identities";
import { useFollows, withNicknames } from "./myVote";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG, queryClient } from "./query";
import type { Follows } from "./sources";

/**
 * Every slate there is to see: the public catalog's and the voter's own,
 * collated. Loaded when a page asks for it, never at startup (catalogCopy.ts
 * says how), and held for the rest of the visit.
 */

/** Its own key rather than the query cache's: that blob is rewritten on every change. */
const COPY_KEY = "openslate.catalogCopy.v1";

/** The next task, without `setTimeout`'s once-a-second crawl in a background tab. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

const loader = createCatalogLoader({
  fetchCatalog: (catalogUrl) => queryClient.fetchQuery(catalogQueryOptions(catalogUrl)),
  fetchBundle: fetchCatalogBundle,
  fetchSlate: (entry, catalogUrl) => fetchCatalogSlate(entry, catalogUrl, queryClient),
  verify(token) {
    const [slate] = decodeSlates([{ token, importedAt: "" }]);
    return slate?.valid ? slate.payload : undefined;
  },
  async readCopy(catalogUrl) {
    const copy = await get<CatalogCopy>(COPY_KEY);
    if (copy?.catalogUrl !== catalogUrl) return undefined;
    // Verified when it was kept; browser storage is as trusted as the app.
    for (const slate of copy.slates) rememberVerified(slate.token, slate.payload);
    return copy;
  },
  writeCopy: (copy) => set(COPY_KEY, copy),
  yieldToPage,
  now: () => Date.now(),
});

export interface AllRaces {
  /** Imported and catalog slates, adoptions expanded, in the ballot's spellings. */
  slates: DecodedSlate[];
  /** The voter's follows, with 0 for every catalog source they haven't imported. */
  follows: Follows;
  /** Every race, in ballot order. */
  races: Race[];
  byKey: Map<string, Race>;
  elections: ElectionSummary[];
  /** Catalog entries that couldn't be used. */
  rejected: number;
  generatedAt: string;
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
    const timer = setTimeout(() => {
      const { ready, rows, follows, contacts } = inputs.current;
      if (!ready) return;
      const next = lineUp(ready, decodeSlates(rows), follows, contacts);
      last = { signature, all: next };
      setAll(next);
    });
    return () => clearTimeout(timer);
  }, [signature]);

  return {
    status,
    all: enabled ? all : undefined,
    preparing: Boolean(ready) && !all,
    retry: () => void loader.load(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG),
  };
}

function lineUp(
  copy: CatalogCopy,
  imported: DecodedSlate[],
  follows: Follows,
  contacts: Parameters<typeof withNicknames>[1],
): AllRaces {
  const catalog = decodeSlates(
    copy.slates.map(({ token }) => ({ token, importedAt: copy.generatedAt })),
  );
  const gathered = gatherSlates(imported, catalog, follows);
  const slates = withNicknames(translateSlates(expandAdoptions(gathered.slates)), contacts);
  const races = collateRaces(slates, { follows: gathered.follows, includeUnfollowed: true });
  return {
    slates,
    follows: gathered.follows,
    races,
    byKey: new Map(races.map((race) => [race.key, race])),
    elections: electionsOf(slates, gathered.follows),
    rejected: copy.rejected,
    generatedAt: copy.generatedAt,
  };
}
