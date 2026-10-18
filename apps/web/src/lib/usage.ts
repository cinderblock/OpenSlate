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
 * Opt-in: off until the user turns it on, in Settings or in the footer. Both
 * read the same state (`useUsageEnabled`), so they never disagree.
 */

import { useSyncExternalStore } from "react";

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

/** This page's choice, for when localStorage is unavailable. */
let memoryChoice: Stored | null = null;

function readStored(): Stored | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "on" || v === "off" ? v : memoryChoice;
  } catch {
    return memoryChoice;
  }
}

export function usageEnabled(): boolean {
  return readStored() === "on";
}

let sink: UsageSink | null = null;
let beaconLoaded = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the setting; storage is shared, so just re-read.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Turning this off stops feature counts at once. The Cloudflare beacon can't
 * be unloaded, so if it already started on this page it keeps running until
 * the next page load (`beaconRunning()` says when). We don't reload for the
 * user: Compose keeps unsaved work in memory.
 */
export function setUsageEnabled(enabled: boolean): void {
  memoryChoice = enabled ? "on" : "off";
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable (private mode quotas etc.) — the switch then only
    // lasts for this page load, which still honours the choice right now.
  }
  if (enabled) loadBeacon();
  notify();
}

/** True when the beacon was loaded on this page and is still running. */
export function beaconRunning(): boolean {
  return beaconLoaded;
}

/** The switch, kept in sync across every component (and tab) that shows it. */
export function useUsageEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, usageEnabled);
  return [enabled, setUsageEnabled];
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
