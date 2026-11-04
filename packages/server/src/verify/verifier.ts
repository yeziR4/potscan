import { Worker } from "node:worker_threads";
import { keccak256, toUtf8Bytes } from "ethers";
import { codeKind, readMetadata, stripMetadata, type CodeKind } from "./evmMetadata.ts";
import { soljsonFor } from "./solcReleases.ts";

export type OptimizerMode = "0" | "1" | "2" | "3" | "s" | "z";

export type VerifyRequest = {
  /** File name to Solidity source. Every imported file must be included; nothing is read from disk. */
  sources: Record<string, string>;
  contractName: string;
  /** `mode` applies to resolc (PolkaVM), `enabled` to both compilers. */
  optimizer: { enabled: boolean; mode: OptimizerMode };
  /** Settings that only matter for EVM bytecode built with solc. */
  evm: { runs: number; evmVersion?: string; viaIR: boolean };
};

export type VerifyResult =
  | {
      match: true;
      /** "exact": metadata identical too. "bytecode": identical code, metadata differs (comments, file paths). */
      matchKind: "exact" | "bytecode";
      vm: CodeKind;
      codeHash: string;
      sourceHash: string;
      file: string;
      compiler: string;
      abi: unknown[];
    }
  | { match: false; reason: string; vm?: CodeKind; compiler?: string; compiledHash?: string; deployedHash?: string };

type Contract = {
  abi: unknown[];
  evm: {
    bytecode?: { object: string };
    deployedBytecode?: { object: string; immutableReferences?: Record<string, { start: number; length: number }[]> };
  };
};
type CompilerOutput = { contracts?: Record<string, Record<string, Contract>>; errors?: { severity: string; formattedMessage: string }[] };
type Reply = { output?: CompilerOutput; error?: string; resolcVersion?: string; solcVersion?: string };

const MAX_FILES = 50;
const MAX_SOURCE_BYTES = 1_000_000;
const MODES = new Set(["0", "1", "2", "3", "s", "z"]);
export const EVM_VERSIONS = [
  "homestead",
  "tangerineWhistle",
  "spuriousDragon",
  "byzantium",
  "constantinople",
  "petersburg",
  "istanbul",
  "berlin",
  "london",
  "paris",
  "shanghai",
  "cancun",
  "prague",
  "osaka",
];

/** Checks a submission before it reaches a compiler, so bad input gets a clear answer instead of a compiler error. */
export function validateRequest(body: unknown): VerifyRequest | string {
  const b = body as (Partial<Omit<VerifyRequest, "evm">> & { evm?: Partial<VerifyRequest["evm"]> }) | null;
  if (!b || typeof b !== "object") return "Send a JSON body with sources, contractName and optimizer.";
  if (!b.sources || typeof b.sources !== "object" || Object.keys(b.sources).length === 0) return "Add at least one source file.";
  const files = Object.entries(b.sources);
  if (files.length > MAX_FILES) return `At most ${MAX_FILES} files.`;
  if (files.some(([name, content]) => typeof content !== "string" || !name.endsWith(".sol"))) return "Each source must be a .sol file with text content.";
  if (files.reduce((n, [, c]) => n + (c as string).length, 0) > MAX_SOURCE_BYTES) return "Sources are larger than 1 MB in total.";
  if (typeof b.contractName !== "string" || !/^[A-Za-z_$][\w$]*$/.test(b.contractName)) return "Give the contract's name, as written after `contract` in the source.";
  const optimizer = b.optimizer ?? { enabled: true, mode: "z" };
  if (typeof optimizer.enabled !== "boolean" || !MODES.has(optimizer.mode)) return "Optimizer mode must be one of 0, 1, 2, 3, s, z.";
  const evm = { runs: b.evm?.runs ?? 200, evmVersion: b.evm?.evmVersion || undefined, viaIR: b.evm?.viaIR ?? false };
  if (!Number.isInteger(evm.runs) || evm.runs < 0 || evm.runs > 2 ** 32 - 1) return "Optimizer runs must be a whole number.";
  if (evm.evmVersion !== undefined && !EVM_VERSIONS.includes(evm.evmVersion)) return `EVM version must be one of ${EVM_VERSIONS.join(", ")}.`;
  if (typeof evm.viaIR !== "boolean") return "viaIR must be true or false.";
  return { sources: b.sources as Record<string, string>, contractName: b.contractName, optimizer, evm };
}

