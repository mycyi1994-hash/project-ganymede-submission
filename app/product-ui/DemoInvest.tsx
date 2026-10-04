"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { parseUsd } from "@/lib/xstocks/wallet";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import type { FundPosition } from "@/lib/funds/demo";
import type { FundSummary } from "@/lib/funds/api";
import { valueDemoPortfolio } from "@/lib/demo/portfolio";
import { useFundResource } from "./useFundResource";
import { FundHoldings } from "./Funds";
import { Icon, Skeleton } from "./Icons";
import { useMarket } from "./MarketProvider";
import { BasketList, BasketTable, useRecordComposition } from "./Basket";
import { WalletInvest } from "./WalletInvest";
import { useWalletAccount } from "./WalletAccount";

// Demo investing with demo dollars in a private browser session. No real money moves and no
// shares are issued on chain; orders fill at the latest NAV recorded on X Layer. Investing from a
// wallet on X Layer Testnet is in WalletInvest; the panel offers both.

type Account = { cashMicros: string; sharesMicros: string; costMicros: string; ordersCount: number; exists: boolean };
type Order = { id: string; side: "subscribe" | "redeem"; usdMicros: string; sharesMicros: string; navMicros: string; navEffectiveAt: string; navHoldingsHash: string; createdAt: string };
type Side = "buy" | "sell";
type DemoAccountView = { account: Account; orders: Order[]; positions: FundPosition[] };

const VERIFY = "/products/ustx/transparency";
const SHARE = 1_000_000n;
const MIN_ORDER = 10_000_000n;

async function send(path: string, body?: unknown) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The demo service did not respond. Try again.");
  return payload as DemoAccountView & { order?: Order };
}

export function useDemoAccount() {
  const { data, error, replace } = useFundResource<DemoAccountView>("/api/demo/account");
  const apply = (body: DemoAccountView) => {
    replace(body);
    window.dispatchEvent(new Event(DEMO_ORDER_EVENT));
  };
  return {
    account: data?.account ?? null, orders: data?.orders ?? [], positions: data?.positions ?? [], error,
    async place(order: { side: "subscribe" | "redeem"; usdMicros?: string; sharesMicros?: string; clientOrderId: string }) {
      const body = await send("/api/demo/orders", order);
      apply(body);
      return body.order!;
    },
    async reset() { apply(await send("/api/demo/reset")); },
  };
}

/** The latest recorded NAV the page has read, used for estimates; the server fills at its own read. */
function useRecordedNav() {
  const { data } = useMarket();
  const record = data?.onchain?.effectiveAt && !data.onchainError ? data.onchain : null;
  return record ? { navMicros: BigInt(record.navPerShareMicros), at: record.effectiveAt } : null;
}

