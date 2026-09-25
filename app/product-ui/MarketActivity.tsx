"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { relativeTime, shortTime } from "@/lib/product-market";
import {
  ACTIVITY_FIRST_BLOCK, ACTIVITY_HIGHLIGHTS, ACTIVITY_LIMIT, isHighlight, mergeActivity, parseActivityDay, parseActivityIndex, parseHighlights, readActivityTail, withNewerRows,
  type ActivityDay, type ActivityKind, type MarketActivity,
} from "@/lib/xstocks/activity";
import { FUND_DEPLOYMENT, fundExplorer, fundRpc, pricePerShare } from "@/lib/xstocks/fund";
import { useMarket } from "./MarketProvider";
import { Icon, Skeleton } from "./Icons";
import { useWalletAccount } from "./WalletAccount";

// Market activity for USTX on X Layer Testnet: orders at the fund, trades in the pool, the keeper's
// arbitrage and the lending market, on the USTX page and in brief on Markets. The app's scheduled job
// keeps the latest rows and their 24-hour figures (GET /api/v1/ustx/activity); a page reads the
// blocks since, every minute and after an order here, and adds them to both.

const SHOWN = 8;

type Loaded = { rows: MarketActivity[]; highlights: MarketActivity[]; day: ActivityDay | null; head: number; complete: boolean; readAt: number };
type Activity = { loaded: Loaded | null; failed: boolean; retry: () => void };

function useActivityLoader(): Activity {
  const [state, setState] = useState<{ loaded: Loaded | null; failed: boolean }>({ loaded: null, failed: false });
  const [minBlock, setMinBlock] = useState(0);
  const [reload, setReload] = useState(0);
  // Rows and the last block this page has read, so each refresh reads only newer blocks.
  const seen = useRef<{ rows: MarketActivity[]; highlights: MarketActivity[]; head: number }>({ rows: [], highlights: [], head: 0 });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const body = await fetch("/api/v1/ustx/activity", { cache: "no-store", signal: controller.signal })
        .then(response => response.ok ? response.json() as Promise<{ day?: unknown; highlights?: unknown }> : null)
        .catch(() => null);
      const served = parseActivityIndex(body);
      const servedDay = served ? parseActivityDay(body?.day) : null;
      const tail = await readActivityTail(served, fundRpc({ signal: controller.signal }), { after: seen.current.head || undefined, minBlock });
      const rows = mergeActivity(seen.current.rows, tail.rows);
      // Marked on the NAV chart: the served arbitrages and large orders, and any this page read since.
      const highlights = mergeActivity(seen.current.highlights, [...parseHighlights(body?.highlights), ...rows.filter(isHighlight)], ACTIVITY_HIGHLIGHTS);
      seen.current = { rows, highlights, head: Math.max(seen.current.head, tail.head) };
      // The served figures count up to the served block; rows this page read since are added.
      const day = served && servedDay ? withNewerRows(servedDay, rows.filter(row => row.block > served.toBlock)) : null;
      return { rows, highlights, day, head: seen.current.head, complete: served !== null && (served.fromBlock <= ACTIVITY_FIRST_BLOCK || served.rows.length >= ACTIVITY_LIMIT), readAt: Date.now() };
    })()
      .then(loaded => { if (!controller.signal.aborted) setState({ loaded, failed: false }); })
      .catch(() => { if (!controller.signal.aborted) setState(previous => ({ ...previous, failed: true })); });
    return () => controller.abort();
  }, [minBlock, reload]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setReload(value => value + 1); }, 60_000);
    // An order on this page: read again up to its block.
    const onOrder = (event: Event) => {
      const block = (event as CustomEvent<{ block?: number }>).detail?.block;
      if (typeof block === "number") setMinBlock(current => Math.max(current, block));
      else setReload(value => value + 1);
    };
    window.addEventListener(DEMO_ORDER_EVENT, onOrder);
    return () => { window.clearInterval(timer); window.removeEventListener(DEMO_ORDER_EVENT, onOrder); };
  }, []);
  return { ...state, retry: () => setReload(value => value + 1) };
}

const ActivityContext = createContext<Activity | null>(null);

/** Reads the market activity once for a screen: its lists and the NAV chart's markers share it. */
export function ActivityProvider({ children }: { children: ReactNode }) {
  return <ActivityContext.Provider value={useActivityLoader()}>{children}</ActivityContext.Provider>;
}

function useMarketActivity(): Activity {
  const value = useContext(ActivityContext);
  if (!value) throw new Error("ActivityProvider is required");
  return value;
}

export type ChartEvent = { key: string; at: string; kind: "arbitrage" | "order"; title: string; detail: string; amount: string };

/** The keeper's arbitrage and orders of $1,000 or more, for the NAV chart; none outside a provider. */
export function useChartEvents(): ChartEvent[] {
  const highlights = useContext(ActivityContext)?.loaded?.highlights ?? [];
  return highlights.map(row => ({ key: `${row.hash}:${row.logIndex}`, at: row.at, kind: row.kind === "arbitrage" ? "arbitrage" : "order", ...describe(row) }));
}

