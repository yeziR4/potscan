import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compact, hasReviveActivity, toRows } from "../src/indexer/transform.ts";
import type { EthBlock, RawBlock } from "../src/indexer/types.ts";

// Polkadot Hub TestNet block 14110525, captured with ChainReader: one revive.ethTransact calling a contract.
const { raw, eth } = JSON.parse(readFileSync(new URL("./fixtures/hub-14110525.json", import.meta.url), "utf8")) as { raw: RawBlock; eth: EthBlock };

test("a block with a revive extrinsic is flagged for an Ethereum read", () => {
  assert.equal(hasReviveActivity(raw), true);
  assert.equal(hasReviveActivity({ ...raw, extrinsics: raw.extrinsics.filter(e => e.pallet !== "revive") }), false);
});

test("the Ethereum transaction is linked to the extrinsic at the same index", () => {
  const rows = toRows(raw, eth);
  const ethTransact = rows.extrinsics.find(e => e.call === "ethTransact")!;
  assert.equal(ethTransact.index, 2);
  assert.equal(ethTransact.ethHash, "0x32464cb2ea3e9a869c6e2e24b7eb9bb78f6569394d0347ee6b299c7b5001d846");
  assert.equal(rows.evmTxs[0]!.block, raw.number);
  assert.equal(rows.block.ethHash, eth.hash);
});

test("an unsigned Ethereum transaction takes its sender from the Ethereum side", () => {
  const ethTransact = toRows(raw, eth).extrinsics.find(e => e.call === "ethTransact")!;
  assert.equal(ethTransact.signer, "0x216db17653c22dcb9a4d387b1e45f57102a30ca7");
});

test("success and the fee come from the extrinsic's own events", () => {
  const ethTransact = toRows(raw, eth).extrinsics.find(e => e.call === "ethTransact")!;
  assert.equal(ethTransact.success, true);
  assert.equal(ethTransact.fee, "24868439");
  // Inherents pay no fee.
  assert.equal(toRows(raw, eth).extrinsics.find(e => e.call === "set")!.fee, undefined);
});

test("a failed extrinsic carries its decoded error", () => {
  const failed: RawBlock = {
    ...raw,
    events: [
      ...raw.events.filter(e => e.extrinsic !== 2 || e.name !== "ExtrinsicSuccess"),
      { index: 99, extrinsic: 2, pallet: "system", name: "ExtrinsicFailed", data: {}, error: "Revive.OutOfGas" },
    ],
  };
  const row = toRows(failed, eth).extrinsics.find(e => e.index === 2)!;
  assert.equal(row.success, false);
  assert.equal(row.error, "Revive.OutOfGas");
});

test("contract deployments are recorded for both engines", () => {
  const deployed: RawBlock = {
    ...raw,
    events: [
      ...raw.events,
      { index: 100, extrinsic: 2, pallet: "revive", name: "Instantiated", data: { deployer: "0xAbC", contract: "0xDEF" } },
      { index: 101, extrinsic: 2, pallet: "contracts", name: "Instantiated", data: { deployer: "5Grw", contract: "5Fink" } },
    ],
  };
  const { contracts } = toRows(deployed, eth);
  assert.deepEqual(
    contracts.map(c => [c.vm, c.address]),
    [
      ["evm", "0xdef"],
      ["wasm", "5Fink"],
    ],
  );
});

test("long byte strings are cut but keep their length", () => {
  const code = `0x${"ab".repeat(1000)}`;
  const out = compact({ code, nested: [code], short: "0x1234" }) as { code: string; nested: string[]; short: string };
  assert.match(out.code, /… \(1000 bytes\)$/);
  assert.match(out.nested[0]!, /1000 bytes/);
  assert.equal(out.short, "0x1234");
});
