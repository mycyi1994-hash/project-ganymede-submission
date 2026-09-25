"use client";

import { useEffect, useState } from "react";
import { fundValueMicros } from "@/lib/demo/basket";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdRounded } from "@/lib/nav-display";
import { compositionForRecord, publicationHistory, shortTime, signedPercent, sinceFirstRecord } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
import { useMarket } from "./MarketProvider";
import { BasketTable, useRecordComposition } from "./Basket";
import { Icon } from "./Icons";
import Holdings from "./Holdings";

// Fund figures for USTX: size and shares outstanding from the NAV record on X Layer, investors
// across wallets (read from the fund contract) and demo balances, and 24-hour flows of demo-balance
// orders. Demo dollars only; totals, never single orders.

type Split = { sharesMicros: string; investors: number };
type FundSnapshot = { sharesOutstandingMicros: string; investors: number; ordersToday: number; last24h: { investedMicros: string; redeemedMicros: string; orders: number }; demo?: Split; wallets?: Split | null };

const digits = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function decodeFund(value: unknown): FundSnapshot {
  const body = value as FundSnapshot;
  const flows = body?.last24h;
  if (!body || !digits(body.sharesOutstandingMicros) || !Number.isSafeInteger(body.investors) || !Number.isSafeInteger(body.ordersToday) || !flows || !digits(flows.investedMicros) || !digits(flows.redeemedMicros) || !Number.isSafeInteger(flows.orders)) throw new Error("The fund response is incomplete.");
  const split = (value: unknown): Split | undefined => { const item = value as Split; return item && digits(item.sharesMicros) && Number.isSafeInteger(item.investors) ? { sharesMicros: item.sharesMicros, investors: item.investors } : undefined; };
  return { ...body, demo: split(body.demo), wallets: split(body.wallets) ?? null };
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

/** Three headline figures for the market card; the chart above it shows the return. */
export function FundStats() {
  const figures = useFundFigures();
  const flows = figures.fund?.last24h;
  const net = flows ? BigInt(flows.investedMicros) - BigInt(flows.redeemedMicros) : null;
  return <dl className="gmd-fund-stats" aria-label="USTX fund figures">
    <div><dt>Fund size</dt><dd>{figures.size === null ? "—" : formatUsdRounded(figures.size)}</dd></div>
    <div><dt>Investors</dt><dd>{figures.fund ? figures.fund.investors.toLocaleString("en-US") : "—"}</dd></div>
    <div><dt>Net flows, 24h</dt><dd className={net === null || net === 0n ? "" : net > 0n ? "gmd-positive" : "gmd-negative"}>{net === null ? "—" : `${net > 0n ? "+" : ""}${formatUsdRounded(net)}`}</dd></div>
  </dl>;
}

/** The fund overview on the USTX page: figures and key facts. */
export function FundOverview() {
  const figures = useFundFigures();
  const { data } = useMarket();
  const { fund, since, record } = figures;
  const entry = record ? [data?.latest?.publication, ...(data?.history ?? [])].find(item => item?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = entry?.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? entry.txHash : null;
  const unavailable = figures.failed && !fund;
  const net = fund ? BigInt(fund.last24h.investedMicros) - BigInt(fund.last24h.redeemedMicros) : null;
  return <section id="overview" className="gmd-fund" aria-labelledby="fund-title">
    <header className="gmd-section-heading"><div><h2 id="fund-title">Fund overview</h2><p>Live figures, refreshed every minute.</p></div></header>
    {unavailable && <p className="gmd-inline-error" role="status">Fund figures are unavailable right now. The NAV and verification are not affected.</p>}
    <div className="gmd-fund-grid">
      <article><span>Fund size</span><strong>{figures.size === null ? "—" : formatUsdRounded(figures.size)}</strong><small>{figures.shares === null ? "Loading…" : figures.onChain && record ? `${formatSharesShort(figures.shares)} shares outstanding, recorded on X Layer at ${shortTime(record.effectiveAt)}` : `${formatSharesShort(figures.shares)} shares outstanding; recorded on X Layer with the next NAV`}</small></article>
      <article><span>Investors</span><strong>{fund ? fund.investors.toLocaleString("en-US") : "—"}</strong><small>{!fund ? "Loading…" : fund.wallets && fund.demo ? `${fund.wallets.investors.toLocaleString("en-US")} ${fund.wallets.investors === 1 ? "wallet" : "wallets"} on X Layer · ${fund.demo.investors.toLocaleString("en-US")} with demo balances` : "Accounts holding USTX"}</small></article>
      <article><span>Net flows, 24h</span><strong className={net === null || net === 0n ? "" : net > 0n ? "gmd-positive" : "gmd-negative"}>{net === null ? "—" : `${net > 0n ? "+" : ""}${formatUsdRounded(net)}`}</strong><small>{fund ? `${formatUsdRounded(fund.last24h.investedMicros)} in · ${formatUsdRounded(fund.last24h.redeemedMicros)} out · ${fund.last24h.orders.toLocaleString("en-US")} ${fund.last24h.orders === 1 ? "order" : "orders"} with demo balances` : "Loading…"}</small></article>
      <article><span>Since launch</span><strong className={tone(since?.percent)}>{since ? signedPercent(since.percent) : "—"}</strong><small>{since ? `From ${formatUsdRounded(since.first.micros)} on ${day(since.first.at)}` : "Loading…"}</small></article>
    </div>
    <dl className="gmd-fund-facts">
      <div><dt>Launch date</dt><dd>{since ? day(since.first.at) : "—"}</dd></div>
      <div><dt>Minimum investment</dt><dd>$10</dd></div>
      <div><dt>Management fee</dt><dd>0.00%</dd></div>
      <div><dt>Dealing</dt><dd>Instant, at the latest NAV on X Layer</dd></div>
      <div><dt>Base currency</dt><dd>USD</dd></div>
      <div><dt>Rebalancing</dt><dd>Quarterly, back to equal weight</dd></div>
      <div><dt>Price oracle</dt><dd>OKX OnchainOS, every 5 minutes</dd></div>
      <div><dt>Share token</dt><dd><a className="gmd-inline-tx" href={`${FUND_DEPLOYMENT.explorerUrl}/token/${FUND_DEPLOYMENT.fund}`} target="_blank" rel="noreferrer">USTX on X Layer Testnet<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
      <div><dt>Last NAV record</dt><dd>{record ? <a className="gmd-inline-tx" href={tx ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${tx}` : `${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">{shortTime(record.effectiveAt)} · OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> : "—"}</dd></div>
    </dl>
  </section>;
}

/** Holdings, as on a fund factsheet: what all shares outstanding hold of each xStock. Before the first share, per share. */
export function FundHoldings() {
  const figures = useFundFigures();
  const { data, loading } = useMarket();
  const { composition } = useRecordComposition();
  if (!composition || figures.shares === null || figures.shares <= 0n) return <Holdings composition={data ? compositionForRecord(data) : null} loading={loading} />;
  return <section className="gmd-fund-holdings" aria-labelledby="holdings-title">
    <header className="gmd-section-heading"><div><h2 id="holdings-title">Holdings</h2><p>All {formatSharesShort(figures.shares)} USTX shares, looked through to each xStock at OKX OnchainOS prices as of {shortTime(composition.asOf)}.</p></div><span className="gmd-count">6 assets</span></header>
    <BasketTable composition={composition} sharesMicros={figures.shares} label="Fund holdings" />
    <p className="gmd-caption">Equal weight at each quarterly rebalance; weights move with prices. On testnet no xStocks are bought.</p>
  </section>;
}
