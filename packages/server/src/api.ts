import type { IncomingMessage, ServerResponse } from "node:http";
import { mapAddress, type Network } from "@potscan/core";
import { Interface } from "ethers";
import type { Store } from "./db.ts";
import type { ChainStore } from "./indexer/chainStore.ts";
import type { Indexer } from "./indexer/indexer.ts";
import { endpointStatus } from "./status.ts";
import type { Attester } from "./verify/attester.ts";
import { codeHashOf, deployedCode } from "./verify/code.ts";
import type { Verified, VerifiedStore } from "./verify/verifiedStore.ts";
import { validateRequest, type Verifier } from "./verify/verifier.ts";

type Reply = { status: number; body: unknown };
type Handler = (url: URL, network: Network, body?: unknown) => Reply | Promise<Reply>;

export type ApiDeps = {
  store: Store;
  chain: ChainStore;
  indexers: Map<string, Indexer>;
  networks: Record<string, Network>;
  verifier: Verifier;
  verified: VerifiedStore;
  attesters: Map<string, Attester>;
  /** Base URL that attestations point readers to, e.g. https://potscan.example. */
  publicUrl: string;
};

const MAX_BODY_BYTES = 2_000_000;

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

/** What the account page needs about a contract's code: its hash and, when known, the verified source. */
async function codeInfo(deps: ApiDeps, net: Network, evm: string) {
  try {
    const hash = codeHashOf(await deployedCode(net, evm));
    if (!hash) return undefined;
    return { hash, verified: deps.verified.byCodeHash(net.id, hash) };
  } catch {
    return undefined;
  }
}

/** The called function's signature, when the target contract's ABI is known from a verification. */
async function methodOf(deps: ApiDeps, net: Network, to: unknown, input: unknown): Promise<string | undefined> {
  if (typeof to !== "string" || typeof input !== "string" || input.length < 10) return undefined;
  const verified = (await codeInfo(deps, net, to))?.verified;
  if (!verified) return undefined;
  try {
    return new Interface(verified.abi as never[]).getFunction(input.slice(0, 10))?.format("full");
  } catch {
    return undefined;
  }
}

export function createApi(deps: ApiDeps) {
  const { store, chain, indexers, networks } = deps;
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

    "/api/tx": async (url, net) => {
      const tx = shape(chain.evmTx(net.id, url.searchParams.get("hash") ?? ""));
      if (!tx) return notFound("This transaction");
      const extrinsic = shape(chain.extrinsic(net.id, Number(tx.block), Number(tx.idx)));
      const method = await methodOf(deps, net, tx.to, tx.input);
      return ok({ tx: { ...tx, method }, extrinsic, events: shapeAll(chain.eventsOf(net.id, Number(tx.block), Number(tx.idx))) });
    },

    "/api/verify": async (url, net, body) => {
      const address = (body as { address?: unknown } | undefined)?.address;
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return badRequest("Give the contract's EVM address (0x…, 20 bytes).");
      const request = validateRequest(body);
      if (typeof request === "string") return badRequest(request);

      let code: string;
      try {
        code = await deployedCode(net, address);
      } catch (e) {
        return { status: 502, body: { error: `Could not read the contract's code: ${(e as Error).message}` } };
      }
      const result = await deps.verifier.verify(request, code);
      if (!result.match) return ok(result);

      const record: Verified = {
        codeHash: result.codeHash,
        contractName: request.contractName,
        file: result.file,
        compiler: result.compiler,
        optimizer: request.optimizer,
        sources: request.sources,
        abi: result.abi,
        sourceHash: result.sourceHash,
        firstAddress: address.toLowerCase(),
        verifiedAt: Date.now(),
      };
      deps.verified.save(net.id, record);

      // The off-chain record stands even if the attestation fails; the reply says which happened.
      const attester = deps.attesters.get(net.id);
      let attestationError: string | undefined;
      if (attester) {
        try {
          record.attestation = await attester.attest(address, result.sourceHash, result.compiler, `${deps.publicUrl}/account/${address}`);
          deps.verified.save(net.id, record);
        } catch (e) {
          attestationError = (e as Error).message;
        }
      }
      return ok({ ...result, attestation: record.attestation, attestationError, onChainRegistry: Boolean(attester) });
    },

    "/api/contracts": (url, net) => ok(shapeAll(chain.contracts(net.id, limitParam(url, 50)))),

    "/api/account": async (url, net) => {
      const q = url.searchParams.get("q") ?? "";
      let mapped;
      try {
        mapped = mapAddress(q, net.ss58);
      } catch {
        return badRequest("Paste an EVM address (0x…, 20 bytes), an SS58 address, or a 32-byte account id.");
      }
      const contract = shape(chain.contract(net.id, mapped.evm) ?? chain.contract(net.id, mapped.ss58));
      const activity = chain.activity(net.id, mapped.evm, mapped.ss58, limitParam(url, 25));
      const code = await codeInfo(deps, net, mapped.evm);
      return ok({
        ...mapped,
        contract,
        code,
        registry: deps.attesters.get(net.id)?.registryAddress,
        extrinsics: shapeAll(activity.extrinsics),
        evmTxs: shapeAll(activity.evmTxs),
      });
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

  // The only route that changes anything; every other route is a read.
  const POST_ONLY = new Set(["/api/verify"]);

  /** Returns false when the path is not an API route, so the caller can serve static files instead. */
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
    if (!route) return false;
    const network = networks[url.searchParams.get("network") ?? ""] ?? Object.values(networks)[0]!;
    const send = (reply: Reply) =>
      res.writeHead(reply.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(reply.body));

    const post = POST_ONLY.has(url.pathname);
    if (post !== (req.method === "POST")) {
      send({ status: 405, body: { error: post ? "Use POST with a JSON body." : "Use GET." } });
      return true;
    }

    (post ? readJson(req) : Promise.resolve(undefined))
      .then(body => route(url, network, body))
      .catch((e: Error & { status?: number }) => {
        if (e.status) return { status: e.status, body: { error: e.message } };
        console.error(url.pathname, e);
        return { status: 500, body: { error: "Something went wrong reading the index" } };
      })
      .then(send);
    return true;
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("The request is larger than 2 MB."), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("The request body is not valid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}
