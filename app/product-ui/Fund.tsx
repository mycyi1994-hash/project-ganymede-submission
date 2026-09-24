"use client";

import { useEffect, useState } from "react";
import { fundValueMicros } from "@/lib/demo/basket";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdRounded } from "@/lib/nav-display";
import { publicationHistory, relativeTime, shortTime, signedPercent, sinceFirstRecord } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { BasketTable, useRecordComposition } from "./Basket";
import { Icon } from "./Icons";

// Fund figures for USTX: size and shares outstanding from the NAV record on X Layer, investors
// and recent orders from the demo ledger. Demo dollars only; nothing identifies an investor.

type FundActivity = { side: "subscribe" | "redeem"; usdMicros: string; sharesMicros: string; createdAt: string };
type FundSnapshot = { sharesOutstandingMicros: string; investors: number; ordersToday: number; recent: FundActivity[] };

const digits = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function decodeFund(value: unknown): FundSnapshot {
  const body = value as FundSnapshot;
  if (!body || !digits(body.sharesOutstandingMicros) || !Number.isSafeInteger(body.investors) || !Number.isSafeInteger(body.ordersToday) || !Array.isArray(body.recent)) throw new Error("The fund response is incomplete.");
  return { ...body, recent: body.recent.filter(item => (item.side === "subscribe" || item.side === "redeem") && digits(item.usdMicros) && digits(item.sharesMicros) && Number.isFinite(Date.parse(item.createdAt))) };
}

/** Loads the public fund totals, refreshing every minute and after an order on this page. */
function useDemoFund() {
  const [state, setState] = useState<{ fund: FundSnapshot | null; loadedAt: number; failed: boolean }>({ fund: null, loadedAt: 0, failed: false });
  useEffect(() => {
    let active: AbortController | null = null;
    const load = () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      fetch("/api/demo/fund", { cache: "no-store", signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error("unavailable"); return decodeFund(await response.json()); })
        .then(fund => { if (active === controller) setState({ fund, loadedAt: Date.now(), failed: false }); })
        .catch(() => { if (active === controller && !controller.signal.aborted) setState(previous => ({ ...previous, failed: true })); });
    };
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    window.addEventListener(DEMO_ORDER_EVENT, load);
    return () => { window.clearInterval(timer); window.removeEventListener(DEMO_ORDER_EVENT, load); active?.abort(); active = null; };
  }, []);
  return state;
}

function useFundFigures() {
  const { data } = useMarket();
  const demo = useDemoFund();
  const record = data?.onchain?.effectiveAt && !data.onchainError ? data.onchain : null;
  const nav = record ? BigInt(record.navPerShareMicros) : null;
  const recorded = record && digits(record.sharesOutstandingMicros) ? BigInt(record.sharesOutstandingMicros) : 0n;
  const live = demo.fund ? BigInt(demo.fund.sharesOutstandingMicros) : null;
  // The count recorded on X Layer with this NAV; before the first such record, the ledger's own total.
  const shares = recorded > 0n ? recorded : live;
  const size = nav !== null && shares !== null ? fundValueMicros(shares, nav) : null;
  const since = data ? sinceFirstRecord(publicationHistory(data)) : null;
  return { ...demo, record, shares, onChain: recorded > 0n, size, since };
}

const tone = (percent: number | undefined) => percent === undefined || Math.round(percent * 100) === 0 ? "" : percent > 0 ? "gmd-positive" : "gmd-negative";

/** Three headline figures for the market card. */
export function FundStats() {
  const figures = useFundFigures();
  return <dl className="gmd-fund-stats" aria-label="USTX fund figures">
    <div><dt>Fund size</dt><dd>{figures.size === null ? "—" : formatUsdRounded(figures.size)}</dd></div>
    <div><dt>Investors</dt><dd>{figures.fund ? figures.fund.investors.toLocaleString("en-US") : "—"}</dd></div>
    <div><dt>Since launch</dt><dd className={tone(figures.since?.percent)}>{figures.since ? signedPercent(figures.since.percent) : "—"}</dd></div>
  </dl>;
}

