import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { IS_DESKTOP_APP } from "../lib/platform";

/** How often an open page asks whether a new version of the app is out. */
const CHECK_MS = 5 * 60_000;

/**
 * On the web: says when a new version of the app has taken over this page, so
 * it isn't left running the old one. The service worker (vite-plugin-pwa,
 * autoUpdate) installs a new version in the background and takes control at
 * once, but the page keeps the code it loaded with: a refresh used to show the
 * old version, and only the next one the new. A page nobody is looking at
 * reloads straight away; one in use offers a reload, so nothing half-typed is
 * lost. An open page also checks for a new version every few minutes, not only
 * when it loads.
 */
export function WebUpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (IS_DESKTOP_APP || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    // The first install also takes control: that isn't an update.
    const hadController = Boolean(sw.controller);
    const onChange = () => {
      if (!hadController) return;
      if (document.visibilityState === "hidden") window.location.reload();
      else setReady(true);
    };
    sw.addEventListener("controllerchange", onChange);
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void sw.getRegistration().then((r) => r?.update().catch(() => undefined));
    };
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      sw.removeEventListener("controllerchange", onChange);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // A page that goes out of sight with the banner up reloads then.
  useEffect(() => {
    if (!ready) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") window.location.reload();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [ready]);

  // The live region is always there, so a screen reader hears the banner arrive.
  return (
    <div aria-live="polite">
      {ready && (
        <aside className="update-banner" aria-label="Update">
          <RefreshCw className="update-banner-icon" />
          <p className="update-banner-text">
            <strong>OpenSlate was updated.</strong> Reload to use the new version.
          </p>
          <span className="update-banner-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" onClick={() => setReady(false)}>
              Later
            </button>
          </span>
        </aside>
      )}
    </div>
  );
}
