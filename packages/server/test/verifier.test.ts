import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { compile } from "@parity/resolc";
import { keccak256 } from "ethers";
import { validateRequest, Verifier, type VerifyRequest } from "../src/verify/verifier.ts";

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Storage {
    uint256 n;
    function store(uint256 x) public { n = x; }
    function retrieve() public view returns (uint256) { return n; }
}
`;
const request: VerifyRequest = { sources: { "Storage.sol": SOURCE }, contractName: "Storage", optimizer: { enabled: true, mode: "z" } };

let deployed = "";
const verifier = new Verifier();

before(async () => {
  // What a deployment of this source with resolc's defaults puts on chain (trusted input, so compile() is fine here).
  const output = await compile({ "Storage.sol": { content: SOURCE } });
  deployed = `0x${output.contracts["Storage.sol"]!.Storage!.evm.bytecode.object}`;
});
after(() => verifier.close());

test("the same source and settings match the deployed code", async () => {
  const result = await verifier.verify(request, deployed);
  assert.equal(result.match, true);
  if (!result.match) return;
  assert.equal(result.codeHash, keccak256(deployed));
  assert.match(result.compiler, /^resolc 1\.4\.0.*, solc 0\.8\./);
  assert.ok(result.abi.some(entry => (entry as { name?: string }).name === "retrieve"));
});

test("a change in behaviour is a mismatch, reported with both hashes", async () => {
  const result = await verifier.verify({ ...request, sources: { "Storage.sol": SOURCE.replace("n = x;", "n = x + 1;") } }, deployed);
  assert.equal(result.match, false);
  if (result.match) return;
  assert.equal(result.deployedHash, keccak256(deployed));
  assert.notEqual(result.compiledHash, result.deployedHash);
});

test("comments do not change PolkaVM code, so a match proves the code, not the exact file", async () => {
  // resolc embeds no source metadata hash, unlike solc's EVM output: this is a bytecode match.
  const result = await verifier.verify({ ...request, sources: { "Storage.sol": `${SOURCE}// a comment added after deployment\n` } }, deployed);
  assert.equal(result.match, true);
});

test("different optimizer settings are a mismatch", async () => {
  const result = await verifier.verify({ ...request, optimizer: { enabled: true, mode: "3" } }, deployed);
  assert.equal(result.match, false);
});

test("an address without code is reported before compiling", async () => {
  const result = await verifier.verify(request, "0x");
  assert.deepEqual(result, { match: false, reason: "There is no contract code at this address." });
});

test("an unknown contract name is named in the reason", async () => {
  const result = await verifier.verify({ ...request, contractName: "Missing" }, deployed);
  assert.equal(result.match, false);
  if (!result.match) assert.match(result.reason, /No contract named Missing/);
});

test("imports are never read from the server's disk", async () => {
  // This file exists in the repository; a verifier that resolved imports from disk would compile it.
  const source = `pragma solidity ^0.8.0;\nimport "packages/contracts/src/VerificationRegistry.sol";\ncontract X {}\n`;
  const result = await verifier.verify({ ...request, sources: { "X.sol": source }, contractName: "X" }, deployed);
  assert.equal(result.match, false);
  if (!result.match) assert.match(result.reason, /not found|File import callback not supported/i);
});

test("submissions are checked before they reach the compiler", () => {
  assert.equal(typeof validateRequest(request), "object");
  assert.match(String(validateRequest({ ...request, sources: {} })), /at least one source/);
  assert.match(String(validateRequest({ ...request, sources: { "a.txt": "x" } })), /\.sol file/);
  assert.match(String(validateRequest({ ...request, contractName: "not a name" })), /contract's name/);
  assert.match(String(validateRequest({ ...request, optimizer: { enabled: true, mode: "fast" } })), /Optimizer mode/);
  assert.deepEqual((validateRequest({ sources: request.sources, contractName: "Storage" }) as VerifyRequest).optimizer, { enabled: true, mode: "z" });
});
