export type Network = {
  id: string;
  name: string;
  /** Substrate JSON-RPC over WebSocket. */
  ws: string;
  /** Ethereum JSON-RPC served by pallet-revive's eth-rpc adapter. */
  ethRpc: string;
  evmChainId: number;
  token: string;
  decimals: number;
  ss58: number;
  /** Where indexing starts on first run: from genesis, or this many blocks behind the finalized head. */
  indexFrom: "genesis" | { behindHead: number };
  /** Keep only this many recent blocks; unset keeps everything. */
  retainBlocks?: number;
};

export const NETWORKS: Record<string, Network> = {
  // Endpoints announced by the Portaldot team on 17 Oct 2026, replacing the feso-apps.xyz ones.
  "portaldot-v3": {
    id: "portaldot-v3",
    name: "Portaldot V3 Testnet",
    ws: "wss://test-node-v3.portaldot.dev",
    ethRpc: "https://test-evm-rpc-v3.portaldot.dev",
    evmChainId: 420420777,
    token: "tPOT",
    decimals: 14,
    ss58: 42,
    indexFrom: "genesis",
  },
  // Same pallet-revive stack, used for development while the Portaldot testnet is unavailable.
  // It is 14M+ blocks long and busy, so only a recent window is kept.
  "polkadot-hub-testnet": {
    id: "polkadot-hub-testnet",
    name: "Polkadot Hub TestNet",
    ws: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    ethRpc: "https://eth-rpc-testnet.polkadot.io",
    evmChainId: 420420417,
    token: "PAS",
    decimals: 10,
    ss58: 42,
    indexFrom: { behindHead: 300 },
    retainBlocks: 20_000,
  },
};
