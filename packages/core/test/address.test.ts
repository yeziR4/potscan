import assert from "node:assert/strict";
import { test } from "node:test";
import { fromEvm, fromSubstrate, mapAddress } from "../src/address.ts";

const SS58 = 42;

// Pairs published for the Portaldot V3 testnet, read from its reviveApi.accountId runtime call.
const V3_PAIRS = [
  ["0xf7eC65d11e35375A250e474059a917B537804142", "5Hfmuhj1AHrTBJiC9zUPnJo1cfG2G52LLMwofSigBnjtto8Y"], // official testnet guide
  ["0x7B00e71Ff3a835BEB4007C8448B954FB03fe2926", "5Eqz1qJfp57C8ZYFPjPTwxfXCHc4C73afSBeSWy7WKVXwNtt"], // hack-chat request
];

test("an EVM address maps to the account the V3 runtime reports", () => {
  for (const [evm, ss58] of V3_PAIRS) assert.equal(fromEvm(evm!, SS58).ss58, ss58);
});

test("an Ethereum-derived account maps back to the same EVM address", () => {
  for (const [evm, ss58] of V3_PAIRS) {
    const mapped = fromSubstrate(ss58!, SS58);
    assert.equal(mapped.evm, evm);
    assert.equal(mapped.ethDerived, true);
  }
});

test("a native account maps to the last 20 bytes of its keccak-256 hash", () => {
  // Dev keyring Alice and Bob, with the addresses reviveApi.address returns on Polkadot Hub TestNet.
  const natives = [
    ["5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", "0x9621dde636de098b43efb0fa9b61facfe328f99d"],
    ["5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", "0x41dccbd49b26c50d34355ed86ff0fa9e489d1e01"],
  ];
  for (const [ss58, evm] of natives) {
    const mapped = fromSubstrate(ss58!, SS58);
    assert.equal(mapped.ethDerived, false);
    assert.equal(mapped.evm.toLowerCase(), evm);
  }
});

test("mapAddress accepts any input format and re-encodes for the network", () => {
  const [evm, ss58] = V3_PAIRS[0]!;
  assert.equal(mapAddress(`  ${evm!.toLowerCase()} `, SS58).ss58, ss58);
  assert.equal(mapAddress(ss58!, 0).ss58.startsWith("1"), true);
  assert.equal(mapAddress(fromEvm(evm!, SS58).accountId, SS58).evm, evm);
});

test("rejects input that is not an address", () => {
  assert.throws(() => mapAddress("not-an-address", SS58));
});
