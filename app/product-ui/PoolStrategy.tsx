"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { poolValueMicros, type PoolLiquidity } from "@/lib/xstocks/liquidity";
import { tickToUsd, v4ValueMicros, type V4Deployment, type V4Pool } from "@/lib/xstocks/v4-liquidity";
import { previewWeights, type PresetShape, type RangePool } from "@/lib/xstocks/range-liquidity";
import {
  BID_ASK_RANGE, DRAWN_LEVELS, DRAWN_MAX, DRAWN_STEP, LP_STRATEGIES, binTicksFor, constantProductRange, drawingFrom, fitDrawing, ownAboveShare, ownBins, ownSides, strategyById, strategyShape, strategyYear,
  type OwnRange, type PriceRange, type RangeSides, type StrategyId,
} from "@/lib/xstocks/lp-strategy";
import { Icon } from "./Icons";
import { useAsk } from "./AskUstx";
import { ChartHead, useWidth } from "./ChartParts";

// Liquidity strategies on Pools, laid out as Meteora lays out its shapes: Spot, Curve and Spot +
// Curve split a deposit between the two pooled pools; Bid-Ask and Custom open a position of one's
// own in the range pool, with the shape, reach, bins and sides one sets (lib/xstocks/lp-strategy.ts):
// as on Meteora's DLMM Pro, the shape is a grid of blocks to draw, presets included, and a setup is
// kept by name in this browser.
// One chart draws where the deposit's dollars would sit by price, or, switched, both pooled pools'
// liquidity as read on X Layer; Ask USTX explains the chosen strategy, or one's own settings, with
// the figures on screen.

// Ask USTX takes questions of up to 1,000 characters (ASSISTANT_LIMITS.messageChars in lib/assistant/ask.ts).
const ASK_LIMIT = 1_000;
const money = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signed = (ratio: number) => `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(Math.round(ratio * 1000) / 10)}%`;

export type StrategyChoice = { id: StrategyId; own: OwnRange };
export const DEFAULT_CHOICE: StrategyChoice = { id: "spot", own: { shape: "curve", rangePercent: 2, bins: 10, sides: "both" } };
export const strategyPercent = (choice: StrategyChoice) => strategyById(choice.id).v4Percent;
/** The position a range strategy opens, or null for a pooled one. */
export const ownRangeOf = (choice: StrategyChoice): OwnRange | null => choice.id === "bid-ask" ? BID_ASK_RANGE : choice.id === "custom" ? choice.own : null;
export const SHAPE_LABELS = { spot: "Spot", curve: "Curve", "bid-ask": "Bid-Ask", custom: "Custom", drawn: "Drawn" } as const;
const PRESET_SHAPES: PresetShape[] = ["spot", "curve", "bid-ask"];
const SIDE_LABELS = { both: "Both sides", below: "Buy below", above: "Sell above" } as const;

/** Each pool's measured result for its providers per $10,000 a year, as GET /api/v1/ustx/pools serves it. */
export function useMeasuredResults() {
  const [value, setValue] = useState<{ constantProduct: bigint | null; v4: bigint | null; from: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/ustx/pools", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((body: { lpResults?: { from?: string } | null; pools?: Array<{ id?: string; lpResult?: { per10kYearMicros?: string | null } | null }> } | null) => {
      if (cancelled || !body) return;
      const rate = (id: string) => { const raw = body.pools?.find(pool => pool.id === id)?.lpResult?.per10kYearMicros; return typeof raw === "string" ? BigInt(raw) : null; };
      setValue({ constantProduct: rate("ustx-dusd"), v4: rate("ustx-dusd-v4"), from: body.lpResults?.from ?? null });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return value;
}

/** A small picture of each shape, as on Meteora's strategy buttons; a drawn one's own bars for Custom. */
function ShapeIcon({ id, own }: { id: StrategyId; own: OwnRange }) {
  const shape = id === "spot" ? "flat" : id === "curve" ? "peak" : id === "spot-curve" ? "mixed" : id === "bid-ask" ? "edges" : own.shape === "spot" ? "flat" : own.shape === "curve" ? "peak" : own.shape === "drawn" ? "drawn" : "edges";
  const drawn = shape === "drawn" ? fitDrawing(own.drawn, own.bins) : [];
  const sample = (from: number, to: number, index: number) => drawn[Math.round(from + (to - from) * index / 3)] / DRAWN_MAX;
  const bars = Array.from({ length: 9 }, (_, index) => {
    const distance = Math.abs(index - 4);
    if (shape === "drawn") return index === 4 ? 0.08 : Math.max(0.06, index < 4 ? sample(0, own.bins - 1, index) : sample(own.bins, 2 * own.bins - 1, index - 5));
    if (shape === "flat") return 0.5;
    if (shape === "peak") return 0.12 + Math.max(0, 1 - distance / 4.5) * 0.88;
    if (shape === "edges") return distance === 0 ? 0.08 : 0.15 + distance / 4 * 0.85;
    return 0.25 + Math.max(0, 1 - distance / 2.2) * 0.7;
  });
  return <svg className="gmd-strategy-icon" viewBox="0 0 54 24" aria-hidden="true">{bars.map((height, index) => <rect key={index} x={index * 6} y={24 - height * 22} width={4} height={height * 22} rx={1} className={index < 4 ? "is-dollars" : index > 4 ? "is-shares" : "is-mid"} />)}</svg>;
}

/** A setup kept by name in this browser: the shape, drawn or a preset, its reach, bins and sides. */
type SavedSetup = { name: string; shape: OwnRange["shape"]; rangePercent: number; bins: number; sides: RangeSides; drawn?: number[] };
const SAVED_SHAPES = "gmd-range-shapes";
const SAVED_LIMIT = 8;
const BIN_CHOICES = [5, 10, 15, 20];
const REACH_PRESETS = [1, 2, 5, 10];
const HISTORY_LIMIT = 60;

/** Setups kept in this browser; nothing leaves it, and storage that refuses is no setups. Entries saved before a setup kept its reach and sides open at ±2% on both sides. */
function readSavedSetups(): SavedSetup[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(SAVED_SHAPES) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.flatMap((item): SavedSetup[] => {
      if (!item || typeof item.name !== "string" || !BIN_CHOICES.includes(item.bins)) return [];
      const shape = item.shape ?? "drawn";
      if (shape !== "drawn" && !PRESET_SHAPES.includes(shape)) return [];
      if (shape === "drawn" && !(Array.isArray(item.drawn) && item.drawn.length === 2 * item.bins)) return [];
      const rangePercent = typeof item.rangePercent === "number" && item.rangePercent >= 0.5 && item.rangePercent <= 10 ? item.rangePercent : 2;
      const sides: RangeSides = item.sides === "below" || item.sides === "above" ? item.sides : "both";
      return [{ name: item.name.slice(0, 24), shape, rangePercent, bins: item.bins, sides, ...(shape === "drawn" ? { drawn: fitDrawing(item.drawn, item.bins) } : {}) }];
    }).slice(0, SAVED_LIMIT);
  } catch {
    return [];
  }
}
function writeSavedSetups(list: SavedSetup[]) {
  try { window.localStorage.setItem(SAVED_SHAPES, JSON.stringify(list.slice(0, SAVED_LIMIT))); } catch { /* kept for this visit only */ }
}

