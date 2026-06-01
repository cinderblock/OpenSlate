import { Link, Outlet } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "Identity" },
  { to: "/compose", label: "Compose" },
  { to: "/import", label: "Import & verify" },
  { to: "/catalog", label: "Catalog" },
  { to: "/collate", label: "Collate" },
  { to: "/elections", label: "Elections" },
  { to: "/results", label: "Results" },
  { to: "/viewer", label: "Viewer" },
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
      </footer>
    </div>
  );
}
