import { createServer } from "node:http";
import { NETWORKS } from "@potscan/core";
import { createApi } from "./api.ts";
import { Store } from "./db.ts";
import { startMonitor } from "./status.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.POTSCAN_DB ?? "data/potscan.db";
const PROBE_INTERVAL_MS = Number(process.env.PROBE_INTERVAL_MS ?? 60_000);

const store = new Store(DB_PATH);
startMonitor(store, Object.values(NETWORKS), PROBE_INTERVAL_MS);

const api = createApi(store, NETWORKS);
createServer((req, res) => {
  if (!api(req, res)) res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
}).listen(PORT, () => console.log(`PotScan API on http://localhost:${PORT}`));