/** Each bin's prices in dollars per USTX, lowest first, as the hook places them around `priceUsd`, skipping the 0.1% the price is in. */
function binPrices(own: OwnRange, priceUsd: number) {
  const step = Math.pow(1.0001, binTicksFor(own.rangePercent, own.bins)), gap = Math.pow(1.0001, 10);
  return Array.from({ length: 2 * own.bins }, (_, index) => {
    if (index < own.bins) {
      const upper = priceUsd / Math.pow(step, own.bins - 1 - index);
      return { fromUsd: upper / step, toUsd: upper };
    }
    const lower = priceUsd * gap * Math.pow(step, index - own.bins);
    return { fromUsd: lower, toUsd: lower * step };
  });
}

/** The columns a setup shows: its drawing, or the preset it follows, in whole blocks. */
const columnsOf = (own: OwnRange) => own.shape === "drawn" ? fitDrawing(own.drawn, own.bins) : drawingFrom(own.shape, own.bins);

/**
 * The shape as on Meteora's DLMM Pro: a column of blocks for every bin, demo dollars below the price
 * and USTX above it. Press a block to fill its column up to it (press the top block again to take
 * it off), drag across the columns to paint, drag under the grid to empty them, or use the arrow keys
 * on a column. A column's height is the dollars its bin holds; a preset becomes a drawing once a
 * block changes.
 */
