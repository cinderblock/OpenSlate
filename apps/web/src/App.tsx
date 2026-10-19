import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useUsageEnabled } from "./lib/usage";

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
            >
              <span aria-hidden="true">{MODES[key].icon}</span> {MODES[key].label}
            </Link>
          ))}
        </nav>
        <span className="grow" />
        <Link to="/settings" className={`header-link${pathname === "/settings" ? " active" : ""}`}>
          Settings
        </Link>
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
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <main>
        <Outlet />
      </main>

      <footer>
        <span>Decentralized — your keys and data stay in this browser.</span>
        {" · "}
        <a href="https://github.com/cinderblock/openslate" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <UsageFooterToggle />
      </footer>
    </div>
  );
}

/** The same opt-in switch as Settings → Usage statistics, on every page. */
function UsageFooterToggle() {
  const [enabled, setEnabled] = useUsageEnabled();
  return (
    <div className="footer-usage">
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Share anonymous usage statistics</span>
      </label>
      {" · "}
      <Link to="/settings">what's collected</Link>
    </div>
  );
}
