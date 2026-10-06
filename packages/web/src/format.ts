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
