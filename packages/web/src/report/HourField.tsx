import { useEffect, useRef } from "react";
import type { HourBucket } from "../api.ts";

export type Encoding = "time" | "activity" | "failures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A minute with no block. */
export const OUTAGE_MS = 60_000;

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One dot per hour: rows are days, columns the 24 hours, so a stall or a burst of activity shows where it happened. */
export function HourField({ hours, encoding, targetMs }: { hours: HourBucket[]; encoding: Encoding; targetMs: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef<{ colors: Rgb[]; radii: number[] }>(undefined);

  useEffect(() => {
    const el = canvas.current;
    if (!el || hours.length === 0) return;
    const css = getComputedStyle(document.documentElement);
    const palette = {
      empty: hex(css.getPropertyValue("--field-empty").trim() || "#23232d"),
      violet: hex("#6724de"),
      indigo: hex("#4c34f1"),
      blue: hex("#2d68f3"),
      warm: hex("#f2994a"),
      red: hex(css.getPropertyValue("--down").trim() || "#f2555a"),
      quiet: hex(css.getPropertyValue("--field-quiet").trim() || "#3a3a48"),
    };

    const firstDay = Math.floor(hours[0]!.at / DAY) * DAY;
    const lastDay = Math.floor(hours.at(-1)!.at / DAY) * DAY;
    const days = Math.round((lastDay - firstDay) / DAY) + 1;
    const byHour = new Map(hours.map(h => [h.at, h]));
    const maxTx = Math.max(1, ...hours.map(h => h.txs + h.evm));

    const target: { colors: Rgb[]; radii: number[] } = { colors: [], radii: [] };
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < 24; h++) {
        const bucket = byHour.get(firstDay + d * DAY + h * HOUR);
        const at = firstDay + d * DAY + h * HOUR;
        if (at < hours[0]!.at || at > hours.at(-1)!.at) {
          // Outside the chain's lifetime so far: present only to keep the grid square.
          target.colors.push(palette.empty);
          target.radii.push(0.3);
          continue;
        }
        if (!bucket || bucket.blocks === 0) {
          // An hour the chain produced nothing: the outage itself.
          target.colors.push(palette.quiet);
          target.radii.push(0.4);
          continue;
        }
        if (encoding === "time") {
          // Graded by the worst gap in the hour: a minute without blocks is an outage, three missed slots a hiccup.
          const outage = bucket.maxBlockMs >= OUTAGE_MS;
          const late = bucket.maxBlockMs > targetMs * 3;
          target.colors.push(outage ? palette.red : late ? palette.warm : palette.blue);
          target.radii.push(outage ? 1 : late ? 0.8 : 0.7);
        } else if (encoding === "activity") {
          const n = bucket.txs + bucket.evm;
          const t = Math.sqrt(n / maxTx);
          target.colors.push(n === 0 ? palette.quiet : mix(palette.violet, palette.blue, t));
          target.radii.push(n === 0 ? 0.45 : 0.6 + 0.4 * t);
        } else {
          target.colors.push(bucket.failed > 0 ? palette.red : bucket.txs + bucket.evm > 0 ? palette.indigo : palette.quiet);
          target.radii.push(bucket.failed > 0 ? 1 : bucket.txs + bucket.evm > 0 ? 0.6 : 0.45);
        }
      }
    }

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = shown.current && shown.current.colors.length === target.colors.length ? shown.current : target;
    const start = performance.now();
    const duration = reduce ? 0 : 700;
    let frame = 0;

    const draw = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const width = el.clientWidth;
      const cell = width / 24;
      const height = cell * days;
      const dpr = devicePixelRatio || 1;
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
        el.style.height = `${height}px`;
      }
      const ctx = el.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const current: { colors: Rgb[]; radii: number[] } = { colors: [], radii: [] };
      target.colors.forEach((c, i) => {
        const color = mix(from.colors[i] ?? c, c, ease);
        const r = (from.radii[i] ?? target.radii[i]!) + (target.radii[i]! - (from.radii[i] ?? target.radii[i]!)) * ease;
        current.colors.push(color);
        current.radii.push(r);
        ctx.fillStyle = `rgb(${color.map(Math.round).join(",")})`;
        ctx.beginPath();
        ctx.arc((i % 24) * cell + cell / 2, Math.floor(i / 24) * cell + cell / 2, (cell / 2) * 0.82 * r, 0, Math.PI * 2);
        ctx.fill();
      });
      shown.current = current;
      if (t < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const onResize = () => requestAnimationFrame(now => draw(now + duration));
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", onResize);
    };
  }, [hours, encoding, targetMs]);

  const label = `${hours.length} hours of Portaldot V3, one dot per hour, coloured by ${encoding === "time" ? "block time" : encoding === "activity" ? "transactions" : "failed transactions"}`;
  return <canvas ref={canvas} className="hour-field" role="img" aria-label={label} />;
}
