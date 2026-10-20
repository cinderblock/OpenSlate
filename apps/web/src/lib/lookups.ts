import { createLocalStore, useLocalStore } from "./localStore";
import { envBase } from "./routing";

/**
 * The online ways to find someone's districts from a typed address, and the
 * consent each needs. Every one sends the address somewhere, so none runs
 * until the user has opted in to that one (remembered, revocable in
 * Settings). The on-device ways (map, "Use my location") need no consent from
 * us and live in geo.ts. See plans/find-my-districts.md.
 */

export type OnlineLookup = "osm" | "census" | "server";

export interface OnlineLookupInfo {
  key: OnlineLookup;
  /** Button / option label. */
  name: string;
  /** Who receives the address, in words. */
  recipient: string;
  /** One line on what happens, shown before opting in. */
  how: string;
  /** Their privacy policy or terms. */
  policyUrl: string;
}

/** The relay's host when it's a separate origin (the public worker), else "" (same origin). */
const relayHost = (() => {
  try {
    return new URL(envBase("VITE_POLLS_BASE", "")).host;
  } catch {
    return "";
  }
})();

export const ONLINE_LOOKUPS: Record<OnlineLookup, OnlineLookupInfo> = {
  osm: {
    key: "osm",
    name: "OpenStreetMap",
    recipient: "the OpenStreetMap Foundation (Nominatim)",
    how: "Your browser sends the address straight to OpenStreetMap's search, gets back a point on the map, and this device works out the districts from it.",
    policyUrl: "https://osmfoundation.org/wiki/Privacy_Policy",
  },
  census: {
    key: "census",
    name: "US Census Bureau",
    recipient: relayHost
      ? `OpenSlate's relay (${relayHost}), which passes it to the US Census Bureau geocoder`
      : "this site's OpenSlate server, which passes it to the US Census Bureau geocoder",
    how: "The Census Bureau matches the address to its official district maps. Our relay only forwards it: nothing is stored, logged or cached.",
    policyUrl: "https://www.census.gov/about/policies/privacy.html",
  },
  server: {
    key: "server",
    name: "Your server (Google)",
    recipient: "your self-hosted OpenSlate server, which asks Google's Civic Information API",
    how: "Google returns the contests on that address's ballot; their districts fill in yours. Only offered when your own server has a Google key.",
    policyUrl: "https://policies.google.com/privacy",
  },
};

type Consents = Partial<Record<OnlineLookup, string>>;

const consentStore = createLocalStore<Consents>("openslate.lookupConsent.v1", {}, (raw) => {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Consents = {};
  for (const key of Object.keys(ONLINE_LOOKUPS) as OnlineLookup[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
});

/** Which online lookups the user has opted in to (key → when), and grant/revoke. */
export function useLookupConsent(): {
  consents: Consents;
  grant: (key: OnlineLookup) => void;
  revoke: (key: OnlineLookup) => void;
} {
  const [consents, set] = useLocalStore(consentStore);
  return {
    consents,
    grant: (key) => set((c) => ({ ...c, [key]: new Date().toISOString() })),
    revoke: (key) =>
      set((c) => {
        const { [key]: _, ...rest } = c;
        return rest;
      }),
  };
}

/** A geocoder's answer: where an address is, and (Census) its districts. */
export interface AddressMatch {
  /** The address as the service understood it. */
  label: string;
  lon: number;
  lat: number;
  /** Postal code of the state, e.g. "CA", when the service says. */
  state?: string;
  /** Census only: districts from the official maps. */
  districts?: { cd?: string; sd?: string; ad?: string };
  county?: string;
  place?: string;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
/** Nominatim's usage policy: at most one request per second. */
const NOMINATIM_INTERVAL_MS = 1100;
let lastNominatim = 0;

async function politeDelay(): Promise<void> {
  const wait = lastNominatim + NOMINATIM_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatim = Date.now();
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { state?: string; "ISO3166-2-lvl4"?: string };
}

/** Parse Nominatim's jsonv2 search results. Pure; exported for tests. */
export function parseNominatim(json: unknown): AddressMatch[] {
  if (!Array.isArray(json)) throw new Error("unexpected OpenStreetMap response");
  const out: AddressMatch[] = [];
  for (const r of json as NominatimResult[]) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const iso = r.address?.["ISO3166-2-lvl4"];
    out.push({
      label: r.display_name ?? `${lat}, ${lon}`,
      lon,
      lat,
      ...(iso?.startsWith("US-") ? { state: iso.slice(3) } : {}),
    });
  }
  return out;
}

/** Search OpenStreetMap for a US address. Call only with the user's consent. */
export async function searchOpenStreetMap(address: string): Promise<AddressMatch[]> {
  await politeDelay();
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    countrycodes: "us",
    addressdetails: "1",
    limit: "5",
  });
  const response = await fetch(`${NOMINATIM}?${params}`, {
    // The page sends no referrer anywhere (Referrer-Policy: no-referrer);
    // Nominatim's policy asks apps to identify themselves, so this one request
    // names our origin (never the page or its #route).
    referrerPolicy: "origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OpenStreetMap answered ${response.status}`);
  return parseNominatim(await response.json());
}

/** Where the Census relay answers: the public worker in production, same origin (apps/server) in dev. */
export function censusRelayUrl(): string {
  return `${envBase("VITE_POLLS_BASE", "")}/api/geocode/census`;
}

interface RelayMatch {
  address?: string;
  lon?: number;
  lat?: number;
  state?: string;
  districts?: AddressMatch["districts"];
  county?: string;
  place?: string;
}

/** Parse the relay's answer (apps/poll-cache/src/geocode.ts). Pure; exported for tests. */
export function parseCensusRelay(json: unknown): AddressMatch[] {
  const matches = (json as { matches?: RelayMatch[] })?.matches;
  if (!Array.isArray(matches)) throw new Error("unexpected answer from the Census relay");
  return matches
    .filter((m) => typeof m.lon === "number" && typeof m.lat === "number")
    .map((m) => ({
      label: m.address ?? "",
      lon: m.lon as number,
      lat: m.lat as number,
      ...(m.state ? { state: m.state } : {}),
      districts: m.districts ?? {},
      ...(m.county ? { county: m.county } : {}),
      ...(m.place ? { place: m.place } : {}),
    }));
}

/** Look an address up through the Census relay. Call only with the user's consent. */
export async function searchCensus(address: string): Promise<AddressMatch[]> {
  const response = await fetch(censusRelayUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined);
    throw new Error(detail ?? `the Census relay answered ${response.status}`);
  }
  return parseCensusRelay(await response.json());
}
