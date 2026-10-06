"use client";

import Link from "next/link";
import { useEffect, useId, useState, type CSSProperties } from "react";
import type { FundDetail } from "@/lib/funds/api";
import { incomeFund, INCOME_FUNDS, type FundDefinition } from "@/lib/funds/catalog";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { INCOME_TERMS, type AutocallTerms, type CoveredCallTerms } from "@/lib/income/terms";
import { coveredCallReturn, premiumYield, type CoveredCallDocument } from "@/lib/income/covered-call";
import { couponPayout, observationDate, type AutocallDocument } from "@/lib/income/autocall";
import { verifyIncomeSnapshot, type IncomeDocument, type IncomeVerification } from "@/lib/income/verify";
import { useFundResource } from "./useFundResource";
import { FundClosed, FundList, KIND_LABELS, NavLine } from "./Funds";
import MarketChart from "./MarketChart";
import { ChartHead, useWidth } from "./ChartParts";
import { AssetMark, Icon } from "./Icons";
import { OkxSource } from "./OkxSource";

// The income products: two covered-call funds and a step-down autocallable note (ELS) on SPYx and
// QQQx. Each page reads its record and documents from GET /api/v1/funds, checks the record and the
// records it rests on against X Layer in the browser, and draws the product's payoff from the
// document. Demo dollars only.

const money = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`;
const signed = (ratio: number, digits = 1) => `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(ratio * 100).toFixed(digits)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const txUrl = (hash: string | null | undefined) => hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${hash}` : null;

/** A product's last check stays while its refreshed response is checked, never for another product. */
function useIncomeCheck(fund: FundDetail | null, id: string): IncomeVerification {
  const [state, setState] = useState<{ fund: FundDetail; check: IncomeVerification } | null>(null);
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    verifyIncomeSnapshot(fund, id).then(check => { if (!cancelled) setState({ fund, check }); }).catch(() => { if (!cancelled) setState({ fund, check: { result: "unavailable", detail: "X Layer could not be read just now." } }); });
    return () => { cancelled = true; };
  }, [fund, id]);
  return fund?.id === id && state?.fund.id === id ? state.check : { result: "checking", detail: "Reading the record on X Layer…" };
}

/** The latest document this page has, before or without the check (the check's own when it matched). */
function latestDocument(fund: FundDetail | null, check: IncomeVerification): IncomeDocument | null {
  if (check.document) return check.document;
  const entry = fund?.history.find(item => item.status === "confirmed") ?? fund?.history[0];
  try { return entry ? JSON.parse(entry.canonical) as IncomeDocument : null; } catch { return null; }
}

/**
 * The covered call's return from today's NAV to this call's expiry against holding the ETF, by the
 * ETF's move from today's price: capped above the strike, cushioned by what the call is still worth.
 * Counting from today keeps it right once the ETF has moved since the call was sold.
 */
function CoveredCallPayoff({ document }: { document: CoveredCallDocument }) {
  const [hover, setHover] = useState<number | null>(null);
  const title = useId();
  const [ref, W] = useWidth(640);
  const price = document.underlying.price;
  const nav = Number(document.navPerShareMicros) / 1e6;
  const callShare = nav > 0 ? document.units * document.call.value / nav : 0;
  const strikeMove = document.call.strike / price - 1;
  const moves = Array.from({ length: 61 }, (_, index) => (index - 30) / 200); // −15% … +15%
  const covered = (move: number) => coveredCallReturn(document, move);
  const H = 230, top = 16, bottom = 28, left = 44, right = 12;
  const lo = -0.16, hi = 0.16;
  const x = (move: number) => left + (move + 0.15) / 0.3 * (W - left - right);
  const y = (value: number) => top + (hi - value) / (hi - lo) * (H - top - bottom);
  const path = (fn: (move: number) => number) => moves.map((move, index) => `${index ? "L" : "M"}${x(move).toFixed(1)},${y(fn(move)).toFixed(1)}`).join("");
  const at = hover === null ? null : moves[hover];
  const question = `On the ${document.underlying.symbol} covered call fund, the fund has sold a call at ${money(document.call.strike)} that expires on ${day(document.call.expiresAt)}. The ETF is at ${money(price)} now, and the call is worth ${pct(callShare, 2)} of the fund. Explain in plain words what the fund earns from today's NAV if the ETF rises 10%, stays flat, or falls 10% by then.`;
  return <figure className="gmd-navmove gmd-income-chart" aria-labelledby={title}>
    <ChartHead id={title} title="From today to this call's expiry" question={question} />
    <ul className="gmd-lq-legend"><li><i className="is-line-pool" aria-hidden="true" />Covered call</li><li><i className="is-line-held" aria-hidden="true" />Holding the ETF</li></ul>
    <div className="gmd-lq-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Return from today's NAV to ${day(document.call.expiresAt)}: the covered call earns the ETF's move up to the strike, ${signed(strikeMove)} from today's price, and keeps what the call is still worth; holding the ETF earns its move.`}
        onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = ((event.clientX - box.left) / box.width * W - left) / (W - left - right); setHover(Math.max(0, Math.min(moves.length - 1, Math.round(ratio * 60)))); }} onPointerLeave={() => setHover(null)}>
        {[-0.1, 0, 0.1].map(value => <g key={value}><line className="gmd-lq-base" x1={left} x2={W - right} y1={y(value)} y2={y(value)} /><text className="gmd-lq-tick" x={left - 6} y={y(value) + 4} textAnchor="end">{signed(value, 0)}</text></g>)}
        <line className="gmd-income-strike" x1={x(strikeMove)} x2={x(strikeMove)} y1={top} y2={H - bottom} />
        <text className="gmd-lq-tick" x={x(strikeMove) + 6} y={top + 10}>Strike {money(document.call.strike)}</text>
        <path className="gmd-navmove-held" d={path(move => move)} pathLength={1} />
        <path className="gmd-navmove-pool" d={path(covered)} pathLength={1} />
        {[-0.15, 0, 0.15].map(move => <text key={move} className="gmd-lq-tick" x={x(move)} y={H - 8} textAnchor="middle">{move === 0 ? "ETF flat" : signed(move, 0)}</text>)}
        {at !== null && <g className="gmd-navmove-cross"><line x1={x(at)} x2={x(at)} y1={top} y2={H - bottom} /><circle className="is-held" cx={x(at)} cy={y(at)} r={4} /><circle className="is-pool" cx={x(at)} cy={y(covered(at))} r={4} /></g>}
      </svg>
      {at !== null && <div className={`gmd-chart-tip is-below${hover! > 30 ? " is-left" : ""}`} style={{ left: `${(x(at) / W) * 100}%`, top: "3%" }} role="status"><b>Covered call {signed(covered(at), 2)}</b><span>If the ETF moves {signed(at, 1)} from today by expiry</span><small>Holding the ETF: {signed(at, 2)}</small><small>{at > strikeMove ? `Capped at the strike, ${signed(strikeMove, 1)} from today` : `${signed(covered(at) - at, 2)} against holding: the call expires unpaid`}</small></div>}
    </div>
    <figcaption className="gmd-caption">From today&rsquo;s NAV to {day(document.call.expiresAt)}, when this call settles and the next one is sold. The call is valued by Black–Scholes at {pct(document.terms.volatility, 0)} volatility: there is no options market for xStocks on X Layer.</figcaption>
  </figure>;
}

