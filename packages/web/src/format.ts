const UNITS: [number, string][] = [
  [24 * 60 * 60, "d"],
  [60 * 60, "h"],
  [60, "m"],
  [1, "s"],
];

/** "2h 14m", "45s": the two largest units of a duration. */
export function duration(ms: number): string {
  let seconds = Math.max(0, Math.round(ms / 1000));
  const parts: string[] = [];
  for (const [size, unit] of UNITS) {
    if (seconds >= size || (unit === "s" && parts.length === 0)) {
      parts.push(`${Math.floor(seconds / size)}${unit}`);
      seconds %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

export const ago = (at: number, now: number) => `${duration(now - at)} ago`;

export const percent = (share: number) => `${(share * 100).toFixed(share === 1 || share === 0 ? 0 : 1)}%`;

export const blockNumber = (n: number) => `#${n.toLocaleString("en-US")}`;

/** "0x3246…d846": enough of a hash to recognise it. */
export const short = (value: string, keep = 6) => (value.length > keep * 2 + 3 ? `${value.slice(0, keep)}…${value.slice(-4)}` : value);

/** An integer amount in the smallest unit, shown in whole tokens without losing precision. */
export function amount(raw: string | number | undefined, decimals: number, symbol: string): string {
  if (raw === undefined) return "—";
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 6);
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

/** Ethereum-side values in pallet-revive use 18 decimals whatever the native token's precision. */
export const EVM_DECIMALS = 18;

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
