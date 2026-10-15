/**
 * Anonymous usage statistics, behind one per-browser switch.
 *
 * Two pipes, both gated by the same switch:
 * - Cloudflare Web Analytics (cookieless beacon): visits, referrer *origin*,
 *   country, page-load speed. The app uses hash routing, and the beacon strips
 *   `#…` and `?…` before reporting, so it only ever sees `/`.
 * - telemetry-collector: counts of the fixed events in `UsageEvent` below,
 *   with no user, device or session id.
 *
 * The hard rule (plans/usage-analytics.md): nothing reported may reveal a
 * choice, race, candidate, measure, org, slate or jurisdiction. Every event and
 * every dim value is a closed, non-political set, so anything else is a type
 * error rather than a code-review catch.
 *
 * Default is on, except in browsers that send Global Privacy Control, where it
 * defaults to off. An explicit choice in Settings always wins.
 */

/** Route *templates*, never the matched values. */
export type RouteTemplate =
  | "/"
  | "/compose"
  | "/import"
  | "/catalog"
  | "/collate"
  | "/race/$key"
  | "/viewer"
  | "/elections"
  | "/results"
  | "/results/$token"
  | "/settings";

export type SlateImportSource = "catalog" | "url" | "file" | "qr" | "paste";

export type UsageEvent =
  | { name: "page.view"; dims: { route: RouteTemplate } }
  | { name: "slate.import"; dims: { source: SlateImportSource } }
  | { name: "catalog.import_all" }
  | { name: "identity.create" }
  | { name: "identity.import" }
  | { name: "identity.export" }
  | { name: "results.print" }
  | { name: "results.export"; dims: { format: "csv" | "markdown" } };

/** What the Settings page lists under "What we collect". */
export const USAGE_EVENT_DESCRIPTIONS: Record<UsageEvent["name"], string> = {
  "page.view": "Which screen was opened (e.g. “Results”), never what was on it",
  "slate.import":
    "That a slate was imported, and whether from the catalog, a URL, a file, a QR code or pasted",
  "catalog.import_all": "That “Import all” was used on the catalog",
  "identity.create": "That a new signing identity was created",
  "identity.import": "That an identity backup was restored",
  "identity.export": "That an identity backup was downloaded",
  "results.print": "That a results sheet was printed",
  "results.export": "That results were exported, and as CSV or Markdown",
};

export interface UsageSink {
  track(name: string, dims?: Record<string, string>): void;
}

const STORAGE_KEY = "openslate.usage-stats";

type Stored = "on" | "off";

function readStored(): Stored | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

/** True when the browser asks sites not to share or sell data (GPC). */
export function globalPrivacyControl(): boolean {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

export function usageEnabled(): boolean {
  const stored = readStored();
  if (stored) return stored === "on";
  return !globalPrivacyControl();
}

/** Whether the user has made an explicit choice (vs. the default). */
export function usageChoiceIsExplicit(): boolean {
  return readStored() !== null;
}

let sink: UsageSink | null = null;
let beaconLoaded = false;

export function setUsageEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable (private mode quotas etc.) — the switch then only
    // lasts for this page load, which still honours the choice right now.
  }
  if (enabled) {
    loadBeacon();
  } else if (beaconLoaded) {
    // The beacon can't be unloaded once running; reload so it is gone now
    // rather than "from the next visit".
    location.reload();
  }
}

/** Install the telemetry-collector sink. Events before this are dropped. */
export function setUsageSink(next: UsageSink | null): void {
  sink = next;
}

export function track(event: UsageEvent): void {
  if (!usageEnabled() || !sink) return;
  sink.track(event.name, "dims" in event ? event.dims : undefined);
}

function env(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return value?.trim() || undefined;
}

/** Inject the Cloudflare Web Analytics beacon, if configured and allowed. */
export function loadBeacon(): void {
  const token = env("VITE_CF_BEACON_TOKEN");
  if (beaconLoaded || !token || !usageEnabled()) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token, spa: true });
  document.head.appendChild(script);
  beaconLoaded = true;
}
