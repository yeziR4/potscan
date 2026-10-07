import { existsSync, readFileSync } from "node:fs";
import type { Network } from "@potscan/core";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const REGISTRY_ABI = ["function attest(address target, bytes32 sourceHash, string compiler, string sourceUri)"];
const CONFIRM_TIMEOUT_MS = 60_000;

export type Attestation = { tx: string; attester: string; registry: string };

/** Records verified builds in the network's VerificationRegistry, when a key and a deployment are configured. */
export class Attester {
  private constructor(
    private readonly registry: Contract,
    readonly attester: string,
    readonly registryAddress: string,
  ) {}

  /** Undefined when PotScan has no key or no registry on this network: verification still works, off chain only. */
  static forNetwork(network: Network, key: string | undefined): Attester | undefined {
    const file = new URL(`../../../contracts/deployments/${network.id}.json`, import.meta.url);
    if (!key || !existsSync(file)) return undefined;
    const address = (JSON.parse(readFileSync(file, "utf8")) as { VerificationRegistry: { address: string } }).VerificationRegistry.address;
    const wallet = new Wallet(key, new JsonRpcProvider(network.ethRpc, network.evmChainId, { staticNetwork: true }));
    return new Attester(new Contract(address, REGISTRY_ABI, wallet), wallet.address, address);
  }

  async attest(target: string, sourceHash: string, compiler: string, sourceUri: string): Promise<Attestation> {
    const tx = await this.registry.getFunction("attest")(target, sourceHash, compiler, sourceUri);
    const receipt = await tx.wait(1, CONFIRM_TIMEOUT_MS);
    if (!receipt || receipt.status !== 1) throw new Error(`Attestation transaction ${tx.hash} failed`);
    return { tx: tx.hash as string, attester: this.attester, registry: this.registryAddress };
  }
}
