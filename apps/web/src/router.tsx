import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./App";
import { raceSlug } from "./lib/raceSlug";
import { type RouteTemplate, track } from "./lib/usage";

// Each page is its own chunk, fetched when the page is first opened (and on
// hover/focus of a link to it, via defaultPreload below). The service worker
// still precaches every chunk, so the app keeps working offline.
const rootRoute = createRootRoute({ component: RootLayout });

/** A page's `?q=`, the search box at its top: kept only when it's a non-empty string. */
function validateQuerySearch(search: Record<string, unknown>): { q?: string } {
  return typeof search.q === "string" && search.q !== "" ? { q: search.q } : {};
}

/** My ballot's `?setup`, the guided setup over an existing ballot, on top of `?q=`. */
function validateBallotSearch(search: Record<string, unknown>): { q?: string; setup?: true } {
  return { ...validateQuerySearch(search), ...(search.setup === true ? { setup: true } : {}) };
}

/** Sources' `?add`, a link straight to its "Add endorsements" section, on top of `?q=`. */
function validateSourcesSearch(search: Record<string, unknown>): { q?: string; add?: true } {
  return { ...validateQuerySearch(search), ...(search.add === true ? { add: true } : {}) };
}

/**
 * A race page's `?all`: every slate on the race, not only what's imported. And
 * `?k`, the exact subject key, when two races share a slug (lib/raceSlug.ts).
 */
function validateRaceSearch(search: Record<string, unknown>): { all?: true; k?: string } {
  return {
    ...(search.all === true ? { all: true } : {}),
    ...(typeof search.k === "string" && search.k !== "" ? { k: search.k } : {}),
  };
}

// --- My vote ---

const ballotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateBallotSearch,
  component: lazyRouteComponent(() => import("./components/MyBallotPanel"), "MyBallotPanel"),
});
const allRacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/races",
  validateSearch: validateQuerySearch,
  component: lazyRouteComponent(() => import("./components/AllRacesPanel"), "AllRacesPanel"),
});
const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  validateSearch: validateSourcesSearch,
  component: lazyRouteComponent(() => import("./components/SourcesPanel"), "SourcesPanel"),
});
const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare",
  component: lazyRouteComponent(
    () => import("./components/CompareBallotPanel"),
    "CompareBallotPanel",
  ),
});
// A race's own page, at its readable slug: /race/2026-11-03/us/ca/governor.
const raceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/race/$",
  validateSearch: validateRaceSearch,
  component: lazyRouteComponent(() => import("./components/RacePanel"), "RacePanel"),
});
// The first race links, by raw subject key (one segment, so it never matches a
// slug). A `t:|j:|e:` key moves to its slug; an `id` key has none and stays.
const raceByKeyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/race/$key",
  validateSearch: validateRaceSearch,
  beforeLoad: ({ params, search, location }) => {
    const slug = raceSlug(params.key);
    if (slug) {
      throw redirect({
        to: "/race/$",
        params: { _splat: slug },
        search,
        ...(location.hash ? { hash: location.hash } : {}),
        replace: true,
      });
    }
  },
  component: lazyRouteComponent(() => import("./components/RacePanel"), "RacePanel"),
});
const resultsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results",
  validateSearch: validateQuerySearch,
  component: lazyRouteComponent(() => import("./components/ResultsView"), "ResultsView"),
});
// Before `/results/$token` in matching: a static segment wins over a param.
const ballotResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/my-ballot",
  component: lazyRouteComponent(
    () => import("./components/BallotResultsPanel"),
    "BallotResultsPanel",
  ),
});
const resultsForSlateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/$token",
  validateSearch: validateQuerySearch,
  component: lazyRouteComponent(() => import("./components/ResultsForSlate"), "ResultsForSlate"),
});

// --- Publish ---

const composeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish",
  validateSearch: validateQuerySearch,
  component: lazyRouteComponent(() => import("./components/ComposePanel"), "ComposePanel"),
});
const identitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/identities",
  component: lazyRouteComponent(() => import("./components/IdentityPanel"), "IdentityPanel"),
});
const electionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/elections",
  validateSearch: validateQuerySearch,
  component: lazyRouteComponent(() => import("./components/ElectionsPanel"), "ElectionsPanel"),
});
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/verify",
  component: lazyRouteComponent(
    () => import("./components/ImportVerifyPanel"),
    "ImportVerifyPanel",
  ),
});
const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/publish/viewer",
  component: lazyRouteComponent(() => import("./components/BlockViewerPanel"), "BlockViewerPanel"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./components/SettingsPage"), "SettingsPage"),
});

const browserDataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/data",
  component: lazyRouteComponent(() => import("./components/BrowserDataPage"), "BrowserDataPage"),
});

// --- Pre-refactor paths, kept so bookmarks and shared links still land somewhere sensible ---

type LegacyTarget =
  | "/"
  | "/sources"
  | "/results"
  | "/publish"
  | "/publish/elections"
  | "/publish/viewer";

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
  // The live count joined Results on election night 2026.
  legacy("/live", "/results"),
] as const;

const routeTree = rootRoute.addChildren([
  ballotRoute,
  allRacesRoute,
  sourcesRoute,
  compareRoute,
  raceRoute,
  raceByKeyRoute,
  resultsIndexRoute,
  ballotResultsRoute,
  resultsForSlateRoute,
  composeRoute,
  identitiesRoute,
  electionsRoute,
  verifyRoute,
  viewerRoute,
  settingsRoute,
  browserDataRoute,
  ...legacyRoutes,
]);

// Hash history keeps route values (a whole signed slate in /results/$token, the
// race in /race/$) in the URL fragment, which browsers never send to a server.
// Shared links therefore never reach a host's request logs.
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
});

// Report the route *template* (e.g. "/results/$token"), never the matched value.
// onResolved fires whenever the router settles, including when loaders re-run
// on the same page; only a new path is a new screen. (Seen live: each
// navigation was counted twice.)
router.subscribe("onResolved", ({ pathChanged }) => {
  if (!pathChanged) return;
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
