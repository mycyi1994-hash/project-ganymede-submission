"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { formatUsdMicros } from "@/lib/nav-display";
import { relativeTime } from "@/lib/product-market";
import { ACTIVITY_FIRST_BLOCK, ACTIVITY_LIMIT, mergeActivity, parseActivityIndex, readActivityTail, type ActivityKind, type MarketActivity } from "@/lib/xstocks/activity";
import { FUND_DEPLOYMENT, fundExplorer, fundRpc, pricePerShare } from "@/lib/xstocks/fund";
import { useMarket } from "./MarketProvider";
import { Icon } from "./Icons";
import { useWalletAccount } from "./WalletAccount";

// Market activity for USTX on X Layer Testnet: orders at the fund, trades in the pool, the keeper's
// arbitrage and the lending market. The app's scheduled job keeps the latest rows
// (GET /api/v1/ustx/activity); this page reads the blocks since, every minute and after an order here.

const SHOWN = 8;

type Loaded = { rows: MarketActivity[]; head: number; complete: boolean; readAt: number };

function useMarketActivity() {
  const [state, setState] = useState<{ loaded: Loaded | null; failed: boolean }>({ loaded: null, failed: false });
  const [minBlock, setMinBlock] = useState(0);
  const [reload, setReload] = useState(0);
  // Rows and the last block this page has read, so each refresh reads only newer blocks.
  const seen = useRef<{ rows: MarketActivity[]; head: number }>({ rows: [], head: 0 });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const served = await fetch("/api/v1/ustx/activity", { cache: "no-store", signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(body => parseActivityIndex(body))
        .catch(() => null);
      const tail = await readActivityTail(served, fundRpc({ signal: controller.signal }), { after: seen.current.head || undefined, minBlock });
      const rows = mergeActivity(seen.current.rows, tail.rows);
      seen.current = { rows, head: Math.max(seen.current.head, tail.head) };
      return { rows, head: seen.current.head, complete: served !== null && (served.fromBlock <= ACTIVITY_FIRST_BLOCK || served.rows.length >= ACTIVITY_LIMIT), readAt: Date.now() };
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

const usd = (micros: bigint | null) => micros === null ? "—" : formatUsdMicros(micros, 2);
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
      const earned = `earned ${formatUsdMicros(profit, profit > 0n && profit < 10_000n ? 4 : 2)}`;
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

export function MarketActivitySection() {
  const { loaded, failed, retry } = useMarketActivity();
  const { now } = useMarket();
  const { address, source } = useWalletAccount();
  const [expanded, setExpanded] = useState(false);
  const mine = source === "wallet" && address ? address.toLowerCase() : null;
  const rows = loaded?.rows ?? [];
  // Rows read after the page's clock last ticked are timed from when they were read; a block
  // stamped a moment ahead of this device's clock reads as just now.
  const clock = Math.max(now, loaded?.readAt ?? 0);
  const shown = expanded ? rows : rows.slice(0, SHOWN);
  const who = (account: string) => account === mine ? "You" : account === FUND_DEPLOYMENT.keeper ? "Arbitrage keeper" : short(account);
  return <section id="activity" className="gmd-fund gmd-market-activity" aria-labelledby="activity-title">
    <header className="gmd-section-heading"><div><h2 id="activity-title">Market activity</h2><p>Orders at the fund and in the pool, arbitrage and loans, as recorded on X Layer Testnet.</p></div><span className="gmd-badge">Updated every minute</span></header>
    {!loaded ? failed ? <p className="gmd-inline-error" role="status">Market activity could not be read right now. <button type="button" className="gmd-text-button" onClick={retry}>Try again</button></p> : <p className="gmd-caption" role="status">Reading market activity from X Layer Testnet…</p>
      : rows.length === 0 ? <p className="gmd-empty-note">No trades yet. Orders, pool trades and loans appear here as they are recorded.</p>
      : <ul aria-label="Latest market activity">{shown.map(row => {
        const text = describe(row);
        return <li key={`${row.hash}:${row.logIndex}`}><a href={fundExplorer.tx(row.hash)} target="_blank" rel="noreferrer">
          <span className={`gmd-transaction-symbol is-${row.kind}`}><Icon name={ICONS[row.kind]} size={18} /></span>
          <span><b>{text.title}</b><small>{text.detail} · {who(row.account)}</small></span>
          <span><b>{text.amount}</b><small><time dateTime={row.at}>{relativeTime(row.at, Math.max(clock, Date.parse(row.at)))}</time></small></span>
          <Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span>
        </a></li>;
      })}</ul>}
    {rows.length > SHOWN && <button type="button" className="gmd-text-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${rows.length}`}</button>}
    <p className="gmd-caption">{loaded && !loaded.complete ? "Earlier activity appears as it is read from X Layer Testnet. " : ""}Each row opens its transaction on the OKX explorer. Demo dollars and USTX have no value.</p>
  </section>;
}
