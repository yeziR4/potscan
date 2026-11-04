import type { DatabaseSync } from "node:sqlite";
import type { Network } from "@potscan/core";
import type { RuntimeFacts } from "./indexer/reader.ts";

const HOUR = 3_600_000;
/** Babe's target slot on Portaldot V3. */
const TARGET_BLOCK_MS = 6_000;
/** A block counts as slow when it took more than 1.5 slots. */
const SLOW_FACTOR = 1.5;

export type HourBucket = {
  /** Start of the hour, epoch ms. */
  at: number;
  blocks: number;
  avgBlockMs: number;
  maxBlockMs: number;
  /** Signed extrinsics: what users and builders actually sent. */
  txs: number;
  evm: number;
  failed: number;
};

export type Insights = {
  network: string;
  generatedAt: number;
  span: { firstBlock: number; lastBlock: number; blocks: number; since: number; until: number };
  blockTime: {
    targetMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    slowShare: number;
    longestGap?: { block: number; ms: number; at: number };
  };
  hours: HourBucket[];
  activity: {
    signed: number;
    accounts: number;
    evmTxs: number;
    evmReverted: number;
    nativeTransfers: number;
    inkCalls: number;
    contracts: { evm: number; wasm: number };
    topCalls: { call: string; count: number }[];
    topContracts: { address: string; calls: number }[];
  };
  failures: {
    dispatchFailed: number;
    byError: { error: string; count: number }[];
    /** Solidity transactions whose extrinsic succeeded but whose EVM execution reverted. */
    silentReverts: number;
    revertTargets: { address: string; label?: string; count: number }[];
  };
  costs: {
    fees: { count: number; median?: string; average?: string };
    deposits: { count: number; median?: string; largest?: string };
    runtime?: { depositPerByte?: string; depositPerItem?: string; codeHashLockupPercent?: number; existentialDeposit?: string };
  };
  validators?: { count: number; era?: number; points: { validator: string; points: number }[] };
};

/**
 * Turns the index into answers: how healthy the chain is, who uses it, why transactions fail, and what building costs.
 * Computed in one pass over the network's rows; callers cache the result.
 */
