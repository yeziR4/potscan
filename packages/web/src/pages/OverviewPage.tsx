import { withNetwork, type IndexerState, type Network, type Overview } from "../api.ts";
import { ago, blockNumber } from "../format.ts";
import { Link } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { useNow } from "../usePolling.ts";
import { Empty, Engine, Hash, Outcome, PageHead } from "../ui.tsx";

export function OverviewPage({ network }: { network: Network }) {
  const { data, error } = useApi<Overview>(withNetwork("/api/overview", network.id), 6_000);
  const now = useNow();

  return (
    <>
      <PageHead
        title={network.name}
        lede="Latest blocks, Solidity transactions, signed extrinsics and contract deployments, read from the chain's Substrate and Ethereum RPCs."
        aside={data && <IndexerSummary state={data.indexer} />}
      />
      {error && !data && <p className="panel error-text pad">Could not load the overview: {error}</p>}
      {data && <Unavailable state={data.indexer} network={network} />}

      {data && (
        <div className="grid-2">
          <section className="panel" aria-labelledby="latest-blocks">
            <div className="panel-head">
              <h2 id="latest-blocks">Latest blocks</h2>
              <Link className="meta-link" to="/blocks">
                All blocks
              </Link>
            </div>
            {data.blocks.length === 0 ? (
              <Empty>No blocks indexed yet.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Age</th>
                    <th className="right">Extrinsics</th>
                    <th className="right">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {data.blocks.map(b => (
                    <tr key={b.number}>
                      <td>
                        <Link to={`/block/${b.number}`}>
                          <span className="num">{blockNumber(b.number)}</span>
                        </Link>
                      </td>
                      <td className="muted num">{ago(b.timestamp, now)}</td>
                      <td className="right num">{b.extrinsicCount}</td>
                      <td className="right num">{b.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="latest-evm">
            <div className="panel-head">
              <h2 id="latest-evm">Latest Solidity transactions</h2>
              <span className="meta">via pallet-revive</span>
            </div>
            {data.evmTxs.length === 0 ? (
              <Empty>No Ethereum-style transactions in the indexed blocks yet.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Hash</th>
                    <th>From → To</th>
                    <th className="right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evmTxs.map(tx => (
                    <tr key={tx.hash}>
                      <td>
                        <Hash value={tx.hash} to={`/tx/${tx.hash}`} />
                        <span className="sub num">{blockNumber(tx.block)}</span>
                      </td>
                      <td>
                        <Hash value={tx.from} to={`/account/${tx.from}`} />
                        <span className="arrow" aria-hidden="true">→</span>
                        {tx.to ? <Hash value={tx.to} to={`/account/${tx.to}`} /> : <span className="faint">contract creation</span>}
                      </td>
                      <td className="right">
                        <Outcome success={tx.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="latest-extrinsics">
            <div className="panel-head">
              <h2 id="latest-extrinsics">Latest signed extrinsics</h2>
            </div>
            {data.extrinsics.length === 0 ? (
              <Empty>No signed extrinsics in the indexed blocks yet.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Extrinsic</th>
                    <th>Call</th>
                    <th className="right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.extrinsics.map(e => (
                    <tr key={`${e.block}-${e.idx}`}>
                      <td>
                        <Link to={`/extrinsic/${e.block}-${e.idx}`}>
                          <span className="num">
                            {e.block}-{e.idx}
                          </span>
                        </Link>
                      </td>
                      <td className="mono">
                        {e.pallet}.{e.call}
                      </td>
                      <td className="right">
                        <Outcome success={e.success} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="latest-contracts">
            <div className="panel-head">
              <h2 id="latest-contracts">Contract deployments</h2>
              <Link className="meta-link" to="/contracts">
                All contracts
              </Link>
            </div>
            {data.contracts.length === 0 ? (
              <Empty>No contracts deployed in the indexed blocks yet. Solidity and ink! deployments both appear here.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Engine</th>
                    <th className="right">Block</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contracts.map(c => (
                    <tr key={c.address}>
                      <td>
                        <Hash value={c.address} to={`/account/${c.address}`} />
                      </td>
                      <td>
                        <Engine vm={c.vm} />
                      </td>
                      <td className="right num">
                        <Link to={`/extrinsic/${c.block}-${c.extrinsic}`}>{blockNumber(c.block)}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/** The indexer saves blocks in small batches, so a few blocks behind the finalized head is normal. */
export const IN_SYNC_BLOCKS = 10;

function IndexerSummary({ state }: { state: IndexerState }) {
  if (!state.connected || state.indexed === undefined || state.head === undefined) return null;
  const behind = state.head - state.indexed;
  return (
    <span className="faint num">
      {behind <= IN_SYNC_BLOCKS ? "In sync" : `Catching up: ${behind.toLocaleString("en-US")} blocks behind`} · head {blockNumber(state.head)}
    </span>
  );
}

/** Explains an empty or stale index instead of showing blank tables without a reason. */
export function Unavailable({ state, network }: { state: IndexerState; network: Network }) {
  if (state.connected) return null;
  return (
    <div className="notice" role="status">
      <strong>PotScan cannot reach the {network.name} node right now.</strong>{" "}
      {state.blocks > 0
        ? `Showing the ${state.blocks.toLocaleString("en-US")} blocks indexed before it went away.`
        : "Nothing is indexed yet."}{" "}
      Indexing resumes on its own when the node returns. <Link to="/status">See network status</Link>
    </div>
  );
}
