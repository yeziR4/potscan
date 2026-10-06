export type Probe = {
  endpoint: string;
  ok: boolean;
  latencyMs?: number;
  block?: number;
  finalized?: number;
  chainId?: number;
  /** Plain-language reason, set whenever ok is false. */
  error?: string;
  checkedAt: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

type RpcResponse = { result?: unknown; error?: { message: string } };

class ProbeError extends Error {}

/** Checks an Ethereum JSON-RPC endpoint: it answers, it is on the expected chain, and its block number. */
export async function probeEvm(endpoint: string, expectedChainId?: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Probe> {
  const started = Date.now();
  try {
    const call = (method: string) => httpRpc(endpoint, method, timeoutMs);
    const [chainId, block] = await Promise.all([call("eth_chainId"), call("eth_blockNumber")]);
    const probe = { endpoint, ok: true, latencyMs: Date.now() - started, chainId: hexNumber(chainId), block: hexNumber(block), checkedAt: started };
    if (expectedChainId !== undefined && probe.chainId !== expectedChainId) {
      return { ...probe, ok: false, error: `Chain ID is ${probe.chainId}, expected ${expectedChainId}` };
    }
    return probe;
  } catch (e) {
    return { endpoint, ok: false, error: describe(e, timeoutMs), checkedAt: started };
  }
}

/** Checks a Substrate WebSocket endpoint: it accepts a connection, and its best and finalized block numbers. */
export async function probeSubstrate(endpoint: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Probe> {
  const started = Date.now();
  try {
    const [best, finalized] = await wsRpc(endpoint, timeoutMs, async call => {
      const head = (await call("chain_getHeader")) as { number: string };
      const finalizedHash = await call("chain_getFinalizedHead");
      const finalizedHead = (await call("chain_getHeader", [finalizedHash])) as { number: string };
      return [hexNumber(head.number), hexNumber(finalizedHead.number)];
    });
    return { endpoint, ok: true, latencyMs: Date.now() - started, block: best, finalized, checkedAt: started };
  } catch (e) {
    return { endpoint, ok: false, error: describe(e, timeoutMs), checkedAt: started };
  }
}

async function httpRpc(endpoint: string, method: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new ProbeError(httpReason(response.status));
  return unwrap((await response.json()) as RpcResponse, method);
}

function wsRpc<T>(endpoint: string, timeoutMs: number, run: (call: (method: string, params?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map<number, (message: RpcResponse) => void>();
    let nextId = 1;
    let settled = false;
    // Closing a socket that failed to connect fires another error event, so settle only once.
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new DOMException("timeout", "TimeoutError"))), timeoutMs);

    socket.onerror = () => finish(() => reject(new ProbeError("WebSocket connection failed")));
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as RpcResponse & { id?: number };
      if (message.id !== undefined) pending.get(message.id)?.(message);
    };
    socket.onopen = () => {
      const call = (method: string, params: unknown[] = []) =>
        new Promise<unknown>((ok, fail) => {
          const id = nextId++;
          pending.set(id, message => {
            try {
              ok(unwrap(message, method));
            } catch (e) {
              fail(e);
            }
          });
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      run(call).then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error)),
      );
    };
  });
}

function unwrap(message: RpcResponse, method: string): unknown {
  if (message.error) throw new ProbeError(`${method} failed: ${message.error.message}`);
  return message.result;
}

const hexNumber = (value: unknown): number => Number.parseInt(String(value), 16);

function httpReason(status: number): string {
  if (status === 502 || status === 503) return `HTTP ${status}: the RPC gateway is up but the node behind it is not answering`;
  if (status === 524) return "HTTP 524: the node took too long to answer the gateway";
  return `HTTP ${status}`;
}

function describe(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return `No response within ${timeoutMs / 1000} s`;
  if (error instanceof ProbeError) return error.message;
  const cause = (error as { cause?: { code?: string } }).cause?.code;
  if (cause === "ENOTFOUND") return "Host name does not resolve";
  if (cause === "ECONNREFUSED") return "Connection refused";
  return error instanceof Error ? error.message : String(error);
}
