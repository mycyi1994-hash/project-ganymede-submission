"use client";

import { useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime, signedPercent, type HistoryPoint } from "@/lib/product-market";

const RANGES = [{ id: "24h", label: "24H", ms: 86_400_000 }, { id: "7d", label: "7D", ms: 7 * 86_400_000 }, { id: "all", label: "All", ms: Infinity }] as const;
type Range = typeof RANGES[number]["id"];

export default function MarketChart({ points: all, loading }: { points: HistoryPoint[]; loading: boolean }) {
  const gradient = useId().replaceAll(":", "");
  const [range, setRange] = useState<Range>("all");
  const [index, setIndex] = useState<number | null>(null);
  const span = RANGES.find(item => item.id === range)!.ms;
  const last = all.length ? Date.parse(all[all.length - 1].at) : 0;
  const points = span === Infinity ? all : all.filter(point => last - Date.parse(point.at) <= span);
  const active = index === null ? null : points[Math.min(index, points.length - 1)];
  const vals = points.map(p => Number(BigInt(p.micros)) / 1_000_000);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const padding = Math.max((max - min) * .3, .01);
  const low = Math.max(0, min - padding);
  const high = max + padding;
  const timeMin = points.length ? Date.parse(points[0].at) : 0;
  const timeMax = points.length ? Date.parse(points[points.length - 1].at) : 1;
  const x = (i: number) => 8 + ((Date.parse(points[i].at) - timeMin) / Math.max(1, timeMax - timeMin)) * 660;
  const y = (v: number) => 22 + (high - v) / Math.max(.01, high - low) * 150;
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const change = points.length > 1 ? Number((BigInt(points[points.length - 1].micros) - BigInt(points[0].micros)) * 1_000_000n / BigInt(points[0].micros)) / 10_000 : null;
  const tone = change === null || Math.round(change * 100) === 0 ? "" : change > 0 ? "gmd-positive" : "gmd-negative";
  const label = RANGES.find(item => item.id === range)!.label;
  return <div className="gmd-chart-block"><div className="gmd-chart-heading"><span aria-live="polite">{active ? `${shortTime(active.at)} · ${formatUsdMicros(active.micros, 4)}` : change === null ? "NAV per share" : <>{range === "all" ? "Since launch" : label} <b className={tone}>{signedPercent(change)}</b></>}</span><div className="gmd-segmented" role="group" aria-label="Chart range">{RANGES.map(item => <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => { setRange(item.id); setIndex(null); }}>{item.label}</button>)}</div></div>
    {points.length < 2 ? <div className="gmd-chart-empty"><div className="gmd-chart-empty-grid" aria-hidden="true" /><p>{loading ? "Loading NAV history…" : "Not enough history for this range yet."}</p></div> : <>
      <svg className="gmd-chart" viewBox="0 0 760 205" role="img" onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width * 760 / 668)); const at = timeMin + ratio * (timeMax - timeMin); setIndex(points.reduce((best, point, i) => Math.abs(Date.parse(point.at) - at) < Math.abs(Date.parse(points[best].at) - at) ? i : best, 0)); }} onPointerLeave={() => setIndex(null)} aria-label={`NAV per share from ${shortTime(points[0].at)} to ${shortTime(points[points.length - 1].at)}, between $${min.toFixed(4)} and $${max.toFixed(4)}.`}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0B625B" stopOpacity=".12" /><stop offset="100%" stopColor="#0B625B" stopOpacity="0" /></linearGradient></defs>
        {[0, .5, 1].map(f => <g key={f}><line x1="8" x2="668" y1={22 + f * 150} y2={22 + f * 150} stroke="#dce4e7" strokeDasharray="3 5" /><text x="688" y={27 + f * 150} fontSize="12" fill="#526570">${(high - f * (high - low)).toFixed(3)}</text></g>)}
        <path d={`${path} L668,184 L8,184 Z`} fill={`url(#${gradient})`} /><path d={path} fill="none" stroke="#0B625B" strokeWidth="2.5" strokeLinejoin="round" />
        {points.length <= 60 && points.map((p, i) => <circle key={p.at} cx={x(i)} cy={y(vals[i])} r="3.5" fill="#0B625B"><title>{shortTime(p.at)}: {formatUsdMicros(p.micros, 4)}</title></circle>)}
        {active && index !== null && index < points.length && <g><line x1={x(index)} x2={x(index)} y1="14" y2="184" stroke="#526570" strokeDasharray="3 3" /><circle cx={x(index)} cy={y(vals[index])} r="5.5" fill="white" stroke="#0B625B" strokeWidth="2" /></g>}
      </svg>
      <label className="gmd-history-scrubber gmd-sr-only"><span>Inspect the NAV history</span><input type="range" min="0" max={points.length - 1} value={index === null ? points.length - 1 : Math.min(index, points.length - 1)} onFocus={() => setIndex(points.length - 1)} onBlur={() => setIndex(null)} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={active ? `${shortTime(active.at)}, ${formatUsdMicros(active.micros, 4)}` : "Latest value"} /></label>
      <div className="gmd-chart-axis"><span>{shortTime(points[0].at)}</span><span>{shortTime(points[points.length - 1].at)}</span></div>
    </>}
  </div>;
}
