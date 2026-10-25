import { DisagreeModeSetting } from "./DisagreeModeSetting";

/** Settings panel for how My ballot counts what your sources say. */
export function BallotSettingsPanel() {
  return (
    <section className="panel">
      <h2>My ballot</h2>
      <div className="card">
        <DisagreeModeSetting />
      </div>
    </section>
  );
}
