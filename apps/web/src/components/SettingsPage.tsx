import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <div className="card-columns">
      <AddressLookupsPanel />
      <RoutingPanel />
      <UsageStatsPanel />
    </div>
  );
}
