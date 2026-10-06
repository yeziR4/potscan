/** A block as read from the Substrate RPC, before any interpretation. */
export type RawBlock = {
  number: number;
  hash: string;
  parentHash: string;
  /** Milliseconds, from the timestamp pallet. */
  timestamp: number;
  extrinsics: RawExtrinsic[];
  events: RawEvent[];
};

export type RawExtrinsic = {
  index: number;
  hash: string;
  pallet: string;
  call: string;
  signer?: string;
  args: Record<string, unknown>;
};

export type RawEvent = {
  index: number;
  /** The extrinsic that emitted the event; undefined for block initialisation and finalisation. */
  extrinsic?: number;
  pallet: string;
  name: string;
  data: Record<string, unknown>;
  /** For System.ExtrinsicFailed: the decoded error, e.g. "Revive.OutOfGas". */
  error?: string;
};

/** The Ethereum view of a block, read only when the block holds Revive transactions. */
export type EthBlock = {
  hash: string;
  transactions: EthTransaction[];
};

export type EthTransaction = {
  hash: string;
  /** Equals the index of the extrinsic that carried it. */
  index: number;
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

export type BlockRow = {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  ethHash?: string;
  extrinsicCount: number;
  eventCount: number;
};

export type ExtrinsicRow = {
  block: number;
  index: number;
  hash: string;
  pallet: string;
  call: string;
  signer?: string;
  success: boolean;
  error?: string;
  fee?: string;
  args: string;
  ethHash?: string;
};

export type EventRow = {
  block: number;
  index: number;
  extrinsic?: number;
  pallet: string;
  name: string;
  data: string;
};

export type EvmTxRow = EthTransaction & { block: number };

export type ContractRow = {
  address: string;
  /** "evm" for pallet-revive (Solidity), "wasm" for pallet-contracts (ink!). */
  vm: "evm" | "wasm";
  deployer: string;
  block: number;
  extrinsic: number;
};

export type BlockRows = {
  block: BlockRow;
  extrinsics: ExtrinsicRow[];
  events: EventRow[];
  evmTxs: EvmTxRow[];
  contracts: ContractRow[];
};
