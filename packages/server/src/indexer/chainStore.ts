import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { BlockRows } from "./types.ts";

type Row = Record<string, SQLInputValue>;

/** Chain data for every network, in the same SQLite database as the probe history. */
export class ChainStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (network TEXT PRIMARY KEY, last_block INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (
        network TEXT NOT NULL, number INTEGER NOT NULL, hash TEXT NOT NULL, parent_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL, eth_hash TEXT, extrinsic_count INTEGER NOT NULL, event_count INTEGER NOT NULL,
        PRIMARY KEY (network, number)
      );
      CREATE INDEX IF NOT EXISTS blocks_by_hash ON blocks (network, hash);
      CREATE TABLE IF NOT EXISTS extrinsics (
        network TEXT NOT NULL, block INTEGER NOT NULL, idx INTEGER NOT NULL, hash TEXT NOT NULL,
        pallet TEXT NOT NULL, call TEXT NOT NULL, signer TEXT, success INTEGER NOT NULL, error TEXT,
        fee TEXT, args TEXT NOT NULL, eth_hash TEXT,
        PRIMARY KEY (network, block, idx)
      );
      CREATE INDEX IF NOT EXISTS extrinsics_by_hash ON extrinsics (network, hash);
      CREATE INDEX IF NOT EXISTS extrinsics_by_signer ON extrinsics (network, signer, block);
      CREATE TABLE IF NOT EXISTS events (
        network TEXT NOT NULL, block INTEGER NOT NULL, idx INTEGER NOT NULL, extrinsic INTEGER,
        pallet TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (network, block, idx)
      );
      CREATE TABLE IF NOT EXISTS evm_txs (
        network TEXT NOT NULL, hash TEXT NOT NULL, block INTEGER NOT NULL, idx INTEGER NOT NULL,
        from_addr TEXT NOT NULL, to_addr TEXT, value TEXT NOT NULL, input TEXT NOT NULL, nonce INTEGER NOT NULL,
        status INTEGER NOT NULL, gas_used TEXT NOT NULL, contract_address TEXT, log_count INTEGER NOT NULL,
        PRIMARY KEY (network, hash)
      );
      CREATE INDEX IF NOT EXISTS evm_txs_by_block ON evm_txs (network, block);
      CREATE INDEX IF NOT EXISTS evm_txs_by_from ON evm_txs (network, from_addr, block);
      CREATE INDEX IF NOT EXISTS evm_txs_by_to ON evm_txs (network, to_addr, block);
      CREATE TABLE IF NOT EXISTS contracts (
        network TEXT NOT NULL, address TEXT NOT NULL, vm TEXT NOT NULL, deployer TEXT NOT NULL,
        block INTEGER NOT NULL, extrinsic INTEGER NOT NULL,
        PRIMARY KEY (network, address)
      );
    `);
  }

  cursor(network: string): number | undefined {
    const row = this.db.prepare(`SELECT last_block FROM cursors WHERE network = ?`).get(network) as Row | undefined;
    return row ? Number(row.last_block) : undefined;
  }

  /** Writes a block and moves the cursor in one transaction, so a crash never leaves half a block. */
  saveBlock(network: string, rows: BlockRows): void {
    const { block, extrinsics, events, evmTxs, contracts } = rows;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`INSERT OR REPLACE INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(network, block.number, block.hash, block.parentHash, block.timestamp, block.ethHash ?? null, block.extrinsicCount, block.eventCount);
      const ex = this.db.prepare(`INSERT OR REPLACE INTO extrinsics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const e of extrinsics) {
        ex.run(network, e.block, e.index, e.hash, e.pallet, e.call, e.signer ?? null, e.success ? 1 : 0, e.error ?? null, e.fee ?? null, e.args, e.ethHash ?? null);
      }
      const ev = this.db.prepare(`INSERT OR REPLACE INTO events VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const e of events) ev.run(network, e.block, e.index, e.extrinsic ?? null, e.pallet, e.name, e.data);
      const tx = this.db.prepare(`INSERT OR REPLACE INTO evm_txs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const t of evmTxs) {
        tx.run(network, t.hash, t.block, t.index, t.from, t.to ?? null, t.value, t.input, t.nonce, t.status ? 1 : 0, t.gasUsed, t.contractAddress ?? null, t.logCount);
      }
      const c = this.db.prepare(`INSERT OR IGNORE INTO contracts VALUES (?, ?, ?, ?, ?, ?)`);
      for (const k of contracts) c.run(network, k.address, k.vm, k.deployer, k.block, k.extrinsic);
      this.db.prepare(`INSERT INTO cursors VALUES (?, ?) ON CONFLICT (network) DO UPDATE SET last_block = excluded.last_block`).run(network, block.number);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Drops blocks below a height. Contracts are kept: a deployment stays worth listing after its block ages out. */
  prune(network: string, below: number): void {
    for (const table of ["blocks", "extrinsics", "events", "evm_txs"]) {
      const column = table === "blocks" ? "number" : "block";
      this.db.prepare(`DELETE FROM ${table} WHERE network = ? AND ${column} < ?`).run(network, below);
    }
  }

  latestBlocks(network: string, limit: number, before?: number): Row[] {
    return this.all(
      `SELECT * FROM blocks WHERE network = ? AND number < ? ORDER BY number DESC LIMIT ?`,
      network,
      before ?? Number.MAX_SAFE_INTEGER,
      limit,
    );
  }

  block(network: string, numberOrHash: string): Row | undefined {
    return /^\d+$/.test(numberOrHash)
      ? this.one(`SELECT * FROM blocks WHERE network = ? AND number = ?`, network, Number(numberOrHash))
      : this.one(`SELECT * FROM blocks WHERE network = ? AND (hash = ? OR eth_hash = ?)`, network, numberOrHash, numberOrHash);
  }

  extrinsicsOf(network: string, block: number): Row[] {
    return this.all(`SELECT * FROM extrinsics WHERE network = ? AND block = ? ORDER BY idx`, network, block);
  }

  eventsOf(network: string, block: number, extrinsic?: number): Row[] {
    return extrinsic === undefined
      ? this.all(`SELECT * FROM events WHERE network = ? AND block = ? ORDER BY idx`, network, block)
      : this.all(`SELECT * FROM events WHERE network = ? AND block = ? AND extrinsic = ? ORDER BY idx`, network, block, extrinsic);
  }

  extrinsic(network: string, block: number, index: number): Row | undefined {
    return this.one(`SELECT * FROM extrinsics WHERE network = ? AND block = ? AND idx = ?`, network, block, index);
  }

  latestExtrinsics(network: string, limit: number, signedOnly: boolean): Row[] {
    return this.all(
      `SELECT * FROM extrinsics WHERE network = ? ${signedOnly ? "AND signer IS NOT NULL" : ""} ORDER BY block DESC, idx DESC LIMIT ?`,
      network,
      limit,
    );
  }

  evmTx(network: string, hash: string): Row | undefined {
    return this.one(`SELECT * FROM evm_txs WHERE network = ? AND hash = ?`, network, hash.toLowerCase());
  }

  latestEvmTxs(network: string, limit: number): Row[] {
    return this.all(`SELECT * FROM evm_txs WHERE network = ? ORDER BY block DESC, idx DESC LIMIT ?`, network, limit);
  }

  contracts(network: string, limit: number): Row[] {
    return this.all(`SELECT * FROM contracts WHERE network = ? ORDER BY block DESC LIMIT ?`, network, limit);
  }

  contract(network: string, address: string): Row | undefined {
    return this.one(`SELECT * FROM contracts WHERE network = ? AND (address = ? OR address = ?)`, network, address, address.toLowerCase());
  }

  /** Recent activity of one account, matched by its EVM and Substrate forms. */
  activity(network: string, evm: string, ss58: string, limit: number): { extrinsics: Row[]; evmTxs: Row[] } {
    const lower = evm.toLowerCase();
    return {
      extrinsics: this.all(
        `SELECT * FROM extrinsics WHERE network = ? AND (signer = ? OR signer = ?) ORDER BY block DESC, idx DESC LIMIT ?`,
        network,
        ss58,
        lower,
        limit,
      ),
      evmTxs: this.all(
        `SELECT * FROM evm_txs WHERE network = ? AND (from_addr = ? OR to_addr = ?) ORDER BY block DESC, idx DESC LIMIT ?`,
        network,
        lower,
        lower,
        limit,
      ),
    };
  }

  /** Finds what a 32-byte hash refers to. */
  findHash(network: string, hash: string): { kind: "block" | "extrinsic" | "evm-tx"; block: number; index?: number; hash: string } | undefined {
    const h = hash.toLowerCase();
    const tx = this.evmTx(network, h);
    if (tx) return { kind: "evm-tx", block: Number(tx.block), hash: String(tx.hash) };
    const block = this.block(network, h);
    if (block) return { kind: "block", block: Number(block.number), hash: String(block.hash) };
    const ex = this.one(`SELECT block, idx, hash FROM extrinsics WHERE network = ? AND hash = ? ORDER BY block DESC LIMIT 1`, network, h);
    if (ex) return { kind: "extrinsic", block: Number(ex.block), index: Number(ex.idx), hash: String(ex.hash) };
    return undefined;
  }

  span(network: string): { first?: number; last?: number; blocks: number } {
    const row = this.one(`SELECT MIN(number) AS first, MAX(number) AS last, COUNT(*) AS blocks FROM blocks WHERE network = ?`, network)!;
    return { first: row.first === null ? undefined : Number(row.first), last: row.last === null ? undefined : Number(row.last), blocks: Number(row.blocks) };
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
}
