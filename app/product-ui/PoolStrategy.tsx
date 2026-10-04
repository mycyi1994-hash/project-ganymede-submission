"use client";

import { useEffect, useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { poolValueMicros, type PoolLiquidity } from "@/lib/xstocks/liquidity";
import { tickToUsd, v4ValueMicros, type V4Deployment, type V4Pool } from "@/lib/xstocks/v4-liquidity";
import { previewShape, type RangePool } from "@/lib/xstocks/range-liquidity";
import {
  BID_ASK_RANGE, LP_STRATEGIES, binTicksFor, constantProductRange, strategyById, strategyShape, strategyYear,
  type OwnRange, type PriceRange, type StrategyId,
} from "@/lib/xstocks/lp-strategy";
import { Icon } from "./Icons";
import { useAsk } from "./AskUstx";
import { ChartHead, useWidth } from "./PoolVisuals";

// Liquidity strategies on Pools, laid out as Meteora lays out its shapes: Spot, Curve and Spot +
// Curve split a deposit between the two pooled pools; Bid-Ask and Custom open a position of one's
// own in the range pool, with the shape, reach, bins and sides one sets (lib/xstocks/lp-strategy.ts).
// One chart draws where the deposit's dollars would sit by price, or, switched, both pooled pools'
// liquidity as read on X Layer; Ask USTX explains the chosen strategy, or one's own settings, with
// the figures on screen.

const money = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signed = (ratio: number) => `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(Math.round(ratio * 1000) / 10)}%`;

export type StrategyChoice = { id: StrategyId; own: OwnRange };
export const DEFAULT_CHOICE: StrategyChoice = { id: "spot", own: { shape: "curve", rangePercent: 2, bins: 10, sides: "both" } };
export const strategyPercent = (choice: StrategyChoice) => strategyById(choice.id).v4Percent;
/** The position a range strategy opens, or null for a pooled one. */
export const ownRangeOf = (choice: StrategyChoice): OwnRange | null => choice.id === "bid-ask" ? BID_ASK_RANGE : choice.id === "custom" ? choice.own : null;
export const SHAPE_LABELS = { spot: "Spot", curve: "Curve", "bid-ask": "Bid-Ask" } as const;
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

/** A small picture of each shape, as on Meteora's strategy buttons. */
function ShapeIcon({ id, own }: { id: StrategyId; own: OwnRange }) {
  const shape = id === "spot" ? "flat" : id === "curve" ? "peak" : id === "spot-curve" ? "mixed" : id === "bid-ask" ? "edges" : own.shape === "spot" ? "flat" : own.shape === "curve" ? "peak" : "edges";
  const bars = Array.from({ length: 9 }, (_, index) => {
    const distance = Math.abs(index - 4);
    if (shape === "flat") return 0.5;
    if (shape === "peak") return 0.12 + Math.max(0, 1 - distance / 4.5) * 0.88;
    if (shape === "edges") return distance === 0 ? 0.08 : 0.15 + distance / 4 * 0.85;
    return 0.25 + Math.max(0, 1 - distance / 2.2) * 0.7;
  });
  return <svg className="gmd-strategy-icon" viewBox="0 0 54 24" aria-hidden="true">{bars.map((height, index) => <rect key={index} x={index * 6} y={24 - height * 22} width={4} height={height * 22} rx={1} className={index < 4 ? "is-dollars" : index > 4 ? "is-shares" : "is-mid"} />)}</svg>;
}

/** The strategies as buttons; for Custom, the shape, reach, bins and sides of one's own position. */
export function StrategyPicker({ value, onChange, range }: { value: StrategyChoice; onChange: (next: StrategyChoice) => void; range: boolean }) {
  const id = useId();
  const options = LP_STRATEGIES.filter(item => range || item.pool === "pooled");
  const own = value.own;
  const set = (patch: Partial<OwnRange>) => onChange({ ...value, own: { ...own, ...patch } });
  return <div className="gmd-strategy">
    <span className="gmd-strategy-label" id={id}>Strategy</span>
    <div className={`gmd-strategy-options is-${options.length}`} role="radiogroup" aria-labelledby={id}>
      {options.map(item => <button type="button" role="radio" key={item.id} aria-checked={value.id === item.id} className={item.id === "custom" ? "is-custom" : undefined} onClick={() => onChange({ ...value, id: item.id })}>
        <ShapeIcon id={item.id} own={own} />
        <b>{item.name}</b><small>{item.label}</small>
      </button>)}
    </div>
    {value.id === "custom" && <div className="gmd-strategy-custom">
      <div className="gmd-strategy-row"><span>Shape</span><div className="gmd-segmented" role="group" aria-label="Shape">{(["spot", "curve", "bid-ask"] as const).map(shape => <button type="button" key={shape} aria-pressed={own.shape === shape} onClick={() => set({ shape })}>{SHAPE_LABELS[shape]}</button>)}</div></div>
      <div className="gmd-strategy-row"><label htmlFor={`${id}-range`}>Reach <b>±{own.rangePercent}%</b></label><input id={`${id}-range`} type="range" min={0.5} max={10} step={0.5} value={own.rangePercent} onChange={event => set({ rangePercent: Number(event.target.value) })} /></div>
      <div className="gmd-strategy-row"><span>Bins each side</span><div className="gmd-segmented" role="group" aria-label="Bins each side">{[5, 10, 15, 20].map(bins => <button type="button" key={bins} aria-pressed={own.bins === bins} onClick={() => set({ bins })}>{bins}</button>)}</div></div>
      <div className="gmd-strategy-row"><span>Sides</span><div className="gmd-segmented" role="group" aria-label="Sides">{(["both", "below", "above"] as const).map(sides => <button type="button" key={sides} aria-pressed={own.sides === sides} onClick={() => set({ sides })}>{SIDE_LABELS[sides]}</button>)}</div></div>
      <p className="gmd-caption">{own.bins} bins of {(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% on {own.sides === "both" ? "each side" : own.sides === "below" ? "the side below the price: demo dollars that buy USTX as it falls" : "the side above the price: USTX sold as it rises"}.</p>
    </div>}
  </div>;
}

/** Both pooled pools as price ranges, read from X Layer. */
export function poolRanges(pool: PoolLiquidity | null, v4: V4Pool | null, deployment: V4Deployment | null) {
  const nav = pool?.nav.navMicros ?? (v4 && v4.nav.answer !== null ? v4.nav.navMicros : null);
  const cp = pool && nav !== null && pool.sharesMicros > 0n ? { ranges: constantProductRange(pool), price: Number(pool.dollarsMicros) / Number(pool.sharesMicros), valueMicros: poolValueMicros(pool, nav) } : null;
  const toRange = (range: V4Pool["base"]): PriceRange | null => {
    if (!deployment || range.liquidity === 0n) return null;
    const a = tickToUsd(range.lower, deployment.assetIsCurrency0), b = tickToUsd(range.upper, deployment.assetIsCurrency0);
    return { lower: Math.min(a, b), upper: Math.max(a, b), liquidity: Number(range.liquidity) };
  };
  const pegged = v4 && v4.nav.answer !== null && deployment ? {
    ranges: [toRange(v4.base), toRange(v4.limit)].filter((range): range is PriceRange => range !== null),
    price: Number(v4.priceMicros) / 1e6, valueMicros: v4ValueMicros(v4, v4.nav.answer),
  } : null;
  return { nav, constantProduct: cp, v4: pegged };
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
  const { nav, constantProduct, v4: pegged } = poolRanges(pool, v4, deployment);
  if (nav === null) return <div className="gmd-lq is-loading" aria-busy="true"><i className="gmd-skeleton gmd-lq-skeleton" aria-hidden="true" /></div>;
  const navPrice = Number(nav) / 1e6;
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
  // One's own position: the hook's spread, at the range pool's price (the NAV until it is read).
  const ownBins = own && mine ? (() => {
    const priceUsd = range ? Number(range.priceMicros) / 1e6 : navPrice;
    const invest = own.sides === "below" ? 0 : own.sides === "above" ? deposit : deposit / 2;
    return previewShape(own.shape, binTicksFor(own.rangePercent, own.bins), own.sides === "above" ? 0 : own.bins, own.sides === "below" ? 0 : own.bins, deposit - invest, invest, priceUsd);
  })() : [];
  const bins: ChartBin[] = pooled.map(bin => ({
    from: bin.from, to: bin.to, side: bin.side, constantProduct: bin.constantProduct, v4: bin.v4,
    own: ownBins.reduce((total, item) => {
      const overlap = Math.min(bin.to, item.toUsd) - Math.max(bin.from, item.fromUsd);
      return overlap > 0 ? total + item.value * overlap / (item.toUsd - item.fromUsd) : total;
    }, 0),
  }));
  const value = (bin: ChartBin) => bin.constantProduct + bin.v4 + bin.own;
  const nearTotal = bins.filter(bin => bin.from >= navPrice * 0.98 - 1e-9 && bin.to <= navPrice * 1.02 + 1e-9).reduce((total, bin) => total + value(bin), 0);
  const shown = bins.reduce((total, bin) => total + value(bin), 0);
  const total = mine ? deposit : Number((constantProduct?.valueMicros ?? 0n) + (pegged?.valueMicros ?? 0n)) / 1e6;
  const year = mine && !own && measured ? strategyYear(pooledCp, pooledV4, measured) : null;
  const H = tall ? 340 : W < 500 ? 220 : 260, top = 30, bottom = 30, plot = H - top - bottom;
  const max = Math.max(1e-9, ...bins.map(value));
  const slot = W / bins.length, barWidth = Math.min(26, slot * 0.7);
  const active = hover === null ? null : bins[hover];
  const x = (move: number) => W / 2 + move / (2 * span) * W;
  // Lighter bars mark the constant-product pool's part wherever another part sits on it.
  const layered = !own && (mine ? strategy.v4Percent > 0 && strategy.v4Percent < 100 : true);
  const drawBar = (bin: ChartBin, index: number) => {
    const all = value(bin) / max * plot, base = H - bottom;
    const heightCp = bin.constantProduct / max * plot;
    const left = index * slot + (slot - barWidth) / 2;
    const distance = Math.abs(index + 0.5 - bins.length / 2);
    return <g key={index} className={`gmd-strategy-bar is-${bin.side}${hover === index ? " is-active" : ""}`} style={{ ["--gmd-delay" as string]: `${Math.round(distance * 26)}ms` }}>
      <rect className="is-v4" x={left} y={base - Math.max(all, 1.5)} width={barWidth} height={Math.max(all, 1.5)} rx={Math.min(4, barWidth / 3)} />
      {layered && heightCp > 0.5 && <rect className="is-cp" x={left} y={base - heightCp} width={barWidth} height={heightCp} rx={Math.min(4, barWidth / 3)} />}
      <rect className="gmd-lq-hit" x={index * slot} y={top} width={slot} height={plot} tabIndex={0} aria-label={`${money(bin.from)} to ${money(bin.to)}: ${money(value(bin))}`}
        onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
    </g>;
  };
  const ownWords = own ? `my own position in the range pool: ${SHAPE_LABELS[own.shape]} shape, reaching ±${own.rangePercent}% from the price in ${own.bins} bins of ${(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% ${own.sides === "both" ? "on each side (half the deposit buys USTX at the NAV for the bins above)" : own.sides === "below" ? "below the price only, all in demo dollars" : "above the price only, all in USTX bought at the NAV"}` : "";
  const describe = own ? `${strategy.name} (${ownWords})` : `${strategy.name} (${strategy.v4Percent}% in the v4 pool held at the NAV, ${100 - strategy.v4Percent}% in the constant-product pool)`;
  const figures = `For ${money(deposit)} of demo dollars, about ${money(nearTotal)} would sit within 2% of the NAV of ${money(navPrice)}.${year !== null ? ` At each pool's measured result for providers so far, a year would come to about ${formatUsdMicros(year < 0n ? -year : year, 2)}${year < 0n ? " lost" : ""}.` : ""}`;
  const questions = [
    { label: choice.id === "custom" ? "Explain my settings" : `Explain ${strategy.name} in detail`, question: `On Pools I chose the ${describe} liquidity strategy. ${figures} Explain in detail and in plain words how it works, which trades I earn fees from, what I end up holding if the price falls or rises, and what happens when a new NAV record arrives.` },
    { label: "Compare it with the others", question: `On Pools the liquidity strategies are Spot (all in the constant-product pool, even at every price), Curve (all in the v4 pool held at the NAV), Spot + Curve (half each), Bid-Ask (a position of one's own, heaviest at the ends, ±3%) and Custom (one's own shape, reach, bins and sides). I am looking at ${describe}. ${figures} Compare them for me: which earns more per dollar near the NAV, which does best when the price swings and comes back, which is safest when it jumps, and who each suits.` },
    { label: "When does it do badly?", question: `When does the ${describe} liquidity strategy on Pools do badly? ${figures} Explain impermanent loss, the price leaving the range, a stale NAV stopping trades, and anything else, simply.` },
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
    <ul className="gmd-lq-legend">
      <li><i className="is-dollars" aria-hidden="true" />dUSD, buys USTX below the price</li>
      <li><i className="is-shares" aria-hidden="true" />USTX, sold above the price</li>
      {layered && <li><i className="is-cp" aria-hidden="true" />Lighter: the constant-product pool’s part</li>}
    </ul>
    <div className="gmd-lq-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${mine ? strategy.name : "Both pooled pools"}: ${money(shown)} by price from ${money(bins[0].from)} to ${money(bins[bins.length - 1].to)}; ${money(nearTotal)} within 2% of the NAV.`}>
        <rect className="gmd-strategy-near" x={x(-0.02)} y={top - 10} width={x(0.02) - x(-0.02)} height={plot + 10} />
        <text className="gmd-lq-tick gmd-strategy-near-label" x={W / 2} y={top - 14} textAnchor="middle">Within 2% of the NAV: {money(nearTotal, 0)} of {money(total, 0)}</text>
        <line className="gmd-lq-base" x1={0} x2={W} y1={H - bottom} y2={H - bottom} />
        <g key={`${choice.id}-${view}-${span}-${own ? `${own.shape}${own.rangePercent}${own.bins}${own.sides}` : ""}`}>{bins.map(drawBar)}</g>
        <line className="gmd-strategy-nav" x1={W / 2} x2={W / 2} y1={top - 4} y2={H - bottom} />
        {ticks.map(move => <text key={move} className="gmd-lq-tick" x={x(move)} y={H - 9} textAnchor={move === -span ? "start" : move === span ? "end" : "middle"}>{move === 0 ? `NAV ${money(navPrice)}` : signed(move)}</text>)}
      </svg>
      {active && <div className={`gmd-chart-tip is-below${hover! > bins.length / 2 ? " is-left" : ""}`} style={{ left: `${((hover! + 0.5) / bins.length) * 100}%`, top: "3%" }} role="status">
        <b>{money(value(active), value(active) < 1 ? 4 : 2)}</b>
        <span>{money(active.from)} – {money(active.to)}</span>
        {active.own > 0 && <small>Your own position: {money(active.own, active.own < 1 ? 4 : 2)}</small>}
        {(!own || !mine) && <small>v4 pool at the NAV: {money(active.v4, active.v4 < 1 ? 4 : 2)}</small>}
        {(!own || !mine) && <small>Constant product: {money(active.constantProduct, active.constantProduct < 1 ? 4 : 2)}</small>}
      </div>}
    </div>
    {mine && <>
      <dl className="gmd-strategy-facts">
        <div><dt>Within 2% of the NAV</dt><dd>{money(nearTotal)}<small>{deposit > 0 ? `${Math.round(nearTotal / deposit * 100)}% of your deposit meets the trades there` : "—"}</small></dd></div>
        {own ? <div><dt>Your position</dt><dd>{SHAPE_LABELS[own.shape]} · ±{own.rangePercent}%<small>{own.bins} bins of {(binTicksFor(own.rangePercent, own.bins) / 100).toFixed(1)}% · {SIDE_LABELS[own.sides].toLowerCase()}</small></dd></div>
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
