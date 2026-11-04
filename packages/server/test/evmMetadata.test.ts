import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { codeKind, readMetadata, stripMetadata } from "../src/verify/evmMetadata.ts";

const require = createRequire(import.meta.url);
// The solc release bundled with resolc's npm package: a real EVM compiler, no download needed in tests.
const solc = require("solc") as { compile: (input: string) => string; version: () => string };

function deployed(source: string): string {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "A.sol": { content: source } },
        settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } },
      }),
    ),
  ) as { contracts: Record<string, Record<string, { evm: { deployedBytecode: { object: string } } }>> };
  return `0x${out.contracts["A.sol"]!.A!.evm.deployedBytecode.object}`;
}

const SOURCE = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A { uint256 public x; function set(uint256 v) external { x = v; } }\n";

test("the compiler release is read from real solc output", () => {
  const meta = readMetadata(deployed(SOURCE));
  assert.equal(meta?.solc, solc.version().split("+")[0]);
  assert.equal(meta?.length, 53); // 51 bytes of CBOR (ipfs + solc) and the 2-byte length
});

test("a comment changes only the metadata, so stripped code matches", () => {
  const a = deployed(SOURCE);
  const b = deployed(`${SOURCE}// a comment\n`);
  assert.notEqual(a, b);
  assert.equal(stripMetadata(a), stripMetadata(b));
});

test("code is classified by its header", () => {
  assert.equal(codeKind("0x50564d0000d061"), "polkavm");
  assert.equal(codeKind(deployed(SOURCE)), "evm");
  assert.equal(codeKind("0x"), undefined);
});

test("code without a solc trailer is left alone", () => {
  assert.equal(readMetadata("0x6001600055"), undefined);
  assert.equal(stripMetadata("0x6001600055"), "0x6001600055");
});
