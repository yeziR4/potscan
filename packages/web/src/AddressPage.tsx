import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getJson, type MappedAddress, type Network } from "./api.ts";

export function AddressPage({ network, query, onSearch }: { network: Network; query: string; onSearch: (q: string) => void }) {
  const [input, setInput] = useState(query);
  const [result, setResult] = useState<MappedAddress>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setInput(query);
    setResult(undefined);
    setError(undefined);
    if (!query) return;
    getJson<MappedAddress>(`/api/address?network=${network.id}&q=${encodeURIComponent(query)}`).then(setResult, (e: Error) => setError(e.message));
  }, [query, network.id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(input.trim());
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Address mapper</h1>
          <p className="lede">
            Every account on {network.name} has two forms: an EVM address for MetaMask and Solidity, and a Substrate
            address for native transfers and ink!. Paste either one to see both.
          </p>
        </div>
      </div>

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
            Map address
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}

        {result && (
          <>
            <dl className="fields">
              <Field name="EVM address" value={result.evm} hint="MetaMask, Solidity, Ethereum RPC" />
              <Field name="Substrate address" value={result.ss58} hint={`SS58 format ${network.ss58}`} />
              <Field
                name="Account ID"
                value={result.accountId}
                display={
                  result.ethDerived ? (
                    <>
                      {result.accountId.slice(0, 42)}
                      <span className="faint" title="12 bytes of 0xEE: pallet-revive's marker for an account created from an EVM address">
                        {result.accountId.slice(42)}
                      </span>
                    </>
                  ) : undefined
                }
              />
              <dt>Origin</dt>
              <dd>{result.ethDerived ? "Ethereum key (the account was created from an EVM address)" : "Native Substrate key"}</dd>
            </dl>
            {result.ethDerived ? (
              <p className="note">
                <strong>Funding this MetaMask account:</strong> send {network.token} to the Substrate address{" "}
                <span className="mono">{result.ss58}</span> from any Substrate wallet. The balance then shows in MetaMask
                for <span className="mono">{result.evm}</span>.
              </p>
            ) : (
              <p className="note">
                <strong>This is a native account.</strong> Solidity contracts see it as{" "}
                <span className="mono">{result.evm}</span>. To call contracts with MetaMask-style tooling it must first
                be mapped on chain with <span className="mono">revive.mapAccount</span>.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Field({ name, value, hint, display }: { name: string; value: string; hint?: string; display?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <dt>
        {name}
        {hint && <span className="stat-name">{hint}</span>}
      </dt>
      <dd>
        <span className="mono">{display ?? value}</span>
        <button type="button" className="button button-quiet copy" onClick={copy} aria-label={`Copy ${name}`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </dd>
    </>
  );
}
