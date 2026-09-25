"use client";

import { useEffect, useState } from "react";
import { fundValueMicros } from "@/lib/demo/basket";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdRounded } from "@/lib/nav-display";
import { publicationHistory, shortTime, signedPercent, sinceFirstRecord } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { BasketTable, useRecordComposition } from "./Basket";
import { Icon } from "./Icons";
import { OkxSource } from "./OkxSource";

// Fund figures for USTX: size and shares outstanding from the NAV record on X Layer, investors
// and 24-hour flows from the demo ledger. Demo dollars only; totals, never single orders.

type FundSnapshot = { sharesOutstandingMicros: string; investors: number; ordersToday: number; last24h: { investedMicros: string; redeemedMicros: string; orders: number } };

const digits = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function decodeFund(value: unknown): FundSnapshot {
  const body = value as FundSnapshot;
  const flows = body?.last24h;
  if (!body || !digits(body.sharesOutstandingMicros) || !Number.isSafeInteger(body.investors) || !Number.isSafeInteger(body.ordersToday) || !flows || !digits(flows.investedMicros) || !digits(flows.redeemedMicros) || !Number.isSafeInteger(flows.orders)) throw new Error("The fund response is incomplete.");
  return body;
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

/** The fund overview on the USTX page: figures, key facts and look-through holdings. */
export function FundOverview() {
  const figures = useFundFigures();
  const { composition } = useRecordComposition();
  const { fund, since, record } = figures;
  const unavailable = figures.failed && !fund;
  const net = fund ? BigInt(fund.last24h.investedMicros) - BigInt(fund.last24h.redeemedMicros) : null;
  return <section id="overview" className="gmd-fund" aria-labelledby="fund-title">
    <header className="gmd-section-heading"><div><h2 id="fund-title">Fund overview</h2><p>Live figures for USTX. Demo dollars on X Layer Testnet.</p></div><span className="gmd-badge">Demo</span></header>
    {unavailable && <p className="gmd-inline-error" role="status">Fund figures are unavailable right now. The NAV and verification are not affected.</p>}
    <div className="gmd-fund-grid">
      <article><span>Fund size</span><strong>{figures.size === null ? "—" : formatUsdRounded(figures.size)}</strong><small>{figures.shares === null ? "Loading…" : figures.onChain && record ? `${formatSharesShort(figures.shares)} shares outstanding, recorded on X Layer at ${shortTime(record.effectiveAt)}` : `${formatSharesShort(figures.shares)} shares outstanding; recorded on X Layer with the next NAV`}</small></article>
      <article><span>Investors</span><strong>{fund ? fund.investors.toLocaleString("en-US") : "—"}</strong><small>{fund ? "Accounts holding USTX" : "Loading…"}</small></article>
      <article><span>Net flows, 24h</span><strong className={net === null || net === 0n ? "" : net > 0n ? "gmd-positive" : "gmd-negative"}>{net === null ? "—" : `${net > 0n ? "+" : ""}${formatUsdRounded(net)}`}</strong><small>{fund ? `${formatUsdRounded(fund.last24h.investedMicros)} in · ${formatUsdRounded(fund.last24h.redeemedMicros)} out · ${fund.last24h.orders.toLocaleString("en-US")} ${fund.last24h.orders === 1 ? "order" : "orders"}` : "Loading…"}</small></article>
      <article><span>Since launch</span><strong className={tone(since?.percent)}>{since ? signedPercent(since.percent) : "—"}</strong><small>{since ? `From ${formatUsdRounded(since.first.micros)} on ${day(since.first.at)}` : "Loading…"}</small></article>
    </div>
    <p className="gmd-fund-source"><OkxSource>Priced by OKX OnchainOS every 5 minutes</OkxSource><span>The NAV, the shares outstanding and a fingerprint of the holdings are recorded on X Layer with every price.</span></p>
    <dl className="gmd-fund-facts">
      <div><dt>Launch date</dt><dd>{since ? day(since.first.at) : "—"}</dd></div>
      <div><dt>Minimum investment</dt><dd>$10</dd></div>
      <div><dt>Management fee</dt><dd>0.00% during the demo</dd></div>
      <div><dt>Dealing</dt><dd>Instant, at the latest NAV on X Layer</dd></div>
      <div><dt>Base currency</dt><dd>USD</dd></div>
      <div><dt>Rebalancing</dt><dd>Quarterly, back to equal weight</dd></div>
      <div><dt>Pricing</dt><dd>OKX OnchainOS, every 5 minutes</dd></div>
      <div><dt>NAV record</dt><dd><a className="gmd-inline-tx" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">X Layer · OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
    </dl>
    {composition && figures.shares !== null && figures.shares > 0n && <div className="gmd-fund-holdings">
      <h3>What the fund holds</h3>
      <p>All {formatSharesShort(figures.shares)} USTX shares outstanding, looked through to the six xStocks at the latest OKX OnchainOS prices. In this demo no tokens are bought.</p>
      <BasketTable composition={composition} sharesMicros={figures.shares} label="Look-through holdings of all USTX shares" />
    </div>}
  </section>;
}
