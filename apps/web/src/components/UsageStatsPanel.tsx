import { USAGE_EVENT_DESCRIPTIONS, useUsageEnabled } from "../lib/usage";
import { Switch } from "./ui/Switch";

/**
 * Settings panel for anonymous usage statistics: one switch, plus an exact
 * list of what is collected. The footer has the same switch. See
 * lib/usage.ts for the rules behind it.
 */
export function UsageStatsPanel() {
  const [enabled, setEnabled] = useUsageEnabled();

  return (
    <section className="panel">
      <h2>Usage statistics</h2>
      <p className="hint">
        To learn which parts of OpenSlate get used, the app can report <strong>anonymous</strong>{" "}
        counts, if you turn this on. It's off unless you do. Nothing reported says what is on your
        ballot or in any slate: no candidates, races, measures, organizations, slates or locations,
        and no identifier for you or this browser.
      </p>
      <div className="card">
        <Switch isSelected={enabled} onChange={setEnabled}>
          Share anonymous usage statistics
        </Switch>
      </div>
      <details className="card">
        <summary>What we collect</summary>
        <p className="hint">
          Counts of these events only, sent to our own telemetry-collector, which doesn't store your
          IP address. No third-party analytics scripts are loaded.
        </p>
        <ul>
          {Object.entries(USAGE_EVENT_DESCRIPTIONS).map(([name, description]) => (
            <li key={name}>{description}</li>
          ))}
        </ul>
        <p className="hint">Turning this off stops them immediately.</p>
      </details>
    </section>
  );
}
