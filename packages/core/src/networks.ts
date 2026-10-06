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
};

export const NETWORKS: Record<string, Network> = {
  // github.com/ItsCogumellum/portaldot-v3-testnet-guide
  "portaldot-v3": {
    id: "portaldot-v3",
    name: "Portaldot V3 Testnet",
    ws: "wss://testnetv3-node.feso-apps.xyz",
    ethRpc: "https://testnetv3-eth-rpc.feso-apps.xyz",
    evmChainId: 420420777,
    token: "tPOTv3",
    decimals: 14,
    ss58: 42,
  },
  // Same pallet-revive stack, used for development while the Portaldot testnet is unavailable.
  "polkadot-hub-testnet": {
    id: "polkadot-hub-testnet",
    name: "Polkadot Hub TestNet",
    ws: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    ethRpc: "https://eth-rpc-testnet.polkadot.io",
    evmChainId: 420420417,
    token: "PAS",
    decimals: 10,
    ss58: 42,
  },
};
