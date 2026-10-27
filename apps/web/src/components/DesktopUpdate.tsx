import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { desktopReleaseUrl, IS_DESKTOP_APP } from "../lib/platform";

interface ReadyUpdate {
  version: string;
}

declare global {
  interface Window {
    /** Set by the desktop app's main process once an update is downloaded and its signature checked. */
    __openslateUpdate?: ReadyUpdate;
    /** Electrobun's channel from the page to the main process. */
    __electrobunSendToHost?: (message: unknown) => void;
  }
}

/**
 * In the desktop app: says when an update is downloaded and checked, and
 * restarts into it on request. The main process (apps/desktop/src/bun/update.ts)
 * announces it with an `openslate:update` event, and installs it when asked.
 */
export function DesktopUpdateBanner() {
  const [update, setUpdate] = useState<ReadyUpdate | undefined>(() =>
    IS_DESKTOP_APP ? window.__openslateUpdate : undefined,
  );
  const [later, setLater] = useState<string>();
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!IS_DESKTOP_APP) return;
    const onUpdate = (event: Event) => setUpdate((event as CustomEvent<ReadyUpdate>).detail);
    window.addEventListener("openslate:update", onUpdate);
    return () => window.removeEventListener("openslate:update", onUpdate);
  }, []);

  if (!IS_DESKTOP_APP) return null;
  const shown = update && later !== update.version ? update : undefined;
  // The live region is always there, so a screen reader hears the banner arrive.
  return (
    <div aria-live="polite">
      {shown && (
        <aside className="update-banner" aria-label="Update">
          <Download className="update-banner-icon" />
          <p className="update-banner-text">
            <strong>OpenSlate {shown.version} is ready.</strong> It's downloaded and its signature
            checked; restart to start using it.{" "}
            <a href={desktopReleaseUrl(shown.version)} target="_blank" rel="noreferrer">
              What's new
            </a>
          </p>
          <span className="update-banner-actions">
            <button
              type="button"
              className="primary"
              disabled={restarting}
              onClick={() => {
                setRestarting(true);
                window.__electrobunSendToHost?.({ openslateUpdate: "apply" });
              }}
            >
              {restarting ? "Restarting…" : "Restart to update"}
            </button>
            <button type="button" disabled={restarting} onClick={() => setLater(shown.version)}>
              Later
            </button>
          </span>
        </aside>
      )}
    </div>
  );
}
