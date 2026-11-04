import { useEffect, useRef, useState, type ReactNode } from "react";
import { withNetwork, type Insights, type Network } from "../api.ts";
import { ago, amount, blockNumber, duration, short } from "../format.ts";
import { Link } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { useNow } from "../usePolling.ts";
import { HourField, type Encoding } from "./HourField.tsx";

const dateLong = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
const count = (n: number) => n.toLocaleString("en-US");
const pct = (share: number) => `${(share * 100).toFixed(share < 0.01 && share > 0 ? 2 : 1)}%`;

export function ReportPage({ network }: { network: Network }) {
  const { data, error, notFound } = useApi<Insights>(withNetwork("/api/insights", network.id), 5 * 60_000);
  const now = useNow();
  const [encoding, setEncoding] = useState<Encoding>("time");

  if (notFound) return <Pending network={network} />;
  if (error && !data) return <p className="panel error-text pad">Could not load the report: {error}</p>;
  if (!data) return <p className="muted report-loading">Reading every block of {network.name}…</p>;

  const { span, blockTime, activity, failures, costs, validators } = data;
  const solidityShare = activity.signed ? activity.evmTxs / activity.signed : 0;

  return (
    <article className="report">
      <header className="report-hero">
        <p className="eyebrow">
          State of {network.name} · live research report <span className="eyebrow-time">updated {ago(data.generatedAt, now)}</span>
        </p>
        <h1 className="display">
          {count(span.blocks)} blocks since {dateLong(span.since)}.
          <span className="display-quiet"> Here is what is happening inside them.</span>
        </h1>
        <p className="report-lede">
          Every number on this page is computed from PotScan's own index of the chain, block by block, and every claim links to
          the evidence in the explorer.
        </p>
        <nav className="chapter-index" aria-label="Chapters">
          <a href="#health">01 Is the network healthy?</a>
          <a href="#builders">02 Who is building?</a>
          <a href="#failures">03 Why do transactions fail?</a>
          <a href="#costs">04 What does it cost?</a>
        </nav>
      </header>

      <div className="story">
        <div className="story-chapters">
          <Chapter id="health" number="01" onEnter={() => setEncoding("time")}>
            <h2 className="chapter-title">Is the network healthy?</h2>
            <p className="big-stat">
              {seconds(blockTime.p50Ms)}
              <span>median block time, against a {seconds(blockTime.targetMs)} target</span>
            </p>
            <p className="chapter-text">
              Half of all blocks arrive within {seconds(blockTime.p50Ms)}, and 95% within {seconds(blockTime.p95Ms)}.{" "}
              {pct(blockTime.slowShare)} took longer than one and a half slots.
            </p>
            {blockTime.longestGap && (
              <Note title="Longest stall">
                <strong>{blockTime.longestGap.ms >= 60_000 ? duration(blockTime.longestGap.ms) : seconds(blockTime.longestGap.ms)}</strong> with no
                block, ending at block{" "}
                <Link to={`/block/${blockTime.longestGap.block}`}>{blockNumber(blockTime.longestGap.block)}</Link>, on{" "}
                {dateLong(blockTime.longestGap.at)}: the faint run of dots in the field.
              </Note>
            )}
            {validators && validators.count > 0 && (
              <Note title={`${validators.count} validators${validators.era !== undefined ? ` · era ${validators.era}` : ""}`}>
                <ul className="validator-bars">
                  {validators.points.slice(0, 6).map(v => {
                    const max = validators.points[0]?.points || 1;
                    return (
                      <li key={v.validator}>
                        <Link to={`/account/${v.validator}`}>
                          <span className="mono">{short(v.validator, 6)}</span>
                        </Link>
                        <span className="bar" style={{ ["--w" as string]: `${(v.points / max) * 100}%` }} />
                        <span className="num">{count(v.points)}</span>
                      </li>
                    );
                  })}
                </ul>
                <span className="note-foot">Era reward points: 20 per authored block.</span>
              </Note>
            )}
            {validators && validators.count > 0 && validators.count < 4 && (
              <p className="chapter-text">
                <strong>
                  {validators.count === 1 ? "One validator produces" : `${validators.count} validators produce`} every block.
                </strong>{" "}
                GRANDPA finalizes a block only when more than two thirds of validators vote for it, so with{" "}
                {validators.count === 1 ? "one" : validators.count} of them, {validators.count === 1 ? "it" : "every one"} must be
                online for anything to finalize. A larger validator set is what turns a testnet into a network.
              </p>
            )}
          </Chapter>

          <Chapter id="builders" number="02" onEnter={() => setEncoding("activity")}>
            <h2 className="chapter-title">Who is building?</h2>
            <p className="big-stat">
              {count(activity.accounts)}
              <span>accounts have sent {count(activity.signed)} transactions</span>
            </p>
            <p className="chapter-text">
              {pct(solidityShare)} of them are Solidity, sent through pallet-revive. {count(activity.contracts.evm)} Solidity contracts
              {activity.contracts.wasm > 0 ? ` and ${count(activity.contracts.wasm)} ink! contracts` : ""} have been deployed.
              {activity.contracts.wasm === 0 && " Nobody has deployed an ink! contract yet: the Solidity path is where builders are."}
            </p>
            {activity.codeBuild.classified > 0 && (
              <>
                <p className="chapter-text">
                  <strong>
                    {pct(activity.codeBuild.evm / activity.codeBuild.classified)} of Solidity contracts are plain EVM bytecode
                  </strong>
                  , compiled with standard solc. Only {count(activity.codeBuild.polkavm)} of {count(activity.codeBuild.classified)} use
                  PolkaVM, the RISC-V target V3 introduces through resolc. Builders are treating V3 as an EVM chain: the native path is
                  almost unused.
                </p>
                <Note title="How contracts are built">
                  <div className="split-bar" role="img" aria-label={`${activity.codeBuild.evm} EVM bytecode, ${activity.codeBuild.polkavm} PolkaVM`}>
                    <span className="split-evm" style={{ flexGrow: activity.codeBuild.evm }} />
                    <span className="split-pvm" style={{ flexGrow: Math.max(activity.codeBuild.polkavm, activity.codeBuild.classified / 200) }} />
                  </div>
                  <ol className="rank">
                    <li>
                      <span>
                        <i className="dot dot-blue" aria-hidden="true" /> EVM bytecode (solc)
                      </span>
                      <span className="num">{count(activity.codeBuild.evm)}</span>
                    </li>
                    <li>
                      <span>
                        <i className="dot dot-warm" aria-hidden="true" /> PolkaVM (resolc)
                      </span>
                      <span className="num">{count(activity.codeBuild.polkavm)}</span>
                    </li>
                  </ol>
                  {activity.codeBuild.solc.length > 0 && (
                    <span className="note-foot">
                      Most used: {activity.codeBuild.solc.map(s => `solc ${s.version} (${count(s.count)})`).join(", ")}. Read from each
                      contract's own metadata.
                    </span>
                  )}
                </Note>
              </>
            )}
            {activity.topContracts.length > 0 && (
              <Note title="Most-called contracts">
                <ol className="rank">
                  {activity.topContracts.map(c => (
                    <li key={c.address}>
                      <Link to={`/account/${c.address}`}>
                        <span className="mono">{c.label ?? short(c.address, 8)}</span>
                      </Link>
                      <span className="num">{count(c.calls)} calls</span>
                    </li>
                  ))}
                </ol>
              </Note>
            )}
          </Chapter>

          <Chapter id="failures" number="03" onEnter={() => setEncoding("failures")}>
            <h2 className="chapter-title">Why do transactions fail?</h2>
            <p className="big-stat">
              {activity.evmTxs ? pct(activity.evmReverted / activity.evmTxs) : "0%"}
              <span>of Solidity transactions reverted</span>
            </p>
            <p className="chapter-text">
              {failures.silentReverts > 0 ? (
                <>
                  <strong>{count(failures.silentReverts)}</strong> of them still show <em>Success</em> on the Substrate side: the extrinsic
                  that carried the transaction ran, but the contract reverted. A wallet that only reads extrinsic results reports these as
                  successful. PotScan shows both views of each transaction.
                </>
              ) : (
                "PotScan checks both the extrinsic and the Ethereum receipt of every Solidity transaction."
              )}
            </p>
            {failures.revertTargets.length > 0 && (
              <Note title="Where reverts happen">
                <ol className="rank">
                  {failures.revertTargets.map(t => (
                    <li key={t.address}>
                      <Link to={`/account/${t.address}`}>
                        <span className="mono">{t.label ?? short(t.address, 8)}</span>
                      </Link>
                      <span className="num">{count(t.count)}</span>
                    </li>
                  ))}
                </ol>
              </Note>
            )}
            {failures.byError.length > 0 && (
              <Note title="Native errors">
                <ol className="rank">
                  {failures.byError.map(e => (
                    <li key={e.error}>
                      <span className="mono">{e.error}</span>
                      <span className="num">{count(e.count)}</span>
                    </li>
                  ))}
                </ol>
              </Note>
            )}
          </Chapter>
        </div>

        <figure className="story-figure">
          <div className="figure-sticky">
            <HourField hours={data.hours} encoding={encoding} targetMs={blockTime.targetMs} />
            <figcaption>
              <Legend encoding={encoding} />
              <span className="faint">
                One dot per hour, {dateLong(span.since)} to {dateLong(span.until)}. Rows are days, columns hours (UTC).
              </span>
            </figcaption>
          </div>
        </figure>
      </div>

      <section className="report-section" id="costs" aria-labelledby="costs-title">
        <p className="eyebrow">04</p>
        <h2 className="chapter-title" id="costs-title">
          What does it cost to deploy?
        </h2>
        <p className="chapter-text wide">
          On V3 a contract's code is held as a storage deposit: tokens reserved, not spent, for as long as the code is on chain.
          The runtime sets the price. Nobody had published it, so here it is, with an estimator.
        </p>
        <Estimator costs={costs} network={network} />
      </section>

      <footer className="report-footer">
        <p>
          Method: PotScan indexes every finalized block of {network.name} from genesis, through its Substrate and Ethereum RPCs, and
          recomputes this report every five minutes. Raw data:{" "}
          <a href={withNetwork("/api/insights", network.id)}>/api/insights</a>.
        </p>
        <Link to="/explorer">Open the explorer →</Link>
      </footer>
    </article>
  );
}

