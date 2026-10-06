export type Network = {
  id: string;
  name: string;
  ws: string;
  ethRpc: string;
  evmChainId: number;
  token: string;
  decimals: number;
  ss58: number;
};

export type Probe = {
  endpoint: string;
  ok: boolean;
  latencyMs?: number;
  block?: number;
  finalized?: number;
  chainId?: number;
  error?: string;
  checkedAt: number;
};

export type EndpointStatus = {
  kind: "substrate" | "evm";
  endpoint: string;
  latest?: Probe;
  uptime24h?: number;
  since?: number;
  sinceIsLowerBound?: boolean;
  history: { ok: boolean; at: number }[];
};

export type IndexerState = {
  network: string;
  connected: boolean;
  head?: number;
  indexed?: number;
  lastError?: string;
  first?: number;
  last?: number;
  blocks: number;
};

export type NetworkStatus = { network: string; name: string; endpoints: EndpointStatus[]; indexer: IndexerState };

export type Block = {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  ethHash?: string;
  extrinsicCount: number;
  eventCount: number;
};

export type Extrinsic = {
  block: number;
  idx: number;
  hash: string;
  pallet: string;
  call: string;
  signer?: string;
  success: boolean;
  error?: string;
  fee?: string;
  args: Record<string, unknown>;
  ethHash?: string;
};

export type ChainEvent = { block: number; idx: number; extrinsic?: number; pallet: string; name: string; data: Record<string, unknown> };

export type EvmTx = {
  hash: string;
  block: number;
  idx: number;
  from: string;
  to?: string;
  value: string;
  input: string;
  nonce: number;
  status: boolean;
  gasUsed: string;
  contractAddress?: string;
  logCount: number;
};

export type Contract = { address: string; vm: "evm" | "wasm"; deployer: string; block: number; extrinsic: number };

export type Overview = { indexer: IndexerState; blocks: Block[]; evmTxs: EvmTx[]; extrinsics: Extrinsic[]; contracts: Contract[] };

export type MappedAddress = { evm: string; accountId: string; ss58: string; ethDerived: boolean };

export type Account = MappedAddress & { contract?: Contract; extrinsics: Extrinsic[]; evmTxs: EvmTx[] };

export class NotFound extends Error {}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json().catch(() => {
    throw new Error("The PotScan API is not reachable");
  })) as T & { error?: string };
  if (response.status === 404) throw new NotFound(body.error ?? "Not found");
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export const withNetwork = (path: string, network: string) => `${path}${path.includes("?") ? "&" : "?"}network=${network}`;
