import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { AppearancePanel } from "./AppearancePanel";
import { GoogleKeyPanel } from "./GoogleKeyPanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <div className="card-columns">
      <AddressLookupsPanel />
      <GoogleKeyPanel />
      <RoutingPanel />
      <UsageStatsPanel />
      <AppearancePanel />
    </div>
  );
}
