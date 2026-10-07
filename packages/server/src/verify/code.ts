import type { Network } from "@potscan/core";
import { keccak256 } from "ethers";

const TTL_MS = 60_000;
const cache = new Map<string, { code: string; at: number }>();

/** Deployed code at an address, via the Ethereum RPC; briefly cached because account pages refresh. */
export async function deployedCode(network: Network, address: string): Promise<string> {
  const key = `${network.id}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code;

  const response = await fetch(network.ethRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The Ethereum RPC returned HTTP ${response.status}`);
  const { result, error } = (await response.json()) as { result?: string; error?: { message: string } };
  if (error || typeof result !== "string") throw new Error(`eth_getCode failed: ${error?.message ?? "no result"}`);
  cache.set(key, { code: result, at: Date.now() });
  return result;
}

export const codeHashOf = (code: string) => (code && code !== "0x" ? keccak256(code) : undefined);
