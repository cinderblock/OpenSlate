import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "./App";
import { BlockViewerPanel } from "./components/BlockViewerPanel";
import { CatalogPanel } from "./components/CatalogPanel";
import { CollatePanel } from "./components/CollatePanel";
import { ComposePanel } from "./components/ComposePanel";
import { ElectionsPanel } from "./components/ElectionsPanel";
import { IdentityPanel } from "./components/IdentityPanel";
import { ImportVerifyPanel } from "./components/ImportVerifyPanel";
import { RacePanel } from "./components/RacePanel";
import { ResultsForSlate } from "./components/ResultsForSlate";
import { ResultsView } from "./components/ResultsView";
import { SettingsPage } from "./components/SettingsPage";
import { type RouteTemplate, track } from "./lib/usage";

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
const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/catalog",
  component: CatalogPanel,
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
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  identityRoute,
  composeRoute,
  importRoute,
  catalogRoute,
  collateRoute,
  raceRoute,
  viewerRoute,
  electionsRoute,
  resultsIndexRoute,
  resultsForSlateRoute,
  settingsRoute,
]);

// Hash history keeps route values (a whole signed slate in /results/$token, the
// race in /race/$key) in the URL fragment, which browsers never send to a server.
// Shared links therefore never reach a host's request logs, and the Cloudflare
// analytics beacon (which strips the fragment) only ever sees "/".
export const router = createRouter({ routeTree, history: createHashHistory() });

// Report the route *template* (e.g. "/results/$token"), never the matched value.
router.subscribe("onResolved", () => {
  const routeId = router.state.matches.at(-1)?.routeId;
  if (routeId && routeId !== "__root__") {
    const route: RouteTemplate = routeId;
    track({ name: "page.view", dims: { route } });
  }
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