/** Pays from the demo balance held for this browser; no wallet needed. */
function DemoInvest({ tabs }: { tabs: ReactNode }) {
  const demo = useDemoAccount();
  const nav = useRecordedNav();
  const { composition, holdingsHash } = useRecordComposition();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("1,000");
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [filled, setFilled] = useState<Order | null>(null);

  const account = demo.account;
  const cash = account ? BigInt(account.cashMicros) : 0n;
  const held = account ? BigInt(account.sharesMicros) : 0n;
  const usd = side === "buy" ? parseUsd(amount) : null;
  const shares = side === "sell" ? parseShares(amount) : null;
  const problem = !account ? null
    : side === "buy" ? (usd === null ? "Enter an amount in dollars, such as 1,000." : usd < MIN_ORDER ? "The minimum order is $10." : usd > cash ? "That is more than your demo cash." : null)
    : (held === 0n ? "You hold no USTX yet." : shares === null || shares === 0n ? "Enter a number of shares, up to six decimals." : shares > held ? "That is more than the shares you hold." : null);
  const estimate = nav && !problem ? side === "buy" && usd ? `${formatShares(usd * SHARE / nav.navMicros)} USTX` : side === "sell" && shares ? formatUsdRounded(shares * nav.navMicros / SHARE) : "—" : "—";
  const choose = (next: Side) => { setSide(next); setAmount(next === "buy" ? "1,000" : ""); setReview(null); setFailure(null); setFilled(null); };

  async function submit() {
    if (!review) return;
    setBusy(true); setFailure(null);
    try {
      const order = await demo.place(side === "buy" ? { side: "subscribe", usdMicros: usd!.toString(), clientOrderId: review } : { side: "redeem", sharesMicros: shares!.toString(), clientOrderId: review });
      setFilled(order); setReview(null); setAmount(side === "buy" ? "1,000" : "");
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "The order was not placed.");
    } finally { setBusy(false); }
  }

  const heading = filled ? "Order filled" : review ? `Review ${side === "buy" ? "investment" : "redemption"}` : "Invest in USTX";
  return <>
    <div className="gmd-order-heading"><h2 id="invest-title">{heading}</h2><Icon name="wallet" /></div>
    {!review && !filled && tabs}
    {demo.error ? <p className="gmd-inline-error" role="alert">{demo.error}</p> : !account ? <p className="gmd-caption" role="status">Opening your demo account…</p>
      : filled ? <div className="gmd-order-review" role="status">
        <span>{filled.side === "subscribe" ? "You bought" : "You redeemed"}</span>
        <strong>{formatShares(filled.sharesMicros)}</strong><span>USTX</span>
        <dl className="gmd-facts">
          <div><dt>{filled.side === "subscribe" ? "Paid" : "Received"}</dt><dd>{formatUsdMicros(filled.usdMicros, 2)}</dd></div>
          <div><dt>NAV per share</dt><dd>{formatUsdMicros(filled.navMicros, 4)}</dd></div>
          <div><dt>Priced by</dt><dd>OKX OnchainOS</dd></div>
          <div><dt>Recorded on X Layer</dt><dd>{shortTime(filled.navEffectiveAt)}</dd></div>
          <div><dt>Balance left</dt><dd>{formatUsdMicros(account.cashMicros, 2)}</dd></div>
        </dl>
        {composition && <div className="gmd-order-basket">
          <h3>{filled.side === "subscribe" ? "Added to your basket" : "Taken out of your basket"}</h3>
          <BasketList composition={composition} sharesMicros={BigInt(filled.sharesMicros)} label={filled.side === "subscribe" ? "Tokens this order added" : "Tokens this redemption removed"} />
          <p className="gmd-caption">{holdingsHash === filled.navHoldingsHash.toLowerCase() ? "At the OKX OnchainOS prices in the record your order filled at." : "Token amounts per share are fixed until the next rebalance; values use the latest OKX OnchainOS prices."}</p>
        </div>}
        <Link prefetch={false} className="gmd-button" href="/portfolio">View portfolio <Icon name="arrow" size={16} /></Link>
        <Link prefetch={false} className="gmd-text-button gmd-inline-link" href={VERIFY}>Verify this price</Link>
        <button type="button" className="gmd-text-button" onClick={() => setFilled(null)}>Place another order</button>
      </div>
      : review ? <div className="gmd-order-review">
        <span>{side === "buy" ? "You pay" : "You redeem"}</span>
        <strong>{side === "buy" ? formatUsdMicros(usd!, 2) : formatShares(shares!)}</strong><span>{side === "buy" ? "demo dollars" : "USTX"}</span>
        <dl className="gmd-facts">
          <div><dt>Basket</dt><dd>US Tech Basket</dd></div>
          <div><dt>NAV per share</dt><dd>{nav ? `${formatUsdMicros(nav.navMicros, 4)} · ${shortTime(nav.at)}` : "Latest recorded NAV"}</dd></div>
          <div><dt>Priced by</dt><dd>OKX OnchainOS</dd></div>
          <div><dt>{side === "buy" ? "Estimated shares" : "Estimated proceeds"}</dt><dd>{estimate}</dd></div>
          <div><dt>Fee</dt><dd>None</dd></div>
          <div><dt>Paid from</dt><dd>Demo balance</dd></div>
        </dl>
        {failure && <p className="gmd-inline-error" role="alert">{failure}</p>}
        <button type="button" className="gmd-button" disabled={busy} onClick={submit}>{busy ? "Placing order…" : side === "buy" ? "Buy with demo dollars" : "Redeem shares"} {!busy && <Icon name="arrow" size={17} />}</button>
        <button type="button" className="gmd-text-button" disabled={busy} onClick={() => { setReview(null); setFailure(null); }}>Edit order</button>
        <p className="gmd-caption">The order fills at the latest NAV recorded on X Layer when you confirm, which can differ slightly from this estimate.</p>
      </div>
      : <>
        <div className="gmd-segmented" role="group" aria-label="Order type">
          <button type="button" aria-pressed={side === "buy"} onClick={() => choose("buy")}>Buy</button>
          <button type="button" aria-pressed={side === "sell"} onClick={() => choose("sell")}>Redeem</button>
        </div>
        <div className="gmd-order-input">
          <label htmlFor="invest-amount">{side === "buy" ? "You invest" : "Shares to redeem"}</label>
          <div><input id="invest-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={event => { setAmount(event.target.value); setFailure(null); }} aria-invalid={Boolean(problem)} aria-describedby="invest-help" /><span>{side === "buy" ? "USD" : "USTX"}</span></div>
          <p id="invest-help">{problem ?? (side === "buy" ? `Demo balance: ${formatUsdMicros(cash, 2)}` : `You hold ${formatShares(held)} USTX`)}</p>
        </div>
        <div className="gmd-order-presets" aria-label={side === "buy" ? "Investment amounts" : "Redemption amounts"}>
          {side === "buy"
            ? [["$250", "250"], ["$1,000", "1,000"], ["Max", (cash / 1_000_000n).toLocaleString("en-US")]].map(([label, value]) => <button type="button" key={label} aria-pressed={amount === value} onClick={() => setAmount(value)}>{label}</button>)
            : [["Half", held / 2n], ["All", held]].map(([label, value]) => <button type="button" key={String(label)} disabled={held === 0n} aria-pressed={amount === formatShares(value as bigint).replace(/,/g, "")} onClick={() => setAmount(formatShares(value as bigint).replace(/,/g, ""))}>{String(label)}</button>)}
        </div>
        <div className="gmd-order-estimate"><span>{side === "buy" ? "Estimated shares" : "Estimated proceeds"}</span><strong>{estimate}</strong></div>
        <dl className="gmd-facts">
          <div><dt>NAV per share</dt><dd>{nav ? formatUsdMicros(nav.navMicros, 4) : "—"}</dd></div>
          <div><dt>Recorded on X Layer</dt><dd>{nav ? shortTime(nav.at) : "—"}</dd></div>
          <div><dt>Fee</dt><dd>None</dd></div>
        </dl>
        <button type="button" className="gmd-button" disabled={Boolean(problem) || !nav} onClick={() => setReview(crypto.randomUUID())}>Review {side === "buy" ? "investment" : "redemption"} <Icon name="arrow" size={17} /></button>
        <p className="gmd-caption">Demo dollars only. No real money moves. Your holdings stay in this demo account.</p>
      </>}
  </>;
}

