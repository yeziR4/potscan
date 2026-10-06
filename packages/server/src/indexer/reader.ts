import "@polkadot/api-augment";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { blake2AsHex } from "@polkadot/util-crypto";
import type { Network } from "@potscan/core";
import { compact } from "./transform.ts";
import type { EthBlock, EthTransaction, RawBlock, RawEvent, RawExtrinsic } from "./types.ts";

/** Reads finalized blocks from one network's Substrate and Ethereum RPCs into plain objects. */
export class ChainReader {
  private constructor(
    private readonly api: ApiPromise,
    private readonly provider: WsProvider,
    private readonly network: Network,
  ) {}

  static async connect(network: Network): Promise<ChainReader> {
    // Retry forever: a testnet that is down now should be picked up when it returns.
    const provider = new WsProvider(network.ws, 5_000);
    const api = await ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: false });
    return new ChainReader(api, provider, network);
  }

  get connected(): boolean {
    return this.api.isConnected;
  }

  async finalizedNumber(): Promise<number> {
    const hash = await this.api.rpc.chain.getFinalizedHead();
    return (await this.api.rpc.chain.getHeader(hash)).number.toNumber();
  }

  onFinalized(callback: (number: number) => void): Promise<() => void> {
    return this.api.rpc.chain.subscribeFinalizedHeads(header => callback(header.number.toNumber()));
  }

  async readBlock(number: number): Promise<RawBlock> {
    const hash = await this.api.rpc.chain.getBlockHash(number);
    // Fetched undecoded: one extrinsic with a format polkadot.js cannot read must not make the whole block unreadable.
    const [block, at] = await Promise.all([
      this.provider.send<{ block: { header: { parentHash: string }; extrinsics: string[] } }>("chain_getBlock", [hash.toHex()], false),
      this.api.at(hash),
    ]);
    const [records, now] = await Promise.all([at.query.system.events(), at.query.timestamp.now()]);
    const extrinsics = block.block.extrinsics.map((bytes, index) => this.decodeExtrinsic(bytes, index));

    const events: RawEvent[] = records.map((record, index) => {
      const { event, phase } = record;
      const names = event.meta.fields.map((f, i) => (f.name.isSome ? f.name.unwrap().toString() : String(i)));
      const data = Object.fromEntries(event.data.map((value, i) => [camel(names[i]!), compact(value.toJSON())]));
      return {
        index,
        extrinsic: phase.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : undefined,
        pallet: event.section,
        name: event.method,
        data,
        error: event.section === "system" && event.method === "ExtrinsicFailed" ? this.describeError(event.data[0]) : undefined,
      };
    });

    return {
      number,
      hash: hash.toHex(),
      parentHash: block.block.header.parentHash,
      timestamp: Number(now.toString()),
      extrinsics,
      events,
    };
  }

  /** The Ethereum view of a block: transactions with their receipts, in one batched request. */
  async readEthBlock(number: number): Promise<EthBlock | undefined> {
    const [block] = await ethBatch(this.network.ethRpc, [["eth_getBlockByNumber", [`0x${number.toString(16)}`, true]]]);
    const b = block as { hash: string; transactions: Record<string, string>[] } | null;
    if (!b) return undefined;
    const receipts = (await ethBatch(this.network.ethRpc, b.transactions.map(tx => ["eth_getTransactionReceipt", [tx.hash]]))) as (Record<string, unknown> | null)[];
    const transactions: EthTransaction[] = b.transactions.map((tx, i) => {
      const receipt = receipts[i];
      return {
        hash: tx.hash!,
        index: Number(tx.transactionIndex),
        from: tx.from!.toLowerCase(),
        to: tx.to?.toLowerCase() ?? undefined,
        value: BigInt(tx.value!).toString(),
        input: compact(tx.input) as string,
        nonce: Number(tx.nonce),
        status: receipt?.status === "0x1",
        gasUsed: receipt ? BigInt(String(receipt.gasUsed)).toString() : "0",
        contractAddress: (receipt?.contractAddress as string | null)?.toLowerCase() ?? undefined,
        logCount: Array.isArray(receipt?.logs) ? receipt.logs.length : 0,
      };
    });
    return { hash: b.hash, transactions };
  }

  async disconnect(): Promise<void> {
    await this.api.disconnect();
  }

  private decodeExtrinsic(bytes: string, index: number): RawExtrinsic {
    try {
      const ex = this.api.registry.createType("Extrinsic", bytes);
      return {
        index,
        hash: ex.hash.toHex(),
        pallet: ex.method.section,
        call: ex.method.method,
        signer: ex.isSigned ? ex.signer.toString() : undefined,
        args: Object.fromEntries(ex.method.meta.args.map((arg, i) => [arg.name.toString(), compact(ex.method.args[i]?.toJSON())])),
      };
    } catch (e) {
      // Kept with its hash so it can still be found; its events still show whether it succeeded and what it paid.
      return {
        index,
        hash: blake2AsHex(bytes, 256),
        pallet: "unknown",
        call: "undecodable",
        // polkadot.js nests decode errors as "outer:: … :: innermost"; the innermost part names the problem.
        args: { reason: e instanceof Error ? e.message.split("::").at(-1)!.trim() : String(e), bytes: compact(bytes) },
      };
    }
  }

  private describeError(dispatchError: unknown): string {
    const error = dispatchError as { isModule?: boolean; asModule?: unknown; toString(): string };
    if (error.isModule) {
      const meta = this.api.registry.findMetaError(error.asModule as Parameters<typeof this.api.registry.findMetaError>[0]);
      return `${meta.section}.${meta.name}`;
    }
    return error.toString();
  }
}

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

async function ethBatch(url: string, calls: [string, unknown[]][]): Promise<unknown[]> {
  if (calls.length === 0) return [];
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Ethereum RPC returned HTTP ${response.status}`);
  const replies = (await response.json()) as { id: number; result?: unknown; error?: { message: string } }[];
  return calls.map((_, id) => {
    const reply = replies.find(r => r.id === id);
    if (!reply || reply.error) throw new Error(`Ethereum RPC: ${reply?.error?.message ?? "missing reply"}`);
    return reply.result;
  });
}
