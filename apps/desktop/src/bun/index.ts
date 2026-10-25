// OpenSlate desktop: the Electrobun main (Bun) process. It opens one window on
// the web app, built for the desktop and bundled as views://mainview, and
// sends links to other sites to the system browser. Everything else, signing
// and verifying included, happens in the web app.
import Electrobun, { BrowserWindow, Utils } from "electrobun/main";
import { recordOutsideLink, selftest } from "./selftest";

const APP_URL = "views://mainview/index.html";

/** Opens a link to the web, or an email, with the system's own app for it. */
function openOutside(url: string | undefined): void {
  if (!url || !/^(https?|mailto):/i.test(url)) return;
  if (recordOutsideLink(url)) return;
  Utils.openExternal(url);
}

/**
 * The URL an Electrobun navigation event is about. Its `detail` is the URL,
 * or JSON holding `{ url }`.
 */
function urlOf(event: unknown): string | undefined {
  const detail = (event as { data?: { detail?: unknown } } | undefined)?.data?.detail;
  let value: unknown = detail;
  if (typeof detail === "string") {
    try {
      value = JSON.parse(detail);
    } catch {
      return detail;
    }
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) return String(value.url);
  return undefined;
}

/**
 * Runs in the page before the app. The web app opens other sites with
 * target=_blank links and window.open; in a desktop window those would open
 * a bare popup window (Windows) or nothing at all (Linux). Hand them to this
 * process instead, the same way Electrobun's own preload reports a cmd+click.
 */
const PRELOAD = `(() => {
  const outside = (href) => {
    try {
      const url = new URL(href, location.href);
      return /^(https?|mailto):$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const openOutside = (url) => {
    const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
    bridge?.postMessage(JSON.stringify({
      id: "webviewEvent",
      type: "message",
      payload: {
        id: window.__electrobunWebviewId,
        eventName: "new-window-open",
        detail: JSON.stringify({ url, isCmdClick: false }),
      },
    }));
  };
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href]");
    const url = link && !link.hasAttribute("download") && outside(link.getAttribute("href"));
    if (!url) return;
    event.preventDefault();
    openOutside(url);
  }, true);
  const open = window.open.bind(window);
  window.open = (url, ...rest) => {
    const away = url != null && outside(String(url));
    if (!away) return open(url, ...rest);
    openOutside(away);
    return null;
  };
})();`;

const mainWindow = new BrowserWindow({
  title: "OpenSlate",
  url: APP_URL,
  preload: PRELOAD,
  frame: { x: 80, y: 60, width: 1280, height: 880 },
});

// Only the app's own pages load in the window: WebView2 runs it with web
// security off, so nothing from the web may load here. "^" blocks; the last
// matching rule wins.
mainWindow.webview.setNavigationRules(["^*", "views://*"]);

// Links the preload catches arrive as new-window-open. Anything else that
// tries to leave the app is blocked by the rules above: open it outside instead.
Electrobun.events.on("new-window-open", (event) => openOutside(urlOf(event)));
mainWindow.webview.on("will-navigate", (event) => openOutside(urlOf(event)));

selftest(mainWindow);
