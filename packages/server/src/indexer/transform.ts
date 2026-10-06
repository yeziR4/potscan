import type { BlockRows, ContractRow, EthBlock, RawBlock } from "./types.ts";

/** Pallet-revive's extrinsics; a block holding any of them is worth reading through the Ethereum RPC too. */
export const REVIVE_PALLET = "revive";

export const hasReviveActivity = (block: RawBlock) => block.extrinsics.some(e => e.pallet === REVIVE_PALLET);

/** Interprets a raw block: outcome and fee per extrinsic, contract deployments, and links to Ethereum transactions. */
export function toRows(raw: RawBlock, eth?: EthBlock): BlockRows {
  const ethByIndex = new Map(eth?.transactions.map(tx => [tx.index, tx]));

  const extrinsics = raw.extrinsics.map(ex => {
    const own = raw.events.filter(e => e.extrinsic === ex.index);
    const failed = own.find(e => e.pallet === "system" && e.name === "ExtrinsicFailed");
    const feePaid = own.find(e => e.pallet === "transactionPayment" && e.name === "TransactionFeePaid");
    const ethTx = ethByIndex.get(ex.index);
    return {
      block: raw.number,
      index: ex.index,
      hash: ex.hash,
      pallet: ex.pallet,
      call: ex.call,
      // An Ethereum transaction arrives unsigned on the Substrate side; its sender is the Ethereum `from`.
      signer: ex.signer ?? ethTx?.from,
      success: !failed,
      error: failed?.error,
      fee: feePaid ? String(feePaid.data.actualFee) : undefined,
      args: JSON.stringify(ex.args),
      ethHash: ethTx?.hash,
    };
  });

  const contracts: ContractRow[] = raw.events
    .filter(e => e.name === "Instantiated" && (e.pallet === "revive" || e.pallet === "contracts") && e.extrinsic !== undefined)
    .map(e => ({
      // EVM addresses are case-insensitive hex; ink! contracts have SS58 addresses, which are not.
      address: e.pallet === "revive" ? String(e.data.contract).toLowerCase() : String(e.data.contract),
      vm: e.pallet === "revive" ? "evm" : "wasm",
      deployer: String(e.data.deployer),
      block: raw.number,
      extrinsic: e.extrinsic!,
    }));

  return {
    block: {
      number: raw.number,
      hash: raw.hash,
      parentHash: raw.parentHash,
      timestamp: raw.timestamp,
      ethHash: eth?.hash,
      extrinsicCount: raw.extrinsics.length,
      eventCount: raw.events.length,
    },
    extrinsics,
    events: raw.events.map(e => ({
      block: raw.number,
      index: e.index,
      extrinsic: e.extrinsic,
      pallet: e.pallet,
      name: e.name,
      data: JSON.stringify(e.data),
    })),
    evmTxs: (eth?.transactions ?? []).map(tx => ({ ...tx, block: raw.number })),
    contracts,
  };
}

const MAX_HEX = 256;

/** Keeps stored arguments small: long byte strings (contract code, calldata) are cut, with their length kept. */
export function compact(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("0x") && value.length > MAX_HEX) {
    return `${value.slice(0, MAX_HEX)}… (${(value.length - 2) / 2} bytes)`;
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  return value;
}
