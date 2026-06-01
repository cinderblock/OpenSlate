import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "./App";
import { BlockViewerPanel } from "./components/BlockViewerPanel";
import { CollatePanel } from "./components/CollatePanel";
import { ComposePanel } from "./components/ComposePanel";
import { ElectionsPanel } from "./components/ElectionsPanel";
import { IdentityPanel } from "./components/IdentityPanel";
import { ImportVerifyPanel } from "./components/ImportVerifyPanel";
import { RacePanel } from "./components/RacePanel";
import { ResultsForSlate } from "./components/ResultsForSlate";
import { ResultsView } from "./components/ResultsView";

const rootRoute = createRootRoute({ component: RootLayout });

const identityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IdentityPanel,
});
const composeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compose",
  component: ComposePanel,
});
const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: ImportVerifyPanel,
});
const collateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collate",
  component: CollatePanel,
});
const raceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/race/$key",
  component: RacePanel,
});
const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/viewer",
  component: BlockViewerPanel,
});
const electionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/elections",
  component: ElectionsPanel,
});
const resultsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results",
  component: ResultsView,
});
const resultsForSlateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/$token",
  component: ResultsForSlate,
});

const routeTree = rootRoute.addChildren([
  identityRoute,
  composeRoute,
  importRoute,
  collateRoute,
  raceRoute,
  viewerRoute,
  electionsRoute,
  resultsIndexRoute,
  resultsForSlateRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
