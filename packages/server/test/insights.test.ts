import assert from "node:assert/strict";
import { test } from "node:test";
import { NETWORKS } from "@potscan/core";
import { Store } from "../src/db.ts";
import { ChainStore } from "../src/indexer/chainStore.ts";
import type { BlockRows } from "../src/indexer/types.ts";
import { computeInsights, moduleAccountLabel, readableError } from "../src/insights.ts";

const net = NETWORKS["portaldot-v3"]!;
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

function block(number: number, timestamp: number, extra: Partial<BlockRows> = {}): BlockRows {
  return {
    block: { number, hash: `0x${number.toString(16).padStart(64, "0")}`, parentHash: "0x00", timestamp, extrinsicCount: 1, eventCount: 0 },
    extrinsics: [],
    events: [],
    evmTxs: [],
    contracts: [],
    ...extra,
  };
}

function seeded() {
  const store = new Store(":memory:");
  const chain = new ChainStore(store.db);
  chain.saveBlock(net.id, block(0, 0)); // genesis has no timestamp
  const times = [6_000, 6_000, 6_000, 18_000, 6_000]; // one slow block: 18 s
  let t = T0;
  times.forEach((dt, i) => {
    t += dt;
    const n = i + 1;
    const extra: Partial<BlockRows> = {};
    if (n === 2) {
      extra.extrinsics = [
        { block: n, index: 1, hash: "0xa", pallet: "revive", call: "ethTransact", signer: "0xabc", success: true, fee: "100", args: "{}", ethHash: "0xe1" },
        { block: n, index: 2, hash: "0xb", pallet: "balances", call: "transferKeepAlive", signer: "5Alice", success: false, error: "Balances.InsufficientBalance", fee: "300", args: "{}" },
      ];
      extra.evmTxs = [
        { block: n, hash: "0xe1", index: 1, from: "0xabc", to: "0x6d6f646c70792f70616464720000000000000000", value: "0", input: "0x", nonce: 0, status: false, gasUsed: "1", logCount: 0 },
      ];
      extra.events = [{ block: n, index: 0, extrinsic: 1, pallet: "balances", name: "Held", data: JSON.stringify({ reason: { Revive: "StorageDepositReserve" }, who: "x", amount: "5000" }) }];
    }
    chain.saveBlock(net.id, block(n, t, extra));
  });
  return store;
}

test("block times are measured between consecutive blocks only, ignoring genesis", () => {
  const insights = computeInsights(seeded().db, net)!;
  assert.equal(insights.span.blocks, 5);
  assert.equal(insights.blockTime.p50Ms, 6_000);
  assert.equal(insights.blockTime.longestGap?.ms, 18_000);
  assert.equal(insights.blockTime.longestGap?.block, 4);
  assert.equal(insights.blockTime.slowShare, 1 / 4);
});

test("activity counts signed extrinsics, Solidity transactions and distinct accounts", () => {
  const { activity } = computeInsights(seeded().db, net)!;
  assert.equal(activity.signed, 2);
  assert.equal(activity.evmTxs, 1);
  assert.equal(activity.nativeTransfers, 1);
  assert.equal(activity.accounts, 2);
});

test("a reverted Solidity call whose extrinsic succeeded is counted as a silent revert", () => {
  const { failures } = computeInsights(seeded().db, net)!;
  assert.equal(failures.silentReverts, 1);
  assert.equal(failures.dispatchFailed, 1);
  assert.deepEqual(failures.byError, [{ error: "Balances.InsufficientBalance", count: 1 }]);
  assert.equal(failures.revertTargets[0]?.label, "py/paddr module account");
});

test("fees and storage deposits are summarised from the chain's own events", () => {
  const { costs } = computeInsights(seeded().db, net)!;
  assert.equal(costs.fees.count, 2);
  assert.equal(costs.fees.average, "200");
  assert.equal(costs.deposits.largest, "5000");
});

test("an index without consecutive timestamped blocks has no insights yet", () => {
  const store = new Store(":memory:");
  new ChainStore(store.db).saveBlock(net.id, block(0, 0));
  assert.equal(computeInsights(store.db, net), undefined);
});

test("non-module dispatch errors read like module errors", () => {
  assert.equal(readableError('{"token":"FundsUnavailable"}'), "Token.FundsUnavailable");
  assert.equal(readableError('{"badOrigin":null}'), "BadOrigin");
  assert.equal(readableError("revive.StorageDepositNotEnoughFunds"), "revive.StorageDepositNotEnoughFunds");
  assert.equal(readableError(null), "Unknown");
});

test("module accounts are named; ordinary addresses are not", () => {
  assert.equal(moduleAccountLabel("0x6d6f646c70792f70616464720000000000000000"), "py/paddr module account");
  assert.equal(moduleAccountLabel("0xf869d5eb8103490260dd9d765663c6608b96fb8a"), undefined);
});
