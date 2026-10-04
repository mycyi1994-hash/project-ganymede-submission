"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { formatShares } from "@/lib/demo/format";
import { formatSharePpm, type PoolLiquidity } from "@/lib/xstocks/liquidity";
import { Icon } from "./Icons";
import { useAsk } from "./AskUstx";

// The Pools page's pictures, drawn from the pool's reserves as read from X Layer: where the pool's
// liquidity sits by price (at a range the reader chooses), how a deposit of demo dollars flows in,
// and what a NAV move does to it against holding the same tokens. Each has its own Ask USTX
// questions, carrying the figures on screen. Nothing here is a forecast; every figure follows from
// the reserves. Motion stops for readers who ask for reduced motion (product.css).

const money = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const percent = (ratio: number) => `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(Math.round(ratio * 1000) / 10)}%`;

/** The plot's width in CSS pixels, so the chart draws at its real size and its text stays 12px on a phone too. */
export function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A chart's heading, with the button that asks Ask USTX to explain it with the figures on screen. */
export function ChartHead({ id, title, question, children }: { id: string; title: string; question: string; children?: ReactNode }) {
  const assistant = useAsk();
  return <div className="gmd-lq-head">
    <h3 id={id}>{title}</h3>
    {children}
    {assistant && <button type="button" className="gmd-lq-explain" onClick={() => assistant.ask(question)}><Icon name="spark" size={14} />Explain with AI</button>}
  </div>;
}

type Bin = { from: number; to: number; side: "dollars" | "shares"; amount: number; value: number };

/**
 * A constant-product pool's liquidity in equal price bands either side of its price, out to ±range.
 * Below the price it holds demo dollars, which buy USTX as the price falls; above it, USTX, which it
 * sells as the price rises. With L = √(USTX × dUSD): a band from a to b holds L(√b − √a) dUSD below
 * the price and L(1/√a − 1/√b) USTX above it.
 */
export function liquidityBins(pool: PoolLiquidity, range = 0.24, steps = 12): Bin[] {
  const shares = Number(pool.sharesMicros) / 1e6, dollars = Number(pool.dollarsMicros) / 1e6;
  if (!(shares > 0 && dollars > 0)) return [];
  const price = dollars / shares, l = Math.sqrt(shares * dollars), width = range / steps;
  const bins: Bin[] = [];
  for (let k = -steps; k < steps; k += 1) {
    const from = price * (1 + k * width), to = price * (1 + (k + 1) * width);
    if (k < 0) { const amount = l * (Math.sqrt(to) - Math.sqrt(from)); bins.push({ from, to, side: "dollars", amount, value: amount }); }
    else { const amount = l * (1 / Math.sqrt(from) - 1 / Math.sqrt(to)); bins.push({ from, to, side: "shares", amount, value: amount * (from + to) / 2 }); }
  }
  return bins;
}

const RANGES = [0.1, 0.24, 0.5, 0.9];

