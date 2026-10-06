import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { probeEvm, probeSubstrate } from "../src/probe.ts";

// A stand-in Ethereum JSON-RPC endpoint whose behaviour each test picks by URL path.
let server: Server;
let base = "";

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      if (req.url === "/down") return void res.writeHead(502).end();
      if (req.url === "/slow") return; // never answers
      const { method } = JSON.parse(body) as { method: string };
      const result = method === "eth_chainId" ? "0x190f1b51" : "0x2a"; // 420420433, block 42
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test("a healthy endpoint reports its chain ID and block", async () => {
  const probe = await probeEvm(`${base}/ok`, 420420433);
  assert.equal(probe.ok, true);
  assert.equal(probe.chainId, 420420433);
  assert.equal(probe.block, 42);
  assert.ok((probe.latencyMs ?? -1) >= 0);
});

test("the wrong chain is reported as a failure", async () => {
  const probe = await probeEvm(`${base}/ok`, 420420777);
  assert.equal(probe.ok, false);
  assert.match(probe.error ?? "", /expected 420420777/);
});

test("a gateway error is explained in plain language", async () => {
  const probe = await probeEvm(`${base}/down`);
  assert.equal(probe.ok, false);
  assert.match(probe.error ?? "", /node behind it is not answering/);
});

test("a WebSocket endpoint that refuses connections fails once, cleanly", async () => {
  const probe = await probeSubstrate("ws://127.0.0.1:1", 2_000);
  assert.equal(probe.ok, false);
  assert.equal(probe.error, "WebSocket connection failed");
});

test("an endpoint that never answers times out", async () => {
  const probe = await probeEvm(`${base}/slow`, undefined, 300);
  assert.equal(probe.ok, false);
  assert.equal(probe.error, "No response within 0.3 s");
});