/**
 * The note's life on one time axis: the early-repayment zone above each observation's barrier, the
 * knock-in zone below 50%, what each observation pays if the worse index is at or above its step,
 * and where the worse index is now, at today's place between the start and maturity.
 */
function AutocallPath({ document, terms, tall = false }: { document: AutocallDocument; terms: AutocallTerms; tall?: boolean }) {
  const title = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(tall ? 1100 : 640);
  const narrow = W < 560;
  const H = tall ? (narrow ? 340 : 420) : 300, top = 34, bottom = narrow ? 50 : 58, left = narrow ? 42 : 56, right = narrow ? 14 : 28;
  const n = terms.barriers.length;
  const start = Date.parse(document.state.fixedAt);
  const dates = Array.from({ length: n + 1 }, (_, index) => index === 0 ? document.state.fixedAt : observationDate(terms, document.state.fixedAt, index));
  const end = Date.parse(dates[n]);
  const x = (at: number) => left + (at - start) / (end - start) * (W - left - right);
  const xi = (index: number) => x(Date.parse(dates[index]));
  const lo = 0.3, hi = 1.15;
  const y = (level: number) => top + (hi - level) / (hi - lo) * (H - top - bottom);
  const steps = terms.barriers.map((barrier, index) => `${index ? "L" : "M"}${xi(index).toFixed(1)},${y(barrier).toFixed(1)} L${xi(index + 1).toFixed(1)},${y(barrier).toFixed(1)}`).join(" ");
  const zone = `${steps} L${xi(n).toFixed(1)},${y(hi).toFixed(1)} L${xi(0).toFixed(1)},${y(hi).toFixed(1)} Z`;
  const nowAt = Math.min(end, Math.max(start, Date.parse(document.asOf)));
  const nowX = x(nowAt), nowY = y(Math.max(lo, Math.min(hi, document.worst)));
  const elapsed = (nowAt - start) / (end - start);
  const active = hover === null ? null : hover;
  const question = `Explain this autocallable note (ELS) in plain words. It started on ${day(document.state.fixedAt)}; the worse of the S&P 500 and the Nasdaq-100 is at ${pct(document.worst)} of its start. ${document.nextObservation ? `At the next observation on ${day(document.nextObservation.date)} it pays back ${money(document.nextObservation.payIfCalled)} per $100 if the worse index is at or above ${pct(document.nextObservation.barrier, 0)}.` : ""} The knock-in is at ${pct(terms.knockIn, 0)}${document.state.knockedIn ? " and has been hit" : " and has not been hit"}. When would I get my money back, and what could I lose?`;
  return <figure className={`gmd-navmove gmd-income-chart gmd-autocall-path${tall ? " is-tall" : ""}`} aria-labelledby={title}>
    <ChartHead id={title} title="Barriers and where the note stands" question={question} />
    <ul className="gmd-lq-legend"><li><i className="is-zone-call" aria-hidden="true" />Paid back early here</li><li><i className="is-line-pool" aria-hidden="true" />Barrier at each observation</li><li><i className="is-dollars" aria-hidden="true" />Worse index now</li><li><i className="is-zone-loss" aria-hidden="true" />Knock-in zone, below {pct(terms.knockIn, 0)}</li></ul>
    <div className="gmd-lq-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Over three years from ${day(document.state.fixedAt)}: barriers ${terms.barriers.map(b => pct(b, 0)).join(", ")} at six-monthly observations, paying ${terms.barriers.map((_, index) => money(couponPayout(terms, index + 1))).join(", ")} per $100; knock-in ${pct(terms.knockIn, 0)}; the worse index is at ${pct(document.worst)} today.`}>
        <path className="gmd-autocall-zone" d={zone} />
        <rect className="gmd-autocall-loss" x={xi(0)} y={y(terms.knockIn)} width={xi(n) - xi(0)} height={y(lo) - y(terms.knockIn)} />
        <rect className="gmd-income-done" x={xi(0)} y={top} width={Math.max(0, nowX - xi(0))} height={H - top - bottom} />
        {[1, 0.9, 0.75, 0.5].map(level => <g key={level}><line className="gmd-lq-base" x1={left} x2={W - right} y1={y(level)} y2={y(level)} /><text className="gmd-lq-tick" x={left - 8} y={y(level) + 4} textAnchor="end">{pct(level, 0)}</text></g>)}
        <line className="gmd-income-ki" x1={left} x2={W - right} y1={y(terms.knockIn)} y2={y(terms.knockIn)} />
        <text className="gmd-autocall-ki-label" x={W - right - 4} y={y(terms.knockIn) + 16} textAnchor="end">Knock-in {pct(terms.knockIn, 0)}: below it, capital at risk at maturity</text>
        <path className="gmd-navmove-pool gmd-autocall-steps" d={steps} pathLength={1} />
        {terms.barriers.map((barrier, index) => {
          const cx = xi(index + 1), seen = document.state.observations[index];
          return <g key={index} className={`gmd-autocall-obs${active === index ? " is-active" : ""}${seen ? seen.called ? " is-called" : " is-missed" : ""}`}>
            <line x1={cx} x2={cx} y1={y(barrier)} y2={H - bottom} />
            <circle cx={cx} cy={y(barrier)} r={5} />
            <text className="gmd-autocall-barrier" x={cx - 6} y={y(barrier) - 8} textAnchor="end">{pct(barrier, 0)}</text>
            <text className="gmd-lq-tick" x={cx} y={H - bottom + 18} textAnchor={index + 1 === n ? "end" : "middle"}>{narrow ? `${(index + 1) * terms.observationMonths}m` : index + 1 === n ? "3 years" : `${(index + 1) * terms.observationMonths} months`}</text>
            <text className="gmd-autocall-pay" x={cx} y={H - bottom + 36} textAnchor={index + 1 === n ? "end" : "middle"}>{money(couponPayout(terms, index + 1), narrow ? 0 : 2)}</text>
            <rect className="gmd-lq-hit" x={xi(index)} y={top} width={xi(index + 1) - xi(index)} height={H - top - bottom} tabIndex={0} aria-label={`Observation ${index + 1}, ${day(dates[index + 1])}: barrier ${pct(barrier, 0)}, pays ${money(couponPayout(terms, index + 1))} per $100 if the worse index is at or above it`}
              onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
          </g>;
        })}
        <line className="gmd-income-now-trail" x1={xi(0)} x2={nowX} y1={nowY} y2={nowY} />
        <line className="gmd-income-now-mark" x1={nowX} x2={nowX} y1={top - 8} y2={H - bottom} />
        <circle className="gmd-income-dot" cx={nowX} cy={nowY} r={7} />
        <text className="gmd-autocall-now" x={nowX + 12} y={nowY - 12}>Today: worse index {pct(document.worst)}</text>
        <text className="gmd-lq-tick" x={xi(0)} y={H - bottom + 18} textAnchor="start">{narrow ? "Start" : `Start ${day(document.state.fixedAt)}`}</text>
      </svg>
      {active !== null && <div className={`gmd-chart-tip is-below${active > n / 2 ? " is-left" : ""}`} style={{ left: `${(xi(active + 1) / W) * 100}%`, top: "3%" }} role="status">
        <b>{money(couponPayout(terms, active + 1))}</b><span>Observation {active + 1} · {day(dates[active + 1])}</span>
        <small>Paid back if the worse index is at or above {pct(terms.barriers[active], 0)}</small>
        {document.state.observations[active] && <small>Observed at {pct(document.state.observations[active].worst)}: {document.state.observations[active].called ? "called" : "not called"}</small>}
      </div>}
    </div>
    <figcaption className="gmd-caption">{pct(elapsed, 1)} of the term has passed. At each six-month observation the note pays back early if the worse index is at or above that step; the steps fall from {pct(terms.barriers[0], 0)} to {pct(terms.barriers[n - 1], 0)}. Below {pct(terms.knockIn, 0)}, capital is at risk at maturity.</figcaption>
  </figure>;
}

