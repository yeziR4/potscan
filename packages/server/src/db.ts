import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Probe } from "@potscan/core";

export type EndpointKind = "substrate" | "evm";

export type StoredProbe = Probe & { network: string; kind: EndpointKind };

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS probes (
        network    TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        endpoint   TEXT    NOT NULL,
        ok         INTEGER NOT NULL,
        latency_ms INTEGER,
        block      INTEGER,
        finalized  INTEGER,
        chain_id   INTEGER,
        error      TEXT,
        checked_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS probes_by_time ON probes (network, kind, checked_at);
    `);
  }

  addProbe(p: StoredProbe): void {
    this.db
      .prepare(
        `INSERT INTO probes (network, kind, endpoint, ok, latency_ms, block, finalized, chain_id, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.network, p.kind, p.endpoint, p.ok ? 1 : 0, p.latencyMs ?? null, p.block ?? null, p.finalized ?? null, p.chainId ?? null, p.error ?? null, p.checkedAt);
  }

  /** Probes for one endpoint since a time, oldest first. */
  probesSince(network: string, kind: EndpointKind, since: number): StoredProbe[] {
    const rows = this.db
      .prepare(`SELECT * FROM probes WHERE network = ? AND kind = ? AND checked_at >= ? ORDER BY checked_at`)
      .all(network, kind, since) as Record<string, unknown>[];
    return rows.map(row => ({
      network: String(row.network),
      kind: row.kind as EndpointKind,
      endpoint: String(row.endpoint),
      ok: row.ok === 1,
      latencyMs: optional(row.latency_ms),
      block: optional(row.block),
      finalized: optional(row.finalized),
      chainId: optional(row.chain_id),
      error: row.error === null ? undefined : String(row.error),
      checkedAt: Number(row.checked_at),
    }));
  }

  prune(before: number): void {
    this.db.prepare(`DELETE FROM probes WHERE checked_at < ?`).run(before);
  }
}

const optional = (value: unknown): number | undefined => (value === null || value === undefined ? undefined : Number(value));
