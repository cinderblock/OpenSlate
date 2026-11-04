import { Link } from "@tanstack/react-router";
import { Database, PenLine } from "lucide-react";
import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { AppearancePanel } from "./AppearancePanel";
import { BallotSettingsPanel } from "./BallotSettingsPanel";
import { GoogleKeyPanel } from "./GoogleKeyPanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <div className="card-columns">
      <YourDataPanel />
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

/** The way into Settings → Your data (BrowserDataPage). */
function YourDataPanel() {
  return (
    <section className="panel">
      <h2>Your data</h2>
      <p className="hint">
        Everything OpenSlate keeps is in this browser: imported slates, your picks, sources, area,
        identities and settings. See it all, remove what you don't want, back it up or start over.
      </p>
      <Link to="/settings/data" className="button-link">
        <Database className="icon" /> Manage browser data
      </Link>
    </section>
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