/** The six observations as steps: each one's barrier, what it pays, and whether it is next, called or passed. */
function AutocallSteps({ document, terms }: { document: AutocallDocument; terms: AutocallTerms }) {
  const next = document.nextObservation?.index ?? null;
  return <ol className="gmd-autocall-stepper" aria-label="Observations">
    {terms.barriers.map((barrier, index) => {
      const seen = document.state.observations[index];
      const state = seen ? seen.called ? "is-called" : "is-missed" : next === index + 1 ? "is-next" : "";
      return <li key={index} className={state} style={{ "--gmd-step": `${Math.round((barrier - 0.4) / 0.6 * 100)}%`, "--gmd-delay": `${index * 70}ms` } as CSSProperties}>
        <span className="gmd-autocall-stepper-bar" aria-hidden="true"><i /></span>
        <b>{pct(barrier, 0)}</b>
        <small>{(index + 1) * terms.observationMonths} months</small>
        <strong>{money(couponPayout(terms, index + 1))}</strong>
        <em>{seen ? seen.called ? "Called" : `Observed ${pct(seen.worst)}` : next === index + 1 ? day(observationDate(terms, document.state.fixedAt, index + 1)) : "\u00a0"}</em>
      </li>;
    })}
  </ol>;
}

/** What the note pays at maturity by the worse index's level, with and without a knock-in. */
function AutocallPayoff({ terms }: { terms: AutocallTerms }) {
  const [hover, setHover] = useState<number | null>(null);
  const title = useId();
  const [ref, W] = useWidth(640);
  const H = 220, top = 16, bottom = 28, left = 48, right = 12;
  const levels = Array.from({ length: 121 }, (_, index) => 0.2 + index / 100); // 20% … 140%
  const full = couponPayout(terms, terms.barriers.length);
  const last = terms.barriers[terms.barriers.length - 1];
  const notIn = (level: number) => level >= terms.knockIn ? full : terms.face * level;
  const knocked = (level: number) => level >= last ? full : terms.face * level;
  const x = (level: number) => left + (level - 0.2) / 1.2 * (W - left - right);
  const y = (value: number) => top + (130 - value) / 120 * (H - top - bottom);
  const path = (fn: (level: number) => number) => levels.map((level, index) => `${index ? "L" : "M"}${x(level).toFixed(1)},${y(fn(level)).toFixed(1)}`).join("");
  const at = hover === null ? null : levels[hover];
  const question = `On this step-down note, at maturity it pays ${money(full)} per $100 unless the worse index ever fell below ${pct(terms.knockIn, 0)} and ends below ${pct(last, 0)}; then it pays $100 times the worse index's level. Explain with examples what I would get at maturity.`;
  return <figure className="gmd-navmove gmd-income-chart" aria-labelledby={title}>
    <ChartHead id={title} title="At maturity, per $100" question={question} />
    <ul className="gmd-lq-legend"><li><i className="is-line-pool" aria-hidden="true" />Never knocked in</li><li><i className="is-dollars" aria-hidden="true" />After a knock-in</li></ul>
    <div className="gmd-lq-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pays ${money(full)} at maturity unless it knocked in below ${pct(terms.knockIn, 0)} and ends below ${pct(last, 0)}; then $100 times the worse index's level.`}
        onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const ratio = ((event.clientX - box.left) / box.width * W - left) / (W - left - right); setHover(Math.max(0, Math.min(levels.length - 1, Math.round(ratio * 120)))); }} onPointerLeave={() => setHover(null)}>
        {[50, 100, full].map(value => <g key={value}><line className="gmd-lq-base" x1={left} x2={W - right} y1={y(value)} y2={y(value)} /><text className="gmd-lq-tick" x={left - 6} y={y(value) + 4} textAnchor="end">{money(value, 0)}</text></g>)}
        <path className="gmd-income-knocked" d={path(knocked)} pathLength={1} />
        <path className="gmd-navmove-pool" d={path(notIn)} pathLength={1} />
        {[0.5, 0.75, 1, 1.4].map(level => <text key={level} className="gmd-lq-tick" x={x(level)} y={H - 8} textAnchor="middle">{pct(level, 0)}</text>)}
        {at !== null && <g className="gmd-navmove-cross"><line x1={x(at)} x2={x(at)} y1={top} y2={H - bottom} /><circle className="is-pool" cx={x(at)} cy={y(notIn(at))} r={4} /><circle className="is-held" cx={x(at)} cy={y(knocked(at))} r={4} /></g>}
      </svg>
      {at !== null && <div className={`gmd-chart-tip is-below${hover! > 60 ? " is-left" : ""}`} style={{ left: `${(x(at) / W) * 100}%`, top: "3%" }} role="status"><b>{money(notIn(at))}</b><span>Worse index at {pct(at, 0)}, never knocked in</span><small>After a knock-in: {money(knocked(at))}</small></div>}
    </div>
    <figcaption className="gmd-caption">Before maturity the note can pay back early at any six-month observation. Nothing hedges it: it pays from recorded prices, in demo dollars.</figcaption>
  </figure>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

