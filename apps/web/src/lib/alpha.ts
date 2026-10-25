/**
 * OpenSlate is alpha software, written by AI with a human watching over it
 * (plans/alpha-notice.md). The public site says so loudly; a copy someone runs
 * themselves says it quietly.
 *
 * Which one this is comes from the hostname, not a build variable: every
 * `vite build` reads .env.production, so a fork building from source and
 * hosting it on its own domain would otherwise look like the public site.
 */

import { useEffect, useState } from "react";
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
 * until the visitor says "Got it"; on a self-run copy only when asked for.
 */
export function useAlphaBannerOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    if (!isPublicSite()) return false;
    try {
      return localStorage.getItem(DISMISSED_KEY) === null;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (open || !isPublicSite()) return;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // private mode etc.: the banner just comes back next visit.
    }
  }, [open]);
  return [open, setOpen];
}