const sortedSources = (request: VerifyRequest) =>
  Object.fromEntries(
    Object.keys(request.sources)
      .sort()
      .map(name => [name, { content: request.sources[name]! }]),
  );

/** The exact resolc input, built only from submitted file contents. Its hash identifies the build. */
export function compilerInput(request: VerifyRequest): string {
  return JSON.stringify({
    language: "Solidity",
    sources: sortedSources(request),
    settings: {
      optimizer: { enabled: request.optimizer.enabled, mode: request.optimizer.mode, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  });
}

/** The exact solc input for EVM bytecode. */
export function evmCompilerInput(request: VerifyRequest): string {
  return JSON.stringify({
    language: "Solidity",
    sources: sortedSources(request),
    settings: {
      optimizer: { enabled: request.optimizer.enabled, runs: request.evm.runs },
      ...(request.evm.evmVersion ? { evmVersion: request.evm.evmVersion } : {}),
      ...(request.evm.viaIR ? { viaIR: true } : {}),
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
    },
  });
}

/**
 * Compares deployed EVM code with a compiler's runtime output. Immutables are written into the code at deploy time,
 * so their positions (which the compiler reports) are zeroed in the deployed copy before comparing.
 */
export function compareEvm(deployed: string, compiled: string, immutables: Record<string, { start: number; length: number }[]> = {}) {
  const d = Buffer.from(deployed.replace(/^0x/, ""), "hex");
  const c = Buffer.from(compiled.replace(/^0x/, ""), "hex");
  if (d.length !== c.length) return undefined;
  for (const refs of Object.values(immutables)) for (const { start, length } of refs) d.fill(0, start, start + length);
  const masked = `0x${d.toString("hex")}`;
  if (masked === `0x${c.toString("hex")}`) return "exact" as const;
  return stripMetadata(masked) === stripMetadata(`0x${c.toString("hex")}`) ? ("bytecode" as const) : undefined;
}

/** One long-lived worker per compiler, held only while it has work so it never keeps the process alive. */
class CompileWorker {
  private worker?: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: Reply) => void>();

  constructor(private readonly file: string) {}

  run(message: Record<string, unknown>): Promise<Reply> {
    if (!this.worker) {
      this.worker = new Worker(new URL(this.file, import.meta.url), { execArgv: ["--import", "tsx"] });
      this.worker.on("message", (reply: Reply & { id: number }) => {
        this.pending.get(reply.id)?.(reply);
        this.pending.delete(reply.id);
        if (this.pending.size === 0) this.worker!.unref();
      });
    }
    const id = this.nextId++;
    this.worker.ref();
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, ...message });
    });
  }

  close() {
    return this.worker?.terminate();
  }
}

export class Verifier {
  private readonly resolc = new CompileWorker("./compileWorker.ts");
  private readonly solc = new CompileWorker("./evmCompileWorker.ts");
  // One compile at a time: each one uses a full core for seconds.
  private queue: Promise<unknown> = Promise.resolve();

  /** @param solcCacheDir where downloaded solc releases are kept */
  constructor(private readonly solcCacheDir: string) {}