function BlockGrid({ own, priceUsd, onStroke, onPaint }: {
  own: OwnRange; priceUsd: number | null;
  /** Called once as a change begins, so it is one step to undo. */
  onStroke: () => void;
  onPaint: (columns: number[]) => void;
}) {
  const id = useId();
  const columns = columnsOf(own);
  const [plotRef, W] = useWidth(520);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const keys = useRef<(SVGRectElement | null)[]>([]);
  const latest = useRef(columns);
  useLayoutEffect(() => { latest.current = columns; });
  const stroke = useRef<{ index: number; level: number } | null>(null);
  const [focus, setFocus] = useState(own.bins - 1);
  const count = columns.length, half = own.bins, gap = 12;
  const pitch = (W - gap) / count;
  const rowPitch = Math.max(9, Math.min(15, pitch * 0.85));
  const top = 34, gridHeight = DRAWN_LEVELS * rowPitch, bottom = top + gridHeight, H = bottom + 26;
  const cellWidth = Math.max(2, pitch - (pitch > 9 ? 2.5 : 1.5)), cellHeight = rowPitch - 2.5;
  const left = (index: number) => index * pitch + (index >= half ? gap : 0);
  const priceX = half * pitch + gap / 2;
  const usable = (index: number) => own.sides === "both" || (own.sides === "below" ? index < half : index >= half);
  const levelOf = (value: number) => Math.round(value / DRAWN_STEP);
  const apply = (changes: { index: number; level: number }[]) => {
    const next = [...latest.current];
    for (const { index, level } of changes) if (usable(index)) next[index] = Math.max(0, Math.min(DRAWN_LEVELS, Math.round(level))) * DRAWN_STEP;
    latest.current = next;
    onPaint(next);
  };
  const at = (event: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    const x = (event.clientX - box.left) / box.width * W, y = (event.clientY - box.top) / box.height * H;
    const index = Math.max(0, Math.min(count - 1, x < priceX ? Math.floor(x / pitch) : Math.floor((x - gap) / pitch)));
    return { index, level: Math.max(0, Math.min(DRAWN_LEVELS, Math.ceil((bottom - y) / rowPitch))) };
  };
  const paint = (event: PointerEvent<SVGSVGElement>, first: boolean) => {
    const point = at(event);
    if (!point) return;
    // Pressing a column's top block takes it off, so a column can come down one block at a time.
    const level = first && point.level > 0 && point.level === levelOf(latest.current[point.index]) ? point.level - 1 : point.level;
    const from = stroke.current ?? { index: point.index, level };
    const span = Math.abs(point.index - from.index);
    apply(Array.from({ length: span + 1 }, (_, offset) => ({
      index: from.index + Math.sign(point.index - from.index) * offset,
      level: span ? from.level + (level - from.level) * offset / span : level,
    })));
    stroke.current = { index: point.index, level };
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    stroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const move = (index: number, by: number) => {
    let next = index + by;
    while (next >= 0 && next < count && !usable(next)) next += by;
    if (next < 0 || next >= count) return;
    setFocus(next);
    keys.current[next]?.focus();
  };
  const key = (event: KeyboardEvent<SVGRectElement>, index: number) => {
    const level = levelOf(latest.current[index]);
    const by = { ArrowUp: 1, ArrowDown: -1, PageUp: 3, PageDown: -3 }[event.key];
    if (by !== undefined) { event.preventDefault(); onStroke(); apply([{ index, level: level + by }]); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); onStroke(); apply([{ index, level: event.key === "Home" ? 0 : DRAWN_LEVELS }]); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(index, event.key === "ArrowLeft" ? -1 : 1); }
  };
  const prices = priceUsd ? binPrices(own, priceUsd) : null;
  const ticks = prices ? (W < 380 ? [0, half, count] : [0, Math.floor(half / 2), half, half + Math.ceil(half / 2), count]) : [];
  const tickX = (column: number) => column === half ? priceX : column >= count ? W : left(column);
  const tickPrice = (column: number) => !prices ? 0 : column === half ? priceUsd! : column >= count ? prices[count - 1].toUsd : prices[column].fromUsd;
  const focused = usable(focus) ? focus : columns.findIndex((_, index) => usable(index));
  return <div className="gmd-grid-plot" ref={plotRef}>
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby={`${id}-title`}
      onPointerDown={event => { if (event.button !== 0) return; onStroke(); stroke.current = null; event.currentTarget.setPointerCapture(event.pointerId); paint(event, true); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) paint(event, false); }}
      onPointerUp={end} onPointerCancel={end}>
      <title id={`${id}-title`}>Your shape, a column of blocks per bin: press or drag to draw, or use the arrow keys on a column</title>
      {columns.map((value, index) => {
        const level = levelOf(value), side = index < half ? "is-dollars" : "is-shares", unused = usable(index) ? "" : " is-unused";
        return <g key={index} className={`gmd-grid-col ${side}${unused}`}>
          {Array.from({ length: DRAWN_LEVELS }, (_, row) => <rect key={row} className={row < level ? "is-on" : "is-off"}
            x={left(index) + (pitch - cellWidth) / 2} y={bottom - (row + 1) * rowPitch + 1.25} width={cellWidth} height={cellHeight} rx={Math.min(3, cellWidth / 3)} />)}
          <rect ref={element => { keys.current[index] = element; }} className="gmd-grid-key" x={left(index)} y={top} width={pitch} height={gridHeight}
            tabIndex={usable(index) ? (index === focused ? 0 : -1) : undefined} role={usable(index) ? "slider" : undefined}
            aria-valuemin={0} aria-valuemax={DRAWN_LEVELS} aria-valuenow={level} aria-valuetext={`${level} of ${DRAWN_LEVELS} blocks`}
            aria-label={usable(index) ? `Bin ${index < half ? half - index : index - half + 1} ${index < half ? "below" : "above"} the price${prices ? `, $${prices[index].fromUsd.toFixed(2)} to $${prices[index].toUsd.toFixed(2)}` : ""}` : undefined}
            onFocus={() => setFocus(index)} onKeyDown={event => key(event, index)} />
        </g>;
      })}
      <line className="gmd-grid-price" x1={priceX} x2={priceX} y1={top - 6} y2={bottom + 4} />
      {priceUsd !== null && <g className="gmd-grid-pill">
        <rect x={priceX - 72} y={2} width={144} height={24} rx={12} />
        <text x={priceX} y={18} textAnchor="middle">Current price ${priceUsd.toFixed(2)}</text>
      </g>}
      {ticks.map(column => <text key={column} className="gmd-lq-tick" x={tickX(column)} y={H - 6} textAnchor={column === 0 ? "start" : column >= count ? "end" : "middle"}>${tickPrice(column).toFixed(2)}</text>)}
    </svg>
  </div>;
}

/**
 * Custom's settings, laid out as Meteora's DLMM Pro lays them out: the shape in a grid of blocks
 * with the current price, undo and redo; Spot, Curve and Bid-Ask to start from, each editable; the
 * range from the price with presets and its lowest and highest prices; bins and sides; and setups
 * kept by name in this browser.
 */
