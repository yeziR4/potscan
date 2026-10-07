import { Worker } from "node:worker_threads";
import { keccak256, toUtf8Bytes } from "ethers";

export type OptimizerMode = "0" | "1" | "2" | "3" | "s" | "z";

export type VerifyRequest = {
  /** File name to Solidity source. Every imported file must be included; nothing is read from disk. */
  sources: Record<string, string>;
  contractName: string;
  optimizer: { enabled: boolean; mode: OptimizerMode };
};

export type VerifyResult =
  | {
      match: true;
      codeHash: string;
      sourceHash: string;
      file: string;
      compiler: string;
      abi: unknown[];
    }
  | { match: false; reason: string; compiler?: string; compiledHash?: string; deployedHash?: string };

type CompilerOutput = {
  contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
  errors?: { severity: string; formattedMessage: string }[];
};

const MAX_FILES = 50;
const MAX_SOURCE_BYTES = 1_000_000;
const MODES = new Set(["0", "1", "2", "3", "s", "z"]);

/** Checks a submission before it reaches the compiler, so bad input gets a clear answer instead of a compiler error. */
export function validateRequest(body: unknown): VerifyRequest | string {
  const b = body as Partial<VerifyRequest> | null;
  if (!b || typeof b !== "object") return "Send a JSON body with sources, contractName and optimizer.";
  if (!b.sources || typeof b.sources !== "object" || Object.keys(b.sources).length === 0) return "Add at least one source file.";
  const files = Object.entries(b.sources);
  if (files.length > MAX_FILES) return `At most ${MAX_FILES} files.`;
  if (files.some(([name, content]) => typeof content !== "string" || !name.endsWith(".sol"))) return "Each source must be a .sol file with text content.";
  if (files.reduce((n, [, c]) => n + (c as string).length, 0) > MAX_SOURCE_BYTES) return "Sources are larger than 1 MB in total.";
  if (typeof b.contractName !== "string" || !/^[A-Za-z_$][\w$]*$/.test(b.contractName)) return "Give the contract's name, as written after `contract` in the source.";
  const optimizer = b.optimizer ?? { enabled: true, mode: "z" };
  if (typeof optimizer.enabled !== "boolean" || !MODES.has(optimizer.mode)) return "Optimizer mode must be one of 0, 1, 2, 3, s, z.";
  return { sources: b.sources as Record<string, string>, contractName: b.contractName, optimizer };
}

/** The exact compiler input, built only from submitted file contents. Its hash identifies the build. */
export function compilerInput(request: VerifyRequest): string {
  const sources = Object.fromEntries(
    Object.keys(request.sources)
      .sort()
      .map(name => [name, { content: request.sources[name]! }]),
  );
  return JSON.stringify({
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: request.optimizer.enabled, mode: request.optimizer.mode, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  });
}

export class Verifier {
  private worker?: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: { output?: CompilerOutput; error?: string; resolcVersion?: string; solcVersion?: string }) => void>();
  // One compile at a time: each one uses a full core for seconds.
  private queue: Promise<unknown> = Promise.resolve();

  /** Compiles the submission and compares it with the code deployed at the address. */
  verify(request: VerifyRequest, deployedCode: string): Promise<VerifyResult> {
    const run = this.queue.then(() => this.run(request, deployedCode));
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): Promise<number> | undefined {
    return this.worker?.terminate();
  }

  private async run(request: VerifyRequest, deployedCode: string): Promise<VerifyResult> {
    if (!deployedCode || deployedCode === "0x") return { match: false, reason: "There is no contract code at this address." };
    const input = compilerInput(request);
    const reply = await this.compile(input);
    if (reply.error) return { match: false, reason: `The compiler stopped: ${reply.error}` };
    const compiler = `resolc ${reply.resolcVersion}, solc ${reply.solcVersion?.split("+")[0]}`;
    const output = reply.output!;
    const errors = (output.errors ?? []).filter(e => e.severity === "error");
    if (errors.length) return { match: false, reason: errors.map(e => e.formattedMessage.trim()).join("\n\n"), compiler };

    const found = Object.entries(output.contracts ?? {}).flatMap(([file, contracts]) =>
      contracts[request.contractName] ? [{ file, contract: contracts[request.contractName]! }] : [],
    );
    if (found.length === 0) return { match: false, reason: `No contract named ${request.contractName} in the sources.`, compiler };

    const compiled = `0x${found[0]!.contract.evm.bytecode.object}`;
    const compiledHash = keccak256(compiled);
    const deployedHash = keccak256(deployedCode);
    if (compiledHash !== deployedHash) {
      return {
        match: false,
        reason:
          "The compiled code differs from the deployed code. Check that the source is what was deployed, the contract name, and the optimizer settings.",
        compiler,
        compiledHash,
        deployedHash,
      };
    }
    return { match: true, codeHash: deployedHash, sourceHash: keccak256(toUtf8Bytes(input)), file: found[0]!.file, compiler, abi: found[0]!.contract.abi };
  }

  private compile(input: string) {
    if (!this.worker) {
      this.worker = new Worker(new URL("./compileWorker.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
      this.worker.on("message", reply => {
        this.pending.get(reply.id)?.(reply);
        this.pending.delete(reply.id);
        // An idle worker must not keep the process alive.
        if (this.pending.size === 0) this.worker!.unref();
      });
    }
    const id = this.nextId++;
    this.worker.ref();
    return new Promise<{ output?: CompilerOutput; error?: string; resolcVersion?: string; solcVersion?: string }>(resolve => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, input });
    });
  }
}
