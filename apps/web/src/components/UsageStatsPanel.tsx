import { useState } from "react";
import {
  USAGE_EVENT_DESCRIPTIONS,
  globalPrivacyControl,
  setUsageEnabled,
  usageChoiceIsExplicit,
  usageEnabled,
} from "../lib/usage";

/**
 * Settings panel for anonymous usage statistics: one switch, plus an exact
 * list of what is collected. See lib/usage.ts for the rules behind it.
 */
export function UsageStatsPanel() {
  const [enabled, setEnabled] = useState(usageEnabled);
  const gpcDefault = globalPrivacyControl() && !usageChoiceIsExplicit();

  function toggle(next: boolean) {
    setUsageEnabled(next);
    setEnabled(next);
  }

  return (
    <section className="panel">
      <h2>Usage statistics</h2>
      <p className="hint">
        To learn which parts of OpenSlate get used, the app can report <strong>anonymous</strong>{" "}
        counts. Nothing reported says what is on your ballot or in any slate: no candidates, races,
        measures, organizations, slates or locations, and no identifier for you or this browser.
      </p>
      <label className="card">
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} /> Share
        anonymous usage statistics
      </label>
      {gpcDefault && (
        <p className="hint">
          Off by default because your browser sends Global Privacy Control. You can still turn it
          on.
        </p>
      )}
      <details className="card">
        <summary>What we collect</summary>
        <p className="hint">
          <strong>Visits</strong> (Cloudflare Web Analytics, no cookies): that the site was loaded,
          the referring site, your country, and page-load speed. It never sees which screen you are
          on or anything after the <code>#</code> in the address.
        </p>
        <p className="hint">
          <strong>Feature counts</strong> (our own telemetry-collector; your IP address is not
          stored):
        </p>
        <ul>
          {Object.entries(USAGE_EVENT_DESCRIPTIONS).map(([name, description]) => (
            <li key={name}>{description}</li>
          ))}
        </ul>
        <p className="hint">Turning this off stops both immediately.</p>
      </details>
    </section>
  );
}