/** Where the pool's liquidity sits by price, with the pool's price and the NAV marked; a range to zoom out; a tooltip per band. */
export function LiquidityChart({ pool, nav, share, tall = false }: { pool: PoolLiquidity; nav: bigint | null; share: number | null; tall?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState(0.24);
  const title = useId();
  const [plotRef, W] = useWidth(900);
  const bins = liquidityBins(pool, range);
  if (!bins.length) return null;
  const H = tall ? 340 : W < 500 ? 210 : 240, top = 40, bottom = 28, plot = H - top - bottom;
  const low = bins[0].from, high = bins[bins.length - 1].to;
  const x = (price: number) => ((price - low) / (high - low)) * W;
  const max = Math.max(...bins.map(bin => bin.value));
  const slot = W / bins.length, bar = Math.min(24, slot * 0.66);
  const price = Number(pool.dollarsMicros) / Number(pool.sharesMicros);
  const navPrice = nav !== null ? Number(nav) / 1e6 : null;
  const navInside = navPrice !== null && navPrice > low && navPrice < high;
  const total = bins.reduce((sum, bin) => sum + bin.value, 0);
  const active = hover === null ? null : bins[hover];
  const question = `Explain the "Liquidity by price" chart on Pools in simple words. The constant-product USTX/dUSD pool trades at ${money(price)} and the NAV is ${navPrice !== null ? money(navPrice) : "not available"}. Between ${money(low)} and ${money(high)} it holds about ${money(total, 0)}: demo dollars below the price and USTX above it, in ${bins.length} bands of ${(range / 12 * 100).toFixed(1)}%. What does this mean for a trader and for a liquidity provider?`;
  const marker = (at: number, label: string, anchorLeft: boolean, row: number, kind: string) => <g className={`gmd-lq-marker is-${kind}`}>
    <line x1={x(at)} x2={x(at)} y1={top - 6} y2={H - bottom} />
    <circle cx={x(at)} cy={top - 6} r={4} />
    <text x={x(at) + (anchorLeft ? -8 : 8)} y={14 + row * 15} textAnchor={anchorLeft ? "end" : "start"}>{label}</text>
  </g>;
  const ticks = W < 500 ? [-range, 0, range] : [-range, -range / 2, 0, range / 2, range];
  return <figure className="gmd-lq" aria-labelledby={title}>
    <ChartHead id={title} title="Liquidity by price" question={question}>
      <div className="gmd-lq-range" role="group" aria-label="Price range">{RANGES.map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => { setRange(value); setHover(null); }}>±{Math.round(value * 100)}%</button>)}</div>
    </ChartHead>
    <ul className="gmd-lq-legend"><li><i className="is-dollars" aria-hidden="true" />dUSD, buys USTX if the price falls</li><li><i className="is-shares" aria-hidden="true" />USTX, sold if the price rises</li></ul>
    <div className="gmd-lq-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Liquidity in ${bins.length} price bands from ${money(low)} to ${money(high)}: demo dollars below the pool price of ${money(price)}, USTX above it.`}>
        <line className="gmd-lq-base" x1={0} x2={W} y1={H - bottom} y2={H - bottom} />
        {/* Keyed by range, so zooming plays the bars' rise again. */}
        <g key={range}>{bins.map((bin, index) => {
          const height = Math.max(2, (bin.value / max) * plot);
          const cx = index * slot + slot / 2, left = cx - bar / 2, base = H - bottom, r = Math.min(4, height);
          const distance = Math.abs(index + 0.5 - bins.length / 2);
          return <g key={index} className={`gmd-lq-bar is-${bin.side}${hover === index ? " is-active" : ""}`} style={{ ["--gmd-delay" as string]: `${Math.round(distance * 28)}ms` }}>
            <path d={`M${left},${base} V${base - height + r} Q${left},${base - height} ${left + r},${base - height} H${left + bar - r} Q${left + bar},${base - height} ${left + bar},${base - height + r} V${base} Z`} />
            <rect className="gmd-lq-hit" x={index * slot} y={top} width={slot} height={plot} tabIndex={0} aria-label={`${money(bin.from)} to ${money(bin.to)}: ${money(bin.value, 0)}`}
              onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
          </g>;
        })}</g>
        {marker(price, `Pool ${money(price)}`, navPrice !== null && navPrice > price, 0, "pool")}
        {navInside && marker(navPrice!, `NAV ${money(navPrice!)}`, navPrice! <= price, 1, "nav")}
        {ticks.map(move => <text key={move} className="gmd-lq-tick" x={x(price * (1 + move))} y={H - 8} textAnchor={move === -range ? "start" : move === range ? "end" : "middle"}>{move === 0 ? "now" : percent(move)}</text>)}
      </svg>
      {active && <div className={`gmd-chart-tip is-below${hover! > bins.length / 2 ? " is-left" : ""}`} style={{ left: `${((hover! + 0.5) / bins.length) * 100}%`, top: "3%" }} role="status">
        <b>{money(active.value, 0)}</b>
        <span>{active.side === "dollars" ? `${money(active.amount, 0)} dUSD` : `${active.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} USTX`}</span>
        <small>{money(active.from)} – {money(active.to)}</small>
        {share !== null && share > 0 && <small>Yours: {money(active.value * share, active.value * share < 1 ? 4 : 2)}</small>}
      </div>}
    </div>
    <figcaption className="gmd-caption">Read from the pool’s reserves on X Layer. A constant-product pool spreads its liquidity across every price, so each band holds a similar amount; zoom out to see it reach far from the price. The bands nearest the price trade first.</figcaption>
  </figure>;
}

type Split = { investMicros: bigint; sharesMicros: bigint; dollarsMicros: bigint };

