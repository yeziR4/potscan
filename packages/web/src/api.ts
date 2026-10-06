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

export type NetworkStatus = { network: string; name: string; endpoints: EndpointStatus[] };

export type MappedAddress = { network: string; evm: string; accountId: string; ss58: string; ethDerived: boolean };

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json().catch(() => {
    throw new Error("The PotScan API is not reachable");
  })) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