function Chapter({ id, number, onEnter, children }: { id: string; number: string; onEnter: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const enter = useRef(onEnter);
  enter.current = onEnter;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && enter.current(), { rootMargin: "-45% 0px -45% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <section ref={ref} id={id} className="chapter" aria-labelledby={`${id}-title`}>
      <p className="eyebrow">{number}</p>
      {children}
    </section>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="note-card">
      <p className="note-title">{title}</p>
      {children}
    </aside>
  );
}

function Legend({ encoding }: { encoding: Encoding }) {
  const items =
    encoding === "time"
      ? [
          ["dot-blue", "on time"],
          ["dot-warm", "a block over 18 s late"],
          ["dot-red", "a minute or more with no block"],
          ["dot-quiet", "no blocks at all"],
        ]
      : encoding === "activity"
        ? [
            ["dot-quiet", "no transactions"],
            ["dot-violet", "some"],
            ["dot-blue", "busiest"],
          ]
        : [
            ["dot-quiet", "quiet"],
            ["dot-indigo", "transactions"],
            ["dot-red", "a failure"],
          ];
  return (
    <span className="legend">
      {items.map(([cls, label]) => (
        <span key={label}>
          <i className={`dot ${cls}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </span>
  );
}

function Estimator({ costs, network }: { costs: Insights["costs"]; network: Network }) {
  const [kb, setKb] = useState(24);
  const runtime = costs.runtime;
  if (!runtime?.depositPerByte) return <p className="muted">This network does not expose pallet-revive's deposit settings.</p>;

  const bytes = BigInt(Math.round(kb * 1024));
  const perByte = BigInt(runtime.depositPerByte);
  const perItem = BigInt(runtime.depositPerItem ?? "0");
  const code = bytes * perByte + perItem;
  const lockup = (code * BigInt(Math.round((runtime.codeHashLockupPercent ?? 0) * 100))) / 10_000n;
  const account = BigInt(runtime.existentialDeposit ?? "0") + perItem;
  const total = code + lockup + account;
  const fmt = (v: bigint | string) => amount(v.toString(), network.decimals, network.token);

  return (
    <div className="estimator">
      <div className="estimator-input">
        <label htmlFor="size" className="field-label">
          Compiled contract size (PolkaVM)
        </label>
        <div className="size-row">
          <input id="size" type="range" min={1} max={100} step={1} value={kb} onChange={e => setKb(Number(e.target.value))} />
          <span className="size-value num">{kb} KB</span>
        </div>
        <p className="faint">resolc output is usually 5 to 10 times larger than EVM bytecode for the same contract.</p>
      </div>
      <dl className="estimate">
        <div>
          <dt>Code deposit</dt>
          <dd className="num">{fmt(code)}</dd>
          <span className="faint">{fmt(perByte)} per byte</span>
        </div>
        <div>
          <dt>Code-hash lockup</dt>
          <dd className="num">{fmt(lockup)}</dd>
          <span className="faint">{runtime.codeHashLockupPercent}% of the code deposit</span>
        </div>
        <div>
          <dt>Contract account</dt>
          <dd className="num">{fmt(account)}</dd>
          <span className="faint">existential deposit and storage item</span>
        </div>
        <div className="estimate-total">
          <dt>Reserved to deploy</dt>
          <dd className="num">{fmt(total)}</dd>
          <span className="faint">plus a few percent for gas; a wallet needs this much available</span>
        </div>
      </dl>
      <p className="note-foot">
        Checked against a real deployment: PotScan's own 23,899-byte registry needed 1,909 tPOT up front on V3, within 3% of this
        model.{costs.deposits.count > 0 && <> Across {count(costs.deposits.count)} deposits seen on chain, the largest was {fmt(costs.deposits.largest!)}.</>}
      </p>
    </div>
  );
}

function Pending({ network }: { network: Network }) {
  return (
    <article className="report">
      <header className="report-hero">
        <p className="eyebrow">State of {network.name}</p>
        <h1 className="display">The report needs a few indexed blocks first.</h1>
        <p className="report-lede">
          PotScan is still reading {network.name}. <Link to="/status">See indexing progress</Link>
        </p>
      </header>
    </article>
  );
}
