import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ProviderInfo,
  type RoutingMode,
  allProviders,
  getRoutingMode,
  setRoutingMode,
} from "../lib/routing";

/**
 * Settings panel: lets the user pick, per upstream provider, whether queries
 * go direct to the provider or through our backend proxy.
 *
 * Trade-off the panel surfaces:
 * - Direct: provider sees your IP and request pattern. No backend in the loop.
 * - Proxy: only our backend sees your IP; provider sees the backend instead.
 *
 * Some providers don't permit browser-direct (their CORS doesn't allow it);
 * the toggle is disabled for those, with the reason inline.
 */
export function RoutingPanel() {
  return (
    <section className="panel">
      <h2>Request routing</h2>
      <p className="hint">
        Each upstream service can be reached either <strong>directly</strong> from your browser (the
        provider sees your IP) or through <strong>our backend</strong> as a proxy (only our backend
        sees you; the provider sees the backend). Defaults pick the option that minimises
        intermediaries while respecting each provider's CORS policy.
      </p>
      <p className="hint">Changes are saved per-browser. Active queries refresh immediately.</p>
      <div className="card">
        <ul className="position-list">
          {allProviders().map((provider) => (
            <ProviderRow key={provider.key} provider={provider} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProviderRow({ provider }: { provider: ProviderInfo }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<RoutingMode>(getRoutingMode(provider.key));

  function pick(next: RoutingMode) {
    try {
      setRoutingMode(provider.key, next);
      setMode(next);
      // Invalidate everything so in-flight queries re-issue with the new base.
      queryClient.invalidateQueries();
    } catch (err) {
      console.warn(err);
    }
  }

  const baseUrl = mode === "direct" ? provider.directUrl : provider.proxyUrl || "(same-origin)";

  return (
    <li>
      <span className="position-subject">
        <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <strong>
            <a href={provider.homepage} target="_blank" rel="noreferrer">
              {provider.name}
            </a>
          </strong>
          <div role="radiogroup" aria-label={`${provider.name} routing`}>
            <button
              type="button"
              className={`tag${mode === "direct" ? " active" : ""}`}
              onClick={() => pick("direct")}
              disabled={!provider.canDirect}
              aria-pressed={mode === "direct"}
              title={
                provider.canDirect
                  ? "Browser fetches the provider directly. Provider sees your IP."
                  : "Disabled: this provider's CORS blocks direct browser access."
              }
              style={{ cursor: provider.canDirect ? "pointer" : "not-allowed" }}
            >
              Direct
            </button>{" "}
            <button
              type="button"
              className={`tag${mode === "proxy" ? " active" : ""}`}
              onClick={() => pick("proxy")}
              aria-pressed={mode === "proxy"}
              title="Browser fetches through our backend. Only the backend sees your IP."
            >
              Through our backend
            </button>
          </div>
        </div>
        <div className="hint">{provider.privacyNote}</div>
        <div className="hint">
          Current base URL: <code className="key">{baseUrl}</code>
        </div>
      </span>
    </li>
  );
}
