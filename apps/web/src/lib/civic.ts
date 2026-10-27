import {
  type CivicBallot,
  type CivicElection,
  civicUrl,
  normalizeVoterInfo,
  parseCivicElections,
  readCivic,
  type VipVoterInfo,
} from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { createLocalStore, useLocalStore } from "./localStore";
import { apiBase } from "./routing";

/**
 * The two ways this browser can reach Google's Civic Information API (the
 * elections list, and the contests on an address's ballot). See
 * plans/google-civic-two-ways.md.
 *
 * - `key`: with the user's own Google API key, straight to Google. The key is
 *   kept in this browser and goes nowhere but Google.
 * - `relay`: through OpenSlate's relay (the public worker, or a self-hosted
 *   apps/server on the same origin), which asks Google with its own key.
 */
export type CivicRoute = "key" | "relay";

const keyStore = createLocalStore<string>("openslate.googleCivicKey.v1", "", (raw) =>
  typeof raw === "string" ? raw : undefined,
);

/** The user's own Google API key ("" when none), and a setter ("" forgets it). */
export function useGoogleKey(): [string, (key: string) => void] {
  const [key, set] = useLocalStore(keyStore);
  return [key, (next) => set(next.trim())];
}

/** Where the relay answers: the public worker in production, same origin (apps/server) in dev. */
export function civicRelayBase(): string {
  return apiBase();
}

/** Whether the relay can ask Google (it reports `civic: true` once it has a key). */
export function civicRelayHealthOptions() {
  const base = civicRelayBase();
  return {
    queryKey: ["civic-relay", base] as const,
    queryFn: async (): Promise<boolean> => {
      // A static host 404s and the dev proxy 500s when no server runs.
      const response = await fetch(`${base}/api/health`).catch(() => null);
      if (!response?.ok) return false;
      const body = (await response.json().catch(() => null)) as { civic?: unknown } | null;
      return body?.civic === true;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

/** The routes this browser can use right now, own key first, and the key. */
export function useCivicRoutes(): { routes: CivicRoute[]; key: string; isLoading: boolean } {
  const [key] = useGoogleKey();
  const relay = useQuery(civicRelayHealthOptions());
  const routes: CivicRoute[] = [];
  if (key) routes.push("key");
  if (relay.data) routes.push("relay");
  return { routes, key, isLoading: relay.isLoading };
}

// The page sends no referrer anywhere (Referrer-Policy: no-referrer), but a
// key restricted to openslate.us needs one: these requests name our origin
// (never the page or its #route).
const DIRECT: RequestInit = { referrerPolicy: "origin" };

async function relayAnswer(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `OpenSlate's relay answered ${response.status}`);
}

/** Google's list of elections it has data for, by date. */
export async function civicElections(route: CivicRoute, key: string): Promise<CivicElection[]> {
  if (route === "key") {
    return parseCivicElections(await readCivic(await fetch(civicUrl("elections", key), DIRECT)));
  }
  return parseCivicElections(
    await relayAnswer(await fetch(`${civicRelayBase()}/api/civic/elections`)),
  );
}

/** The contests on an address's ballot. Call only with the user's consent for `route`. */
export async function civicBallot(
  route: CivicRoute,
  key: string,
  address: string,
  electionId?: string,
): Promise<CivicBallot> {
  if (route === "key") {
    const params: Record<string, string> = { address };
    if (electionId) params.electionId = electionId;
    const response = await fetch(civicUrl("voterinfo", key, params), {
      ...DIRECT,
      cache: "no-store",
    });
    return normalizeVoterInfo((await readCivic(response)) as VipVoterInfo);
  }
  const response = await fetch(`${civicRelayBase()}/api/civic/voterinfo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(electionId ? { address, electionId } : { address }),
    cache: "no-store",
  });
  return (await relayAnswer(response)) as CivicBallot;
}

export type CivicLookup = "ballot" | "elections" | "key-check";

const LOOKUP_NAMES: Record<CivicLookup, string> = {
  ballot: "the ballot lookup for an address",
  elections: "the elections list",
  "key-check": "checking my key in Settings",
};

/**
 * A problem report for a failed Google lookup, for the feedback dialog (the
 * user still reviews and sends it). It names the lookup and the route and
 * quotes the error, never the address, and never a key should an error ever
 * quote one.
 */
export function civicProblemReport(
  lookup: CivicLookup,
  route: CivicRoute,
  message: string,
): string {
  return [
    "A Google Civic Information lookup failed.",
    "",
    `Lookup: ${LOOKUP_NAMES[lookup]}`,
    `Route: ${route === "key" ? "with my own Google API key" : "through OpenSlate's relay"}`,
    `Error: ${message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[a key]")}`,
  ].join("\n");
}

/** Google's elections list by `route`; disabled when there's no route. */
export function civicElectionsQueryOptions(route: CivicRoute | undefined, key: string) {
  return {
    // The key itself stays out of the (persisted) query cache.
    queryKey: ["civic-elections", route ?? "none"] as const,
    queryFn: () => civicElections(route ?? "relay", key),
    enabled: route !== undefined,
    staleTime: 1000 * 60 * 60,
  };
}
