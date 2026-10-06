import type { IncomingMessage, ServerResponse } from "node:http";
import { mapAddress, type Network } from "@potscan/core";
import type { Store } from "./db.ts";
import type { ChainStore } from "./indexer/chainStore.ts";
import type { Indexer } from "./indexer/indexer.ts";
import { endpointStatus } from "./status.ts";

type Reply = { status: number; body: unknown };
type Handler = (url: URL, network: Network) => Reply;

const ok = (body: unknown): Reply => ({ status: 200, body });
const notFound = (what: string): Reply => ({ status: 404, body: { error: `${what} is not indexed on this network` } });
const badRequest = (error: string): Reply => ({ status: 400, body: { error } });

const JSON_COLUMNS = new Set(["args", "data"]);
const BOOLEAN_COLUMNS = new Set(["success", "status"]);

/** Database row to API object: camelCase keys, JSON columns parsed, 0/1 flags as booleans, nulls dropped. */
function shape(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || key === "network") continue;
    const name = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/Addr$/, "");
    out[name] = JSON_COLUMNS.has(key) ? JSON.parse(String(value)) : BOOLEAN_COLUMNS.has(key) ? value === 1 : value;
  }
  return out;
}
const shapeAll = (rows: Record<string, unknown>[]) => rows.map(shape);

const limitParam = (url: URL, fallback: number) => Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? fallback) || fallback));

export function createApi(store: Store, chain: ChainStore, indexers: Map<string, Indexer>, networks: Record<string, Network>) {
  const routes: Record<string, Handler> = {
    "/api/networks": () => ok(Object.values(networks)),

    "/api/status": () =>
      ok(
        Object.values(networks).map(n => ({
          network: n.id,
          name: n.name,
          endpoints: [endpointStatus(store, n, "substrate"), endpointStatus(store, n, "evm")],
          indexer: { ...indexers.get(n.id)?.state(), ...chain.span(n.id) },
        })),
      ),

    "/api/overview": (_, net) =>
      ok({
        indexer: { ...indexers.get(net.id)?.state(), ...chain.span(net.id) },
        blocks: shapeAll(chain.latestBlocks(net.id, 12)),
        evmTxs: shapeAll(chain.latestEvmTxs(net.id, 12)),
        extrinsics: shapeAll(chain.latestExtrinsics(net.id, 12, true)),
        contracts: shapeAll(chain.contracts(net.id, 8)),
      }),

    "/api/blocks": (url, net) => {
      const before = url.searchParams.get("before");
      return ok(shapeAll(chain.latestBlocks(net.id, limitParam(url, 25), before ? Number(before) : undefined)));
    },

    "/api/block": (url, net) => {
      const block = shape(chain.block(net.id, url.searchParams.get("id") ?? ""));
      if (!block) return notFound("This block");
      const number = Number(block.number);
      return ok({ block, extrinsics: shapeAll(chain.extrinsicsOf(net.id, number)), events: shapeAll(chain.eventsOf(net.id, number)) });
    },

    "/api/extrinsic": (url, net) => {
      const block = Number(url.searchParams.get("block"));
      const index = Number(url.searchParams.get("index"));
      const extrinsic = shape(chain.extrinsic(net.id, block, index));
      if (!extrinsic) return notFound("This extrinsic");
      const evmTx = extrinsic.ethHash ? shape(chain.evmTx(net.id, String(extrinsic.ethHash))) : undefined;
      return ok({ extrinsic, events: shapeAll(chain.eventsOf(net.id, block, index)), evmTx });
    },

    "/api/tx": (url, net) => {
      const tx = shape(chain.evmTx(net.id, url.searchParams.get("hash") ?? ""));
      if (!tx) return notFound("This transaction");
      const extrinsic = shape(chain.extrinsic(net.id, Number(tx.block), Number(tx.idx)));
      return ok({ tx, extrinsic, events: shapeAll(chain.eventsOf(net.id, Number(tx.block), Number(tx.idx))) });
    },

    "/api/contracts": (url, net) => ok(shapeAll(chain.contracts(net.id, limitParam(url, 50)))),

    "/api/account": (url, net) => {
      const q = url.searchParams.get("q") ?? "";
      try {
        const mapped = mapAddress(q, net.ss58);
        const contract = shape(chain.contract(net.id, mapped.evm) ?? chain.contract(net.id, mapped.ss58));
        const activity = chain.activity(net.id, mapped.evm, mapped.ss58, limitParam(url, 25));
        return ok({ ...mapped, contract, extrinsics: shapeAll(activity.extrinsics), evmTxs: shapeAll(activity.evmTxs) });
      } catch {
        return badRequest("Paste an EVM address (0x…, 20 bytes), an SS58 address, or a 32-byte account id.");
      }
    },

    // Kept for links shared before the account page existed.
    "/api/address": (url, net) => {
      try {
        return ok({ network: net.id, ...mapAddress(url.searchParams.get("q") ?? "", net.ss58) });
      } catch {
        return badRequest("Paste an EVM address (0x…, 20 bytes), an SS58 address, or a 32-byte account id.");
      }
    },

    "/api/search": (url, net) => {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (/^\d+$/.test(q)) return ok({ path: `/block/${q}` });
      if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
        const found = chain.findHash(net.id, q);
        if (!found) return notFound("This hash");
        if (found.kind === "evm-tx") return ok({ path: `/tx/${found.hash}` });
        if (found.kind === "block") return ok({ path: `/block/${found.block}` });
        return ok({ path: `/extrinsic/${found.block}-${found.index}` });
      }
      if (/^\d+-\d+$/.test(q)) return ok({ path: `/extrinsic/${q}` });
      try {
        mapAddress(q, net.ss58);
        return ok({ path: `/account/${q}` });
      } catch {
        return badRequest("Search by block number, block or transaction hash, extrinsic id (block-index), or address.");
      }
    },
  };

  /** Returns false when the path is not an API route, so the caller can serve static files instead. */
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
    if (!route) return false;
    const network = networks[url.searchParams.get("network") ?? ""] ?? Object.values(networks)[0]!;
    let reply: Reply;
    try {
      reply = route(url, network);
    } catch (e) {
      console.error(url.pathname, e);
      reply = { status: 500, body: { error: "Something went wrong reading the index" } };
    }
    res.writeHead(reply.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(reply.body));
    return true;
  };
}
