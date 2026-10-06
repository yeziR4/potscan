import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Store } from "../src/db.ts";
import { ChainStore } from "../src/indexer/chainStore.ts";
import { toRows } from "../src/indexer/transform.ts";
import type { EthBlock, RawBlock } from "../src/indexer/types.ts";

const { raw, eth } = JSON.parse(readFileSync(new URL("./fixtures/hub-14110525.json", import.meta.url), "utf8")) as { raw: RawBlock; eth: EthBlock };
const NET = "polkadot-hub-testnet";
const ETH_TX = "0x32464cb2ea3e9a869c6e2e24b7eb9bb78f6569394d0347ee6b299c7b5001d846";

function seeded() {
  const chain = new ChainStore(new Store(":memory:").db);
  chain.saveBlock(NET, toRows(raw, eth));
  return chain;
}

test("saving a block moves the cursor so indexing resumes after it", () => {
  const chain = seeded();
  assert.equal(chain.cursor(NET), raw.number);
  assert.equal(chain.cursor("portaldot-v3"), undefined);
});

test("saving the same block twice is harmless", () => {
  const chain = seeded();
  chain.saveBlock(NET, toRows(raw, eth));
  assert.equal(chain.extrinsicsOf(NET, raw.number).length, raw.extrinsics.length);
  assert.equal(chain.span(NET).blocks, 1);
});

test("a block is found by number, Substrate hash and Ethereum hash", () => {
  const chain = seeded();
  for (const id of [String(raw.number), raw.hash, eth.hash]) assert.equal(Number(chain.block(NET, id)?.number), raw.number, id);
});

test("a pasted 32-byte hash resolves to what it names", () => {
  const chain = seeded();
  assert.deepEqual(chain.findHash(NET, ETH_TX.toUpperCase().replace("0X", "0x")), { kind: "evm-tx", block: raw.number, hash: ETH_TX });
  assert.equal(chain.findHash(NET, raw.hash)?.kind, "block");
  assert.equal(chain.findHash(NET, raw.extrinsics[2]!.hash)?.kind, "extrinsic");
  assert.equal(chain.findHash(NET, `0x${"00".repeat(32)}`), undefined);
});

test("an account's activity is found from either of its address forms", () => {
  const chain = seeded();
  const from = "0x216dB17653C22dcB9a4D387b1e45f57102A30cA7";
  const { evmTxs, extrinsics } = chain.activity(NET, from, "unused", 10);
  assert.equal(evmTxs[0]?.hash, ETH_TX);
  assert.equal(extrinsics[0]?.call, "ethTransact");
});

test("pruning drops old blocks but keeps contract deployments", () => {
  const chain = seeded();
  chain.saveBlock(NET, { ...toRows(raw, eth), contracts: [{ address: "0xabc", vm: "evm", deployer: "0xdef", block: raw.number, extrinsic: 2 }] });
  chain.prune(NET, raw.number + 1);
  assert.equal(chain.span(NET).blocks, 0);
  assert.equal(chain.evmTx(NET, ETH_TX), undefined);
  assert.equal(chain.contracts(NET, 10).length, 1);
});
