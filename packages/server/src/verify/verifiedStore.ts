import type { DatabaseSync } from "node:sqlite";
import type { CodeKind } from "./evmMetadata.ts";
import type { VerifyRequest } from "./verifier.ts";

export type Verified = {
  codeHash: string;
  /** Records saved before EVM support have neither field; they were PolkaVM bytecode matches. */
  vm?: CodeKind;
  matchKind?: "exact" | "bytecode";
  contractName: string;
  file: string;
  compiler: string;
  optimizer: VerifyRequest["optimizer"];
  evm?: VerifyRequest["evm"];
  sources: Record<string, string>;
  abi: unknown[];
  sourceHash: string;
  /** The address the source was submitted for; any contract with the same code hash is covered. */
  firstAddress: string;
  verifiedAt: number;
  attestation?: { tx: string; attester: string; registry: string };
};

/** Verified builds, keyed by code hash: one verification covers every deployment of the same code. */
export class VerifiedStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS verified (
        network TEXT NOT NULL, code_hash TEXT NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY (network, code_hash)
      );
    `);
  }

  save(network: string, verified: Verified): void {
    this.db.prepare(`INSERT OR REPLACE INTO verified VALUES (?, ?, ?)`).run(network, verified.codeHash, JSON.stringify(verified));
  }

  byCodeHash(network: string, codeHash: string): Verified | undefined {
    const row = this.db.prepare(`SELECT record FROM verified WHERE network = ? AND code_hash = ?`).get(network, codeHash) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as Verified) : undefined;
  }

  count(network: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM verified WHERE network = ?`).get(network) as { n: number }).n);
  }
}
