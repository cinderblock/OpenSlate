import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { FeedbackHost } from "./components/FeedbackHost";
import { WizardHost } from "./components/WizardHost";
import { Switch } from "./components/ui/Switch";
import { useDbStatus } from "./lib/dbStatus";
import { openFeedback } from "./lib/feedback";
import { useUsageEnabled } from "./lib/usage";
import { openWizard } from "./lib/wizard";

type Mode = "vote" | "publish";

interface NavItem {
  to:
    | "/"
    | "/sources"
    | "/results"
    | "/publish"
    | "/publish/identities"
    | "/publish/elections"
    | "/publish/verify"
    | "/publish/viewer";
  label: string;
  /** Also active under these path prefixes (e.g. a race page belongs to My ballot). */
  prefixes?: string[];
}

const MODES: Record<Mode, { label: string; icon: string; home: NavItem["to"]; nav: NavItem[] }> = {
  vote: {
    label: "My vote",
    icon: "🗳",
    home: "/",
    nav: [
      { to: "/", label: "My ballot", prefixes: ["/race/"] },
      { to: "/sources", label: "Sources" },
      { to: "/results", label: "Results", prefixes: ["/results/"] },
    ],
  },
  publish: {
    label: "Publish",
    icon: "✍",
    home: "/publish",
    nav: [
      { to: "/publish", label: "Compose" },
      { to: "/publish/identities", label: "Identities" },
      { to: "/publish/elections", label: "Elections" },
      { to: "/publish/verify", label: "Verify" },
      { to: "/publish/viewer", label: "Viewer" },
    ],
  },
};

function modeOf(pathname: string): Mode | null {
  if (pathname === "/publish" || pathname.startsWith("/publish/")) return "publish";
  if (pathname === "/settings") return null;
  return "vote";
}

function isActive(item: NavItem, pathname: string): boolean {
  return pathname === item.to || (item.prefixes?.some((p) => pathname.startsWith(p)) ?? false);
}

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mode = modeOf(pathname);

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          <h1>OpenSlate</h1>
        </Link>
        <nav className="mode-switch" aria-label="Mode">
          {(Object.keys(MODES) as Mode[]).map((key) => (
            <Link
              key={key}
              to={MODES[key].home}
              className={`mode${mode === key ? " active" : ""}`}
              aria-current={mode === key ? "page" : undefined}
              activeProps={{}}
            >
              <span aria-hidden="true">{MODES[key].icon}</span> {MODES[key].label}
            </Link>
          ))}
        </nav>
        <span className="grow" />
        <span className="header-links">
          <button type="button" className="header-link" onClick={() => openWizard()}>
            Get started
          </button>
          <Link
            to="/settings"
            className={`header-link${pathname === "/settings" ? " active" : ""}`}
            activeProps={{}}
          >
            Settings
          </Link>
        </span>
      </header>
      <p className="tagline">
        {mode === "publish"
          ? "Sign endorsements anyone can verify, and share them anywhere."
          : "Collect the endorsements you trust and plan your vote with them."}
      </p>

      {mode && (
        <nav className="tabs" aria-label={MODES[mode].label}>
          {MODES[mode].nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`tab${isActive(item, pathname) ? " active" : ""}`}
              // We decide "active" ourselves. Link's default adds an `active`
              // class on any prefix match, so Compose (/publish) would light
              // up on every Publish page.
              activeProps={{}}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <DbStatusBanner />

      <main>
        <Outlet />
      </main>

      <WizardHost />
      <FeedbackHost />

      <footer>
        <span>Decentralized — your keys and data stay in this browser.</span>
        {" · "}
        <a href="https://github.com/cinderblock/openslate" target="_blank" rel="noreferrer">
          GitHub
        </a>
        {" · "}
        <button type="button" className="link" onClick={openFeedback}>
          Send feedback
        </button>
        <UsageFooterToggle />
      </footer>
    </div>
  );
}

/** Says why nothing loads when this browser's database can't be opened. */
function DbStatusBanner() {
  const status = useDbStatus();
  if (status.state === "ok") return null;
  return (
    <div className="card db-status-banner" role="alert">
      {status.state === "blocked" && (
        <p>
          OpenSlate was updated, and it's still open in another tab running the old version. Close
          or reload that tab and this one will finish loading.
        </p>
      )}
      {status.state === "outdated" && (
        <p>
          A newer version of OpenSlate opened in another tab. Reload this tab to keep going.{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}
      {status.state === "failed" && (
        <p>
          This browser's storage couldn't be opened, so your sources, picks and keys can't load (
          {status.message}).
        </p>
      )}
    </div>
  );
}

/** The same opt-in switch as Settings → Usage statistics, on every page. */
function UsageFooterToggle() {
  const [enabled, setEnabled] = useUsageEnabled();
  return (
    <div className="footer-usage">
      <Switch isSelected={enabled} onChange={setEnabled}>
        Share anonymous usage statistics
      </Switch>
      {" · "}
      <Link to="/settings">what's collected</Link>
    </div>
  );
}
