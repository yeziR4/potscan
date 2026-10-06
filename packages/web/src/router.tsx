import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

export type Route =
  | { page: "overview" }
  | { page: "status" }
  | { page: "blocks" }
  | { page: "contracts" }
  | { page: "block"; id: string }
  | { page: "extrinsic"; block: number; index: number }
  | { page: "tx"; hash: string }
  | { page: "account"; query: string };

export function parseRoute(path: string): Route {
  const [, first = "", rest = ""] = path.match(/^\/([^/]*)\/?(.*)$/) ?? [];
  const arg = decodeURIComponent(rest);
  switch (first) {
    case "status":
      return { page: "status" };
    case "blocks":
      return { page: "blocks" };
    case "contracts":
      return { page: "contracts" };
    case "block":
      return { page: "block", id: arg };
    case "tx":
      return { page: "tx", hash: arg };
    case "extrinsic": {
      const [block, index] = arg.split("-").map(Number);
      return { page: "extrinsic", block: block ?? 0, index: index ?? 0 };
    }
    case "account":
    case "address": // the mapper's original URL
      return { page: "account", query: arg };
    default:
      return { page: "overview" };
  }
}

const NavContext = createContext<(path: string) => void>(() => {});

export function Router({ children }: { children: (route: Route) => ReactNode }) {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = (path: string) => {
    history.pushState(null, "", path);
    setRoute(parseRoute(path));
    scrollTo(0, 0);
  };
  return <NavContext.Provider value={go}>{children(route)}</NavContext.Provider>;
}

export const useGo = () => useContext(NavContext);

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; "aria-current"?: "page" }) {
  const go = useGo();
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
