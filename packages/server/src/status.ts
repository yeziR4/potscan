import { probeEvm, probeSubstrate, type Network } from "@potscan/core";
import type { EndpointKind, Store, StoredProbe } from "./db.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type EndpointStatus = {
  kind: EndpointKind;
  endpoint: string;
  latest?: StoredProbe;
  /** Share of successful probes in the last 24 h, from 0 to 1; undefined before the first probe. */
  uptime24h?: number;
  /** When the endpoint last changed between up and down. */
  since?: number;
  /** True when no change has been seen in the window, so the state may have started before `since`. */
  sinceIsLowerBound?: boolean;
  /** One entry per probe in the last 24 h, oldest first, for the history bar. */
  history: { ok: boolean; at: number }[];
};

export async function probeNetwork(store: Store, network: Network): Promise<void> {
  const [substrate, evm] = await Promise.all([probeSubstrate(network.ws), probeEvm(network.ethRpc, network.evmChainId)]);
  store.addProbe({ ...substrate, network: network.id, kind: "substrate" });
  store.addProbe({ ...evm, network: network.id, kind: "evm" });
}

export function endpointStatus(store: Store, network: Network, kind: EndpointKind, now = Date.now()): EndpointStatus {
  const probes = store.probesSince(network.id, kind, now - DAY_MS);
  const latest = probes.at(-1);
  const endpoint = kind === "substrate" ? network.ws : network.ethRpc;
  if (!latest) return { kind, endpoint, history: [] };

  let since = latest.checkedAt;
  for (let i = probes.length - 1; i >= 0 && probes[i]!.ok === latest.ok; i--) since = probes[i]!.checkedAt;

  return {
    kind,
    endpoint,
    latest,
    uptime24h: probes.filter(p => p.ok).length / probes.length,
    since,
    sinceIsLowerBound: since === probes[0]!.checkedAt,
    history: probes.map(p => ({ ok: p.ok, at: p.checkedAt })),
  };
}

/** Probes every network now and then every interval, keeping 7 days of history. */
export function startMonitor(store: Store, networks: Network[], intervalMs: number): () => void {
  const round = async () => {
    await Promise.all(networks.map(n => probeNetwork(store, n)));
    store.prune(Date.now() - 7 * DAY_MS);
  };
  void round();
  const timer = setInterval(() => void round(), intervalMs);
  return () => clearInterval(timer);
}