const usd = (micros: bigint | null) => micros === null ? "—" : formatUsdMicros(micros, 2);
/** Earnings of under a cent keep four decimals, so they do not read as $0.00. */
const earnedUsd = (micros: bigint) => formatUsdMicros(micros, micros > 0n && micros < 10_000n ? 4 : 2);
const ustx = (micros: bigint | null) => micros === null ? "—" : `${formatSharesShort(micros, 4)} USTX`;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const ICONS: Record<ActivityKind, Parameters<typeof Icon>[0]["name"]> = {
  invest: "arrow", redeem: "back", buy: "arrow", sell: "back", addLiquidity: "market", removeLiquidity: "market", arbitrage: "refresh",
  deposit: "lock", withdrawCollateral: "back", borrow: "wallet", repay: "check", lend: "arrow", withdraw: "back", liquidate: "info",
};

/** What a row says: its title, the detail under it, and the amount beside it. */
function describe(row: MarketActivity): { title: string; detail: string; amount: string } {
  const price = row.dollarsMicros !== null && row.sharesMicros ? formatUsdMicros(pricePerShare(row.dollarsMicros, row.sharesMicros), 2) : "—";
  switch (row.kind) {
    case "invest": return { title: "Invested at the NAV", detail: `${ustx(row.sharesMicros)} at ${usd(row.navMicros)}`, amount: usd(row.dollarsMicros) };
    case "redeem": return { title: "Redeemed at the NAV", detail: `${ustx(row.sharesMicros)} at ${usd(row.navMicros)}`, amount: usd(row.dollarsMicros) };
    case "buy": return { title: "Bought in the pool", detail: `${ustx(row.sharesMicros)} at ${price}`, amount: usd(row.dollarsMicros) };
    case "sell": return { title: "Sold in the pool", detail: `${ustx(row.sharesMicros)} at ${price}`, amount: usd(row.dollarsMicros) };
    case "addLiquidity": return { title: "Added pool liquidity", detail: `With ${ustx(row.sharesMicros)}`, amount: usd(row.dollarsMicros) };
    case "removeLiquidity": return { title: "Removed pool liquidity", detail: `With ${ustx(row.sharesMicros)}`, amount: usd(row.dollarsMicros) };
    case "arbitrage": {
      const profit = row.dollarsOutMicros !== null && row.dollarsMicros !== null && row.dollarsOutMicros > row.dollarsMicros ? row.dollarsOutMicros - row.dollarsMicros : 0n;
      const earned = `earned ${earnedUsd(profit)}`;
      return {
        title: "Closed the gap to the NAV",
        detail: row.boughtInPool ? `Bought ${ustx(row.sharesMicros)} in the pool, redeemed at the fund, ${earned}` : `Invested at the fund, sold ${ustx(row.sharesMicros)} in the pool, ${earned}`,
        amount: usd(row.dollarsMicros),
      };
    }
    case "deposit": return { title: "Deposited collateral", detail: "USTX to borrow against", amount: ustx(row.sharesMicros) };
    case "withdrawCollateral": return { title: "Withdrew collateral", detail: "USTX back to the wallet", amount: ustx(row.sharesMicros) };
    case "borrow": return { title: "Borrowed", detail: "Demo dollars against USTX", amount: usd(row.dollarsMicros) };
    case "repay": return { title: "Repaid a loan", detail: "Demo dollars, with interest", amount: usd(row.dollarsMicros) };
    case "lend": return { title: "Lent demo dollars", detail: "Earning what borrowers pay", amount: usd(row.dollarsMicros) };
    case "withdraw": return { title: "Withdrew lent dollars", detail: "With interest", amount: usd(row.dollarsMicros) };
    case "liquidate": return { title: "Liquidated a loan", detail: `Repaid for ${row.borrower ? short(row.borrower) : "a borrower"}, took ${ustx(row.sharesMicros)}`, amount: usd(row.dollarsMicros) };
  }
}

/** The rows, each linked to its transaction on the OKX explorer. */
function ActivityList({ rows, clock, mine }: { rows: MarketActivity[]; clock: number; mine: string | null }) {
  const who = (account: string) => account === mine ? "You" : account === FUND_DEPLOYMENT.keeper ? "Arbitrage keeper" : short(account);
  return <ul className="gmd-activity-list" aria-label="Latest market activity">{rows.map(row => {
    const text = describe(row);
    return <li key={`${row.hash}:${row.logIndex}`}><a href={fundExplorer.tx(row.hash)} target="_blank" rel="noreferrer">
      <span className={`gmd-transaction-symbol is-${row.kind}`}><Icon name={ICONS[row.kind]} size={18} /></span>
      <span><b>{text.title}</b><small>{text.detail} · {who(row.account)}</small></span>
      {/* A block stamped a moment ahead of this device's clock reads as just now. */}
      <span><b>{text.amount}</b><small><time dateTime={row.at}>{relativeTime(row.at, Math.max(clock, Date.parse(row.at)))}</time></small></span>
      <Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span>
    </a></li>;
  })}</ul>;
}

