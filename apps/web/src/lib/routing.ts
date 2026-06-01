/**
 * Per-provider routing preference: direct to the upstream API vs through our
 * own backend proxy (Hono / Cloudflare Worker). The choice is a privacy
 * decision — direct means the provider sees the user's IP + request pattern;
 * proxy means only our backend sees that and the provider sees us instead.
 *
 * Not every provider supports both. CORS-restricted providers (VoteHub,
 * Kalshi) can ONLY be reached through the proxy. The UI honours that —
 * `canDirect: false` means the toggle is disabled and the explanation reads
 * "the provider's CORS doesn't permit browser-direct access."
 */

export type RoutingMode = "direct" | "proxy";

export interface ProviderInfo {
  /** Stable key used in storage + adapter wiring. */
  key: string;
  /** Display name. */
  name: string;
  /** Provider homepage, for UI links. */
  homepage: string;
  /**
   * Whether the provider allows browser-direct access (sends permissive CORS
   * headers). False means only proxy is usable.
   */
  canDirect: boolean;
  /** Sensible default when no preference is set yet. */
  defaultMode: RoutingMode;
  /** Direct base URL (provider's own origin). */
  directUrl: string;
  /**
   * Proxy base URL. Empty string = same-origin relative (the dev proxy or a
   * sibling deployment). Honours the build-time env var so a self-hoster can
   * point at a Cloudflare Worker instead of the local Hono server.
   */
  proxyUrl: string;
  /**
   * Human-readable explanation surfaced when canDirect is false, or when a
   * thoughtful user wants to know the trade-off.
   */
  privacyNote: string;
}

/**
 * Read a Vite env var without TypeScript narrowing it away. Falls back to a
 * provided default. Trailing slashes stripped so callers can concat cleanly.
 */
function envBase(key: string, fallback: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[key] ?? fallback;
  return raw.replace(/\/+$/, "");
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  civicapi: {
    key: "civicapi",
    name: "civicAPI",
    homepage: "https://civicapi.org",
    canDirect: true,
    defaultMode: "direct",
    directUrl: "https://civicapi.org/api/v2",
    proxyUrl: envBase("VITE_RESULTS_BASE", "/api/results/v2"),
    privacyNote:
      "civicAPI's CORS is open, so the SPA can hit them directly. Direct means civicAPI sees your IP; proxy keeps that off their logs but puts our backend in the middle of every request.",
  },
  votehub: {
    key: "votehub",
    name: "VoteHub",
    homepage: "https://votehub.com",
    canDirect: false,
    defaultMode: "proxy",
    directUrl: "https://api.votehub.com",
    proxyUrl: envBase("VITE_POLLS_BASE", ""),
    privacyNote:
      "VoteHub's API doesn't send permissive CORS headers, so a browser can't read direct responses. All requests must go through the proxy.",
  },
  kalshi: {
    key: "kalshi",
    name: "Kalshi",
    homepage: "https://kalshi.com",
    canDirect: false,
    defaultMode: "proxy",
    directUrl: "https://api.elections.kalshi.com/trade-api/v2",
    proxyUrl: envBase("VITE_FORECASTS_BASE", "/api/forecasts/v2"),
    privacyNote:
      "Kalshi only accepts browser requests from kalshi.com (returns 403 to other origins). All requests must go through the proxy.",
  },
};

const STORAGE_KEY = "openslate:routing-prefs";

interface StoredPrefs {
  [providerKey: string]: RoutingMode;
}

function loadPrefs(): StoredPrefs {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StoredPrefs) : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs: StoredPrefs): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * The current effective routing mode for a provider. Honours the stored
 * preference, falls back to the provider's default, and *always* enforces
 * `proxy` when the provider can't be reached directly — even if storage
 * somehow contains "direct" for it (e.g. carried over from a future where
 * the provider added CORS, then rolled it back).
 */
export function getRoutingMode(providerKey: string): RoutingMode {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error(`unknown provider: ${providerKey}`);
  if (!provider.canDirect) return "proxy";
  const stored = loadPrefs()[providerKey];
  return stored ?? provider.defaultMode;
}

export function setRoutingMode(providerKey: string, mode: RoutingMode): void {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error(`unknown provider: ${providerKey}`);
  if (!provider.canDirect && mode === "direct") {
    throw new Error(`${provider.name} doesn't permit browser-direct access`);
  }
  const prefs = loadPrefs();
  prefs[providerKey] = mode;
  savePrefs(prefs);
}

/** Resolve the base URL for a provider given the current routing preference. */
export function baseUrlFor(providerKey: string): string {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error(`unknown provider: ${providerKey}`);
  return getRoutingMode(providerKey) === "direct" ? provider.directUrl : provider.proxyUrl;
}

/** All providers in a stable order, for the settings UI. */
export function allProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
