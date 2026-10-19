import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
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

// --- My vote ---

const ballotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: CollatePanel,
});
const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: CatalogPanel,
});
const raceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/race/$key",
  component: RacePanel,
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

// --- Publish ---

const composeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish",
  component: ComposePanel,
});
const identitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/identities",
  component: IdentityPanel,
});
const electionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/elections",
  component: ElectionsPanel,
});
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/verify",
  component: ImportVerifyPanel,
});
const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/viewer",
  component: BlockViewerPanel,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

// --- Pre-refactor paths, kept so bookmarks and shared links still land somewhere sensible ---

type LegacyTarget = "/" | "/sources" | "/publish" | "/publish/elections" | "/publish/viewer";

function legacy<const From extends string>(from: From, to: LegacyTarget) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path: from,
    beforeLoad: () => {
      throw redirect({ to, replace: true });
    },
  });
}

const legacyRoutes = [
  legacy("/compose", "/publish"),
  legacy("/collate", "/"),
  legacy("/catalog", "/sources"),
  legacy("/import", "/sources"),
  legacy("/elections", "/publish/elections"),
  legacy("/viewer", "/publish/viewer"),
] as const;

const routeTree = rootRoute.addChildren([
  ballotRoute,
  sourcesRoute,
  raceRoute,
  resultsIndexRoute,
  resultsForSlateRoute,
  composeRoute,
  identitiesRoute,
  electionsRoute,
  verifyRoute,
  viewerRoute,
  settingsRoute,
  ...legacyRoutes,
]);

// Hash history keeps route values (a whole signed slate in /results/$token, the
// race in /race/$key) in the URL fragment, which browsers never send to a server.
// Shared links therefore never reach a host's request logs.
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