/**
 * The order panel, one view: with OKX Wallet connected, orders go from the wallet and are recorded
 * on X Layer Testnet; without one, they fill from this browser's demo balance at once. A line at the
 * top says which, with the one action that changes it.
 */
export function InvestPanel() {
  const router = useRouter();
  const { address, source, busy: connecting, connect } = useWalletAccount();
  const connected = source === "wallet" && Boolean(address);
  const [demoInstead, setDemoInstead] = useState(false);
  const mode = connected && !demoInstead ? "wallet" : "demo";
  const route = mode === "wallet"
    ? <div className="gmd-invest-route is-chain" role="group" aria-label="Pay with">
      <p><i aria-hidden="true" /><span><b>From your wallet</b> · recorded on X Layer Testnet</span></p>
      <button type="button" className="gmd-text-button" onClick={() => setDemoInstead(true)}>Use demo balance</button>
    </div>
    : <div className="gmd-invest-route is-demo" role="group" aria-label="Pay with">
      <p><i aria-hidden="true" /><span><b>Demo balance</b> · no wallet needed, not recorded on chain</span></p>
      <button type="button" className="gmd-text-button" disabled={connecting} onClick={() => {
        setDemoInstead(false);
        if (connected) return;
        // Without an injected wallet, the portfolio page explains how to connect.
        if (!window.okxwallet && !window.ethereum) { router.push("/portfolio#wallet"); return; }
        void connect();
      }}>{connected ? "Use my wallet" : connecting ? "Connecting…" : "Connect OKX Wallet to invest on X Layer"}</button>
    </div>;
  return <aside className="gmd-order-panel" aria-labelledby="invest-title">{mode === "wallet" ? <WalletInvest tabs={route} onUseDemo={() => setDemoInstead(true)} /> : <DemoInvest tabs={route} />}</aside>;
}

