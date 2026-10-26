// A check that the app works in this platform's webview, for CI and for
// trying a build by hand. With OPENSLATE_SELFTEST=<file> set, the app runs
// the page script below once the window has loaded, writes what it found to
// <file> as JSON, and quits. Run it twice: the second run reports what the
// first one stored, which shows storage survives a restart. Links to other
// sites are recorded instead of opened.
import { writeFileSync } from "node:fs";
import Electrobun, { type BrowserWindow, Utils } from "electrobun/main";

/** Everything here runs in the page, so it's plain JavaScript in a string. */
const PAGE_CHECKS = `(async () => {
  const marker = new Date().toISOString();
  const report = { href: location.href, title: document.title, marker };
  const attempt = async (name, check) => {
    try {
      report[name] = await check();
    } catch (error) {
      report[name] = { error: String(error && error.message || error) };
    }
  };

  // The app booted: React rendered into #root.
  await attempt("rendered", async () => {
    for (let i = 0; i < 50 && !document.querySelector("#root > *"); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return Boolean(document.querySelector("#root > *"));
  });

  await attempt("localStorage", () => {
    const previous = localStorage.getItem("openslate.selftest");
    localStorage.setItem("openslate.selftest", marker);
    return { previous, wrote: localStorage.getItem("openslate.selftest") === marker };
  });

  await attempt("indexedDB", () => new Promise((resolve, reject) => {
    const open = indexedDB.open("openslate-selftest", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      const read = store.get("marker");
      read.onsuccess = () => {
        const previous = read.result ?? null;
        store.put(marker, "marker");
        tx.oncomplete = () => { db.close(); resolve({ previous, wrote: true }); };
      };
      tx.onerror = () => reject(tx.error);
    };
  }));

  await attempt("persisted", async () =>
    navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null);

  await attempt("sha256", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  });

  await attempt("randomValues", () => crypto.getRandomValues(new Uint8Array(8)).length === 8);

  // Files bundled beside the app load by relative URL.
  await attempt("geo", async () => (await fetch("geo/us-ca.topo.json")).status);
  await attempt("catalog", async () => {
    const response = await fetch("catalog/index.json");
    if (!response.ok) return { status: response.status };
    const index = await response.json();
    return { status: response.status, entries: index.entries.length };
  });

  await attempt("serviceWorker", () =>
    "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : null);

  // Links to other sites go to the main process (recorded there) and the
  // window stays on the app: a target=_blank link, window.open, and a plain
  // navigation, which the navigation rules block.
  const link = document.createElement("a");
  link.href = "https://example.org/selftest-link";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
  window.open("https://example.org/selftest-open", "_blank");
  location.href = "https://example.org/selftest-navigate";
  await new Promise((r) => setTimeout(r, 1500));
  report.stayed = location.href;

  window.__electrobunSendToHost({ openslateSelftest: report });
})();`;

const reportFile = process.env.OPENSLATE_SELFTEST;

/** Whether this run is a self-test (which doesn't check for updates). */
export const isSelftest = Boolean(reportFile);
const outsideLinks: string[] = [];

/** In a self-test, keeps a link to another site rather than opening it; says whether it did. */
export function recordOutsideLink(url: string): boolean {
  if (!reportFile) return false;
  outsideLinks.push(url);
  return true;
}

/** Runs the page checks in `window`, for the report file OPENSLATE_SELFTEST names. */
export function selftest(window: BrowserWindow): void {
  if (!reportFile) return;

  // Never wait forever: a page that doesn't load is a failure too.
  const timeout = setTimeout(() => {
    writeFileSync(reportFile, `${JSON.stringify({ error: "timed out" }, null, 2)}\n`);
    Utils.quit(1);
  }, 60_000);

  let started = false;
  window.webview.on("dom-ready", () => {
    if (started) return;
    started = true;
    window.webview.executeJavascript(PAGE_CHECKS);
  });

  Electrobun.events.on("host-message", (event) => {
    const detail = (event as { data?: { detail?: { openslateSelftest?: unknown } } }).data?.detail;
    if (!detail?.openslateSelftest) return;
    clearTimeout(timeout);
    const report = { ...(detail.openslateSelftest as object), outsideLinks };
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    Utils.quit(0);
  });
}
