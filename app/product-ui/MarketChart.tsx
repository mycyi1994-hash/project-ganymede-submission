"use client";

import { useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime, signedPercent, type HistoryPoint } from "@/lib/product-market";
import { useChartEvents } from "./MarketActivity";

const RANGES = [{ id: "24h", label: "24H", ms: 86_400_000 }, { id: "7d", label: "7D", ms: 7 * 86_400_000 }, { id: "all", label: "All", ms: Infinity }] as const;
type Range = typeof RANGES[number]["id"];

// The plot in the SVG's own units; the tooltip and markers sit over it in percentages of the same box.
const W = 760, H = 205, LEFT = 8, RIGHT = 668, TOP = 22, BOTTOM = 172;
const left = (x: number) => `${x / W * 100}%`;
const top = (y: number) => `${y / H * 100}%`;

export default function MarketChart({ points: all, loading }: { points: HistoryPoint[]; loading: boolean }) {
  const gradient = useId().replaceAll(":", "");
  const events = useChartEvents();
  const [range, setRange] = useState<Range>("all");
  const [index, setIndex] = useState<number | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
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
  const xAt = (time: number) => LEFT + ((time - timeMin) / Math.max(1, timeMax - timeMin)) * (RIGHT - LEFT);
  const x = (i: number) => xAt(Date.parse(points[i].at));
  const y = (v: number) => TOP + (high - v) / Math.max(.01, high - low) * (BOTTOM - TOP);
  const nearest = (time: number) => points.reduce((best, point, i) => Math.abs(Date.parse(point.at) - time) < Math.abs(Date.parse(points[best].at) - time) ? i : best, 0);
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const change = points.length > 1 ? Number((BigInt(points[points.length - 1].micros) - BigInt(points[0].micros)) * 1_000_000n / BigInt(points[0].micros)) / 10_000 : null;
  const tone = change === null || Math.round(change * 100) === 0 ? "" : change > 0 ? "gmd-positive" : "gmd-negative";
  const label = RANGES.find(item => item.id === range)!.label;
  // Arbitrage and large orders inside the range, on the line at the record nearest their time.
  const marks = points.length < 2 ? [] : events.filter(event => { const time = Date.parse(event.at); return time >= timeMin && time <= timeMax; })
    .map(event => ({ ...event, x: xAt(Date.parse(event.at)), y: y(vals[nearest(Date.parse(event.at))]) }));
  const mark = marks.find(item => item.key === marked) ?? null;
  const kinds = new Set(marks.map(item => item.kind));
  const tip = mark ? { x: mark.x, y: mark.y } : active && index !== null && index < points.length ? { x: x(index), y: y(vals[index]) } : null;
  return <div className="gmd-chart-block"><div className="gmd-chart-heading"><span aria-live="polite">{active ? `${shortTime(active.at)} · ${formatUsdMicros(active.micros, 4)}` : change === null ? "NAV per share" : <>{range === "all" ? "Since launch" : label} <b className={tone}>{signedPercent(change)}</b></>}</span><div className="gmd-segmented" role="group" aria-label="Chart range">{RANGES.map(item => <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => { setRange(item.id); setIndex(null); setMarked(null); }}>{item.label}</button>)}</div></div>
    {points.length < 2 ? <div className={`gmd-chart-empty${loading ? " is-loading" : ""}`} aria-busy={loading}><div className="gmd-chart-empty-grid" aria-hidden="true" />{loading ? <><i className="gmd-skeleton is-chart" aria-hidden="true" /><span className="gmd-sr-only">Loading NAV history</span></> : <p>Not enough history for this range yet.</p>}</div> : <>
      <div className="gmd-chart-plot" onPointerLeave={() => { setIndex(null); setMarked(null); }}>
        <svg className="gmd-chart" viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * W - LEFT) / (RIGHT - LEFT))); setIndex(nearest(timeMin + ratio * (timeMax - timeMin))); }} aria-label={`NAV per share from ${shortTime(points[0].at)} to ${shortTime(points[points.length - 1].at)}, between $${min.toFixed(4)} and $${max.toFixed(4)}.`}>
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0B625B" stopOpacity=".12" /><stop offset="100%" stopColor="#0B625B" stopOpacity="0" /></linearGradient></defs>
          {[0, .5, 1].map(f => <g key={f}><line x1={LEFT} x2={RIGHT} y1={TOP + f * (BOTTOM - TOP)} y2={TOP + f * (BOTTOM - TOP)} stroke="#e4eaed" /><text x="688" y={TOP + 5 + f * (BOTTOM - TOP)} fontSize="12" fill="#526570">${(high - f * (high - low)).toFixed(3)}</text></g>)}
          <path d={`${path} L${RIGHT},184 L${LEFT},184 Z`} fill={`url(#${gradient})`} /><path d={path} fill="none" stroke="#0B625B" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {points.length <= 60 && points.map((p, i) => <circle key={p.at} cx={x(i)} cy={y(vals[i])} r="4" fill="#0B625B" stroke="#fff" strokeWidth="2" />)}
          {tip && !mark && <g><line x1={tip.x} x2={tip.x} y1={TOP - 8} y2="184" stroke="#526570" strokeDasharray="3 3" /><circle cx={tip.x} cy={tip.y} r="5.5" fill="white" stroke="#0B625B" strokeWidth="2" /></g>}
        </svg>
        {marks.map(item => <span key={item.key} className={`gmd-chart-event is-${item.kind}${item.key === marked ? " is-active" : ""}`} style={{ left: left(item.x), top: top(item.y) }} aria-hidden="true" onPointerEnter={() => { setMarked(item.key); setIndex(nearest(Date.parse(item.at))); }} onPointerLeave={() => setMarked(null)}><i /></span>)}
        {tip && <div className={`gmd-chart-tip${mark ? " is-event" : ""}${tip.x > (LEFT + RIGHT) * .62 ? " is-left" : ""}`} style={{ left: left(tip.x), top: top(tip.y) }} aria-hidden="true">
          {mark ? <><b>{mark.amount}</b><span>{mark.title}</span><small>{mark.detail}</small><small>{shortTime(mark.at)}</small></> : active ? <><b>{formatUsdMicros(active.micros, 4)}</b><small>{shortTime(active.at)}</small></> : null}
        </div>}
      </div>
      <label className="gmd-history-scrubber gmd-sr-only"><span>Inspect the NAV history</span><input type="range" min="0" max={points.length - 1} value={index === null ? points.length - 1 : Math.min(index, points.length - 1)} onFocus={() => setIndex(points.length - 1)} onBlur={() => setIndex(null)} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={active ? `${shortTime(active.at)}, ${formatUsdMicros(active.micros, 4)}` : "Latest value"} /></label>
      <div className="gmd-chart-axis"><span>{shortTime(points[0].at)}</span><span>{shortTime(points[points.length - 1].at)}</span></div>
      {kinds.size > 0 && <p className="gmd-chart-legend">{kinds.has("arbitrage") && <span><i className="is-arbitrage" aria-hidden="true" />Keeper arbitrage</span>}{kinds.has("order") && <span><i className="is-order" aria-hidden="true" />Orders of $1,000 or more</span>}</p>}
    </>}
  </div>;
}