  /** Compiles the submission with the compiler the deployed code calls for, and compares the two. */
  verify(request: VerifyRequest, deployedCode: string): Promise<VerifyResult> {
    const run = this.queue.then(() => {
      const kind = codeKind(deployedCode);
      if (!kind) return { match: false as const, reason: "There is no contract code at this address." };
      return kind === "polkavm" ? this.verifyPolkaVm(request, deployedCode) : this.verifyEvm(request, deployedCode);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  close() {
    return Promise.all([this.resolc.close(), this.solc.close()]);
  }

  private async verifyPolkaVm(request: VerifyRequest, deployedCode: string): Promise<VerifyResult> {
    const input = compilerInput(request);
    const reply = await this.resolc.run({ input });
    const compiler = reply.resolcVersion && `resolc ${reply.resolcVersion}, solc ${reply.solcVersion?.split("+")[0]}`;
    const found = pick(reply, request, compiler, "polkavm");
    if ("match" in found) return found;

    const compiled = `0x${found.contract.evm.bytecode?.object ?? ""}`;
    const compiledHash = keccak256(compiled);
    const deployedHash = keccak256(deployedCode);
    if (compiledHash !== deployedHash) return mismatch("polkavm", compiler, compiledHash, deployedHash);
    // PolkaVM code carries no source metadata, so every match is a bytecode match.
    return { match: true, matchKind: "bytecode", vm: "polkavm", codeHash: deployedHash, sourceHash: keccak256(toUtf8Bytes(input)), file: found.file, compiler: compiler!, abi: found.contract.abi };
  }

  private async verifyEvm(request: VerifyRequest, deployedCode: string): Promise<VerifyResult> {
    const version = readMetadata(deployedCode)?.solc;
    if (!version) {
      return { match: false, vm: "evm", reason: "This bytecode carries no solc metadata, so the compiler version that built it is unknown." };
    }
    let soljson: { path: string; longVersion: string };
    try {
      soljson = await soljsonFor(version, this.solcCacheDir);
    } catch (e) {
      return { match: false, vm: "evm", reason: `Could not get solc ${version}: ${(e as Error).message}` };
    }
    const input = evmCompilerInput(request);
    const compiler = `solc ${soljson.longVersion}`;
    const found = pick(await this.solc.run({ input, soljsonPath: soljson.path }), request, compiler, "evm");
    if ("match" in found) return found;

    const runtime = found.contract.evm.deployedBytecode;
    const matchKind = runtime && compareEvm(deployedCode, `0x${runtime.object}`, runtime.immutableReferences);
    const deployedHash = keccak256(deployedCode);
    if (!matchKind) return mismatch("evm", compiler, runtime?.object ? keccak256(`0x${runtime.object}`) : undefined, deployedHash);
    return { match: true, matchKind, vm: "evm", codeHash: deployedHash, sourceHash: keccak256(toUtf8Bytes(input)), file: found.file, compiler, abi: found.contract.abi };
  }
}

/** The named contract from a compiler reply, or the reason there is none. */
function pick(reply: Reply, request: VerifyRequest, compiler: string | undefined, vm: CodeKind): { file: string; contract: Contract } | Extract<VerifyResult, { match: false }> {
  if (reply.error) return { match: false, vm, reason: `The compiler stopped: ${reply.error}`, compiler };
  const errors = (reply.output?.errors ?? []).filter(e => e.severity === "error");
  if (errors.length) return { match: false, vm, reason: errors.map(e => e.formattedMessage.trim()).join("\n\n"), compiler };
  for (const [file, contracts] of Object.entries(reply.output?.contracts ?? {})) {
    const contract = contracts[request.contractName];
    if (contract) return { file, contract };
  }
  return { match: false, vm, reason: `No contract named ${request.contractName} in the sources.`, compiler };
}

function mismatch(vm: CodeKind, compiler: string | undefined, compiledHash: string | undefined, deployedHash: string): VerifyResult {
  return {
    match: false,
    vm,
    reason:
      vm === "evm"
        ? "The compiled code differs from the deployed code. Check the source, the contract name, the optimizer runs, the EVM version and viaIR."
        : "The compiled code differs from the deployed code. Check that the source is what was deployed, the contract name, and the optimizer settings.",
    compiler,
    compiledHash,
    deployedHash,
  };
}
