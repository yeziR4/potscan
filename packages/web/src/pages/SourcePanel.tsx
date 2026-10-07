import { useState, type ChangeEvent, type FormEvent } from "react";
import { selectorOf } from "../selector.ts";
import { postJson, withNetwork, type AbiEntry, type Network, type OptimizerMode, type Verified, type VerifyReply } from "../api.ts";
import { dateTime } from "../format.ts";
import { Copy, Field, Fields, Hash } from "../ui.tsx";

const MODES: { value: OptimizerMode | "off"; label: string }[] = [
  { value: "z", label: "z: smallest code (resolc default)" },
  { value: "s", label: "s: small code" },
  { value: "3", label: "3: fastest code" },
  { value: "2", label: "2" },
  { value: "1", label: "1" },
  { value: "0", label: "0: no optimisation" },
  { value: "off", label: "Optimizer disabled" },
];

export function SourcePanel({ network, address, verified, registry, onVerified }: {
  network: Network;
  address: string;
  verified?: Verified;
  registry?: string;
  onVerified: () => void;
}) {
  return verified ? <VerifiedSource verified={verified} registry={registry} /> : <VerifyForm network={network} address={address} onVerified={onVerified} />;
}

function VerifiedSource({ verified, registry }: { verified: Verified; registry?: string }) {
  const files = Object.keys(verified.sources);
  const [file, setFile] = useState(verified.file in verified.sources ? verified.file : files[0]!);
  const functions = verified.abi.filter((e): e is AbiEntry & { name: string } => e.type === "function" && Boolean(e.name));

  return (
    <section className="panel" aria-labelledby="source">
      <div className="panel-head">
        <h2 id="source">Source</h2>
        <span className="state up">Verified: bytecode match</span>
      </div>
      <Fields>
        <Field name="Contract">
          <span className="mono">
            {verified.contractName} in {verified.file}
          </span>
        </Field>
        <Field name="Compiler">{verified.compiler}</Field>
        <Field name="Optimizer">{verified.optimizer.enabled ? `mode ${verified.optimizer.mode}` : "disabled"}</Field>
        <Field name="Code hash" hint="keccak-256 of the deployed code">
          <Hash value={verified.codeHash} full />
        </Field>
        <Field name="On-chain attestation">
          {verified.attestation ? (
            <span>
              Recorded in <Hash value={verified.attestation.registry} to={`/account/${verified.attestation.registry}`} /> by transaction{" "}
              <Hash value={verified.attestation.tx} to={`/tx/${verified.attestation.tx}`} />
            </span>
          ) : (
            <span className="faint">{registry ? "Not recorded on chain." : "No VerificationRegistry on this network yet; verified in PotScan only."}</span>
          )}
        </Field>
        <Field name="Verified">
          <span className="num">{dateTime(verified.verifiedAt)}</span>
        </Field>
      </Fields>
      <p className="note">
        <strong>What a match means:</strong> this source, compiled with these settings, produces exactly the code deployed
        here. PolkaVM code carries no fingerprint of the source text, so comments and formatting are not compared. Every
        contract with the same code hash shares this verification.
      </p>

      {files.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Source files">
          {files.map(f => (
            <button key={f} type="button" role="tab" aria-selected={f === file} className="tab mono" onClick={() => setFile(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="code-head">
        <span className="mono faint">{file}</span>
        <Copy value={verified.sources[file]!} label={`${file} source`} />
      </div>
      <pre className="code">
        {verified.sources[file]!.split("\n").map((line, i) => (
          <span className="code-line" key={i}>
            <span className="code-number" aria-hidden="true">
              {i + 1}
            </span>
            {line || " "}
          </span>
        ))}
      </pre>

      {functions.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Function</th>
              <th>Selector</th>
              <th className="right">Kind</th>
            </tr>
          </thead>
          <tbody>
            {functions.map(f => {
              const signature = `${f.name}(${(f.inputs ?? []).map(i => i.type).join(",")})`;
              return (
                <tr key={signature}>
                  <td className="mono">{signature}</td>
                  <td className="mono">{selectorOf(signature)}</td>
                  <td className="right">
                    <span className="tag">{f.stateMutability === "view" || f.stateMutability === "pure" ? "read" : "write"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function VerifyForm({ network, address, onVerified }: { network: Network; address: string; onVerified: () => void }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [contractName, setContractName] = useState("");
  const [mode, setMode] = useState<OptimizerMode | "off">("z");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<VerifyReply>();
  const [error, setError] = useState<string>();
  const [pasteName, setPasteName] = useState("");
  const [pasteContent, setPasteContent] = useState("");

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    const read = await Promise.all(picked.map(async f => [f.name, await f.text()] as const));
    setFiles(current => ({ ...current, ...Object.fromEntries(read) }));
    if (!contractName && read[0]) setContractName(guessContract(read[0][1]) ?? "");
    event.target.value = "";
  };

  const addPasted = () => {
    const name = pasteName.trim() || "Contract.sol";
    setFiles(current => ({ ...current, [name.endsWith(".sol") ? name : `${name}.sol`]: pasteContent }));
    if (!contractName) setContractName(guessContract(pasteContent) ?? "");
    setPasteName("");
    setPasteContent("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setReply(undefined);
    setError(undefined);
    try {
      const result = await postJson<VerifyReply>(withNetwork("/api/verify", network.id), {
        address,
        sources: files,
        contractName,
        optimizer: mode === "off" ? { enabled: false, mode: "z" } : { enabled: true, mode },
      });
      setReply(result);
      if (result.match) onVerified();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const names = Object.keys(files);
  return (
    <section className="panel" aria-labelledby="verify">
      <div className="panel-head">
        <h2 id="verify">Verify source</h2>
        <span className="meta">Solidity compiled to PolkaVM with resolc</span>
      </div>
      <form className="verify" onSubmit={submit}>
        <p className="muted m0">
          Add every file the contract needs, including imports: PotScan compiles only what you send. Use the settings you
          deployed with.
        </p>

        <div className="verify-files">
          <label className="button button-quiet file-button">
            Add .sol files
            <input type="file" accept=".sol" multiple onChange={addFiles} className="visually-hidden" />
          </label>
          {names.length === 0 ? (
            <span className="faint">No files yet.</span>
          ) : (
            <ul className="file-list">
              {names.map(n => (
                <li key={n}>
                  <span className="mono">{n}</span>
                  <span className="faint num">{files[n]!.split("\n").length} lines</span>
                  <button
                    type="button"
                    className="button button-quiet copy"
                    onClick={() => setFiles(({ [n]: _, ...rest }) => rest)}
                    aria-label={`Remove ${n}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="paste">
          <summary>Or paste a file</summary>
          <label className="field-label" htmlFor="paste-name">
            File name
          </label>
          <input id="paste-name" className="input" value={pasteName} onChange={e => setPasteName(e.target.value)} placeholder="Token.sol" />
          <label className="field-label" htmlFor="paste-content">
            Source
          </label>
          <textarea id="paste-content" className="input textarea" value={pasteContent} onChange={e => setPasteContent(e.target.value)} spellCheck={false} />
          <button type="button" className="button button-quiet" onClick={addPasted} disabled={!pasteContent.trim()}>
            Add file
          </button>
        </details>

        <div className="verify-settings">
          <div>
            <label className="field-label" htmlFor="contract-name">
              Contract name
            </label>
            <input id="contract-name" className="input" value={contractName} onChange={e => setContractName(e.target.value)} placeholder="Token" />
          </div>
          <div>
            <label className="field-label" htmlFor="optimizer">
              Optimizer
            </label>
            <select id="optimizer" className="select" value={mode} onChange={e => setMode(e.target.value as OptimizerMode | "off")}>
              {MODES.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <button className="button" type="submit" disabled={busy || names.length === 0 || !contractName}>
            {busy ? "Compiling…" : "Verify"}
          </button>
          {busy && <span className="faint busy-note">Compiling takes a few seconds.</span>}
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}
      {reply && !reply.match && (
        <div className="verify-result">
          <p className="m0">
            <strong className="down-text">No match.</strong> {reply.reason.includes("\n") ? null : reply.reason}
          </p>
          {reply.reason.includes("\n") && <pre className="code compiler-output">{reply.reason}</pre>}
          {reply.compiledHash && (
            <Fields>
              <Field name="Compiled code hash">
                <Hash value={reply.compiledHash} full />
              </Field>
              <Field name="Deployed code hash">
                <Hash value={reply.deployedHash!} full />
              </Field>
              <Field name="Compiler">{reply.compiler}</Field>
            </Fields>
          )}
        </div>
      )}
      {reply?.match && reply.attestationError && (
        <p className="error-text">Verified, but recording it on chain failed: {reply.attestationError}</p>
      )}
    </section>
  );
}

const guessContract = (source: string) => source.match(/^\s*(?:abstract\s+)?contract\s+([A-Za-z_$][\w$]*)/m)?.[1];