/** How a deposit of demo dollars flows into the pool: part invested at the NAV, part deposited as it is, both into LP tokens. */
export function DepositFlow({ split, lpMicros, shareAfter }: { split: Split | null; lpMicros: bigint | null; shareAfter: bigint | null }) {
  const title = useId();
  const [plotRef, W] = useWidth(420);
  const total = split ? split.investMicros + split.dollarsMicros : 0n;
  const invested = split && total > 0n ? Number(split.investMicros * 10_000n / total) / 10_000 : 0.5;
  const H = 168, mid = H / 2, from = 22, splitX = W * 0.46, to = W - 22;
  const thick = (part: number) => split ? Math.max(3, Math.round(part * 22)) : 3;
  const upper = `M${from},${mid} C${from + 60},${mid} ${splitX - 60},${mid - 46} ${splitX},${mid - 46} S${to - 60},${mid} ${to},${mid}`;
  const lower = `M${from},${mid} C${from + 60},${mid} ${splitX - 60},${mid + 46} ${splitX},${mid + 46} S${to - 60},${mid} ${to},${mid}`;
  const question = split
    ? `On Pools I entered ${formatUsdMicros(total, 2)} to add as liquidity. ${formatUsdMicros(split.investMicros, 2)} buys ${formatShares(split.sharesMicros)} USTX at the NAV and ${formatUsdMicros(split.dollarsMicros, 2)} goes in as demo dollars, for ${lpMicros !== null ? formatShares(lpMicros) : "some"} USTX-LP. Explain step by step what happens and what I hold afterwards.`
    : "On Pools, what happens step by step when I add $1,000 of demo dollars as liquidity, and what do I hold afterwards?";
  return <section className={`gmd-deposit-preview${split ? "" : " is-empty"}`} aria-labelledby={title}>
    <ChartHead id={title} title={split ? `Your deposit of ${formatUsdRounded(total)}` : "Your deposit"} question={question} />
    <div className="gmd-flow" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={split ? `${formatUsdMicros(total, 2)} of demo dollars: ${formatUsdMicros(split.investMicros, 2)} buys USTX at the NAV, ${formatUsdMicros(split.dollarsMicros, 2)} goes in as demo dollars, both into the pool.` : "Enter an amount to see how it goes into the pool."}>
        <path className="gmd-flow-path is-shares" d={upper} style={{ strokeWidth: thick(invested) }} />
        <path className="gmd-flow-path is-dollars" d={lower} style={{ strokeWidth: thick(1 - invested) }} />
        {split && [0, 1, 2].map(index => <g key={index}>
          <circle className="gmd-flow-dot is-shares" r={4}><animateMotion dur="2.6s" begin={`${index * 0.85}s`} repeatCount="indefinite" path={upper} /></circle>
          <circle className="gmd-flow-dot is-dollars" r={4}><animateMotion dur="2.6s" begin={`${index * 0.85 + 0.4}s`} repeatCount="indefinite" path={lower} /></circle>
        </g>)}
        <circle className="gmd-flow-node" cx={from} cy={mid} r={9} />
        <circle className="gmd-flow-node is-pool" cx={to} cy={mid} r={11} />
        <text className="gmd-flow-label" x={splitX} y={mid - 58} textAnchor="middle">{split ? `${formatUsdMicros(split.investMicros, 2)} → ${formatShares(split.sharesMicros)} USTX` : "Buys USTX at the NAV"}</text>
        <text className="gmd-flow-label" x={splitX} y={mid + 68} textAnchor="middle">{split ? `${formatUsdMicros(split.dollarsMicros, 2)} as dUSD` : "Goes in as dUSD"}</text>
        <text className="gmd-flow-end" x={to} y={mid + 30} textAnchor="end">{lpMicros !== null ? `${formatShares(lpMicros)} LP` : "LP tokens"}</text>
      </svg>
    </div>
    <dl className="gmd-deposit-parts">
      <div><dt><i className="is-shares" aria-hidden="true" />Buys USTX at the NAV</dt><dd>{split ? formatUsdMicros(split.investMicros, 2) : "—"}<small>{split ? `${formatShares(split.sharesMicros)} USTX, no fee` : "no fee"}</small></dd></div>
      <div><dt><i className="is-dollars" aria-hidden="true" />Goes in as dUSD</dt><dd>{split ? formatUsdMicros(split.dollarsMicros, 2) : "—"}<small>at the pool’s ratio</small></dd></div>
      <div><dt>You receive</dt><dd>{lpMicros !== null ? `${formatShares(lpMicros)} USTX-LP` : "—"}<small>{shareAfter !== null ? `${formatSharePpm(shareAfter, true)} of the pool after` : "Enter an amount in the panel"}</small></dd></div>
    </dl>
  </section>;
}

const MOVES = Array.from({ length: 81 }, (_, index) => index - 30); // −30% … +50%

