import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  ChartColumn,
  Eye,
  KeyRound,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  PenLine,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Users,
  Vote,
} from "lucide-react";
import { useRef } from "react";
import { AlphaBadge, AlphaBanner } from "./components/AlphaNotice";
import { DesktopUpdateBanner } from "./components/DesktopUpdate";
import { FeedbackHost } from "./components/FeedbackHost";
import { WizardHost } from "./components/WizardHost";
import { Switch } from "./components/ui/Switch";
import { useAlphaBannerOpen } from "./lib/alpha";
import { useDbStatus } from "./lib/dbStatus";
import { EndorsersContext, useEndorserDirectory } from "./lib/endorsers";
import { REPO_URL, openFeedback } from "./lib/feedback";
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
  icon: LucideIcon;
  /** Also active under these path prefixes (e.g. a race page belongs to My ballot). */
  prefixes?: string[];
}

const MODES: Record<
  Mode,
  { label: string; icon: LucideIcon; home: NavItem["to"]; nav: NavItem[] }
> = {
  vote: {
    label: "My vote",
    icon: Vote,
    home: "/",
    nav: [
      { to: "/", label: "My ballot", icon: ListChecks, prefixes: ["/race/"] },
      { to: "/sources", label: "Sources", icon: Users },
      { to: "/results", label: "Results", icon: ChartColumn, prefixes: ["/results/"] },
    ],
  },
  publish: {
    label: "Publish",
    icon: PenLine,
    home: "/publish",
    nav: [
      { to: "/publish", label: "Compose", icon: SquarePen },
      { to: "/publish/identities", label: "Identities", icon: KeyRound },
      { to: "/publish/elections", label: "Elections", icon: CalendarDays },
      { to: "/publish/verify", label: "Verify", icon: ShieldCheck },
      { to: "/publish/viewer", label: "Viewer", icon: Eye },
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
  const endorsers = useEndorserDirectory();
  const [alphaOpen, setAlphaOpen] = useAlphaBannerOpen();
  const alphaBadge = useRef<HTMLButtonElement>(null);

  return (
    <EndorsersContext.Provider value={endorsers}>
      <div className="app">
        <DesktopUpdateBanner />
        {alphaOpen && (
          <AlphaBanner
            onClose={() => {
              setAlphaOpen(false);
              alphaBadge.current?.focus();
            }}
          />
        )}
        <header className="app-header">
          <span className="brand-group">
            <Link to="/" className="brand">
              <h1>OpenSlate</h1>
            </Link>
            <AlphaBadge
              ref={alphaBadge}
              open={alphaOpen}
              onToggle={() => setAlphaOpen(!alphaOpen)}
            />
          </span>
          <nav className="mode-switch" aria-label="Mode">
            {(Object.keys(MODES) as Mode[]).map((key) => {
              const ModeIcon = MODES[key].icon;
              return (
                <Link
                  key={key}
                  to={MODES[key].home}
                  className={`mode${mode === key ? " active" : ""}`}
                  aria-current={mode === key ? "page" : undefined}
                  activeProps={{}}
                >
                  <ModeIcon className="icon" /> {MODES[key].label}
                </Link>
              );
            })}
          </nav>
          <span className="grow" />
          <span className="header-links">
            <button type="button" className="header-link" onClick={() => openWizard()}>
              <Sparkles className="icon" /> Get started
            </button>
            <Link
              to="/settings"
              className={`header-link${pathname === "/settings" ? " active" : ""}`}
              activeProps={{}}
            >
              <Settings className="icon" /> Settings
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
            {MODES[mode].nav.map((item) => {
              const TabIcon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`tab${isActive(item, pathname) ? " active" : ""}`}
                  // We decide "active" ourselves. Link's default adds an `active`
                  // class on any prefix match, so Compose (/publish) would light
                  // up on every Publish page.
                  activeProps={{}}
                >
                  <TabIcon className="icon" /> {item.label}
                </Link>
              );
            })}
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
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Open source on GitHub
          </a>
          {" · "}
          <button type="button" className="link" onClick={openFeedback}>
            <MessageSquare className="icon" /> Send feedback
          </button>
          <UsageFooterToggle />
        </footer>
      </div>
    </EndorsersContext.Provider>
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
