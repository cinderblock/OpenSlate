import { USAGE_EVENT_DESCRIPTIONS, beaconRunning, useUsageEnabled } from "../lib/usage";

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
        <label className="row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Share anonymous usage statistics</span>
        </label>
      </div>
      {!enabled && beaconRunning() && (
        <p>
          <BeaconStillRunning />
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
        <p className="hint">
          Turning this off stops feature counts immediately. Visit counting, if it already started
          on this page, stops the next time you open or reload OpenSlate.
        </p>
      </details>
    </section>
  );
}

/** Shown after opting out while the beacon is still loaded on this page. */
export function BeaconStillRunning() {
  return (
    <span className="hint">
      Visit counting stops when you next load the page.{" "}
      <button type="button" className="link" onClick={() => location.reload()}>
        Reload now
      </button>
    </span>
  );
}