function CustomRange({ own, onChange, priceUsd }: { own: OwnRange; onChange: (next: OwnRange) => void; priceUsd: number | null }) {
  const id = useId();
  const [past, setPast] = useState<OwnRange[]>([]);
  const [future, setFuture] = useState<OwnRange[]>([]);
  const [customReach, setCustomReach] = useState(!REACH_PRESETS.includes(own.rangePercent));
  const [saved, setSaved] = useState<SavedSetup[]>(readSavedSetups);
  const [name, setName] = useState("");
  // The settings as last sent, ahead of the render, so a stroke's first change is one undo step.
  const current = useRef(own);
  useLayoutEffect(() => { current.current = own; });
  const remember = () => { setPast(list => [...list, current.current].slice(-HISTORY_LIMIT)); setFuture([]); };
  const commit = (patch: Partial<OwnRange>) => { remember(); const next = { ...current.current, ...patch }; current.current = next; onChange(next); };
  const undo = () => { const previous = past[past.length - 1]; if (!previous) return; setPast(past.slice(0, -1)); setFuture([current.current, ...future]); current.current = previous; onChange(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setFuture(future.slice(1)); setPast([...past, current.current]); current.current = next; onChange(next); };
  const columns = columnsOf(own);
  const half = own.bins;
  const pick = (shape: OwnRange["shape"]) => commit(shape === "drawn" ? { shape, drawn: own.drawn ?? columns } : { shape });
  const setBins = (bins: number) => commit(own.shape === "drawn" || own.drawn ? { bins, drawn: fitDrawing(own.drawn ?? columns, bins) } : { bins });
  const mirror = (from: "below" | "above") => {
    const below = columns.slice(0, half), above = columns.slice(half);
    commit({ shape: "drawn", drawn: from === "below" ? [...below, ...[...below].reverse()] : [...[...above].reverse(), ...above] });
  };
  const save = () => {
    const label = name.trim().slice(0, 24) || `Shape ${saved.length + 1}`;
    const setup: SavedSetup = { name: label, shape: own.shape, rangePercent: own.rangePercent, bins: own.bins, sides: own.sides, ...(own.shape === "drawn" ? { drawn: columns } : {}) };
    const next = [setup, ...saved.filter(item => item.name !== label)].slice(0, SAVED_LIMIT);
    setSaved(next);
    writeSavedSetups(next);
    setName("");
  };
  const forget = (label: string) => { const next = saved.filter(item => item.name !== label); setSaved(next); writeSavedSetups(next); };
  const layout = ownBins(own);
  const prices = priceUsd ? binPrices(own, priceUsd) : null;
  const lowest = prices && layout.binsBelow ? prices[0].fromUsd : prices && layout.binsAbove ? prices[half].fromUsd : null;
  const highest = prices && layout.binsAbove ? prices[2 * half - 1].toUsd : prices && layout.binsBelow ? prices[half - 1].toUsd : null;
  const percent = (value: number) => `${value >= priceUsd! ? "+" : "−"}${Math.abs((value / priceUsd! - 1) * 100).toFixed(2)}%`;
  const share = ownAboveShare(own), sides = ownSides(own);
  return <div className="gmd-strategy-custom gmd-range-card">
    <div className="gmd-range-head">
      <div><b id={`${id}-title`}>Price range</b><span className="gmd-range-legend"><i className="is-dollars" aria-hidden="true" />dUSD <i className="is-shares" aria-hidden="true" />USTX</span></div>
      <div className="gmd-range-history" role="group" aria-label="Undo and redo">
        <button type="button" className="gmd-icon-button" onClick={undo} disabled={!past.length} aria-label="Undo"><Icon name="undo" size={16} /></button>
        <button type="button" className="gmd-icon-button" onClick={redo} disabled={!future.length} aria-label="Redo"><Icon name="redo" size={16} /></button>
      </div>
    </div>
    <BlockGrid own={own} priceUsd={priceUsd} onStroke={remember} onPaint={drawn => { const next = { ...current.current, shape: "drawn" as const, drawn }; current.current = next; onChange(next); }} />
    <div className="gmd-strategy-row"><span>Shape</span><div className="gmd-segmented" role="group" aria-label="Shape">{([...PRESET_SHAPES, "drawn"] as const).map(shape => <button type="button" key={shape} aria-pressed={own.shape === shape} onClick={() => pick(shape)}>{shape === "drawn" ? "Yours" : SHAPE_LABELS[shape]}</button>)}</div></div>
    <div className="gmd-shape-tools">
      <button type="button" className="gmd-small-button" onClick={() => mirror("below")}>Copy left to right</button>
      <button type="button" className="gmd-small-button" onClick={() => mirror("above")}>Copy right to left</button>
      <button type="button" className="gmd-small-button" onClick={() => commit({ shape: "drawn", drawn: columns.map(() => 0) })}>Clear</button>
    </div>
    <div className="gmd-range-prices">
      <div><span>Min price</span><b>{lowest !== null ? `$${lowest.toFixed(2)}` : "—"}</b><small>{lowest !== null ? percent(lowest) : ""}</small></div>
      <div><span>Max price</span><b>{highest !== null ? `$${highest.toFixed(2)}` : "—"}</b><small>{highest !== null ? percent(highest) : ""}</small></div>
    </div>
    <div className="gmd-strategy-row"><span>Range</span><div className="gmd-segmented" role="group" aria-label="Range from the price">
      {REACH_PRESETS.map(reach => <button type="button" key={reach} aria-pressed={!customReach && own.rangePercent === reach} onClick={() => { setCustomReach(false); commit({ rangePercent: reach }); }}>±{reach}%</button>)}
      <button type="button" aria-pressed={customReach || !REACH_PRESETS.includes(own.rangePercent)} onClick={() => setCustomReach(true)}>Custom</button>
    </div></div>
    {(customReach || !REACH_PRESETS.includes(own.rangePercent)) && <div className="gmd-strategy-row"><label htmlFor={`${id}-range`}>Reach <b>±{own.rangePercent}%</b></label><input id={`${id}-range`} type="range" min={0.5} max={10} step={0.5} value={own.rangePercent} onPointerDown={remember} onKeyDown={remember} onChange={event => { const next = { ...current.current, rangePercent: Number(event.target.value) }; current.current = next; onChange(next); }} /></div>}
    <div className="gmd-strategy-row"><span>Bins each side</span><div className="gmd-segmented" role="group" aria-label="Bins each side">{BIN_CHOICES.map(bins => <button type="button" key={bins} aria-pressed={own.bins === bins} onClick={() => setBins(bins)}>{bins}</button>)}</div></div>
    <div className="gmd-strategy-row"><span>Sides</span><div className="gmd-segmented" role="group" aria-label="Sides">{(["both", "below", "above"] as const).map(option => <button type="button" key={option} aria-pressed={own.sides === option} onClick={() => commit({ sides: option })}>{SIDE_LABELS[option]}</button>)}</div></div>
    <div className="gmd-shape-saved">
      <label className="gmd-sr-only" htmlFor={`${id}-name`}>Name this setup</label>
      <input id={`${id}-name`} type="text" maxLength={24} placeholder="Name this setup" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
      <button type="button" className="gmd-button gmd-range-save" onClick={save}>Save</button>
      {saved.map(item => <span className="gmd-shape-chip" key={item.name}>
        <button type="button" onClick={() => { setCustomReach(!REACH_PRESETS.includes(item.rangePercent)); commit({ shape: item.shape, rangePercent: item.rangePercent, bins: item.bins, sides: item.sides, ...(item.drawn ? { drawn: item.drawn } : {}) }); }} aria-label={`Use the setup ${item.name}`}>{item.name}</button>
        <button type="button" onClick={() => forget(item.name)} aria-label={`Forget the setup ${item.name}`}>×</button>
      </span>)}
    </div>
    <p className="gmd-caption">{own.bins} bins of {(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% {sides === "both" ? "on each side" : sides === "below" ? "below the price: demo dollars that buy USTX as it falls" : "above the price: USTX sold as it rises"}{own.shape === "drawn" ? `, each holding what its column shows${sides === "both" ? `: ${Math.round(share * 100)}% of the deposit buys USTX for the columns above` : ""}` : ""}.{own.rangePercent > 5 ? " Swaps keep the price within 5% of the NAV, so bins past it never trade." : ""}</p>
  </div>;
}

/** The strategies as buttons; for Custom, the shape, range, bins and sides of one's own position. */
export function StrategyPicker({ value, onChange, range, priceUsd = null }: { value: StrategyChoice; onChange: (next: StrategyChoice) => void; range: boolean; priceUsd?: number | null }) {
  const id = useId();
  const options = LP_STRATEGIES.filter(item => range || item.pool === "pooled");
  const own = value.own;
  return <div className="gmd-strategy">
    <span className="gmd-strategy-label" id={id}>Strategy</span>
    <div className={`gmd-strategy-options is-${options.length}`} role="radiogroup" aria-labelledby={id}>
      {options.map(item => <button type="button" role="radio" key={item.id} aria-checked={value.id === item.id} className={item.id === "custom" ? "is-custom" : undefined} onClick={() => onChange({ ...value, id: item.id })}>
        <ShapeIcon id={item.id} own={own} />
        <b>{item.name}</b><small>{item.label}</small>
      </button>)}
    </div>
    {value.id === "custom" && <CustomRange own={own} priceUsd={priceUsd} onChange={next => onChange({ ...value, own: next })} />}
  </div>;
}

/**
 * Both pooled pools as price ranges, read from X Layer, around `center`: the NAV, or while the NAV
 * record is over an hour old and the fund refuses it, the constant-product pool's own price.
 */
export function poolRanges(pool: PoolLiquidity | null, v4: V4Pool | null, deployment: V4Deployment | null) {
  const nav = pool?.nav.navMicros ?? (v4 && v4.nav.answer !== null ? v4.nav.navMicros : null);
  const poolPrice = pool && pool.sharesMicros > 0n ? pool.dollarsMicros * 1_000_000n / pool.sharesMicros : null;
  const center = nav ?? poolPrice ?? (v4 ? v4.priceMicros : null);
  const cp = pool && center !== null && pool.sharesMicros > 0n ? { ranges: constantProductRange(pool), price: Number(pool.dollarsMicros) / Number(pool.sharesMicros), valueMicros: poolValueMicros(pool, center) } : null;
  const toRange = (range: V4Pool["base"]): PriceRange | null => {
    if (!deployment || range.liquidity === 0n) return null;
    const a = tickToUsd(range.lower, deployment.assetIsCurrency0), b = tickToUsd(range.upper, deployment.assetIsCurrency0);
    return { lower: Math.min(a, b), upper: Math.max(a, b), liquidity: Number(range.liquidity) };
  };
  const pegged = v4 && deployment && (v4.nav.answer !== null || center !== null) ? {
    ranges: [toRange(v4.base), toRange(v4.limit)].filter((range): range is PriceRange => range !== null),
    price: Number(v4.priceMicros) / 1e6, valueMicros: v4ValueMicros(v4, v4.nav.answer ?? center!),
  } : null;
  return { nav, center, constantProduct: cp, v4: pegged };
}

type ChartBin = { from: number; to: number; side: "dollars" | "shares"; constantProduct: number; v4: number; own: number };
const SPANS = [0.06, 0.24] as const;

/** One chart for Pools: where your deposit would sit by price under the chosen strategy, or both pooled pools' liquidity. */
export function StrategyChart({ choice, amountMicros, pool, v4, deployment, range, tall = false }: {
  choice: StrategyChoice; amountMicros: bigint; pool: PoolLiquidity | null; v4: V4Pool | null; deployment: V4Deployment | null; range: RangePool | null; tall?: boolean;
}) {
  const title = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<"mine" | "pools">("mine");
  const [span, setSpan] = useState<number>(0.06);
  const [plotRef, W] = useWidth(900);
  const measured = useMeasuredResults();
  const assistant = useAsk();
  const strategy = strategyById(choice.id);
  const own = ownRangeOf(choice);
  const { nav: recordedNav, center: nav, constantProduct, v4: pegged } = poolRanges(pool, v4, deployment);
  if (nav === null) return <div className="gmd-lq is-loading" aria-busy="true"><i className="gmd-skeleton gmd-lq-skeleton" aria-hidden="true" /></div>;
  const navPrice = Number(nav) / 1e6;
  // While the NAV record is over an hour old, the chart centres on the pool's own price and says so.
  const stale = recordedNav === null;
  const mark = stale ? "the pool price" : "the NAV";
  const deposit = Number(amountMicros) / 1e6;
  const pooledV4 = own ? 0n : amountMicros * BigInt(strategy.v4Percent) / 100n;
  const pooledCp = own ? 0n : amountMicros - pooledV4;
  const mine = view === "mine";
  // Pooled pools: your share of each, or each whole pool.
  const pooled = strategyShape({
    navMicros: nav, span, step: span / 12,
    constantProductMicros: mine ? pooledCp : constantProduct?.valueMicros ?? 0n,
    v4Micros: mine ? pooledV4 : pegged?.valueMicros ?? 0n,
    constantProduct, v4: pegged,
  });
  // One's own position: the hook's spread, at the range pool's price (the NAV until it is read),
  // drawn bin by bin as the grid shows it.
  const priced = Boolean(own && mine);
  const ownBars = own && mine ? (() => {
    const priceUsd = range ? Number(range.priceMicros) / 1e6 : navPrice;
    const invest = deposit * ownAboveShare(own);
    const layout = ownBins(own);
    return previewWeights(layout.weights, binTicksFor(own.rangePercent, own.bins), layout.binsBelow, layout.binsAbove, deposit - invest, invest, priceUsd);
  })() : [];
  const low = navPrice * (1 - span), high = navPrice * (1 + span);
  const bins: ChartBin[] = priced
    ? ownBars.filter(item => item.toUsd > low && item.fromUsd < high).map(item => ({ from: item.fromUsd, to: item.toUsd, side: item.side, constantProduct: 0, v4: 0, own: item.value }))
    : pooled.map(bin => ({ from: bin.from, to: bin.to, side: bin.side, constantProduct: bin.constantProduct, v4: bin.v4, own: 0 }));
  const clipped = priced && span < SPANS[SPANS.length - 1] && ownBars.some(item => item.value > 0 && (item.fromUsd < low || item.toUsd > high));
  const value = (bin: ChartBin) => bin.constantProduct + bin.v4 + bin.own;
  const nearTotal = bins.filter(bin => bin.from >= navPrice * 0.98 - 1e-9 && bin.to <= navPrice * 1.02 + 1e-9).reduce((total, bin) => total + value(bin), 0);
  const shown = bins.reduce((total, bin) => total + value(bin), 0);
  const total = mine ? deposit : Number((constantProduct?.valueMicros ?? 0n) + (pegged?.valueMicros ?? 0n)) / 1e6;
  const year = mine && !own && measured ? strategyYear(pooledCp, pooledV4, measured) : null;
  const H = tall ? 340 : W < 500 ? 220 : 260, top = 30, bottom = 30, plot = H - top - bottom;
  const max = Math.max(1e-9, ...bins.map(value));
  const slot = W / Math.max(1, bins.length), barWidth = Math.min(26, slot * 0.7);
  const active = hover === null ? null : bins[hover] ?? null;
  const x = (move: number) => W / 2 + move / (2 * span) * W;
  // A pooled bar takes an equal slot; a bin of one's own sits at its prices.
  const box = (bin: ChartBin, index: number) => {
    if (!priced) return { hitLeft: index * slot, hitWidth: slot, left: index * slot + (slot - barWidth) / 2, width: barWidth };
    const a = Math.max(0, x(bin.from / navPrice - 1)), b = Math.min(W, x(bin.to / navPrice - 1));
    const width = Math.max(1.5, Math.min(26, (b - a) * 0.8));
    return { hitLeft: a, hitWidth: Math.max(1, b - a), left: (a + b) / 2 - width / 2, width };
  };
  const center = (index: number) => { const item = box(bins[index], index); return (item.hitLeft + item.hitWidth / 2) / W; };
  // Lighter bars mark the constant-product pool's part wherever another part sits on it.
  const layered = !own && (mine ? strategy.v4Percent > 0 && strategy.v4Percent < 100 : true);
  const drawBar = (bin: ChartBin, index: number) => {
    const all = value(bin) / max * plot, base = H - bottom;
    const heightCp = bin.constantProduct / max * plot;
    const { left, width, hitLeft, hitWidth } = box(bin, index);
    const distance = Math.abs(index + 0.5 - bins.length / 2);
    return <g key={index} className={`gmd-strategy-bar is-${bin.side}${hover === index ? " is-active" : ""}`} style={{ ["--gmd-delay" as string]: `${Math.round(distance * (priced ? 12 : 26))}ms` }}>
      <rect className="is-v4" x={left} y={base - Math.max(all, 1.5)} width={width} height={Math.max(all, 1.5)} rx={Math.min(4, width / 3)} />
      {layered && heightCp > 0.5 && <rect className="is-cp" x={left} y={base - heightCp} width={width} height={heightCp} rx={Math.min(4, width / 3)} />}
      <rect className="gmd-lq-hit" x={hitLeft} y={top} width={hitWidth} height={plot} tabIndex={0} aria-label={`${money(bin.from)} to ${money(bin.to)}: ${money(value(bin))}`}
        onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
    </g>;
  };
  // A drawing's bars go into each question while it stays within Ask USTX's limit; past it, the
  // question keeps the drawing's split and leaves the bars out.
  const drawnBars = own?.shape === "drawn" ? `; its columns, in blocks of ${DRAWN_LEVELS} at most, from the farthest below the price to the farthest above: ${ownBins(own).weights.map(weight => weight / DRAWN_STEP).join(" ")}` : "";
  const ownWords = own ? `my own position in the range pool: ${own.shape === "drawn" ? "a shape I drew block by block" : `${SHAPE_LABELS[own.shape]} shape`}, reaching ±${own.rangePercent}% from the price in ${own.bins} bins of ${(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% ${ownSides(own) === "both" ? `on each side (${Math.round(ownAboveShare(own) * 100)}% of the deposit buys USTX at the NAV for the bins above)` : ownSides(own) === "below" ? "below the price only, all in demo dollars" : "above the price only, all in USTX bought at the NAV"}` : "";
  const describe = (bars: string) => own ? `${strategy.name} (${ownWords}${bars})` : `${strategy.name} (${strategy.v4Percent}% in the v4 pool held at the NAV, ${100 - strategy.v4Percent}% in the constant-product pool)`;
  const figures = `For ${money(deposit)} of demo dollars, about ${money(nearTotal)} would sit within 2% of ${mark} of ${money(navPrice)}.${year !== null ? ` At each pool's measured result for providers so far, a year would come to about ${formatUsdMicros(year < 0n ? -year : year, 2)}${year < 0n ? " lost" : ""}.` : ""}`;
  const fitted = (write: (described: string) => string) => { const full = write(describe(drawnBars)); return full.length <= ASK_LIMIT ? full : write(describe("")); };
  const questions = [
    { label: choice.id === "custom" ? "Explain my settings" : `Explain ${strategy.name} in detail`, question: fitted(described => `On Pools I chose the ${described} liquidity strategy. ${figures} Explain in detail and in plain words how it works, which trades I earn fees from, what I end up holding if the price falls or rises, and what happens when a new NAV record arrives.`) },
    { label: "Compare it with the others", question: fitted(described => `On Pools the liquidity strategies are Spot (all in the constant-product pool, even at every price), Curve (all in the v4 pool held at the NAV), Spot + Curve (half each), Bid-Ask (a position of one's own, heaviest at the ends, ±3%) and Custom (one's own shape, drawn bar by bar if one likes, reach, bins and sides). I am looking at ${described}. ${figures} Compare them for me: which earns more per dollar near the NAV, which does best when the price swings and comes back, which is safest when it jumps, and who each suits.`) },
    { label: "When does it do badly?", question: fitted(described => `When does the ${described} liquidity strategy on Pools do badly? ${figures} Explain impermanent loss, the price leaving the range, a stale NAV stopping trades, and anything else, simply.`) },
  ];
  const ticks = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map(part => part * span).filter((_, index) => W >= 500 || index % 3 === 0);
  return <figure className={`gmd-lq gmd-strategy-chart${tall ? " is-tall" : ""}`} aria-labelledby={title}>
    <ChartHead id={title} title={mine ? `Your liquidity by price: ${strategy.name}` : "Both pooled pools by price"} question={mine ? questions[0].question : `Explain the "Both pooled pools by price" chart on Pools: the constant-product pool holds ${constantProduct ? formatUsdMicros(constantProduct.valueMicros, 0) : "—"} spread over every price and the v4 pool ${pegged ? formatUsdMicros(pegged.valueMicros, 0) : "—"} within a few percent of the NAV of ${money(navPrice)}. What does that mean for traders and for liquidity providers?`}>
      <div className="gmd-lq-range" role="group" aria-label="What the chart shows">
        <button type="button" aria-pressed={mine} onClick={() => { setView("mine"); setHover(null); }}>Your deposit</button>
        <button type="button" aria-pressed={!mine} onClick={() => { setView("pools"); setHover(null); }}>Whole pools</button>
      </div>
      <div className="gmd-lq-range" role="group" aria-label="Price range">{SPANS.map(option => <button type="button" key={option} aria-pressed={span === option} onClick={() => { setSpan(option); setHover(null); }}>±{Math.round(option * 100)}%</button>)}</div>
    </ChartHead>
    {stale && <p className="gmd-caption gmd-strategy-stale" role="status">{pool?.nav.navMicros === null ? pool.nav.reason : "The NAV record is over an hour old."} Until the next record, the chart is centred on the pool’s own price.</p>}
    <ul className="gmd-lq-legend">
      <li><i className="is-dollars" aria-hidden="true" />dUSD, buys USTX below the price</li>
      <li><i className="is-shares" aria-hidden="true" />USTX, sold above the price</li>
      {layered && <li><i className="is-cp" aria-hidden="true" />Lighter: the constant-product pool’s part</li>}
      {clipped && <li className="gmd-strategy-clipped">Part of your position lies past ±{Math.round(span * 100)}%: see ±{Math.round(SPANS[SPANS.length - 1] * 100)}%</li>}
    </ul>
    <div className="gmd-lq-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${mine ? strategy.name : "Both pooled pools"}: ${money(shown)} by price from ${money(bins.length ? bins[0].from : low)} to ${money(bins.length ? bins[bins.length - 1].to : high)}; ${money(nearTotal)} within 2% of the NAV.`}>
        <rect className="gmd-strategy-near" x={x(-0.02)} y={top - 10} width={x(0.02) - x(-0.02)} height={plot + 10} />
        <text className="gmd-lq-tick gmd-strategy-near-label" x={W / 2} y={top - 14} textAnchor="middle">Within 2% of {mark}: {money(nearTotal, 0)} of {money(total, 0)}</text>
        <line className="gmd-lq-base" x1={0} x2={W} y1={H - bottom} y2={H - bottom} />
        <g key={`${choice.id}-${view}-${span}-${own ? `${own.shape}${own.rangePercent}${own.bins}${own.sides}${own.shape === "drawn" ? "-drawn" : ""}` : ""}`}>{bins.map(drawBar)}</g>
        <line className="gmd-strategy-nav" x1={W / 2} x2={W / 2} y1={top - 4} y2={H - bottom} />
        {ticks.map(move => <text key={move} className="gmd-lq-tick" x={x(move)} y={H - 9} textAnchor={move === -span ? "start" : move === span ? "end" : "middle"}>{move === 0 ? `${stale ? "Pool" : "NAV"} ${money(navPrice)}` : signed(move)}</text>)}
      </svg>
      {active && <div className={`gmd-chart-tip is-below${center(hover!) > 0.5 ? " is-left" : ""}`} style={{ left: `${center(hover!) * 100}%`, top: "3%" }} role="status">
        <b>{money(value(active), value(active) < 1 ? 4 : 2)}</b>
        <span>{money(active.from)} – {money(active.to)}</span>
        {active.own > 0 && <small>Your own position: {money(active.own, active.own < 1 ? 4 : 2)}</small>}
        {(!own || !mine) && <small>v4 pool at the NAV: {money(active.v4, active.v4 < 1 ? 4 : 2)}</small>}
        {(!own || !mine) && <small>Constant product: {money(active.constantProduct, active.constantProduct < 1 ? 4 : 2)}</small>}
      </div>}
    </div>
    {mine && <>
      <dl className="gmd-strategy-facts">
        <div><dt>Within 2% of {mark}</dt><dd>{money(nearTotal)}<small>{deposit > 0 ? `${Math.round(nearTotal / deposit * 100)}% of your deposit meets the trades there` : "—"}</small></dd></div>
        {own ? <div><dt>Your position</dt><dd>{own.shape === "drawn" ? "Your drawing" : SHAPE_LABELS[own.shape]} · ±{own.rangePercent}%<small>{own.bins} bins of {(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% · {SIDE_LABELS[ownSides(own)].toLowerCase()}</small></dd></div>
          : <div><dt>Split</dt><dd>{strategy.v4Percent}% at the NAV<small>{100 - strategy.v4Percent}% even, in the constant-product pool</small></dd></div>}
        <div><dt>{own ? "Fees" : "A year at the measured results"}</dt><dd>{own ? "Yours alone" : year === null ? "—" : `${year < 0n ? "−" : "+"}${formatUsdMicros(year < 0n ? -year : year, 2)}`}<small>{own ? "Only trades that cross your bins pay you" : "Each pool’s result for providers so far, per dollar; not a forecast"}</small></dd></div>
      </dl>
      <p className="gmd-strategy-summary">{strategy.summary}</p>
      {assistant && <div className="gmd-strategy-ask">
        <span className="gmd-ask-guide-mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
        <div><b>{choice.id === "custom" ? "Ask USTX about your settings" : `Ask USTX about ${strategy.name}`}</b>
          <div className="gmd-ask-guide-actions">{questions.map(item => <button type="button" key={item.label} onClick={() => assistant.ask(item.question)}>{item.label}</button>)}</div></div>
      </div>}
    </>}
    <figcaption className="gmd-caption">{mine
      ? own ? "Drawn as the range pool’s hook spreads a position: demo dollars in the bins below the price, USTX in the bins above, skipping the 0.1% the price is in. Only you earn the fees on your bins, and closing pays them with the tokens at any NAV."
        : "Drawn from both pooled pools’ ranges as read on X Layer, at your share of each. The v4 pool’s hook moves its range to every NAV record; the constant-product pool keeps liquidity at every price, so little of it sits near the NAV."
      : "Everything in the two pooled pools by price, read on X Layer: the constant-product pool’s even spread (lighter) with the v4 pool’s liquidity at the NAV on top. Positions of one’s own sit in the range pool, each owner’s apart."}</figcaption>
  </figure>;
}
