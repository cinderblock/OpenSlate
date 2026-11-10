/**
 * Address → districts relay for the web app's "Find my districts" (opt-in;
 * see plans/find-my-districts.md). The US Census geocoder answers keyless but
 * without CORS headers, so a browser can't read it directly; this forwards one
 * address and returns only what the app needs.
 *
 * Privacy: the address arrives in a POST body, so it never sits in a URL or a
 * request log here. It is passed to Census and forgotten: no cache (in either
 * direction), no logging, no storage.
 */
import { censusDistrictId } from "@openslate/core/districts";

const CENSUS_UPSTREAM = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
/** TIGERweb layers: 120th Congress, 2026 State Senate, 2026 Assembly, counties, cities, county subdivisions. */
const CENSUS_LAYERS = "54,56,58,82,28,22";
/** Census rejects longer addresses. */
export const MAX_ADDRESS_LENGTH = 100;

export const GEOCODE_PATH = "/api/geocode/census";

export interface GeocodeMatch {
  /** The address as Census matched it. */
  address: string;
  lon: number;
  lat: number;
  /** Two-letter postal code, e.g. "CA". */
  state?: string;
  districts: { cd?: string; sd?: string; ad?: string };
  county?: string;
  /** The county's whole name: "Orleans Parish", "Middlesex County". */
  countyName?: string;
  /** Incorporated city, if any. */
  place?: string;
  /**
   * The town or township, where it is a government of its own and not an
   * incorporated place (New England, New York, the Midwest): the Census's
   * whole name for it ("Washington township") and the name alone.
   */
  town?: { name: string; basename: string };
}

export interface GeocodeResponse {
  matches: GeocodeMatch[];
  source: string;
}

interface CensusGeography {
  BASENAME?: string;
  NAME?: string;
  /** `A`: an active government; `B`: one partly consolidated, with its own officers. */
  FUNCSTAT?: string;
}

interface CensusMatch {
  matchedAddress?: string;
  coordinates?: { x?: number; y?: number };
  addressComponents?: { state?: string };
  geographies?: Record<string, CensusGeography[]>;
}

function firstOf(
  geographies: Record<string, CensusGeography[]>,
  test: RegExp,
): CensusGeography | undefined {
  const key = Object.keys(geographies).find((k) => test.test(k));
  return key ? geographies[key]?.[0] : undefined;
}

function first(geographies: Record<string, CensusGeography[]>, test: RegExp): string | undefined {
  return firstOf(geographies, test)?.BASENAME;
}

/** Census geocoder JSON → the trimmed matches the app reads. Pure. */
export function trimCensus(json: unknown): GeocodeMatch[] {
  const matches = (json as { result?: { addressMatches?: CensusMatch[] } })?.result?.addressMatches;
  if (!Array.isArray(matches)) throw new Error("unexpected Census response");
  const out: GeocodeMatch[] = [];
  for (const m of matches) {
    const lon = m.coordinates?.x;
    const lat = m.coordinates?.y;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    const g = m.geographies ?? {};
    const districts: GeocodeMatch["districts"] = {};
    // As ids are spelled everywhere (core's districts.ts): Minnesota's 35A is
    // `35a`, Massachusetts' Third Middlesex `third-middlesex`, a state's one
    // at-large House district `1`.
    const cd = censusDistrictId(first(g, /Congressional Districts$/));
    const sd = censusDistrictId(first(g, /State Legislative Districts - Upper$/));
    const ad = censusDistrictId(first(g, /State Legislative Districts - Lower$/));
    if (cd) districts.cd = cd;
    if (sd) districts.sd = sd;
    if (ad) districts.ad = ad;
    const county = firstOf(g, /^Counties$/);
    const place = first(g, /^Incorporated Places$/);
    // A county subdivision that is a government (the others are the Census's
    // own bookkeeping, or a city's twin).
    const sub = firstOf(g, /^County Subdivisions$/);
    const town =
      sub?.NAME && sub.BASENAME && (sub.FUNCSTAT === "A" || sub.FUNCSTAT === "B")
        ? { name: sub.NAME, basename: sub.BASENAME }
        : undefined;
    out.push({
      address: m.matchedAddress ?? "",
      lon,
      lat,
      ...(m.addressComponents?.state ? { state: m.addressComponents.state } : {}),
      districts,
      ...(county?.BASENAME ? { county: county.BASENAME } : {}),
      ...(county?.BASENAME && county.NAME ? { countyName: county.NAME } : {}),
      ...(place ? { place } : {}),
      ...(town ? { town } : {}),
    });
  }
  return out;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}

/** POST {"address": "..."} → GeocodeResponse. */
export async function handleGeocode(req: Request, cors: Record<string, string>): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "POST an address" }, 405, { ...cors, Allow: "POST, OPTIONS" });
  }
  let address: unknown;
  try {
    address = ((await req.json()) as { address?: unknown })?.address;
  } catch {
    return json({ error: "expected a JSON body" }, 400, cors);
  }
  if (typeof address !== "string" || !address.trim()) {
    return json({ error: "address is required" }, 400, cors);
  }
  const trimmed = address.trim().replace(/\s+/g, " ");
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    return json({ error: `address is longer than ${MAX_ADDRESS_LENGTH} characters` }, 400, cors);
  }

  const upstream = new URL(CENSUS_UPSTREAM);
  upstream.search = new URLSearchParams({
    address: trimmed,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: CENSUS_LAYERS,
    format: "json",
  }).toString();

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), { cache: "no-store" });
  } catch {
    return json({ error: "the Census geocoder didn't answer" }, 502, cors);
  }
  if (!upstreamRes.ok) {
    return json({ error: `the Census geocoder answered ${upstreamRes.status}` }, 502, cors);
  }
  try {
    const body: GeocodeResponse = {
      matches: trimCensus(await upstreamRes.json()),
      source: "US Census Bureau Geocoder",
    };
    return json(body, 200, cors);
  } catch {
    return json({ error: "the Census geocoder sent something unexpected" }, 502, cors);
  }
}
