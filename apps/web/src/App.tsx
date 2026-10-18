import { Link, Outlet } from "@tanstack/react-router";
import { useUsageEnabled } from "./lib/usage";

const NAV = [
  { to: "/", label: "Identity" },
  { to: "/compose", label: "Compose" },
  { to: "/import", label: "Import & verify" },
  { to: "/catalog", label: "Catalog" },
  { to: "/collate", label: "Collate" },
  { to: "/elections", label: "Elections" },
  { to: "/results", label: "Results" },
  { to: "/viewer", label: "Viewer" },
  { to: "/settings", label: "Settings" },
] as const;

export function RootLayout() {
  return (
    <div className="app">
      <header>
        <h1>OpenSlate</h1>
        <p>Securely share and collate verifiable endorsements.</p>
      </header>

      <nav className="tabs">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="tab"
            activeProps={{ className: "tab active" }}
            activeOptions={{ exact: item.to === "/" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

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
