"use client";

import { useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime, type HistoryPoint } from "@/lib/product-market";

export default function MarketChart({ points, total = points.length, loading }: { points: HistoryPoint[]; total?: number; loading: boolean }) {
  const gradient = useId().replaceAll(":", "");
  const [view, setView] = useState<"chart" | "records">("chart");
  const [index, setIndex] = useState<number | null>(null);
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
  return <div className="gmd-chart-block"><div className="gmd-chart-heading"><span>{active ? `${shortTime(active.at)} · ${formatUsdMicros(active.micros, 4)}` : "NAV history"}</span><div className="gmd-segmented" aria-label="History display"><button aria-pressed={view === "chart"} onClick={() => setView("chart")}>Chart</button><button aria-pressed={view === "records"} onClick={() => setView("records")}>Records</button></div></div>
    {view === "records" ? <div className="gmd-records-scroll"><table className="gmd-table"><caption className="gmd-sr-only">NAV records on X Layer</caption><thead><tr><th>Time</th><th>NAV / USD</th></tr></thead><tbody>{[...points].reverse().map(point => <tr key={point.at}><td>{shortTime(point.at)}</td><td>{formatUsdMicros(point.micros, 4)}</td></tr>)}</tbody></table>{!points.length && <p className="gmd-muted">{loading ? "Loading publication history…" : "No confirmed history is available."}</p>}</div> : points.length < 2 ? <div className="gmd-chart-empty"><div className="gmd-chart-empty-grid" aria-hidden="true" /><p>{loading ? "Loading recorded values…" : points.length === 1 ? "One published record. More history will appear as values are published." : "Publication history is not available."}</p></div> : <>
      <svg className="gmd-chart" viewBox="0 0 760 205" role="img" onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width * 760 / 668)); const at = timeMin + ratio * (timeMax - timeMin); setIndex(points.reduce((best, point, i) => Math.abs(Date.parse(point.at) - at) < Math.abs(Date.parse(points[best].at) - at) ? i : best, 0)); }} onPointerLeave={() => setIndex(null)} aria-label={`Published NAV from ${shortTime(points[0].at)} to ${shortTime(points[points.length - 1].at)}. Range $${min.toFixed(4)} to $${max.toFixed(4)}. Open Records for exact values.`}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0B625B" stopOpacity=".12" /><stop offset="100%" stopColor="#0B625B" stopOpacity="0" /></linearGradient></defs>
        {[0, .5, 1].map(f => <g key={f}><line x1="8" x2="668" y1={22 + f * 150} y2={22 + f * 150} stroke="#dce4e7" strokeDasharray="3 5" /><text x="688" y={27 + f * 150} fontSize="12" fill="#526570">${(high - f * (high - low)).toFixed(3)}</text></g>)}
        <path d={`${path} L668,184 L8,184 Z`} fill={`url(#${gradient})`} /><path d={path} fill="none" stroke="#0B625B" strokeWidth="2.5" strokeLinejoin="round" />
        {points.length <= 60 && points.map((p, i) => <circle key={p.at} cx={x(i)} cy={y(vals[i])} r="3.5" fill="#0B625B"><title>{shortTime(p.at)}: {formatUsdMicros(p.micros, 4)}</title></circle>)}
        {active && index !== null && index < points.length && <g><line x1={x(index)} x2={x(index)} y1="14" y2="184" stroke="#526570" strokeDasharray="3 3" /><circle cx={x(index)} cy={y(vals[index])} r="5.5" fill="white" stroke="#0B625B" strokeWidth="2" /></g>}
      </svg>
      <label className="gmd-history-scrubber gmd-sr-only"><span>Inspect a published record</span><input type="range" min="0" max={points.length - 1} value={index === null ? points.length - 1 : Math.min(index, points.length - 1)} onFocus={() => setIndex(points.length - 1)} onBlur={() => setIndex(null)} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={active ? `${shortTime(active.at)}, ${formatUsdMicros(active.micros, 4)}` : "Latest record"} /></label>
      <div className="gmd-chart-axis"><span>{shortTime(points[0].at)}</span><span>{shortTime(points[points.length - 1].at)}</span></div>
    </>}
    <p className="gmd-chart-note">{points.length > 1 ? `${total} NAV records on X Layer since ${shortTime(points[0].at)}${total > points.length ? ` (${points.length} shown)` : ""}` : "NAV per share"} · Prices by OKX OnchainOS</p>
  </div>;
}
