import { useEffect, useState, type FormEvent } from "react";
import { getJson, withNetwork, type Network } from "./api.ts";
import { AccountPage } from "./pages/AccountPage.tsx";
import { BlockPage, BlocksPage } from "./pages/BlockPages.tsx";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { ExtrinsicPage, TxPage } from "./pages/TxPages.tsx";
import { Link, Router, useGo, type Route } from "./router.tsx";
import { StatusPage } from "./StatusPage.tsx";

const stored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
};

const NAV: [string, string, Route["page"][]][] = [
  ["/", "Overview", ["overview"]],
  ["/blocks", "Blocks", ["blocks", "block", "extrinsic", "tx"]],
  ["/contracts", "Contracts", ["contracts"]],
  ["/account", "Address mapper", ["account"]],
  ["/status", "Status", ["status"]],
];

export function App() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [networkId, setNetworkId] = useState(() => stored("potscan.network") ?? "portaldot-v3");
  const [theme, setTheme] = useState(() => stored("potscan.theme") ?? "dark");

  useEffect(() => {
    getJson<Network[]>("/api/networks").then(setNetworks, () => setNetworks([]));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store("potscan.theme", theme);
  }, [theme]);

  const network = networks.find(n => n.id === networkId) ?? networks[0];
  const chooseNetwork = (id: string) => {
    setNetworkId(id);
    store("potscan.network", id);
  };

  return (
    <Router>
      {route => (
        <>
          <header className="header">
            <div className="container header-inner">
              <Link className="brand" to="/">
                <img src="/logo.png" alt="" />
                PotScan
              </Link>
              <nav className="nav" aria-label="Main">
                {NAV.map(([to, label, pages]) => (
                  <Link key={to} to={to} aria-current={pages.includes(route.page) ? "page" : undefined}>
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="header-tools">
                <label className="visually-hidden" htmlFor="network">
                  Network
                </label>
                <select id="network" className="select" value={network?.id ?? ""} onChange={e => chooseNetwork(e.target.value)}>
                  {networks.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-quiet icon-button"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  title={theme === "dark" ? "Light theme" : "Dark theme"}
                >
                  <ThemeIcon dark={theme === "dark"} />
                </button>
              </div>
            </div>
            {network && (
              <div className="container">
                <Search network={network} key={network.id} />
              </div>
            )}
          </header>

          <main className="container">{network ? <Page route={route} network={network} networks={networks} /> : <p className="muted">Loading…</p>}</main>

          <footer className="footer">
            <div className="container">
              PotScan is an independent, open-source tool for Portaldot builders, not run by the Portaldot team.{" "}
              <a href="https://github.com/yeziR4/potscan">Source on GitHub</a>
            </div>
          </footer>
        </>
      )}
    </Router>
  );
}

function Page({ route, network, networks }: { route: Route; network: Network; networks: Network[] }) {
  switch (route.page) {
    case "overview":
      return <OverviewPage network={network} />;
    case "status":
      return <StatusPage networks={networks} />;
    case "blocks":
      return <BlocksPage network={network} />;
    case "contracts":
      return <ContractsPage network={network} />;
    case "block":
      return <BlockPage network={network} id={route.id} key={route.id} />;
    case "extrinsic":
      return <ExtrinsicPage network={network} block={route.block} index={route.index} />;
    case "tx":
      return <TxPage network={network} hash={route.hash} />;
    case "account":
      return <AccountPage network={network} query={route.query} />;
  }
}

function Search({ network }: { network: Network }) {
  const go = useGo();
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const query = q.trim();
    if (!query) return;
    try {
      const { path } = await getJson<{ path: string }>(withNetwork(`/api/search?q=${encodeURIComponent(query)}`, network.id));
      setMessage(undefined);
      setQ("");
      go(path);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label htmlFor="search" className="visually-hidden">
        Search {network.name}
      </label>
      <input
        id="search"
        className="input"
        value={q}
        onChange={e => {
          setQ(e.target.value);
          setMessage(undefined);
        }}
        placeholder="Search by block, transaction or extrinsic hash, extrinsic id (block-index), or address"
        spellCheck={false}
        autoComplete="off"
        aria-describedby={message ? "search-message" : undefined}
      />
      {message && (
        <p id="search-message" className="search-message" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" />
      </g>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" fill="currentColor" />
    </svg>
  );
}
