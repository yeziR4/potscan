import { withNetwork, type Block, type ChainEvent, type Extrinsic, type Network, type Overview } from "../api.ts";
import { ago, amount, blockNumber, dateTime } from "../format.ts";
import { Link } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { useNow } from "../usePolling.ts";
import { Copy, Data, Empty, Field, Fields, Hash, Outcome, PageHead } from "../ui.tsx";
import { Unavailable } from "./OverviewPage.tsx";

export function BlocksPage({ network }: { network: Network }) {
  const overview = useApi<Overview>(withNetwork("/api/overview", network.id), 6_000);
  const { data } = useApi<Block[]>(withNetwork("/api/blocks?limit=50", network.id), 6_000);
  const now = useNow();
  return (
    <>
      <PageHead title="Blocks" lede="The most recent finalized blocks PotScan has indexed." />
      {overview.data && <Unavailable state={overview.data.indexer} network={network} />}
      <section className="panel">
        {!data || data.length === 0 ? (
          <Empty>No blocks indexed yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Hash</th>
                <th>Age</th>
                <th className="right">Extrinsics</th>
                <th className="right">Events</th>
              </tr>
            </thead>
            <tbody>
              {data.map(b => (
                <tr key={b.number}>
                  <td>
                    <Link to={`/block/${b.number}`}>
                      <span className="num">{blockNumber(b.number)}</span>
                    </Link>
                  </td>
                  <td>
                    <Hash value={b.hash} />
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
    </>
  );
}

type BlockDetail = { block: Block; extrinsics: Extrinsic[]; events: ChainEvent[] };

export function BlockPage({ network, id }: { network: Network; id: string }) {
  const { data, error, notFound } = useApi<BlockDetail>(withNetwork(`/api/block?id=${encodeURIComponent(id)}`, network.id));
  const now = useNow();
  if (notFound) return <Missing what={`Block ${id}`} network={network} />;
  if (error) return <p className="panel error-text pad">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { block, extrinsics, events } = data;

  return (
    <>
      <PageHead
        title={<>Block <span className="num">{blockNumber(block.number)}</span></>}
        aside={
          <span className="pager">
            <Link to={`/block/${block.number - 1}`}>← Previous</Link>
            <Link to={`/block/${block.number + 1}`}>Next →</Link>
          </span>
        }
      />
      <section className="panel">
        <Fields>
          <Field name="Time">
            <span className="num">{dateTime(block.timestamp)}</span>
            <span className="faint num">{ago(block.timestamp, now)}</span>
          </Field>
          <Field name="Block hash" hint="Substrate">
            <Hash value={block.hash} full />
            <Copy value={block.hash} label="block hash" />
          </Field>
          {block.ethHash && (
            <Field name="Ethereum block hash" hint="What eth_getBlockByNumber returns">
              <Hash value={block.ethHash} full />
              <Copy value={block.ethHash} label="Ethereum block hash" />
            </Field>
          )}
          <Field name="Parent hash">
            <Link to={`/block/${block.number - 1}`}>
              <Hash value={block.parentHash} full />
            </Link>
          </Field>
        </Fields>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Extrinsics</h2>
          <span className="meta num">{extrinsics.length}</span>
        </div>
        <ExtrinsicTable extrinsics={extrinsics} network={network} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Events</h2>
          <span className="meta num">{events.length}</span>
        </div>
        <EventList events={events} showExtrinsic />
      </section>
    </>
  );
}

export function ExtrinsicTable({ extrinsics, network }: { extrinsics: Extrinsic[]; network: Network }) {
  if (extrinsics.length === 0) return <Empty>None.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Extrinsic</th>
          <th>Call</th>
          <th>Signer</th>
          <th className="right">Fee</th>
          <th className="right">Result</th>
        </tr>
      </thead>
      <tbody>
        {extrinsics.map(e => (
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
              {e.ethHash && <span className="tag tag-inline">EVM</span>}
            </td>
            <td>{e.signer ? <Hash value={e.signer} to={`/account/${e.signer}`} /> : <span className="faint">inherent</span>}</td>
            <td className="right num">{e.fee ? amount(e.fee, network.decimals, network.token) : <span className="faint">—</span>}</td>
            <td className="right">
              <Outcome success={e.success} error={e.error} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EventList({ events, showExtrinsic }: { events: ChainEvent[]; showExtrinsic?: boolean }) {
  if (events.length === 0) return <Empty>None.</Empty>;
  return (
    <ol className="events">
      {events.map(e => (
        <li key={e.idx}>
          <details>
            <summary>
              <span className="mono">
                {e.pallet}.{e.name}
              </span>
              {showExtrinsic && (
                <span className="faint num">{e.extrinsic === undefined ? "block" : `extrinsic ${e.extrinsic}`}</span>
              )}
            </summary>
            <Data value={e.data} />
          </details>
        </li>
      ))}
    </ol>
  );
}

export function Missing({ what, network }: { what: string; network: Network }) {
  return (
    <>
      <PageHead title="Not found" />
      <section className="panel pad">
        <p className="m0">
          <strong>{what}</strong> is not in PotScan's index for {network.name}.
        </p>
        <p className="muted">
          PotScan keeps every block of the Portaldot V3 testnet and the most recent blocks of the stand-in network. If
          you just sent a transaction, it appears once its block is finalized, usually within a minute.
        </p>
        <Link to="/">Back to the overview</Link>
      </section>
    </>
  );
}
