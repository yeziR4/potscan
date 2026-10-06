import assert from "node:assert/strict";
import { test } from "node:test";
import { NETWORKS } from "@potscan/core";
import { Store } from "../src/db.ts";
import { DAY_MS, endpointStatus } from "../src/status.ts";

const net = NETWORKS["portaldot-v3"]!;
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function storeWith(oks: boolean[]): Store {
  const store = new Store(":memory:");
  oks.forEach((ok, i) =>
    store.addProbe({
      network: net.id,
      kind: "evm",
      endpoint: net.ethRpc,
      ok,
      error: ok ? undefined : "HTTP 502",
      block: ok ? 100 + i : undefined,
      checkedAt: NOW - (oks.length - 1 - i) * MINUTE,
    }),
  );
  return store;
}

test("no probes yet gives an empty status rather than a guess", () => {
  const status = endpointStatus(new Store(":memory:"), net, "evm", NOW);
  assert.equal(status.latest, undefined);
  assert.equal(status.uptime24h, undefined);
  assert.deepEqual(status.history, []);
});

test("uptime is the share of successful probes, and 'since' is when the current state began", () => {
  const status = endpointStatus(storeWith([true, true, false, false]), net, "evm", NOW);
  assert.equal(status.uptime24h, 0.5);
  assert.equal(status.latest?.ok, false);
  assert.equal(status.since, NOW - MINUTE);
  assert.deepEqual(status.history.map(h => h.ok), [true, true, false, false]);
});

test("probes older than 24 h do not count", () => {
  const store = storeWith([true]);
  store.addProbe({ network: net.id, kind: "evm", endpoint: net.ethRpc, ok: false, checkedAt: NOW - DAY_MS - MINUTE });
  assert.equal(endpointStatus(store, net, "evm", NOW).uptime24h, 1);
});

test("history for one endpoint never mixes in the other", () => {
  assert.equal(endpointStatus(storeWith([true, false]), net, "substrate", NOW).latest, undefined);
});
