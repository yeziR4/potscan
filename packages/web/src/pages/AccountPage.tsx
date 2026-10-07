import { useEffect, useState, type FormEvent } from "react";
import { withNetwork, type Account, type Contract, type Network } from "../api.ts";
import { blockNumber } from "../format.ts";
import { Link, useGo } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { Copy, Empty, Engine, Field, Fields, Hash, Outcome, PageHead } from "../ui.tsx";
import { ExtrinsicTable } from "./BlockPages.tsx";
import { SourcePanel } from "./SourcePanel.tsx";

export function AccountPage({ network, query }: { network: Network; query: string }) {
  const go = useGo();
  const [input, setInput] = useState(query);
  const [reloads, setReloads] = useState(0);
  useEffect(() => setInput(query), [query]);
  const { data, error } = useApi<Account>(
    query ? withNetwork(`/api/account?q=${encodeURIComponent(query)}${reloads ? `&r=${reloads}` : ""}`, network.id) : undefined,
  );
  const isContract = Boolean(data?.code || data?.contract);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = input.trim();
    go(q ? `/account/${encodeURIComponent(q)}` : "/account");
  };

  return (
    <>
      <PageHead
        title={isContract ? "Contract" : "Account"}
        lede={`Every account on ${network.name} has two forms: an EVM address for MetaMask and Solidity, and a Substrate address for native transfers and ink!. Paste either one.`}
      />

      <section className="panel">
        <form className="lookup" onSubmit={submit} role="search">
          <label htmlFor="address-input" className="visually-hidden">
            Address
          </label>
          <input
            id="address-input"
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="0x… EVM address, 5… Substrate address, or 32-byte account id"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="button" type="submit">
            Look up
          </button>
        </form>
        {query && error && <p className="error-text">{error}</p>}
        {query && data && <Forms account={data} network={network} />}
      </section>

      {query && data?.contract && <ContractInfo contract={data.contract} />}
      {query && data?.code && (
        <SourcePanel
          network={network}
          address={data.evm}
          verified={data.code.verified}
          registry={data.registry}
          onVerified={() => setReloads(n => n + 1)}
        />
      )}

      {query && data && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Solidity transactions</h2>
              <span className="meta">Sent from or to {isContract ? "this contract" : "the EVM address"}</span>
            </div>
            {data.evmTxs.length === 0 ? (
              <Empty>None in the indexed blocks.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Hash</th>
                    <th>Direction</th>
                    <th>Counterparty</th>
                    <th className="right">Block</th>
                    <th className="right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evmTxs.map(tx => {
                    const outgoing = tx.from === data.evm.toLowerCase();
                    const other = outgoing ? tx.to : tx.from;
                    return (
                      <tr key={tx.hash}>
                        <td>
                          <Hash value={tx.hash} to={`/tx/${tx.hash}`} />
                        </td>
                        <td>
                          <span className="tag">{outgoing ? "Out" : "In"}</span>
                        </td>
                        <td>{other ? <Hash value={other} to={`/account/${other}`} /> : <span className="faint">contract creation</span>}</td>
                        <td className="right">
                          <Link to={`/block/${tx.block}`}>
                            <span className="num">{blockNumber(tx.block)}</span>
                          </Link>
                        </td>
                        <td className="right">
                          <Outcome success={tx.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Extrinsics signed</h2>
            </div>
            <ExtrinsicTable extrinsics={data.extrinsics} network={network} />
          </section>
        </>
      )}
    </>
  );
}

function Forms({ account, network }: { account: Account; network: Network }) {
  return (
    <>
      <Fields>
        <Field name="EVM address" hint="MetaMask, Solidity, Ethereum RPC">
          <span className="mono">{account.evm}</span>
          <Copy value={account.evm} label="EVM address" />
        </Field>
        <Field name="Substrate address" hint={`SS58 format ${network.ss58}`}>
          <span className="mono">{account.ss58}</span>
          <Copy value={account.ss58} label="Substrate address" />
        </Field>
        <Field name="Account ID">
          <span className="mono">
            {account.ethDerived ? (
              <>
                {account.accountId.slice(0, 42)}
                <span className="faint" title="12 bytes of 0xEE: pallet-revive's marker for an account created from an EVM address">
                  {account.accountId.slice(42)}
                </span>
              </>
            ) : (
              account.accountId
            )}
          </span>
          <Copy value={account.accountId} label="account ID" />
        </Field>
        <Field name="Origin">
          {account.ethDerived ? "Ethereum key (the account was created from an EVM address)" : "Native Substrate key"}
        </Field>
      </Fields>
      {account.contract || account.code ? null : account.ethDerived ? (
        <p className="note">
          <strong>Funding this MetaMask account:</strong> send {network.token} to the Substrate address{" "}
          <span className="mono">{account.ss58}</span> from any Substrate wallet. The balance then shows in MetaMask for{" "}
          <span className="mono">{account.evm}</span>.
        </p>
      ) : (
        <p className="note">
          <strong>This is a native account.</strong> Solidity contracts see it as <span className="mono">{account.evm}</span>. To
          call contracts with MetaMask-style tooling it must first be mapped on chain with{" "}
          <span className="mono">revive.mapAccount</span>.
        </p>
      )}
    </>
  );
}

function ContractInfo({ contract }: { contract: Contract }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Deployment</h2>
        <Engine vm={contract.vm} />
      </div>
      <Fields>
        <Field name="Deployed by">
          <Hash value={contract.deployer} to={`/account/${contract.deployer}`} full />
        </Field>
        <Field name="Deployed in">
          <Link to={`/extrinsic/${contract.block}-${contract.extrinsic}`}>
            <span className="num">
              extrinsic {contract.block}-{contract.extrinsic}
            </span>
          </Link>
        </Field>
      </Fields>
    </section>
  );
}
