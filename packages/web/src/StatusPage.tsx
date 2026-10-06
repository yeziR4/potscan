import { getJson, type EndpointStatus, type IndexerState, type Network, type NetworkStatus } from "./api.ts";
import { ago, blockNumber, duration, percent } from "./format.ts";
import { IN_SYNC_BLOCKS } from "./pages/OverviewPage.tsx";
import { useNow, usePolling } from "./usePolling.ts";

const KIND_LABEL = { substrate: "Substrate RPC", evm: "Ethereum RPC" } as const;
const KIND_HINT = { substrate: "Wallets, polkadot.js, ink! tooling", evm: "MetaMask, Hardhat, Foundry, Remix" } as const;

export function StatusPage({ networks }: { networks: Network[] }) {
  const { data, error } = usePolling(() => getJson<NetworkStatus[]>("/api/status"), 30_000, "status");
  const now = useNow();
  const lastCheck = data?.flatMap(n => n.endpoints).reduce((t, e) => Math.max(t, e.latest?.checkedAt ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Network status</h1>
          <p className="lede">
            Every endpoint is checked once a minute from the PotScan server. When something is down, this page says
            what failed, so you know it is the network and not your setup.
          </p>
        </div>
        {lastCheck ? <span className="faint num">Last check {ago(lastCheck, now)}</span> : null}
      </div>

      {error && !data && <p className="panel error-text" style={{ padding: 16 }}>Could not load status: {error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data?.map(status => {
        const network = networks.find(n => n.id === status.network);
        return (
          <section className="panel" key={status.network} aria-labelledby={`net-${status.network}`}>
            <div className="panel-head">
              <h2 id={`net-${status.network}`}>{status.name}</h2>
              <Overall endpoints={status.endpoints} />
              {network && <span className="meta mono">EVM chain ID {network.evmChainId} · {network.token}</span>}
            </div>
            {status.endpoints.map(endpoint => (
              <Endpoint key={endpoint.kind} status={endpoint} now={now} />
            ))}
            <IndexerLine state={status.indexer} />
          </section>
        );
      })}
    </>
  );
}

function IndexerLine({ state }: { state: IndexerState }) {
  const range =
    state.first !== undefined && state.last !== undefined ? ` (${blockNumber(state.first)} – ${blockNumber(state.last)})` : "";
  const behind = state.head !== undefined && state.indexed !== undefined ? state.head - state.indexed : undefined;
  return (
    <p className="indexer-line">
      <span className="stat-name">PotScan indexer</span>
      {state.connected ? (
        <>
          {state.blocks.toLocaleString("en-US")} blocks indexed{range},{" "}
          {behind === undefined ? "starting" : behind <= IN_SYNC_BLOCKS ? "in sync with the finalized head" : `${behind.toLocaleString("en-US")} blocks behind`}
          {state.lastError && <span className="reason-inline">. Retrying after: {state.lastError}</span>}
        </>
      ) : (
        <>Waiting for the node. {state.blocks > 0 ? `${state.blocks.toLocaleString("en-US")} blocks kept from before.` : "Indexing starts from genesis when it is reachable."}</>
      )}
    </p>
  );
}

function Overall({ endpoints }: { endpoints: EndpointStatus[] }) {
  const known = endpoints.filter(e => e.latest);
  if (known.length === 0) return <span className="state">Not checked yet</span>;
  const up = known.filter(e => e.latest!.ok).length;
  if (up === known.length) return <span className="state up">Operational</span>;
  if (up === 0) return <span className="state down">Unavailable</span>;
  return <span className="state down">Partly unavailable</span>;
}

function Endpoint({ status, now }: { status: EndpointStatus; now: number }) {
  const { latest } = status;
  return (
    <div className="endpoint">
      <div>
        <div className="label">{KIND_LABEL[status.kind]}</div>
        <div className="url mono">{status.endpoint}</div>
        <div className="faint" style={{ fontSize: 12 }}>{KIND_HINT[status.kind]}</div>
      </div>

      <div>
        <span className="stat-name">State</span>
        {latest ? (
          <>
            <span className={`state ${latest.ok ? "up" : "down"}`}>{latest.ok ? "Up" : "Down"}</span>
            {status.since !== undefined && (
              <span className="sub num">
                for {status.sinceIsLowerBound && "at least "}
                {duration(now - status.since)}
              </span>
            )}
          </>
        ) : (
          <span className="state">Pending</span>
        )}
      </div>

      <Stat name="Latency" value={latest?.ok && latest.latencyMs !== undefined ? `${latest.latencyMs} ms` : "—"} />
      <Stat
        name={status.kind === "substrate" ? "Best block" : "Block"}
        value={latest?.ok && latest.block !== undefined ? blockNumber(latest.block) : "—"}
        sub={latest?.ok && latest.finalized !== undefined ? `finalized ${blockNumber(latest.finalized)}` : undefined}
      />
      <Stat name="Uptime 24 h" value={status.uptime24h === undefined ? "—" : percent(status.uptime24h)} />

      {latest && !latest.ok && (
        <p className="reason">
          <strong>Last error:</strong> {latest.error}
        </p>
      )}

      <History history={status.history} />
    </div>
  );
}

function Stat({ name, value, sub }: { name: string; value: string; sub?: string }) {
  return (
    <div>
      <span className="stat-name">{name}</span>
      <span className="num">{value}</span>
      {sub && <span className="sub num">{sub}</span>}
    </div>
  );
}

const SLOTS = 96; // 15-minute slots across 24 h

function History({ history }: { history: EndpointStatus["history"] }) {
  const end = Date.now();
  const start = end - 24 * 60 * 60 * 1000;
  const slots: ("ok" | "fail" | "none")[] = Array(SLOTS).fill("none");
  for (const h of history) {
    const i = Math.min(SLOTS - 1, Math.floor(((h.at - start) / (end - start)) * SLOTS));
    if (i < 0) continue;
    // A slot with any failure shows as failed.
    if (!h.ok) slots[i] = "fail";
    else if (slots[i] === "none") slots[i] = "ok";
  }
  const label = `${history.filter(h => h.ok).length} of ${history.length} checks succeeded in the last 24 hours`;
  return (
    <>
      <div className="history" role="img" aria-label={label} title={label}>
        {slots.map((s, i) => (
          <span key={i} className={s === "none" ? "" : s} />
        ))}
      </div>
      <div className="history-scale" aria-hidden="true">
        <span>24 h ago</span>
        <span>now</span>
      </div>
    </>
  );
}
