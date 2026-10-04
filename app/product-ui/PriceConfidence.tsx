"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { formatRecordTime } from "@/lib/nav-status";
import { formatDifference } from "@/lib/xstocks/pool-prices";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { useRecordCheck, type RecordCheck, type RecordCheckState } from "./useRecordCheck";
import { usePoolCheck, type PoolCheckResult } from "./PoolCheck";
import { AssetMark, Icon } from "./Icons";

type View = "prices" | "calculation" | "record";
type Tone = "matched" | "failed" | "waiting";
const money = (value: string | null | undefined) => value == null ? "—" : formatUsdMicros(value, 6);
const WAD = 10n ** 18n;
const tokenUnits = (value: string) => {
  const amount = BigInt(value);
  const fraction = (amount % WAD).toString().padStart(18, "0").replace(/0+$/, "");
  return `${amount / WAD}${fraction ? `.${fraction}` : ""}`;
};

function CheckLabel({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`gmd-price-check is-${tone}`}><Icon name={tone === "matched" ? "check" : tone === "failed" ? "close" : "info"} size={14} />{children}</span>;
}

/** Customer prices always come from the document checked against a direct chain read. */
export default function PriceConfidence({ compact = false }: { compact?: boolean }) {
  const { data, error, now, reload } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const pools = usePoolCheck(checks?.composition ?? null);
  return <PriceConfidenceView checks={checks} state={state} pools={pools} now={now} onRefresh={reload} compact={compact} />;
}

