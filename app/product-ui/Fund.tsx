"use client";

import { useEffect, useState } from "react";
import { fundValueMicros } from "@/lib/demo/basket";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { compositionForRecord, publicationHistory, shortTime, signedPercent, sinceFirstRecord } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { FUND_DEPLOYMENT, POOL_FEE_BPS, describePremium, fundExplorer, readPoolMarket, type PoolMarket } from "@/lib/xstocks/fund";
import { useMarket } from "./MarketProvider";
import { BasketTable, useRecordComposition } from "./Basket";
import { Icon, Skeleton } from "./Icons";
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

/** The USTX/dUSD pool's price read from X Layer Testnet, refreshing every minute and after an order. */
function usePoolMarket() {
  const [state, setState] = useState<{ market: PoolMarket | null; failed: boolean }>({ market: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    const load = () => readPoolMarket()
      .then(market => { if (!cancelled) setState({ market, failed: false }); })
      .catch(() => { if (!cancelled) setState(previous => ({ ...previous, failed: true })); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    window.addEventListener(DEMO_ORDER_EVENT, load);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener(DEMO_ORDER_EVENT, load); };
  }, []);
  return state;
}

function useFundFigures() {
  const { data, loading } = useMarket();
  const demo = useDemoFund();
  const record = data?.onchain?.effectiveAt && !data.onchainError ? data.onchain : null;
  const nav = record ? BigInt(record.navPerShareMicros) : null;
  const recorded = record && digits(record.sharesOutstandingMicros) ? BigInt(record.sharesOutstandingMicros) : 0n;
  const live = demo.fund ? BigInt(demo.fund.sharesOutstandingMicros) : null;
  // The count recorded on X Layer with this NAV; before the first such record, the ledger's own total.
  const shares = recorded > 0n ? recorded : live;
  const size = nav !== null && shares !== null ? fundValueMicros(shares, nav) : null;
  const since = data ? sinceFirstRecord(publicationHistory(data)) : null;
  // Before the first reads return: placeholders, not dashes. A later refresh keeps the figures shown.
  const pending = (!data && loading) || (!demo.fund && !demo.failed);
  return { ...demo, record, shares, onChain: recorded > 0n, size, since, pending, marketPending: !data && loading };
}

const tone = (percent: number | undefined) => percent === undefined || Math.round(percent * 100) === 0 ? "" : percent > 0 ? "gmd-positive" : "gmd-negative";

/** Three headline figures for the market card; the chart above it shows the return. */
export function FundStats() {
  const figures = useFundFigures();
  const flows = figures.fund?.last24h;
  const net = flows ? BigInt(flows.investedMicros) - BigInt(flows.redeemedMicros) : null;
  const wait = (width: number) => figures.pending ? <Skeleton width={width} /> : "—";
  return <dl className="gmd-fund-stats" aria-label="USTX fund figures" aria-busy={figures.pending}>
    <div><dt>Fund size</dt><dd>{figures.size === null ? wait(76) : formatUsdRounded(figures.size)}</dd></div>
    <div><dt>Investors</dt><dd>{figures.fund ? figures.fund.investors.toLocaleString("en-US") : wait(34)}</dd></div>
    <div><dt>Net flows, 24h</dt><dd className={net === null || net === 0n ? "" : net > 0n ? "gmd-positive" : "gmd-negative"}>{net === null ? wait(64) : `${net > 0n ? "+" : ""}${formatUsdRounded(net)}`}</dd></div>
  </dl>;
}

const FEE_PPM = Number(POOL_FEE_BPS) * 100;
/** The gauge runs from 1% below the NAV to 1% above. */
const GAUGE_PPM = 10_000;

/**
 * The pool's price against the NAV on one scale, with the band of the pool's 0.3% fee around the NAV:
 * inside it a trade through the pool costs more than the gap, beyond it the keeper can close it.
 */
function PremiumGauge({ market }: { market: PoolMarket }) {
  if (market.premiumPpm === null || market.navMicros === null) return null;
  const ppm = Number(market.premiumPpm);
  const shown = Math.max(-GAUGE_PPM, Math.min(GAUGE_PPM, ppm));
  const at = (value: number) => `${50 + value / GAUGE_PPM * 50}%`;
  const inside = Math.abs(ppm) <= FEE_PPM;
  const gap = describePremium(market.premiumPpm);
  return <div className="gmd-premium">
    <div className="gmd-premium-head">
      <div><h3>Pool price against the NAV</h3><p>{formatUsdMicros(market.priceMicros, 2)} in the USTX/dUSD pool · NAV {formatUsdMicros(market.navMicros, 2)}</p></div>
      <strong className={inside ? "" : ppm > 0 ? "gmd-positive" : "gmd-negative"}>{gap === "at the NAV" ? "At the NAV" : gap}</strong>
    </div>
    <div className="gmd-premium-track" role="meter" aria-label="Pool price against the NAV" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={shown / 10_000} aria-valuetext={`${gap}, ${inside ? "inside" : "outside"} the pool's 0.3% fee`}>
      <span className="gmd-premium-band" style={{ left: at(-FEE_PPM), width: `${FEE_PPM / GAUGE_PPM * 100}%` }} />
      <span className="gmd-premium-nav" />
      <i style={{ left: at(shown) }} />
    </div>
    <div className="gmd-premium-scale" aria-hidden="true"><span>1% below</span><span style={{ left: at(-FEE_PPM) }}>−0.3%</span><span style={{ left: "50%" }}>NAV</span><span style={{ left: at(FEE_PPM) }}>+0.3%</span><span>1% above</span></div>
    <p className="gmd-caption">{inside ? "Inside the shaded band the pool’s 0.3% fee costs more than the gap, so no arbitrage pays." : "Outside the pool’s 0.3% fee: the arbitrage keeper checks every five minutes and closes gaps like this through the fund in one transaction."}</p>
  </div>;
}

/** The fund overview on the USTX page: figures and key facts. */
export function FundOverview() {
  const figures = useFundFigures();
  const pool = usePoolMarket();
  const { data } = useMarket();
  const { fund, since, record } = figures;
  const entry = record ? [data?.latest?.publication, ...(data?.history ?? [])].find(item => item?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = entry?.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? entry.txHash : null;
  const unavailable = figures.failed && !fund;
  const net = fund ? BigInt(fund.last24h.investedMicros) - BigInt(fund.last24h.redeemedMicros) : null;
  return <section id="overview" className="gmd-fund" aria-labelledby="fund-title">
    <header className="gmd-section-heading"><div><h2 id="fund-title">Fund overview</h2><p>Live figures, refreshed every minute.</p></div></header>
    {unavailable && <p className="gmd-inline-error" role="status">Fund figures are unavailable right now. The NAV and verification are not affected.</p>}
    <div className="gmd-fund-grid" aria-busy={figures.pending}>
      <article><span>Fund size</span><strong>{figures.size === null ? figures.pending ? <Skeleton width={96} /> : "—" : formatUsdRounded(figures.size)}</strong><small>{figures.shares === null ? figures.pending ? <Skeleton width="80%" /> : "Unavailable" : figures.onChain && record ? `${formatSharesShort(figures.shares)} shares outstanding, recorded on X Layer at ${shortTime(record.effectiveAt)}` : `${formatSharesShort(figures.shares)} shares outstanding; recorded on X Layer with the next NAV`}{fund?.wallets && fund.demo && <><br />Now {formatSharesShort(fund.wallets.sharesMicros)} in wallets · {formatSharesShort(fund.demo.sharesMicros)} in demo balances</>}</small></article>
      <article><span>Investors</span><strong>{fund ? fund.investors.toLocaleString("en-US") : figures.pending ? <Skeleton width={40} /> : "—"}</strong><small>{!fund ? figures.pending ? <Skeleton width="70%" /> : "Unavailable" : fund.wallets && fund.demo ? `${fund.wallets.investors.toLocaleString("en-US")} ${fund.wallets.investors === 1 ? "holder" : "holders"} on X Layer · ${fund.demo.investors.toLocaleString("en-US")} with demo balances` : "Accounts holding USTX"}</small></article>
      <article><span>Net flows, 24h</span><strong className={net === null || net === 0n ? "" : net > 0n ? "gmd-positive" : "gmd-negative"}>{net === null ? figures.pending ? <Skeleton width={80} /> : "—" : `${net > 0n ? "+" : ""}${formatUsdRounded(net)}`}</strong><small>{fund ? `${formatUsdRounded(fund.last24h.investedMicros)} in · ${formatUsdRounded(fund.last24h.redeemedMicros)} out · ${fund.last24h.orders.toLocaleString("en-US")} ${fund.last24h.orders === 1 ? "order" : "orders"} with demo balances` : figures.pending ? <Skeleton width="85%" /> : "Unavailable"}</small></article>
      <article><span>Since launch</span><strong className={tone(since?.percent)}>{since ? signedPercent(since.percent) : figures.marketPending ? <Skeleton width={72} /> : "—"}</strong><small>{since ? `From ${formatUsdRounded(since.first.micros)} on ${day(since.first.at)}` : figures.marketPending ? <Skeleton width="60%" /> : "Unavailable"}</small></article>
    </div>
    {fund?.wallets && fund.demo && <p className="gmd-caption gmd-fund-split">Shares in wallets are USTX tokens on X Layer Testnet: they trade in the pool and serve as loan collateral. Shares in demo balances stay in this app. Both were issued at the recorded NAV, and the record counts both.</p>}
    {pool.market && pool.market.priceMicros > 0n && <PremiumGauge market={pool.market} />}
    <dl className="gmd-fund-facts">
      <div><dt>Launch date</dt><dd>{since ? day(since.first.at) : "—"}</dd></div>
      <div><dt>Minimum investment</dt><dd>$10</dd></div>
      <div><dt>Management fee</dt><dd>0.00%</dd></div>
      <div><dt>Dealing</dt><dd>Instant, at the fund’s NAV or the pool’s price</dd></div>
      <div><dt>Market price</dt><dd>{pool.market && pool.market.priceMicros > 0n ? <a className="gmd-inline-tx" href={fundExplorer.address(FUND_DEPLOYMENT.pool)} target="_blank" rel="noreferrer">{formatUsdMicros(pool.market.priceMicros, 2)}{pool.market.premiumPpm !== null ? ` · ${describePremium(pool.market.premiumPpm)}` : ""} · USTX/dUSD pool<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> : pool.failed ? "Unavailable right now" : "—"}</dd></div>
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
