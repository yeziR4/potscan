import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { compile } from "@parity/resolc";
import { keccak256 } from "ethers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { compareEvm, validateRequest, Verifier, type VerifyRequest } from "../src/verify/verifier.ts";

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Storage {
    uint256 n;
    function store(uint256 x) public { n = x; }
    function retrieve() public view returns (uint256) { return n; }
}
`;
const request: VerifyRequest = {
  sources: { "Storage.sol": SOURCE },
  contractName: "Storage",
  optimizer: { enabled: true, mode: "z" },
  evm: { runs: 200, viaIR: false },
};

let deployed = "";
// EVM tests below never reach the download path, so no cache directory is touched.
const verifier = new Verifier(join(tmpdir(), "potscan-test-solc"));

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
  assert.deepEqual((validateRequest({ sources: request.sources, contractName: "Storage" }) as VerifyRequest).evm, { runs: 200, evmVersion: undefined, viaIR: false });
  assert.match(String(validateRequest({ ...request, evm: { runs: -1, viaIR: false } })), /runs/);
  assert.match(String(validateRequest({ ...request, evm: { runs: 200, evmVersion: "future", viaIR: false } })), /EVM version/);
});

// EVM bytecode, built with the solc release bundled for tests (no download).
const solc = createRequire(import.meta.url)("solc") as { compile: (input: string) => string };
const IMMUTABLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Owned {
    address public immutable owner;
    uint256 public x;
    constructor() { owner = msg.sender; }
    function set(uint256 v) external { x = v; }
}
`;

function evmBuild(source: string) {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Owned.sol": { content: source } },
        settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } },
      }),
    ),
  ) as { contracts: Record<string, Record<string, { evm: { deployedBytecode: { object: string; immutableReferences: Record<string, { start: number; length: number }[]> } } }>> };
  return out.contracts["Owned.sol"]!.Owned!.evm.deployedBytecode;
}

/** What the chain holds after deployment: the runtime code with the immutable filled in. */
function deployedWithOwner(runtime: ReturnType<typeof evmBuild>, owner: string): string {
  const code = Buffer.from(runtime.object, "hex");
  for (const refs of Object.values(runtime.immutableReferences)) {
    for (const { start, length } of refs) Buffer.from(owner.replace(/^0x/, "").padStart(length * 2, "0"), "hex").copy(code, start);
  }
  return `0x${code.toString("hex")}`;
}

test("EVM: identical code with an immutable written at deploy time is an exact match", () => {
  const runtime = evmBuild(IMMUTABLE);
  assert.ok(Object.keys(runtime.immutableReferences).length > 0);
  const onChain = deployedWithOwner(runtime, "0xf636741fa260225b51cdd69f8f2052ccd85755f0");
  assert.notEqual(onChain, `0x${runtime.object}`);
  assert.equal(compareEvm(onChain, `0x${runtime.object}`, runtime.immutableReferences), "exact");
});

test("EVM: a source differing only in comments is a bytecode match, not an exact one", () => {
  const onChain = deployedWithOwner(evmBuild(IMMUTABLE), "0x01");
  const recompiled = evmBuild(`${IMMUTABLE}// comment\n`);
  assert.equal(compareEvm(onChain, `0x${recompiled.object}`, recompiled.immutableReferences), "bytecode");
});

test("EVM: different behaviour does not match", () => {
  const onChain = deployedWithOwner(evmBuild(IMMUTABLE), "0x01");
  const other = evmBuild(IMMUTABLE.replace("x = v;", "x = v + 1;"));
  assert.equal(compareEvm(onChain, `0x${other.object}`, other.immutableReferences), undefined);
});

test("EVM: code without solc metadata is refused with a reason, before any download", async () => {
  const result = await verifier.verify(request, "0x6001600055");
  assert.equal(result.match, false);
  if (!result.match) {
    assert.equal(result.vm, "evm");
    assert.match(result.reason, /no solc metadata/);
  }
});