/** One income product's page. */
export function IncomeScreen({ id }: { id: string }) {
  const definition = incomeFund(id);
  const { data, error: failed } = useFundResource<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(id)}`);
  const fund = data?.fund ?? null;
  const check = useIncomeCheck(fund, id);
  useEffect(() => { if (definition) document.title = `${definition.name} (${definition.ticker}) · Ganymede`; }, [definition]);
  if (!definition) return null;
  const terms = INCOME_TERMS[id];
  const latest = latestDocument(fund, check);
  const nav = check.record?.navPerShareMicros ?? null;
  const note = terms.kind === "autocall" && latest?.kind === "autocall" ? latest : null;
  const call = terms.kind === "covered-call" && latest?.kind === "covered-call" ? latest : null;
  const closed = note ? note.state.status !== "live" ? "This note has ended and takes no new money." : Date.parse(note.asOf) > Date.parse(note.subscriptionEndsAt) ? `Subscriptions closed on ${day(note.subscriptionEndsAt)}.` : null : null;
  const notOpen = `${terms.kind === "autocall" ? "Subscribing to" : "Investing in"} ${definition.ticker} is not open yet. Its value is recorded on X Layer every five minutes, so you can follow it and check it here.`;
  return <>
    <Link className="gmd-breadcrumb" prefetch={false} href="/?category=income"><Icon name="back" size={16} />Income &amp; structured</Link>
    <div className="gmd-page-heading"><div><span className="gmd-ticker">{definition.ticker} <span>{KIND_LABELS[definition.kind ?? "basket"]}</span></span><h1>{definition.name}</h1><p>{definition.description}</p></div><span className="gmd-badge">Demo product · model pricing</span></div>
    {failed && <p className="gmd-inline-error" role="status">This product could not be read just now. Reload the page in a moment.</p>}
    <div className="gmd-fund-layout">
      <div className="gmd-fund-main">
        <section className="gmd-fund-hero" aria-label={`${definition.name} value`}>
          <div><span>{terms.kind === "autocall" ? "Value per note / USD" : "NAV per share / USD"}</span><strong>{nav ? formatUsdMicros(nav, terms.kind === "autocall" ? 2 : 4) : "—"}</strong><small>{check.record ? `Recorded ${shortTime(check.record.effectiveAt)}` : "Waiting for a verified record"}</small></div>
          <div className="gmd-fund-hero-side"><OkxSource>Priced by OKX OnchainOS</OkxSource>{txUrl(fund?.nav?.txHash) && <a className="gmd-inline-tx" href={txUrl(fund?.nav?.txHash)!} target="_blank" rel="noreferrer">Recorded on X Layer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>}</div>
          {terms.kind === "covered-call" && <NavLine series={fund?.series ?? []} label={`${definition.name} NAV over the last seven days`} />}
        </section>
        <section className={`gmd-evidence-summary is-${check.result === "matched" ? "matched" : check.result === "failed" ? "failed" : "waiting"}`} aria-live="polite">
          <div className="gmd-evidence-icon"><Icon name={check.result === "matched" ? "check" : "info"} size={24} /></div>
          <div><h2>{{ matched: "Value verified on X Layer", failed: "This value could not be verified", unavailable: "Verification unavailable", checking: "Checking the latest record…" }[check.result]}</h2><p>{check.detail}</p></div>
        </section>
        {call && <section className="gmd-income-section" aria-labelledby="call-title">
          <header className="gmd-section-heading"><div><h2 id="call-title">This month&rsquo;s call</h2><p>The fund holds {call.underlying.symbol} and has sold one call on it, until {day(call.call.expiresAt)}.</p></div><span className="gmd-fund-asset"><AssetMark symbol={call.underlying.symbol} /></span></header>
          <div className="gmd-pools-summary-stats gmd-income-tiles">
            <Tile label={`${call.underlying.symbol} price`} value={money(call.underlying.price)} note={`Recorded ${shortTime(call.asOf)}`} />
            <Tile label="Strike" value={money(call.call.strike)} note={`${signed(call.call.strike / call.underlying.price - 1)} from the price now`} />
            <Tile label="Premium this month" value={pct(premiumYield(call).month, 2)} note={`About ${pct(premiumYield(call).annualized)} a year if every month paid the same`} />
            <Tile label="Expires" value={day(call.call.expiresAt)} note={`${Math.max(0, Math.ceil((Date.parse(call.call.expiresAt) - Date.parse(call.asOf)) / 86_400_000))} days left · ${call.rolls} ${call.rolls === 1 ? "roll" : "rolls"} so far`} />
          </div>
          <CoveredCallPayoff document={call} />
        </section>}
        {note && terms.kind === "autocall" && <section className="gmd-income-section" aria-labelledby="note-title">
          <header className="gmd-section-heading"><div><h2 id="note-title">Where the note stands</h2><p>Started on {day(note.state.fixedAt)} at {terms.underlyings.map(symbol => `${symbol} ${money(note.state.initial[symbol])}`).join(" and ")}.</p></div><span className="gmd-fund-asset">{terms.underlyings.map(symbol => <AssetMark key={symbol} symbol={symbol} />)}</span></header>
          <div className="gmd-pools-summary-stats gmd-income-tiles">
            {terms.underlyings.map(symbol => <Tile key={symbol} label={`${symbol} vs start`} value={pct(note.performance[symbol])} note={money(note.prices[symbol])} />)}
            <Tile label="Knock-in" value={note.state.knockedIn ? "Hit" : "Not hit"} note={note.state.knockedIn ? `On ${day(note.state.knockedInAt!)}` : `The worse index is ${pct(note.worst - terms.knockIn)} above ${pct(terms.knockIn, 0)}`} />
            <Tile label={note.state.status === "live" ? "Next observation" : note.state.status === "called" ? "Called" : "Matured"} value={note.nextObservation ? day(note.nextObservation.date) : money(note.state.payout ?? 0)} note={note.nextObservation ? `Pays ${money(note.nextObservation.payIfCalled)} if at or above ${pct(note.nextObservation.barrier, 0)}` : "Per note, on its final record"} />
          </div>
          <AutocallPath document={note} terms={terms} tall />
          <div className="gmd-data-table-scroll"><table className="gmd-table"><caption className="gmd-sr-only">Observation schedule</caption><thead><tr><th>Observation</th><th>Date</th><th>Barrier</th><th>Pays per $100 if called</th><th>Result</th></tr></thead><tbody>
            {terms.barriers.map((barrier, index) => { const seen = note.state.observations[index]; return <tr key={index}><th scope="row">{index + 1}</th><td>{day(observationDate(terms, note.state.fixedAt, index + 1))}</td><td>{pct(barrier, 0)}</td><td>{money(couponPayout(terms, index + 1))}</td><td>{seen ? (seen.called ? `Called at ${pct(seen.worst)}` : `Not called (${pct(seen.worst)})`) : "—"}</td></tr>; })}
          </tbody></table></div>
        </section>}
        {terms.kind === "autocall" && <section className="gmd-income-section" aria-label="Payoff"><AutocallPayoff terms={terms} /></section>}
        {!latest && <p className="gmd-caption">The first record is written within five minutes of the product&rsquo;s launch{terms.kind === "autocall" ? ", and fixes the note’s starting levels" : ""}.</p>}
        <section className="gmd-terms"><h2>How {definition.ticker} works</h2><dl className="gmd-facts">
          {terms.kind === "covered-call" ? <CoveredCallFacts terms={terms} /> : <AutocallFacts terms={terms} />}
          <div><dt>Records</dt><dd>Value and its document published on X Layer Testnet every five minutes; your browser recomputes the value from the document and checks the records it rests on ({terms.kind === "covered-call" ? "each call’s sale" : "the fixing, any knock-in and each observation"}) against their own transactions</dd></div>
        </dl><p className="gmd-caption">A demo product on X Layer Testnet. Its value is a model with no money behind it; it is not an offer, a security or investment advice.</p></section>
      </div>
      <FundClosed ticker={definition.ticker} note={closed ?? notOpen} />
    </div>
  </>;
}

function CoveredCallFacts({ terms }: { terms: CoveredCallTerms }) {
  return <>
    <div><dt>Holds</dt><dd>{terms.underlying}, the {terms.underlying === "SPYx" ? "S&P 500" : "Nasdaq-100"} ETF xStock, priced by OKX OnchainOS</dd></div>
    <div><dt>Each month</dt><dd>Sells a {terms.tenorDays}-day call {pct(terms.moneyness, 0)} above the price and keeps the premium; at expiry the call settles in cash and everything goes back into the ETF</dd></div>
    <div><dt>Option pricing</dt><dd>Black–Scholes at {pct(terms.volatility, 0)} volatility and a {pct(terms.rate, 0)} rate, marked at every record. There is no options market for xStocks on X Layer, so the fund writes the call in the model</dd></div>
    <div><dt>Like</dt><dd>Covered-call ETFs on the same indices, such as XYLD and QYLD, and Cboe&rsquo;s BXM buy-write index</dd></div>
    <div><dt>Orders</dt><dd>Not open yet: investing runs only on X Layer Testnet, from your own wallet</dd></div>
  </>;
}

function AutocallFacts({ terms }: { terms: AutocallTerms }) {
  return <>
    <div><dt>Underlyings</dt><dd>The worse of {terms.underlyings.join(" and ")} against their starting levels</dd></div>
    <div><dt>Term</dt><dd>Three years, observed every {terms.observationMonths} months</dd></div>
    <div><dt>Early repayment</dt><dd>Barriers {terms.barriers.map(b => pct(b, 0)).join(" · ")}; called at face plus {pct(terms.couponPerYear * terms.observationMonths / 12)} per half-year ({pct(terms.couponPerYear, 0)} a year)</dd></div>
    <div><dt>Knock-in</dt><dd>{pct(terms.knockIn, 0)} of the starting level, checked at every record; only then is capital at risk at maturity</dd></div>
    <div><dt>Orders</dt><dd>Not open yet: subscriptions would run on X Layer Testnet, from your own wallet, at ${terms.face} a note. Not sold back early: it pays automatically when called or at maturity</dd></div>
    <div><dt>Like</dt><dd>Korean step-down ELS on two indices; here it pays from recorded prices and nothing hedges it</dd></div>
  </>;
}

/** The status line of a product's record, as on the basket cards. */
const STATUS = { matched: "Value checked on X Layer", checking: "Confirming the value…", failed: "Value needs attention", unavailable: "Value check unavailable" } as const;

/** One row of a feature card's side panel. */
function Row({ label, value, note, mark }: { label: string; value: string; note?: string; mark?: string }) {
  return <li><div className="gmd-income-row">{mark ? <AssetMark symbol={mark} /> : <span className="gmd-income-row-dot" aria-hidden="true" />}<span className="gmd-income-row-label"><b>{label}</b>{note && <small>{note}</small>}</span><b className="gmd-income-row-value">{value}</b></div></li>;
}

/** The selected income or structured product on Markets: its value, record, chart and where it stands, as the basket card shows a basket. */
function IncomeMarketPreview({ definition }: { definition: FundDefinition }) {
  const { data, error, reload } = useFundResource<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(definition.id)}`);
  const fund = data?.fund ?? null;
  const check = useIncomeCheck(fund, definition.id);
  const latest = latestDocument(fund, check);
  const terms = INCOME_TERMS[definition.id];
  const record = check.record ?? null;
  const loading = !fund && !error;
  const call = latest?.kind === "covered-call" ? latest : null;
  const note = latest?.kind === "autocall" ? latest : null;
  const points = (fund?.series ?? []).map(([at, micros]) => ({ at: new Date(at * 1_000).toISOString(), micros, hash: "" }));
  const yields = call ? premiumYield(call) : null;
  return <>
    <div className="gmd-market-primary">
      <div className="gmd-feature-title"><div className="gmd-product-identity is-compact"><div className={`gmd-product-monogram is-${terms.kind}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">{definition.ticker} <span>{KIND_LABELS[definition.kind ?? "basket"]}</span></span><h2>{definition.name}</h2><p>{definition.description}</p></div></div><Link prefetch={false} className="gmd-button" href={definition.href}>View {terms.kind === "autocall" ? "note" : "fund"} <Icon name="arrow" size={18} /></Link></div>
      <div className="gmd-nav-summary"><div><span className="gmd-label">{terms.kind === "autocall" ? "Value per note" : "NAV per share"} <span>/ USD</span></span><strong className="gmd-value">{record ? formatUsdMicros(record.navPerShareMicros, terms.kind === "autocall" ? 2 : 4) : loading ? <><i className="gmd-skeleton is-hero" aria-hidden="true" /><span className="gmd-sr-only">Loading</span></> : "—"}</strong></div><div className="gmd-nav-meta"><OkxSource>Priced by OKX OnchainOS</OkxSource><span role="status" className={`gmd-status ${check.result === "matched" ? "is-positive" : "is-waiting"}`}><i />{error ? "Value unavailable" : STATUS[check.result]}</span>{record && <time dateTime={record.effectiveAt ?? undefined}>{shortTime(record.effectiveAt)}</time>}</div></div>
      {error && <div className="gmd-data-notice" role="status"><span>This product could not be loaded just now.</span><button type="button" onClick={() => void reload()}>Try again</button></div>}
      <dl className="gmd-fund-stats" aria-label={`${definition.ticker} figures`} aria-busy={loading}>
        <div><dt>Launched</dt><dd>{latest ? day(latest.kind === "autocall" ? latest.state.fixedAt : latest.startedAt) : "—"}</dd></div>
        <div><dt>Recorded on X Layer</dt><dd>Every 5 minutes</dd></div>
        {terms.kind === "covered-call" ? <div><dt>Premium this month</dt><dd>{yields ? `${pct(yields.month, 2)} · ${pct(yields.annualized)} a year` : "—"}</dd></div>
          : <div><dt>Coupon</dt><dd>{pct(terms.couponPerYear, 0)} a year · knock-in {pct(terms.knockIn, 0)}</dd></div>}
      </dl>
      {terms.kind === "covered-call" ? <MarketChart points={points} loading={loading} showActivity={false} historyLabel="Past 7 days" />
        : note && terms.kind === "autocall" ? <AutocallSteps document={note} terms={terms} /> : <div className="gmd-lq is-loading" aria-busy="true"><i className="gmd-skeleton gmd-lq-skeleton" aria-hidden="true" /></div>}
      <div className="gmd-feature-bottom">{terms.kind === "covered-call"
        ? <span>Monthly call <i /> {pct(terms.moneyness, 0)} above the price <i /> {pct(terms.volatility, 0)} volatility <i /> Min. $10</span>
        : <span>Three years <i /> Observed every {terms.observationMonths} months <i /> Barriers {terms.barriers.map(b => pct(b, 0)).join("·")} <i /> ${terms.face} a note</span>}<span className="gmd-badge">Demo product</span></div>
    </div>
    <div className="gmd-market-composition"><section className="gmd-holdings is-compact" aria-label={`${definition.name} position`}>
      {call ? <>
        <header className="gmd-section-heading"><div><h2>This month&rsquo;s call</h2><p>Sold {day(call.call.soldAt)} · expires {day(call.call.expiresAt)}</p></div></header>
        <div className="gmd-income-meter" role="img" aria-label={`Price ${money(call.underlying.price)}, strike ${money(call.call.strike)}`}><span style={{ width: `${Math.min(100, Math.max(4, (call.underlying.price / call.call.strike) * 100))}%` }} /><b>Strike {money(call.call.strike)}</b></div>
        <ul className="gmd-income-rows">
          <Row mark={call.underlying.symbol} label={`${call.underlying.symbol} price`} note="OKX OnchainOS" value={money(call.underlying.price)} />
          <Row label="Strike" note={`${signed(call.call.strike / call.underlying.price - 1)} from the price`} value={money(call.call.strike)} />
          <Row label="Premium kept" note={`${money(call.call.premium)} a unit, ${call.units.toFixed(4)} units a share`} value={money(call.units * call.call.premium)} />
          <Row label="Call value now" note="What the fund owes on it, marked" value={money(call.units * call.call.value)} />
          <Row label="Days left" note={`Expires ${day(call.call.expiresAt)}`} value={`${Math.max(0, Math.ceil((Date.parse(call.call.expiresAt) - Date.parse(call.asOf)) / 86_400_000))}`} />
        </ul>
        <p className="gmd-caption">Gains above the strike go to the call&rsquo;s buyer; the premium stays in the fund. Priced by Black–Scholes: there is no options market for xStocks on X Layer.</p>
      </> : note && terms.kind === "autocall" ? <>
        <header className="gmd-section-heading"><div><h2>Where the note stands</h2><p>Started {day(note.state.fixedAt)}</p></div><span className="gmd-count">{note.state.status === "live" ? "Live" : note.state.status === "called" ? "Called" : "Matured"}</span></header>
        <div className="gmd-income-meter is-note" role="img" aria-label={`Worse index at ${pct(note.worst)} of its start; knock-in at ${pct(terms.knockIn, 0)}`}><span style={{ width: `${Math.min(100, note.worst / 1.2 * 100)}%` }} /><i style={{ left: `${terms.knockIn / 1.2 * 100}%` }} /><b>Worse index {pct(note.worst)}</b></div>
        <ul className="gmd-income-rows">
          {terms.underlyings.map(symbol => <Row key={symbol} mark={symbol} label={`${symbol} vs start`} note={`${money(note.prices[symbol])} from ${money(note.state.initial[symbol])}`} value={pct(note.performance[symbol])} />)}
          <Row label="Knock-in" note={note.state.knockedIn ? `Hit on ${day(note.state.knockedInAt!)}` : `${pct(note.worst - terms.knockIn)} above ${pct(terms.knockIn, 0)}`} value={note.state.knockedIn ? "Hit" : "Not hit"} />
          {note.nextObservation && <Row label="Next observation" note={`Pays ${money(note.nextObservation.payIfCalled)} if at or above ${pct(note.nextObservation.barrier, 0)}`} value={day(note.nextObservation.date)} />}
          <Row label="Subscription" note={`At $${terms.face} a note`} value={Date.parse(note.asOf) > Date.parse(note.subscriptionEndsAt) ? "Closed" : `Until ${day(note.subscriptionEndsAt)}`} />
        </ul>
        <p className="gmd-caption">Pays from recorded prices of SPYx and QQQx; nothing hedges it. Demo dollars only.</p>
      </> : <p className="gmd-caption" role="status">{loading ? "Reading the latest record…" : "The first record is written within five minutes of launch."}</p>}
    </section></div>
    {terms.kind === "autocall" && <div className="gmd-market-wide">{note ? <AutocallPath document={note} terms={terms} tall /> : <div className="gmd-lq is-loading" aria-busy="true"><i className="gmd-skeleton gmd-lq-skeleton is-tall" aria-hidden="true" /></div>}</div>}
  </>;
}

/** The covered calls side by side, from each one's latest document. */
function CompareRow({ definition }: { definition: FundDefinition }) {
  const { data } = useFundResource<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(definition.id)}`);
  const fund = data?.fund ?? null;
  const entry = fund?.history.find(item => item.status === "confirmed");
  let call: CoveredCallDocument | null = null;
  try { const parsed = entry ? JSON.parse(entry.canonical) as IncomeDocument : null; if (parsed?.kind === "covered-call") call = parsed; } catch { /* shown as dashes */ }
  const yields = call ? premiumYield(call) : null;
  return <tr><th scope="row"><Link prefetch={false} className="gmd-fund-asset" href={definition.href}><AssetMark symbol={definition.constituents[0]} /><span><b>{definition.name}</b><small>{definition.ticker}</small></span></Link></th>
    <td>{fund?.nav ? formatUsdMicros(fund.nav.perShareMicros, 2) : "—"}</td>
    <td>{call ? money(call.underlying.price) : "—"}</td>
    <td>{call ? `${money(call.call.strike)} (${signed(call.call.strike / call.underlying.price - 1)})` : "—"}</td>
    <td>{yields ? pct(yields.month, 2) : "—"}</td>
    <td>{yields ? pct(yields.annualized) : "—"}</td>
    <td>{call ? day(call.call.expiresAt) : "—"}</td></tr>;
}

