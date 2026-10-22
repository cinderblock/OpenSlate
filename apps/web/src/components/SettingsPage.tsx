import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { AppearancePanel } from "./AppearancePanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <div className="card-columns">
      <AddressLookupsPanel />
      <RoutingPanel />
      <UsageStatsPanel />
      <AppearancePanel />
    </div>
  );
}
