import assert from "node:assert/strict";
import { test } from "node:test";
import { withTimeout } from "../src/indexer/indexer.ts";

test("a read that never settles is turned into an error the loop can retry", async () => {
  const hung = new Promise<never>(() => {});
  await assert.rejects(withTimeout(hung, 50, "Reading block 7 took too long"), /block 7/);
});

test("a read that settles in time passes through unchanged", async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 1_000, "unused"), 42);
});
