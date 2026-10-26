/**
 * OpenSlate is alpha software, written by AI with a human watching over it
 * (plans/alpha-notice.md). The public site says so loudly; a copy someone runs
 * themselves says it quietly.
 *
 * Which one this is comes from the hostname, not a build variable: every
 * `vite build` reads .env.production, so a fork building from source and
 * hosting it on its own domain would otherwise look like the public site.
 */

import { useSyncExternalStore } from "react";
import { IS_DESKTOP_APP } from "./platform";

/** Where the project's own copy answers (www redirects, but count it anyway). */
export const PUBLIC_SITE_HOSTS: readonly string[] = ["openslate.us", "www.openslate.us"];

/**
 * Whether this is the project's own copy: openslate.us, or the desktop app
 * (whose pages have no hostname of their own). Pass a hostname to ask about
 * that host alone.
 */
export function isPublicSite(hostname?: string): boolean {
  if (hostname === undefined && IS_DESKTOP_APP) return true;
  const host = hostname ?? (typeof location === "undefined" ? "" : location.hostname);
  return PUBLIC_SITE_HOSTS.includes(host.toLowerCase());
}

const DISMISSED_KEY = "openslate.alphaNoticeDismissed.v1";

/**
 * Whether the page-top alpha banner is open: at first on the public site,
 * until the visitor says "Got it" (or reads the wizard's version); on a
 * self-run copy only when asked for. Page state shared by the banner, the
 * badge and the wizard; only the dismissal is persisted.
 */
let bannerOpen: boolean | undefined;
const listeners = new Set<() => void>();

function getBannerOpen(): boolean {
  if (bannerOpen === undefined) {
    if (!isPublicSite()) bannerOpen = false;
    else {
      try {
        bannerOpen = localStorage.getItem(DISMISSED_KEY) === null;
      } catch {
        bannerOpen = true;
      }
    }
  }
  return bannerOpen;
}

export function setAlphaBannerOpen(open: boolean): void {
  if (!open && isPublicSite()) {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // private mode etc.: the banner just comes back next visit.
    }
  }
  if (open === bannerOpen) return;
  bannerOpen = open;
  for (const listener of listeners) listener();
}

export function useAlphaBannerOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getBannerOpen);
  return [open, setAlphaBannerOpen];
}
