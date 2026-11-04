import type { Network } from "@potscan/core";
import type { ChainStore } from "./indexer/chainStore.ts";
import { codeKind, readMetadata } from "./verify/evmMetadata.ts";

const BATCH = 100;
const INTERVAL_MS = 2 * 60_000;

/** Reads each new Revive contract's code once and records what built it, for the report's PolkaVM-versus-EVM finding. */
export function startCodeCensus(chain: ChainStore, networks: Network[]): () => void {
  let running = false;
  const round = async () => {
    if (running) return;
    running = true;
    try {
      for (const network of networks) {
        const addresses = chain.unclassifiedContracts(network.id, BATCH);
        if (addresses.length === 0) continue;
        const codes = await getCodes(network.ethRpc, addresses).catch(() => undefined);
        if (!codes) continue; // Network down: try again next round.
        addresses.forEach((address, i) => {
          const code = codes[i];
          if (code === undefined) return;
          const kind = codeKind(code);
          // "empty": the contract was removed (or never stored code); still counted, so it is not re-read forever.
          chain.saveCodeKind(network.id, address, kind ?? "empty", kind === "evm" ? readMetadata(code)?.solc : undefined);
        });
      }
    } finally {
      running = false;
    }
  };
  void round();
  const timer = setInterval(() => void round(), INTERVAL_MS);
  return () => clearInterval(timer);
}

async function getCodes(url: string, addresses: string[]): Promise<(string | undefined)[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(addresses.map((address, id) => ({ jsonrpc: "2.0", id, method: "eth_getCode", params: [address, "latest"] }))),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const replies = (await response.json()) as { id: number; result?: string }[];
  return addresses.map((_, id) => replies.find(r => r.id === id)?.result);
}