export function computeInsights(db: DatabaseSync, network: Network, facts?: RuntimeFacts): Insights | undefined {
  const blocks = db.prepare(`SELECT number, timestamp FROM blocks WHERE network = ? ORDER BY number`).iterate(network.id) as Iterable<{ number: number; timestamp: number }>;

  const hourly = new Map<number, HourBucket>();
  const bucket = (ts: number) => {
    const at = Math.floor(ts / HOUR) * HOUR;
    let b = hourly.get(at);
    if (!b) hourly.set(at, (b = { at, blocks: 0, avgBlockMs: 0, maxBlockMs: 0, txs: 0, evm: 0, failed: 0 }));
    return b;
  };

  const gaps: number[] = [];
  const blockTime = new Map<number, number>();
  let prev: { number: number; timestamp: number } | undefined;
  let first: { number: number; timestamp: number } | undefined;
  let longestGap: Insights["blockTime"]["longestGap"];
  for (const row of blocks) {
    const b = { number: Number(row.number), timestamp: Number(row.timestamp) };
    // Genesis carries no timestamp.
    if (b.timestamp > 0) {
      first ??= b;
      const h = bucket(b.timestamp);
      h.blocks++;
      // Only consecutive blocks give a real interval; a gap in the index would read as a stall.
      if (prev && prev.timestamp > 0 && prev.number === b.number - 1) {
        const dt = b.timestamp - prev.timestamp;
        gaps.push(dt);
        h.avgBlockMs += dt;
        h.maxBlockMs = Math.max(h.maxBlockMs, dt);
        if (!longestGap || dt > longestGap.ms) longestGap = { block: b.number, ms: dt, at: b.timestamp };
      }
      blockTime.set(b.number, b.timestamp);
    }
    prev = b;
  }
  if (!first || !prev || gaps.length === 0) return undefined;
  for (const h of hourly.values()) h.avgBlockMs = h.blocks > 1 ? Math.round(h.avgBlockMs / (h.blocks - 1)) : 0;

  gaps.sort((a, b) => a - b);
  const pick = (q: number) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))]!;
  const avgMs = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);

  // Signed extrinsics are few next to blocks, so they are read whole.
  const extrinsics = db
    .prepare(`SELECT block, pallet, call, signer, success, error, fee, eth_hash FROM extrinsics WHERE network = ? AND signer IS NOT NULL`)
    .all(network.id) as { block: number; pallet: string; call: string; signer: string; success: number; error: string | null; fee: string | null; eth_hash: string | null }[];
  const evmTxs = db.prepare(`SELECT block, from_addr, to_addr, status FROM evm_txs WHERE network = ?`).all(network.id) as {
    block: number;
    from_addr: string;
    to_addr: string | null;
    status: number;
  }[];

  const callCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  const accounts = new Set<string>();
  const fees: bigint[] = [];
  let nativeTransfers = 0;
  let inkCalls = 0;
  for (const e of extrinsics) {
    const ts = blockTime.get(Number(e.block));
    const h = ts ? bucket(ts) : undefined;
    if (h) h.txs++;
    accounts.add(e.signer.toLowerCase());
    callCounts.set(`${e.pallet}.${e.call}`, (callCounts.get(`${e.pallet}.${e.call}`) ?? 0) + 1);
    if (e.pallet === "balances") nativeTransfers++;
    if (e.pallet === "contracts") inkCalls++;
    if (!e.success) {
      if (h) h.failed++;
      errorCounts.set(e.error ?? "Unknown", (errorCounts.get(e.error ?? "Unknown") ?? 0) + 1);
    }
    if (e.fee) fees.push(BigInt(e.fee));
  }

  const contractCalls = new Map<string, number>();
  const revertTargets = new Map<string, number>();
  let evmReverted = 0;
  for (const t of evmTxs) {
    const ts = blockTime.get(Number(t.block));
    const h = ts ? bucket(ts) : undefined;
    if (h) h.evm++;
    accounts.add(t.from_addr);
    if (t.to_addr) contractCalls.set(t.to_addr, (contractCalls.get(t.to_addr) ?? 0) + 1);
    if (!t.status) {
      evmReverted++;
      if (h) h.failed++;
      if (t.to_addr) revertTargets.set(t.to_addr, (revertTargets.get(t.to_addr) ?? 0) + 1);
    }
  }
  // A reverted Solidity call still lands as a successful revive.ethTransact: count the ones whose extrinsic said success.
  const silentReverts = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM evm_txs t JOIN extrinsics e ON e.network = t.network AND e.block = t.block AND e.idx = t.idx
           WHERE t.network = ? AND t.status = 0 AND e.success = 1`,
        )
        .get(network.id) as { n: number }
    ).n,
  );

  const deposits = (
    db
      .prepare(`SELECT data FROM events WHERE network = ? AND pallet = 'balances' AND name = 'Held' AND data LIKE '%StorageDeposit%'`)
      .all(network.id) as { data: string }[]
  ).map(r => BigInt(String((JSON.parse(r.data) as { amount: string | number }).amount)));

  const contractsByVm = db.prepare(`SELECT vm, COUNT(*) AS n FROM contracts WHERE network = ? GROUP BY vm`).all(network.id) as { vm: string; n: number }[];
  const top = <K>(m: Map<K, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    network: network.id,
    generatedAt: Date.now(),
    span: { firstBlock: first.number, lastBlock: prev.number, blocks: blockTime.size, since: first.timestamp, until: prev.timestamp },
    blockTime: {
      targetMs: TARGET_BLOCK_MS,
      avgMs,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      slowShare: gaps.filter(g => g > TARGET_BLOCK_MS * SLOW_FACTOR).length / gaps.length,
      longestGap,
    },
    hours: [...hourly.values()].sort((a, b) => a.at - b.at),
    activity: {
      signed: extrinsics.length,
      accounts: accounts.size,
      evmTxs: evmTxs.length,
      evmReverted,
      nativeTransfers,
      inkCalls,
      contracts: {
        evm: Number(contractsByVm.find(c => c.vm === "evm")?.n ?? 0),
        wasm: Number(contractsByVm.find(c => c.vm === "wasm")?.n ?? 0),
      },
      topCalls: top(callCounts, 6).map(([call, count]) => ({ call, count })),
      topContracts: top(contractCalls, 5).map(([address, calls]) => ({ address, calls })),
    },
    failures: {
      dispatchFailed: [...errorCounts.values()].reduce((s, n) => s + n, 0),
      byError: top(errorCounts, 6).map(([error, count]) => ({ error, count })),
      silentReverts,
      revertTargets: top(revertTargets, 5).map(([address, count]) => ({ address, label: moduleAccountLabel(address), count })),
    },
    costs: {
      fees: { count: fees.length, median: median(fees), average: average(fees) },
      deposits: { count: deposits.length, median: median(deposits), largest: deposits.length ? deposits.reduce((a, b) => (b > a ? b : a)).toString() : undefined },
      runtime: facts && {
        depositPerByte: facts.depositPerByte,
        depositPerItem: facts.depositPerItem,
        codeHashLockupPercent: facts.codeHashLockupPercent ? Number(facts.codeHashLockupPercent) / 1e7 : undefined,
        existentialDeposit: facts.existentialDeposit,
      },
    },
    validators: facts && { count: facts.validators.length, era: facts.era, points: facts.eraPoints },
  };
}

/**
 * Module accounts are 20 bytes of "modl" + an 8-byte pallet id, zero padded, e.g. "modlpy/paddr".
 * Naming them turns an opaque address into "the py/paddr module account".
 */
export function moduleAccountLabel(address: string): string | undefined {
  const bytes = Buffer.from(address.replace(/^0x/, ""), "hex");
  if (bytes.length !== 20 || bytes.subarray(0, 4).toString("latin1") !== "modl") return undefined;
  const id = bytes.subarray(4, 12).toString("latin1").replace(/\0+$/, "");
  return /^[\x20-\x7e]+$/.test(id) && bytes.subarray(12).every(b => b === 0) ? `${id} module account` : undefined;
}

function median(values: bigint[]): string | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)]!.toString();
}

function average(values: bigint[]): string | undefined {
  if (values.length === 0) return undefined;
  return (values.reduce((s, v) => s + v, 0n) / BigInt(values.length)).toString();
}
