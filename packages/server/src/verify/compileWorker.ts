// Runs resolc in a worker thread: a compile takes seconds of CPU and would otherwise stall the indexer and the API.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parentPort } from "node:worker_threads";

const require = createRequire(import.meta.url);
// The raw compiler entry point. The package's public compile() resolves imports by reading the server's own
// disk, which would let a submitted `import "../../.env"` read secrets, so it must not be used for user input.
const root = dirname(require.resolve("@parity/resolc"));
const { resolc, version } = require(join(root, "resolc.js")) as { resolc: (input: string) => unknown; version: () => string };
const solcVersion = (require("solc") as { version: () => string }).version();
const resolcVersion = version().trim().split(" ").pop()!;

parentPort!.on("message", ({ id, input }: { id: number; input: string }) => {
  try {
    parentPort!.postMessage({ id, output: resolc(input), resolcVersion, solcVersion });
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