export function PriceConfidenceView({ checks, state, pools, now, onRefresh, compact = false }: {
  checks: RecordCheck | null; state: RecordCheckState; pools: PoolCheckResult;
  now: number; onRefresh: () => void; compact?: boolean;
}) {
  const id = useId();
  const [view, setView] = useState<View>("prices");
  const document = checks?.composition;
  const record = checks?.record;
  const compared = pools.comparison;
  const recordedAt = record?.effectiveAt ? Date.parse(record.effectiveAt) : null;
  const delayed = Boolean(now && recordedAt !== null && now - recordedAt > 15 * 60_000);
  const oldPool = Boolean(now && pools.pools && now - Date.parse(pools.pools.blockTime) > 15 * 60_000);
  const complete = state === "matched" && pools.state === "matched" && !delayed && !oldPool;
  const failed = state === "failed" || pools.state === "failed";
  const unavailable = state === "unavailable" || pools.state === "unavailable";
  const tone: Tone = complete ? "matched" : failed ? "failed" : "waiting";
  const title = state === "failed" ? "Price verification needs attention" : pools.state === "failed" ? "Market prices have diverged" : delayed || oldPool ? "Waiting for a fresh price" : complete ? "Price checks complete" : unavailable ? "Some checks are unavailable" : "Checking the USTX price";
  const explanation = state === "failed" ? "The published price and its supporting holdings do not match. Treat this price as unverified."
    : pools.state === "failed" ? "The pool-based basket value is outside the 1% comparison range. Review the difference below."
    : delayed || oldPool ? "A price in this comparison is over 15 minutes old. A matching record does not mean the price is current."
    : complete ? "The basket calculation matches its X Layer record, and pool prices are within 1%."
    : unavailable ? "A price source could not be reached. Full confirmation is not available yet."
    : "Comparing market prices and checking the calculation on your device.";
  const proofTone: Tone = state === "matched" ? "matched" : state === "failed" ? "failed" : "waiting";
  const proofLabel = state === "matched" ? "Record matches" : state === "failed" ? "Record mismatch" : state === "unavailable" ? "Record unavailable" : "Checking record";
  const poolTone: Tone = pools.state === "matched" ? "matched" : pools.state === "failed" ? "failed" : "waiting";
  const poolLabel = pools.state === "matched" ? "Within 1%" : pools.state === "failed" ? "Outside 1%" : pools.state === "unavailable" ? "Comparison unavailable" : "Comparing prices";
  const calculationTone: Tone = checks?.nav.state === "pass" ? "matched" : checks?.nav.state === "fail" ? "failed" : "waiting";
  const difference = compared?.navDifferenceBps ?? null;
  const position = difference === null ? 50 : 50 + Math.max(-200, Math.min(200, difference)) / 4;
  const refresh = () => { onRefresh(); pools.retry(); };
  return <section id={compact ? undefined : "price-confidence"} className={`gmd-price-confidence${compact ? " is-compact" : ""}`} aria-labelledby={`${id}-title`}>
    <header className="gmd-price-confidence-heading">
      <div><span className="gmd-price-eyebrow">USTX · Price transparency</span><h2 id={`${id}-title`}>{compact ? "Your price, cross-checked." : "One price. Checked from every angle."}</h2><p>Two market sources. A calculation you can check.</p></div>
      {compact ? <Link prefetch={false} href="/products/ustx/transparency" className="gmd-inline-link">Explore the checks<Icon name="arrow" size={16} /></Link> : <button type="button" className="gmd-small-button" onClick={refresh}><Icon name="refresh" size={16} />Refresh checks</button>}
    </header>

    <div className="gmd-price-path" aria-label="Two price sources and your browser calculation">
      <article className="gmd-price-source is-okx"><span className="gmd-price-source-label"><Icon name="market" size={18} />Market source 1</span><h3>OKX market prices</h3><strong>{money(document?.navPerShareMicros)}</strong><span className="gmd-price-unit">per USTX share</span><p>The basket valued with OKX OnchainOS prices.</p><small>{document ? formatRecordTime(document.asOf) : "Waiting for prices"}</small></article>
      <article className="gmd-price-source is-pools"><span className="gmd-price-source-label"><Icon name="pool" size={18} />Market source 2</span><h3>xStock pool prices</h3><strong>{money(compared?.poolNavMicros)}</strong><span className="gmd-price-unit">the same basket, at pool prices</span><p>Read directly from Uniswap pools on X Layer mainnet.</p><small>{pools.pools ? formatRecordTime(pools.pools.blockTime) : pools.state === "unavailable" ? "Prices unavailable" : "Waiting for pool prices"}</small></article>
      <article className="gmd-price-source is-browser"><span className="gmd-price-source-label"><Icon name="check" size={18} />Calculated on your device</span><h3>Your browser’s result</h3><strong>{money(checks?.computedNavMicros)}</strong><span className="gmd-price-unit">holdings × OKX prices, added again</span><p>Recalculates the basket and checks its X Layer record.</p><small>A calculation check, not a third price source</small></article>
    </div>
    <div className="gmd-price-path-join" aria-hidden="true"><svg viewBox="0 0 900 36" preserveAspectRatio="none"><path d="M150 0V12Q150 20 158 20H742Q750 20 750 12V0M450 0V36" /></svg><span>Compared on your device</span></div>

    <div className={`gmd-price-outcome is-${tone}`} role="status"><span className="gmd-price-outcome-icon"><Icon name={complete ? "check" : "info"} size={23} /></span><div><h3>{title}</h3><p>{explanation}</p></div><span className="gmd-price-difference"><small>Pool / OKX difference</small><b>{difference === null ? "—" : formatDifference(difference)}</b></span></div>
    <div className="gmd-price-checks" aria-label="Price check results"><CheckLabel tone={proofTone}>{proofLabel}</CheckLabel><CheckLabel tone={poolTone}>{poolLabel}</CheckLabel><CheckLabel tone={delayed || oldPool ? "waiting" : complete ? "matched" : "waiting"}>{delayed || oldPool ? "Price update delayed" : recordedAt !== null ? `Price as of ${formatRecordTime(record?.effectiveAt)}` : "Waiting for an update"}</CheckLabel></div>

    {!compact && <>
      <div className="gmd-price-tabs" role="group" aria-label="Explore price checks">{([
        ["prices", "Compare prices"], ["calculation", "See the calculation"], ["record", "Published record"],
      ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} aria-controls={`${id}-detail`} onClick={() => setView(key)}>{label}</button>)}</div>
      <div id={`${id}-detail`} className="gmd-price-detail">
        {view === "prices" && <>
          <div className="gmd-price-detail-heading"><div><h3>How close are the two market prices?</h3><p>We value the same holdings at both sources. The shaded range is ±1% of the OKX basket value.</p></div><CheckLabel tone={poolTone}>{poolLabel}</CheckLabel></div>
          {compared ? <div className="gmd-price-gauge" role="img" aria-label={`Pool basket value is ${formatDifference(compared.navDifferenceBps)} from OKX. ${compared.agrees ? "Within" : "Outside"} the 1% range.`}>
            <div className="gmd-price-gauge-track"><span className="gmd-price-gauge-band" /><i className="gmd-price-gauge-center" /><b className={`gmd-price-gauge-dot is-${poolTone}`} style={{ left: `${position}%` }} /></div>
            <div className="gmd-price-gauge-scale" aria-hidden="true"><span>−2%</span><span>−1%</span><b>OKX price</b><span>+1%</span><span>+2%</span></div>
            <p>Pool value <b>{formatDifference(compared.navDifferenceBps)}</b>{Math.abs(compared.navDifferenceBps) > 200 ? " · beyond the chart range" : ""}. The 1% comparison applies to the whole basket, not each holding.</p>
          </div> : <p className="gmd-price-empty">{pools.state === "unavailable" ? "Pool prices are unavailable. You can retry the comparison." : "The comparison appears when both price sources are available."}</p>}
          {compared && <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Holding</th><th>OKX price</th><th>Pool price</th><th>Difference</th></tr></thead><tbody>{compared.rows.map(row => <tr key={row.symbol}><th scope="row"><span className="gmd-price-holding"><AssetMark symbol={row.symbol} />{row.symbol}</span></th><td>{formatUsdMicros(row.recordedMicros, 4)}</td><td>{formatUsdMicros(row.poolMicros, 4)}</td><td>{formatDifference(row.differenceBps)}</td></tr>)}</tbody></table></div>}
          <p className="gmd-caption">Pool prices can move between updates. This comparison is separate from checking that the published calculation is correct.</p>
          {pools.state === "unavailable" && <button type="button" className="gmd-small-button" onClick={pools.retry}>Retry price comparison</button>}
        </>}
        {view === "calculation" && <>
          <div className="gmd-price-detail-heading"><div><h3>Every holding adds up to one share.</h3><p>Your browser multiplies each holding by its OKX price, then adds the values. It checks the result and price times against the published record.</p></div><CheckLabel tone={calculationTone}>{checks?.nav.state === "pass" ? "Calculation matches" : checks?.nav.state === "fail" ? "Calculation needs attention" : "Checking calculation"}</CheckLabel></div>
          {document ? <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Holding</th><th>Amount per share</th><th>× OKX price</th><th>= Value</th></tr></thead><tbody>{document.holdings.map(row => <tr key={row.symbol}><th scope="row"><span className="gmd-price-holding"><AssetMark symbol={row.symbol} />{row.symbol}</span></th><td>{tokenUnits(row.unitsWad)}</td><td>{money(row.priceMicros)}</td><td>{money((BigInt(row.unitsWad) * BigInt(row.priceMicros) / WAD).toString())}</td></tr>)}</tbody></table></div> : <p className="gmd-price-empty">The calculation appears when the holdings are available.</p>}
          <div className="gmd-price-totals"><div><span>Calculated on your device</span><strong>{money(checks?.computedNavMicros)}</strong></div><span aria-hidden="true">{checks?.nav.state === "pass" ? "=" : checks?.nav.state === "fail" ? "!" : "…"}</span><div><span>Published on X Layer</span><strong>{record?.effectiveAt ? money(record.navPerShareMicros) : "—"}</strong></div></div>
          <p className="gmd-caption">Each holding’s value is rounded down to six decimal places before adding. A correct calculation does not guarantee that the market prices are accurate.</p>
        </>}
        {view === "record" && <>
          <div className="gmd-price-detail-heading"><div><h3>A published record you can check.</h3><p>The NAV and its holdings are checked against the record on X Layer Testnet.</p></div><CheckLabel tone={proofTone}>{proofLabel}</CheckLabel></div>
          <dl className="gmd-price-record"><div><dt>Published NAV</dt><dd>{record?.effectiveAt ? money(record.navPerShareMicros) : "—"}</dd></div><div><dt>Price time</dt><dd>{formatRecordTime(record?.effectiveAt)}</dd></div><div><dt>Holdings unchanged</dt><dd>{checks?.hash.state === "pass" ? "Confirmed" : checks?.hash.state === "fail" ? "Does not match" : "Not confirmed"}</dd></div><div><dt>Calculation and times</dt><dd>{checks?.nav.state === "pass" ? "Match the record" : checks?.nav.state === "fail" ? "Need attention" : "Not confirmed"}</dd></div></dl>
          <a className="gmd-small-button" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">View on X Layer<Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>
        </>}
      </div>
    </>}
    <footer className="gmd-price-footnote"><p>{compact ? "Price checks do not confirm asset backing or stock-exchange prices." : "These checks compare xStock prices and calculations. They do not confirm asset backing or the underlying stock-exchange price."}</p><Link prefetch={false} href="/limitations">Understand the risks<Icon name="arrow" size={14} /></Link></footer>
  </section>;
}