/** A deposit's value after the NAV moves and arbitrage brings the pool to it, against holding the same tokens: √r against (1 + r) / 2, with a month's fees at the current APR. */
export function NavMoveChart({ amount, aprPercent }: { amount: number; aprPercent: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const title = useId();
  const [plotRef, W] = useWidth(460);
  const H = 210, top = 14, bottom = 26, left = 6, right = 84;
  const pooled = (move: number) => amount * Math.sqrt(1 + move / 100);
  const held = (move: number) => amount * (2 + move / 100) / 2;
  const values = MOVES.flatMap(move => [pooled(move), held(move)]);
  const min = Math.min(...values), max = Math.max(...values);
  const x = (move: number) => left + ((move + 30) / 80) * (W - left - right);
  const y = (value: number) => top + (1 - (value - min) / (max - min || 1)) * (H - top - bottom);
  const line = (value: (move: number) => number) => MOVES.map((move, index) => `${index ? "L" : "M"}${x(move).toFixed(1)},${y(value(move)).toFixed(1)}`).join("");
  const gap = `${line(held)} ${MOVES.slice().reverse().map(move => `L${x(move).toFixed(1)},${y(pooled(move)).toFixed(1)}`).join("")} Z`;
  const at = hover === null ? null : MOVES[hover];
  const fees30 = aprPercent !== null ? amount * aprPercent / 100 * 30 / 365 : null;
  const question = `On Pools, the "If the NAV moves" chart: ${money(amount, 0)} deposited is worth ${money(pooled(20))} in the pool after the NAV rises 20%, against ${money(held(20))} holding both tokens, and ${money(pooled(-20))} against ${money(held(-20))} after a 20% fall.${fees30 !== null ? ` At the current fee APR of ${aprPercent}%, a month of fees on it is about ${money(fees30)}.` : ""} Explain impermanent loss in plain words and whether the fees can make up for it.`;
  return <figure className="gmd-navmove" aria-labelledby={title}>
    <ChartHead id={title} title="If the NAV moves" question={question} />
    <ul className="gmd-lq-legend"><li><i className="is-line-pool" aria-hidden="true" />In the pool</li><li><i className="is-line-held" aria-hidden="true" />Holding both</li></ul>
    <div className="gmd-lq-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${money(amount, 0)} deposited: after a NAV move of −30% to +50%, in the pool against holding both tokens, before fees.`}
        onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = ((event.clientX - box.left) / box.width * W - left) / (W - left - right); setHover(Math.max(0, Math.min(MOVES.length - 1, Math.round(ratio * 80)))); }}
        onPointerLeave={() => setHover(null)}>
        <line className="gmd-lq-base" x1={x(0)} x2={x(0)} y1={top} y2={H - bottom} />
        <path className="gmd-navmove-gap" d={gap} />
        <path className="gmd-navmove-held" d={line(held)} pathLength={1} />
        <path className="gmd-navmove-pool" d={line(pooled)} pathLength={1} />
        <text className="gmd-navmove-label" x={x(50) + 6} y={y(held(50)) - 4}>Holding</text>
        <text className="gmd-navmove-label" x={x(50) + 6} y={y(pooled(50)) + 12}>In the pool</text>
        {[-30, 0, 25, 50].map(move => <text key={move} className="gmd-lq-tick" x={x(move)} y={H - 8} textAnchor="middle">{move === 0 ? "0%" : `${move > 0 ? "+" : "−"}${Math.abs(move)}%`}</text>)}
        {at !== null && <g className="gmd-navmove-cross"><line x1={x(at)} x2={x(at)} y1={top} y2={H - bottom} /><circle className="is-held" cx={x(at)} cy={y(held(at))} r={4} /><circle className="is-pool" cx={x(at)} cy={y(pooled(at))} r={4} /></g>}
      </svg>
      {at !== null && <div className={`gmd-chart-tip is-below${hover! > 50 ? " is-left" : ""}`} style={{ left: `${(x(at) / W) * 100}%`, top: "3%" }} role="status">
        <b>{money(pooled(at))}</b><span>In the pool, NAV {at > 0 ? "+" : at < 0 ? "−" : ""}{Math.abs(at)}%</span>
        <small>Holding both: {money(held(at))}</small><small>Difference: {money(pooled(at) - held(at))}</small>
      </div>}
    </div>
    <figcaption className="gmd-caption">{fees30 !== null ? `Before fees: at the current fee APR, a month adds about ${money(fees30)}. ` : "Before fees, which add to the pool. "}An illustration, not a forecast.</figcaption>
  </figure>;
}

/** The three pictures at the full width of the window, for a closer look; Escape or the button closes it. */
export function PoolVisualsDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  return <div className="gmd-pool-dialog" role="dialog" aria-modal="true" aria-label="Pool charts, full width" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="gmd-pool-dialog-body">
      <header><h2>USTX / dUSD pool, up close</h2><button ref={close} type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button></header>
      {children}
    </div>
  </div>;
}

/** Ask USTX for the pool's pictures: questions that carry the figures on screen. */
export function PoolAsk({ questions }: { questions: { label: string; question: string }[] }) {
  const assistant = useAsk();
  if (!assistant) return null;
  return <aside className="gmd-pool-ask" aria-label="Ask USTX about these charts">
    <span className="gmd-ask-guide-mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
    <div><b>Not sure what you are looking at?</b><p>Ask USTX explains these charts with the pool’s figures right now.</p>
      <div className="gmd-ask-guide-actions">{questions.map(item => <button type="button" key={item.label} onClick={() => assistant.ask(item.question)}>{item.label}</button>)}</div>
    </div>
  </aside>;
}
