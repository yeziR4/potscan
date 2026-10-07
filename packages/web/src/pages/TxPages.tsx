import type { ReactNode } from "react";
import { withNetwork, type ChainEvent, type EvmTx, type Extrinsic, type Network } from "../api.ts";
import { amount, blockNumber, EVM_DECIMALS } from "../format.ts";
import { Link } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { Copy, Data, Field, Fields, Hash, Outcome, PageHead } from "../ui.tsx";
import { EventList, Missing } from "./BlockPages.tsx";

type ExtrinsicDetail = { extrinsic: Extrinsic; events: ChainEvent[]; evmTx?: EvmTx };
type TxDetail = { tx: EvmTx; extrinsic?: Extrinsic; events: ChainEvent[] };

export function ExtrinsicPage({ network, block, index }: { network: Network; block: number; index: number }) {
  const { data, error, notFound } = useApi<ExtrinsicDetail>(withNetwork(`/api/extrinsic?block=${block}&index=${index}`, network.id));
  if (notFound) return <Missing what={`Extrinsic ${block}-${index}`} network={network} />;
  if (error) return <p className="panel error-text pad">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { extrinsic: e, events, evmTx } = data;

  return (
    <>
      <PageHead title={<>Extrinsic <span className="num">{block}-{index}</span></>} lede={<span className="mono">{e.pallet}.{e.call}</span>} />
      {evmTx && <SameTransaction>This extrinsic carried the Solidity transaction <Hash value={evmTx.hash} to={`/tx/${evmTx.hash}`} />.</SameTransaction>}
      {e.call === "undecodable" && (
        <div className="notice notice-link" role="note">
          <strong>PotScan could not decode this extrinsic's format.</strong> It is usually a signed extension specific to
          this chain. Its result and fee below come from the events it emitted, which decode separately.
        </div>
      )}
      <section className="panel">
        <ExtrinsicFields extrinsic={e} network={network} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Arguments</h2>
        </div>
        <div className="pad">
          <Data value={e.args} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Events</h2>
          <span className="meta num">{events.length}</span>
        </div>
        <EventList events={events} />
      </section>
    </>
  );
}

export function TxPage({ network, hash }: { network: Network; hash: string }) {
  const { data, error, notFound } = useApi<TxDetail>(withNetwork(`/api/tx?hash=${hash}`, network.id));
  if (notFound) return <Missing what={`Transaction ${hash}`} network={network} />;
  if (error) return <p className="panel error-text pad">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { tx, extrinsic, events } = data;
  const selector = tx.input.length >= 10 ? tx.input.slice(0, 10) : undefined;

  return (
    <>
      <PageHead title="Solidity transaction" lede={<Hash value={tx.hash} full />} aside={<Copy value={tx.hash} label="transaction hash" />} />
      {extrinsic && (
        <SameTransaction>
          On the Substrate side this is extrinsic{" "}
          <Link to={`/extrinsic/${tx.block}-${tx.idx}`}>
            <span className="num">
              {tx.block}-{tx.idx}
            </span>
          </Link>{" "}
          (<span className="mono">{extrinsic.pallet}.{extrinsic.call}</span>), which is where its native fee and storage deposit appear.
        </SameTransaction>
      )}
      <section className="panel">
        <Fields>
          <Field name="Result">
            <Outcome success={tx.status} />
          </Field>
          <Field name="Block">
            <Link to={`/block/${tx.block}`}>
              <span className="num">{blockNumber(tx.block)}</span>
            </Link>
          </Field>
          <Field name="From">
            <Hash value={tx.from} to={`/account/${tx.from}`} full />
          </Field>
          <Field name="To">
            {tx.to ? <Hash value={tx.to} to={`/account/${tx.to}`} full /> : <span className="faint">Contract creation</span>}
          </Field>
          {tx.contractAddress && (
            <Field name="Contract created">
              <Hash value={tx.contractAddress} to={`/account/${tx.contractAddress}`} full />
            </Field>
          )}
          <Field name="Value" hint="18 decimals on the Ethereum side">
            <span className="num">{amount(tx.value, EVM_DECIMALS, network.token)}</span>
          </Field>
          {extrinsic?.fee && (
            <Field name="Fee paid" hint="Native, from TransactionFeePaid">
              <span className="num">{amount(extrinsic.fee, network.decimals, network.token)}</span>
            </Field>
          )}
          <Field name="Gas used">
            <span className="num">{BigInt(tx.gasUsed).toLocaleString("en-US")}</span>
          </Field>
          <Field name="Nonce">
            <span className="num">{tx.nonce}</span>
          </Field>
          {selector && (
            <Field name="Function" hint={`Selector ${selector}`}>
              {tx.method ? (
                <span className="mono">{tx.method}</span>
              ) : (
                <span className="faint">
                  Unknown until the contract is verified.{" "}
                  {tx.to && <Link to={`/account/${tx.to}`}>Verify it</Link>}
                </span>
              )}
            </Field>
          )}
          <Field name="Input">
            <span className="mono">{tx.input === "0x" ? <span className="faint">empty (plain transfer)</span> : tx.input}</span>
          </Field>
          <Field name="Logs">
            <span className="num">{tx.logCount}</span>
          </Field>
        </Fields>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Events</h2>
          <span className="meta">From the Substrate side, including balance movements</span>
        </div>
        <EventList events={events} />
      </section>
    </>
  );
}

function ExtrinsicFields({ extrinsic: e, network }: { extrinsic: Extrinsic; network: Network }) {
  return (
    <Fields>
      <Field name="Result">
        <Outcome success={e.success} error={e.error} />
      </Field>
      <Field name="Block">
        <Link to={`/block/${e.block}`}>
          <span className="num">{blockNumber(e.block)}</span>
        </Link>
      </Field>
      <Field name="Hash">
        <Hash value={e.hash} full />
        <Copy value={e.hash} label="extrinsic hash" />
      </Field>
      <Field name="Signer">{e.signer ? <Hash value={e.signer} to={`/account/${e.signer}`} full /> : <span className="faint">None: an inherent added by the block author</span>}</Field>
      <Field name="Fee">{e.fee ? <span className="num">{amount(e.fee, network.decimals, network.token)}</span> : <span className="faint">—</span>}</Field>
    </Fields>
  );
}

/** The link between the two views of one transaction, which no other Portaldot tool shows. */
function SameTransaction({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-link" role="note">
      <strong>One transaction, two views.</strong> {children}
    </div>
  );
}
