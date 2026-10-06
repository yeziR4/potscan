import type { IncomingMessage, ServerResponse } from "node:http";
import { mapAddress, type Network } from "@potscan/core";
import type { Store } from "./db.ts";
import { endpointStatus } from "./status.ts";

type Handler = (url: URL) => { status: number; body: unknown };

export function createApi(store: Store, networks: Record<string, Network>) {
  const network = (url: URL) => networks[url.searchParams.get("network") ?? ""] ?? Object.values(networks)[0]!;

  const routes: Record<string, Handler> = {
    "/api/networks": () => ({ status: 200, body: Object.values(networks) }),

    "/api/status": () => ({
      status: 200,
      body: Object.values(networks).map(n => ({
        network: n.id,
        name: n.name,
        endpoints: [endpointStatus(store, n, "substrate"), endpointStatus(store, n, "evm")],
      })),
    }),

    "/api/address": url => {
      const input = url.searchParams.get("q") ?? "";
      const net = network(url);
      try {
        return { status: 200, body: { network: net.id, ...mapAddress(input, net.ss58) } };
      } catch {
        return { status: 400, body: { error: "Paste an EVM address (0x…, 20 bytes), an SS58 address, or a 32-byte account id." } };
      }
    },
  };

  /** Returns false when the path is not an API route, so the caller can serve static files instead. */
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
    if (!route) return false;
    const { status, body } = route(url);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    return true;
  };
}
