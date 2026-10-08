import { readFileSync } from "node:fs";
import { compile, version } from "@parity/resolc";

/** Compiles one contract to PolkaVM with the pinned resolc, the way pallet-revive runs it. */
export async function compileContract(file: string, name: string): Promise<{ bytecode: string; abi: unknown[]; compiler: string }> {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const output = await compile({ [file]: { content: source } });
  const errors = (output.errors ?? []).filter(e => e.severity === "error");
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join("\n"));
  const contract = output.contracts[file]?.[name];
  if (!contract) throw new Error(`${name} not found in ${file}`);
  return { bytecode: `0x${contract.evm.bytecode.object}`, abi: contract.abi, compiler: `resolc ${version().trim()}` };
}
