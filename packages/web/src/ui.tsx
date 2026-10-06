import { useState, type ReactNode } from "react";
import { Link } from "./router.tsx";
import { short } from "./format.ts";

export function Copy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="button button-quiet copy" onClick={copy} aria-label={`Copy ${label}`}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A hash or address: shortened and linked in tables, full where there is room. */
export function Hash({ value, to, full }: { value: string; to?: string; full?: boolean }) {
  const text = <span className="mono" title={value}>{full ? value : short(value)}</span>;
  return to ? <Link to={to}>{text}</Link> : text;
}

export function Outcome({ success, error }: { success: boolean; error?: string }) {
  return <span className={`state ${success ? "up" : "down"}`}>{success ? "Success" : `Failed${error ? `: ${error}` : ""}`}</span>;
}

export function Engine({ vm }: { vm: string }) {
  return <span className="tag">{vm === "evm" ? "Solidity · Revive" : "ink! · WASM"}</span>;
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="fields">{children}</dl>;
}

export function Field({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <dt>
        {name}
        {hint && <span className="stat-name">{hint}</span>}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function PageHead({ title, lede, aside }: { title: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {aside}
    </div>
  );
}

/** JSON arguments or event data, laid out as nested name/value pairs. */
export function Data({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  if (typeof value !== "object") return <span className="mono data-value">{String(value)}</span>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  if (entries.length === 0) return <span className="faint">{Array.isArray(value) ? "[]" : "{}"}</span>;
  return (
    <table className="data">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th className="mono">{k}</th>
            <td>
              <Data value={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