/** The Income and Structured tabs on Markets: a feature card for the chosen product, a comparison, the list and Ask USTX. */
export function IncomeMarket({ kind }: { kind: "covered-call" | "autocall" }) {
  const products = INCOME_FUNDS.filter(item => item.kind === kind);
  const [selectedId, setSelectedId] = useState(products[0].id);
  const definition = products.find(item => item.id === selectedId) ?? products[0];
  const terms = INCOME_TERMS[definition.id];
  return <>
    <section id="income-feature" className="gmd-market-feature" aria-label={definition.name}><IncomeMarketPreview key={definition.id} definition={definition} /></section>
    {kind === "covered-call" ? <section className="gmd-proof-history gmd-income-compare" aria-labelledby="income-compare-title"><header className="gmd-section-heading"><div><h2 id="income-compare-title">Compare this month&rsquo;s calls</h2><p>Each fund&rsquo;s current call, from its latest record on X Layer.</p></div></header>
      <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Fund</th><th>NAV</th><th>ETF price</th><th>Strike</th><th>Premium, month</th><th>A year at this rate</th><th>Expires</th></tr></thead><tbody>{products.map(item => <CompareRow key={item.id} definition={item} />)}</tbody></table></div>
      <p className="gmd-caption">The Nasdaq-100&rsquo;s higher volatility pays a higher premium for the same 2% strike, and gives away more of a rally.</p></section>
      : terms.kind === "autocall" && <section className="gmd-proof-history gmd-income-compare" aria-label="Payoff and schedule"><AutocallPayoff terms={terms} />
        <div className="gmd-data-table-scroll"><table className="gmd-table"><caption className="gmd-sr-only">Observation schedule</caption><thead><tr><th>Observation</th><th>After</th><th>Barrier</th><th>Pays per $100 if called</th></tr></thead><tbody>
          {terms.barriers.map((barrier, index) => <tr key={index}><th scope="row">{index + 1}</th><td>{(index + 1) * terms.observationMonths} months</td><td>{pct(barrier, 0)}</td><td>{money(couponPayout(terms, index + 1))}</td></tr>)}
        </tbody></table></div></section>}
    <FundList selectedId={selectedId} onSelect={setSelectedId} controls="income-feature" kinds={[kind]} selectable />
    <p className="gmd-caption">Demo products on X Layer Testnet, bought with demo dollars. {kind === "covered-call" ? "Option premiums are modelled: there is no options market for xStocks on X Layer." : "The note pays from recorded prices and nothing hedges it."}</p>
  </>;
}
