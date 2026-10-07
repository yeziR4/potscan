// Deploys VerificationRegistry to a pallet-revive network and records the address in deployments/<network>.json.
// Usage: npm run deploy -w @potscan/contracts -- <network-id>
import { mkdirSync, writeFileSync } from "node:fs";
import { NETWORKS } from "@potscan/core";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { compileContract } from "./compile.ts";

const networkId = process.argv[2] ?? "portaldot-v3";
const network = NETWORKS[networkId];
if (!network) throw new Error(`Unknown network ${networkId}. Known: ${Object.keys(NETWORKS).join(", ")}`);
const key = process.env.POTSCAN_KEY;
if (!key) throw new Error("POTSCAN_KEY is not set. Run `npm run new-key -w @potscan/contracts` and fund the address it prints.");

const provider = new JsonRpcProvider(network.ethRpc, network.evmChainId, { staticNetwork: true });
const wallet = new Wallet(key, provider);
const balance = await provider.getBalance(wallet.address);
if (balance === 0n) throw new Error(`${wallet.address} has no ${network.token} on ${network.name}; fund it first.`);

const { bytecode, abi, compiler } = await compileContract("VerificationRegistry.sol", "VerificationRegistry");
console.log(`Compiled with ${compiler}: ${(bytecode.length - 2) / 2} bytes of PolkaVM code`);

const contract = await new ContractFactory(abi as never[], bytecode, wallet).deploy();
const tx = contract.deploymentTransaction()!;
console.log(`Deploying from ${wallet.address}, transaction ${tx.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();

mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../deployments/${network.id}.json`, import.meta.url),
  `${JSON.stringify({ VerificationRegistry: { address, transaction: tx.hash, compiler, deployer: wallet.address } }, null, 2)}\n`,
);
console.log(`VerificationRegistry deployed at ${address}`);