/** Placeholder rows and figures while the first read of the activity is on its way. */
function ActivityLoading({ rows, figures = true }: { rows: number; figures?: boolean }) {
  return <div className="gmd-activity-loading" role="status">
    <span className="gmd-sr-only">Reading market activity from X Layer Testnet…</span>
    {figures && <div className="gmd-activity-day is-loading" aria-hidden="true">{[0, 1, 2, 3].map(item => <div key={item}><Skeleton width={84} /><Skeleton width={64} className="is-large" /><Skeleton width="80%" /></div>)}</div>}
    <ul className="gmd-activity-list is-loading" aria-hidden="true">{Array.from({ length: rows }, (_, item) => <li key={item}><span><Skeleton className="is-symbol" /><span><Skeleton width="56%" /><Skeleton width="78%" /></span><span><Skeleton width={58} /><Skeleton width={42} /></span></span></li>)}</ul>
  </div>;
}

/** The last 24 hours in four figures. */
function DayFigures({ day }: { day: ActivityDay }) {
  return <>
    <dl className="gmd-activity-day" aria-label="Market activity, last 24 hours">
      <div><dt>Volume, 24h</dt><dd><strong>{formatUsdRounded(day.volumeMicros)}</strong><small>Orders at the fund and in the pool</small></dd></div>
      <div><dt>Trades, 24h</dt><dd><strong>{day.trades.toLocaleString("en-US")}</strong><small>At the NAV, in the pool and arbitrage</small></dd></div>
      <div><dt>Arbitrage, 24h</dt><dd><strong>{day.arbitrages.toLocaleString("en-US")}</strong><small>{day.earnedMicros > 0n ? `Earned ${earnedUsd(day.earnedMicros)} closing gaps to the NAV` : "Keeps the pool at the NAV"}</small></dd></div>
      <div><dt>Loan actions, 24h</dt><dd><strong>{day.loans.toLocaleString("en-US")}</strong><small>Collateral, loans and lending</small></dd></div>
    </dl>
    {!day.complete && <p className="gmd-caption">Counted since {shortTime(day.since)}. Earlier activity is still being read from X Layer Testnet.</p>}
  </>;
}

/** The page clock, the connected wallet and the loaded activity, shared by both views. */
function useActivityView() {
  const activity = useMarketActivity();
  const { now } = useMarket();
  const { address, source } = useWalletAccount();
  // Rows read after the page's clock last ticked are timed from when they were read.
  const clock = Math.max(now, activity.loaded?.readAt ?? 0);
  return { ...activity, clock, mine: source === "wallet" && address ? address.toLowerCase() : null };
}

export function MarketActivitySection() {
  const { loaded, failed, retry, clock, mine } = useActivityView();
  const [expanded, setExpanded] = useState(false);
  const rows = loaded?.rows ?? [];
  return <section id="activity" className="gmd-fund gmd-market-activity" aria-labelledby="activity-title">
    <header className="gmd-section-heading"><div><h2 id="activity-title">Market activity</h2><p>Orders at the fund and in the pool, arbitrage and loans, as recorded on X Layer Testnet.</p></div><span className="gmd-badge">Updated every minute</span></header>
    {loaded?.day && <DayFigures day={loaded.day} />}
    {!loaded ? failed ? <p className="gmd-inline-error" role="status">Market activity could not be read right now. <button type="button" className="gmd-text-button" onClick={retry}>Try again</button></p> : <ActivityLoading rows={SHOWN} />
      : rows.length === 0 ? <p className="gmd-empty-note">No trades yet. Orders, pool trades and loans appear here as they are recorded.</p>
      : <ActivityList rows={expanded ? rows : rows.slice(0, SHOWN)} clock={clock} mine={mine} />}
    {rows.length > SHOWN && <button type="button" className="gmd-text-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${rows.length}`}</button>}
    <p className="gmd-caption">{loaded && !loaded.complete ? "Earlier activity appears as it is read from X Layer Testnet. " : ""}Each row opens its transaction on the OKX explorer. Demo dollars and USTX have no value.</p>
  </section>;
}

/** Markets: the last 24 hours and the latest four rows, with the full list on the USTX page. */
export function MarketPulse() {
  const { loaded, failed, clock, mine } = useActivityView();
  // Markets stays as it was when the chain cannot be read; the USTX page says why.
  if (failed && !loaded) return null;
  return <section className="gmd-market-pulse" aria-labelledby="pulse-title">
    <header className="gmd-section-heading"><div><h2 id="pulse-title">Market activity</h2><p>The latest orders, arbitrage and loans in USTX on X Layer Testnet.</p></div><Link prefetch={false} href="/products/ustx#activity">View all <Icon name="arrow" size={16} /></Link></header>
    {loaded?.day && <DayFigures day={loaded.day} />}
    {!loaded ? <ActivityLoading rows={4} />
      : loaded.rows.length === 0 ? <p className="gmd-empty-note">No trades yet. Orders, pool trades and loans appear here as they are recorded.</p>
      : <ActivityList rows={loaded.rows.slice(0, 4)} clock={clock} mine={mine} />}
  </section>;
}