/** The fund overview on the USTX page: figures, key facts, look-through holdings and recent orders. */
export function FundOverview() {
  const figures = useFundFigures();
  const { composition } = useRecordComposition();
  const { fund, since, record } = figures;
  const unavailable = figures.failed && !fund;
  return <section id="overview" className="gmd-fund" aria-labelledby="fund-title">
    <header className="gmd-section-heading"><div><h2 id="fund-title">Fund overview</h2><p>Live figures for USTX. Demo dollars on X Layer Testnet.</p></div><span className="gmd-badge">Demo</span></header>
    {unavailable && <p className="gmd-inline-error" role="status">Fund figures are unavailable right now. The NAV and verification are not affected.</p>}
    <div className="gmd-fund-grid">
      <article><span>Fund size</span><strong>{figures.size === null ? "—" : formatUsdRounded(figures.size)}</strong><small>{figures.shares === null ? "Loading…" : figures.onChain && record ? `${formatSharesShort(figures.shares)} shares outstanding, recorded on X Layer at ${shortTime(record.effectiveAt)}` : `${formatSharesShort(figures.shares)} shares outstanding; recorded on X Layer with the next NAV`}</small></article>
      <article><span>Investors</span><strong>{fund ? fund.investors.toLocaleString("en-US") : "—"}</strong><small>{fund ? `${fund.ordersToday.toLocaleString("en-US")} ${fund.ordersToday === 1 ? "order" : "orders"} today (UTC)` : "Loading…"}</small></article>
      <article><span>Since launch</span><strong className={tone(since?.percent)}>{since ? signedPercent(since.percent) : "—"}</strong><small>{since ? `From ${formatUsdRounded(since.first.micros)} on ${day(since.first.at)}` : "Loading…"}</small></article>
      <article><span>NAV updates</span><strong>Every 5 min</strong><small>Priced by OKX OnchainOS, recorded on X Layer</small></article>
    </div>
    <dl className="gmd-fund-facts">
      <div><dt>Launch date</dt><dd>{since ? day(since.first.at) : "—"}</dd></div>
      <div><dt>Minimum investment</dt><dd>$10</dd></div>
      <div><dt>Management fee</dt><dd>0.00% during the demo</dd></div>
      <div><dt>Dealing</dt><dd>Instant, at the latest NAV on X Layer</dd></div>
      <div><dt>Base currency</dt><dd>USD</dd></div>
      <div><dt>Rebalancing</dt><dd>Quarterly, back to equal weight</dd></div>
      <div><dt>Price source</dt><dd>OKX OnchainOS, X Layer DEX prices</dd></div>
      <div><dt>NAV registry</dt><dd><a className="gmd-inline-tx" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">{PROOF_DEPLOYMENT.registry.slice(0, 6)}…{PROOF_DEPLOYMENT.registry.slice(-4)}<Icon name="external" size={12} /><span className="gmd-sr-only"> on the X Layer Testnet explorer (opens in a new tab)</span></a></dd></div>
    </dl>
    {composition && figures.shares !== null && figures.shares > 0n && <div className="gmd-fund-holdings">
      <h3>What the fund holds</h3>
      <p>All {formatSharesShort(figures.shares)} USTX shares outstanding, looked through to the six xStocks at the prices in the latest record. In this demo no tokens are bought.</p>
      <BasketTable composition={composition} sharesMicros={figures.shares} label="Look-through holdings of all USTX shares" />
    </div>}
    <div className="gmd-fund-activity" aria-live="polite">
      <header className="gmd-section-heading"><h3>Recent investor activity</h3><span>Anonymous · refreshed every minute</span></header>
      {fund && fund.recent.length > 0 ? <div className="gmd-activity-rows">{fund.recent.map(item => <div className="gmd-activity-row" key={`${item.createdAt}-${item.usdMicros}-${item.side}`}>
        <span className="gmd-transaction-symbol is-complete"><Icon name={item.side === "subscribe" ? "arrow" : "back"} /></span>
        <span><b>{item.side === "subscribe" ? "Investment" : "Redemption"}</b><small>{relativeTime(item.createdAt, figures.loadedAt)}</small></span>
        <span><b>{formatUsdRounded(item.usdMicros)}</b><small>{formatSharesShort(item.sharesMicros, 4)} USTX</small></span>
      </div>)}</div> : <p className="gmd-empty-note">{fund ? "No orders yet. Be the first to invest." : unavailable ? "Activity is unavailable right now." : "Loading activity…"}</p>}
    </div>
  </section>;
}
