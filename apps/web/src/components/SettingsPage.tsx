import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { AppearancePanel } from "./AppearancePanel";
import { BallotSettingsPanel } from "./BallotSettingsPanel";
import { GoogleKeyPanel } from "./GoogleKeyPanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <div className="card-columns">
      <BallotSettingsPanel />
      <AddressLookupsPanel />
      <GoogleKeyPanel />
      <RoutingPanel />
      <UsageStatsPanel />
      <AppearancePanel />
      <PublishPanel />
    </div>
  );
}

/** One of the quiet ways into Publish, for whoever comes looking for it here. */
function PublishPanel() {
  return (
    <section className="panel">
      <h2>Publish your own endorsements</h2>
      <p className="hint">
        Running a group, writing a voter guide, or just want to share your picks? Sign your
        endorsements so anyone can check they came from you and weren't changed, then share them as
        a link, file or QR code.
      </p>
      <Link to="/publish" className="button-link">
        <PenLine className="icon" /> Go to Publish
      </Link>
    </section>
  );
}
