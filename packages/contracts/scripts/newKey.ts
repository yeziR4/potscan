// Creates a throwaway testnet key for deploying and attesting, stored in packages/contracts/.env (gitignored).
// Prints only the addresses to fund, never the key.
import { existsSync, writeFileSync } from "node:fs";
import { fromEvm, NETWORKS } from "@potscan/core";
import { Wallet } from "ethers";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) throw new Error("packages/contracts/.env already exists; delete it first if you really want a new key.");

const wallet = Wallet.createRandom();
writeFileSync(envFile, `# Testnet only. Never reuse for real funds.\nPOTSCAN_KEY=${wallet.privateKey}\n`);

console.log(`EVM address: ${wallet.address}`);
for (const network of Object.values(NETWORKS)) {
  console.log(`Fund on ${network.name} by sending ${network.token} to: ${fromEvm(wallet.address, network.ss58).ss58}`);
}
