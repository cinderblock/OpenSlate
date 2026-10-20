import { AddressLookupsPanel } from "./AddressLookupsPanel";
import { RoutingPanel } from "./RoutingPanel";
import { UsageStatsPanel } from "./UsageStatsPanel";

export function SettingsPage() {
  return (
    <>
      <AddressLookupsPanel />
      <RoutingPanel />
      <UsageStatsPanel />
    </>
  );
}
