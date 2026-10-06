import { useEffect, useState } from "react";
import { AddressPage } from "./AddressPage.tsx";
import { getJson, type Network } from "./api.ts";
import { StatusPage } from "./StatusPage.tsx";

type Route = { page: "status" } | { page: "address"; query: string };

function parseRoute(path: string): Route {
  const match = path.match(/^\/address(?:\/(.+))?$/);
  return match ? { page: "address", query: decodeURIComponent(match[1] ?? "") } : { page: "status" };
}

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

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  const [networks, setNetworks] = useState<Network[]>([]);
  const [networkId, setNetworkId] = useState(() => stored("potscan.network") ?? "portaldot-v3");
  const [theme, setTheme] = useState(() => stored("potscan.theme") ?? "dark");

  useEffect(() => {
    getJson<Network[]>("/api/networks").then(setNetworks, () => setNetworks([]));
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store("potscan.theme", theme);
  }, [theme]);

  const go = (path: string) => {
    history.pushState(null, "", path);
    setRoute(parseRoute(path));
    scrollTo(0, 0);
  };
  const link = (path: string) => ({
    href: path,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(path);
    },
  });

  const network = networks.find(n => n.id === networkId) ?? networks[0];
  const chooseNetwork = (id: string) => {
    setNetworkId(id);
    store("potscan.network", id);
  };

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" {...link("/")}>
            <img src="/logo.png" alt="" />
            PotScan
            <small>Portaldot V3 explorer</small>
          </a>
          <nav className="nav" aria-label="Main">
            <a {...link("/")} aria-current={route.page === "status" ? "page" : undefined}>
              Status
            </a>
            <a {...link("/address")} aria-current={route.page === "address" ? "page" : undefined}>
              Address mapper
            </a>
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
      </header>

      <main className="container">
        {route.page === "status" && <StatusPage networks={networks} />}
        {route.page === "address" && network && (
          <AddressPage network={network} query={route.query} onSearch={q => go(q ? `/address/${encodeURIComponent(q)}` : "/address")} />
        )}
      </main>

      <footer className="footer">
        <div className="container">
          PotScan is an independent, open-source tool for Portaldot builders, not run by the Portaldot team.{" "}
          <a href="https://github.com/yeziR4/potscan">Source on GitHub</a>
        </div>
      </footer>
    </>
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
