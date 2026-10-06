import type { Network } from "@potscan/core";
import type { ChainStore } from "./chainStore.ts";
import { ChainReader } from "./reader.ts";
import { hasReviveActivity, toRows } from "./transform.ts";

const PARALLEL_READS = 4;
const RETRY_MS = 5_000;
const PRUNE_EVERY = 200;

export type IndexerState = {
  network: string;
  connected: boolean;
  /** Latest finalized block seen on the chain. */
  head?: number;
  /** Latest block saved. */
  indexed?: number;
  lastError?: string;
};

/** Follows one network's finalized blocks and saves each one, in order, without gaps. */
export class Indexer {
  private reader?: ChainReader;
  private head?: number;
  private running = false;
  private lastError?: string;
  private saved = 0;

  constructor(
    private readonly store: ChainStore,
    private readonly network: Network,
  ) {}

  /** Connects in the background; a network that is down is picked up when it returns. */
  start(): void {
    void ChainReader.connect(this.network).then(async reader => {
      this.reader = reader;
      this.head = await reader.finalizedNumber();
      await reader.onFinalized(n => {
        this.head = n;
        void this.catchUp();
      });
      void this.catchUp();
    });
  }

  state(): IndexerState {
    return {
      network: this.network.id,
      connected: this.reader?.connected ?? false,
      head: this.head,
      indexed: this.store.cursor(this.network.id),
      lastError: this.lastError,
    };
  }

  private firstBlock(head: number): number {
    const cursor = this.store.cursor(this.network.id);
    if (cursor !== undefined) return cursor + 1;
    return this.network.indexFrom === "genesis" ? 0 : Math.max(0, head - this.network.indexFrom.behindHead);
  }

  private async catchUp(): Promise<void> {
    if (this.running || !this.reader || this.head === undefined) return;
    this.running = true;
    try {
      let next = this.firstBlock(this.head);
      while (next <= this.head) {
        const batch = Array.from({ length: Math.min(PARALLEL_READS, this.head - next + 1) }, (_, i) => next + i);
        try {
          const rows = await Promise.all(batch.map(n => this.read(n)));
          for (const r of rows) this.store.saveBlock(this.network.id, r);
          next += batch.length;
          this.lastError = undefined;
          this.prune(next - 1);
        } catch (e) {
          this.lastError = e instanceof Error ? e.message : String(e);
          await new Promise(resolve => setTimeout(resolve, RETRY_MS));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async read(number: number) {
    const raw = await this.reader!.readBlock(number);
    const eth = hasReviveActivity(raw) ? await this.reader!.readEthBlock(number) : undefined;
    return toRows(raw, eth);
  }

  private prune(latest: number): void {
    const keep = this.network.retainBlocks;
    if (!keep || ++this.saved % PRUNE_EVERY !== 0) return;
    this.store.prune(this.network.id, latest - keep);
  }
}
