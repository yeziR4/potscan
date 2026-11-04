// Compiles Solidity to EVM bytecode with a specific solc release, off the main thread.
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

const require = createRequire(import.meta.url);
// solc-js's wrapper turns an official soljson build into a compiler. No import callback is given, so imports
// resolve only against the submitted sources and nothing is read from disk.
const wrap = require("solc/wrapper") as (soljson: unknown) => { compile: (input: string) => string };
const compilers = new Map<string, { compile: (input: string) => string }>();

parentPort!.on("message", ({ id, input, soljsonPath }: { id: number; input: string; soljsonPath: string }) => {
  try {
    let solc = compilers.get(soljsonPath);
    if (!solc) compilers.set(soljsonPath, (solc = wrap(require(soljsonPath))));
    parentPort!.postMessage({ id, output: JSON.parse(solc.compile(input)) });
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