export function DemoPortfolio() {
  const demo = useDemoAccount();
  const nav = useRecordedNav();
  const { composition } = useRecordComposition();
  const [resetting, setResetting] = useState(false);
  const { data: fundData } = useFundResource<{ funds: FundSummary[] }>("/api/v1/funds");
  const account = demo.account;
  const shares = account ? BigInt(account.sharesMicros) : 0n;
  const cost = account ? BigInt(account.costMicros) : 0n;
  const cash = account ? BigInt(account.cashMicros) : 0n;
  const value = nav ? shares * nav.navMicros / SHARE : null;
  // Whole cents toward zero, so a sub-cent rounding difference reads as no change rather than −$0.00.
  const gain = value === null ? null : (value - cost) / 10_000n * 10_000n;
  const percent = gain !== null && cost > 0n ? Number(gain * 1_000_000n / cost) / 10_000 : null;
  const tone = gain === null || gain === 0n ? "" : gain > 0n ? "gmd-positive" : "gmd-negative";
  const signed = (micros: bigint) => micros === 0n ? formatUsdMicros(0n, 2) : `${micros < 0n ? "−" : "+"}${formatUsdMicros(micros < 0n ? -micros : micros, 2)}`;
  const signedPercent = (value: number) => value === 0 ? "0.00%" : `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
  const navs = new Map((fundData?.funds ?? []).map(fund => [fund.id, fund.nav?.perShareMicros ?? null]));
  navs.set("us-tech-x", nav?.navMicros.toString() ?? null);
  const portfolio = account ? valueDemoPortfolio(account, demo.positions, navs) : null;
  const totalGain = portfolio?.gainMicros === null || !portfolio ? null : portfolio.gainMicros / 10_000n * 10_000n;
  const totalPercent = totalGain !== null && portfolio && portfolio.investedMicros > 0n ? Number(totalGain * 1_000_000n / portfolio.investedMicros) / 10_000 : null;
  const totalTone = totalGain === null || totalGain === 0n ? "" : totalGain > 0n ? "gmd-positive" : "gmd-negative";
  async function reset() {
    if (!window.confirm("Start again with $10,000 demo dollars? Your demo holdings and history will be cleared.")) return;
    setResetting(true);
    try { await demo.reset(); } finally { setResetting(false); }
  }
  return <section className="gmd-demo-portfolio" aria-labelledby="demo-title">
    <header className="gmd-section-heading"><div><h2 id="demo-title">Your investments</h2><p>Your demo funds, available cash and returns.</p></div><Link prefetch={false} className="gmd-button" href="/products/ustx#investment">Invest <Icon name="arrow" size={16} /></Link></header>
    {demo.error ? <p className="gmd-inline-error" role="alert">{demo.error}</p> : !account ? <div className="gmd-portfolio-summary is-loading" role="status"><span className="gmd-sr-only">Opening your demo account…</span><div aria-hidden="true"><Skeleton width={90} /><Skeleton className="is-hero" /><Skeleton width="72%" /></div><div className="gmd-loading-facts" aria-hidden="true">{[0, 1, 2].map(item => <span key={item}><Skeleton width={96} /><Skeleton width={120} /></span>)}</div></div> : <>
      <div className="gmd-portfolio-summary">
        <div><span className="gmd-label">Total value</span><strong className="gmd-value">{portfolio?.totalMicros == null ? "—" : formatUsdRounded(portfolio.totalMicros)}</strong><p>{portfolio?.totalMicros == null ? "Updating prices for your holdings." : "Available cash and the current value of all your demo funds."}</p></div>
        <dl>
          <div><dt>Cash balance</dt><dd>{formatUsdMicros(cash, 2)}</dd></div>
          <div><dt>Invested</dt><dd>{formatUsdMicros(portfolio?.investedMicros ?? 0n, 2)}</dd></div>
          <div><dt>Unrealized return</dt><dd className={totalTone}>{totalGain === null ? "—" : signed(totalGain)}{totalPercent !== null && <small>{signedPercent(totalPercent)}</small>}</dd></div>
        </dl>
      </div>
      <div className="gmd-position-table">
        <div className="gmd-position-row is-head"><span>Basket</span><span>Shares</span><span>Value</span><span>Return</span><span>Actions</span></div>
        {shares === 0n ? <p className="gmd-empty-note">You hold no USTX yet. Start with {formatUsdMicros(cash, 2)} in demo dollars.</p> : <div className="gmd-position-row">
          <div className="gmd-position-name"><span className="gmd-mini-monogram">G</span><div><b>US Tech Basket</b><small>USTX · 9 xStocks</small></div></div>
          <div><span className="gmd-mobile-label">Shares</span><b>{formatShares(shares)}</b><small>{nav ? `${formatUsdMicros(nav.navMicros, 4)} / share` : ""}</small></div>
          <div><span className="gmd-mobile-label">Value</span><b>{value === null ? "—" : formatUsdRounded(value)}</b><small>{formatUsdMicros(cost, 2)} invested</small></div>
          <div className={tone}><span className="gmd-mobile-label">Return</span><b>{gain === null ? "—" : signed(gain)}</b><small>{percent === null ? "" : signedPercent(percent)}</small></div>
          <div className="gmd-position-actions"><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Buy</Link><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Redeem</Link></div>
        </div>}
      </div>
      <FundHoldings positions={demo.positions} funds={fundData?.funds ?? null} />
      {shares > 0n && <section className="gmd-inside" aria-labelledby="inside-title">
        <header className="gmd-section-heading"><div><h3 id="inside-title">Inside your USTX</h3><p>Your {formatShares(shares)} shares, looked through to the nine xStocks.</p></div></header>
        {composition ? <BasketTable composition={composition} sharesMicros={shares} label="Your USTX looked through to each xStock" chart /> : <p className="gmd-caption">Waiting for the latest record to show what your shares hold…</p>}
        <p className="gmd-caption">Each USTX share is valued as fixed token amounts of each xStock until the next quarterly rebalance. Values use the latest OKX OnchainOS prices recorded on X Layer.</p>
      </section>}
      <div className="gmd-demo-activity">
        <header className="gmd-section-heading"><h3>Recent orders</h3><span>{demo.orders.length ? `${demo.orders.length} shown` : "None yet"}</span></header>
        {demo.orders.length > 0 && <div className="gmd-activity-rows">{demo.orders.map(order => <div className="gmd-activity-row" key={order.id}>
          <span className="gmd-transaction-symbol is-complete"><Icon name={order.side === "subscribe" ? "arrow" : "back"} /></span>
          <span><b>{order.side === "subscribe" ? "Bought USTX" : "Redeemed USTX"}</b><small>{shortTime(order.createdAt)} · NAV {formatUsdMicros(order.navMicros, 4)} recorded {shortTime(order.navEffectiveAt)}</small></span>
          <span><b>{formatUsdMicros(order.usdMicros, 2)}</b><small>{formatShares(order.sharesMicros)} USTX</small></span>
        </div>)}</div>}
        <button type="button" className="gmd-text-button" disabled={resetting || !account.exists} onClick={reset}>{resetting ? "Resetting…" : "Reset demo balance"}</button>
      </div>
    </>}
  </section>;
}
