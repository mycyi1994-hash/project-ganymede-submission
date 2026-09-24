"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icons";
import { designLink } from "./ProductShell";
import { ProductScreen } from "./ProductScreens";

// Deliberately isolated from portfolio APIs and wallets. Mounted only by a dev-only page.
const example = { nav: 99.4392, shares: 125.25, cost: 12_525, available: 8_000 };
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function OrderPreview({ startReview = false }: { startReview?: boolean }) {
  const [amount, setAmount] = useState("1000");
  const [review, setReview] = useState(startReview);
  const value = Number(amount);
  const valid = /^\d+(\.\d{0,2})?$/.test(amount) && value >= 25 && value <= example.available;
  const fee = value * .0025;
  const units = Math.floor((value - fee) / example.nav * 1e6) / 1e6;
  return <aside className="gmd-order-panel"><div className="gmd-order-heading"><h2>{review ? "Review investment" : "Invest in USTX"}</h2><Icon name="wallet" /></div><p className="gmd-example-note">Example quote · Design preview</p>{review ? <div className="gmd-order-review"><span>You pay</span><strong>{money(value)}</strong><span>USDC</span><dl className="gmd-facts"><div><dt>Basket</dt><dd>US Tech Basket</dd></div><div><dt>Example price</dt><dd>{money(example.nav)}</dd></div><div><dt>Example fee</dt><dd>{money(fee)}</dd></div><div><dt>You receive</dt><dd>{units.toFixed(6)} USTX</dd></div><div><dt>Account</dt><dd>Example account</dd></div></dl><p className="gmd-caption">These terms illustrate the order layout. No executable quote or investment is created.</p><Link className="gmd-button" href={`${designLink("transaction", "pending")}&amount=${value.toFixed(2)}`} prefetch={false}>Preview processing <Icon name="arrow" size={16} /></Link><button className="gmd-text-button" onClick={() => setReview(false)}>Edit amount</button></div> : <><div className="gmd-order-input"><label htmlFor="example-amount">You invest</label><div><input id="example-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={!valid} aria-describedby="example-amount-help" /><span>USDC</span></div><p id="example-amount-help">{valid ? `Example balance: ${money(example.available)} USDC` : value > example.available ? "Amount exceeds the example balance." : "Enter an amount from 25 to 8,000, with up to two decimals."}</p></div><div className="gmd-order-presets" aria-label="Example investment amounts">{[250, 500, 1000].map(v => <button key={v} aria-pressed={amount === String(v)} onClick={() => setAmount(String(v))}>{money(v)}</button>)}</div><div className="gmd-order-estimate"><span>Estimated shares</span><strong>{valid ? units.toFixed(6) : "—"}<small>USTX</small></strong></div><dl className="gmd-facts"><div><dt>Example price</dt><dd>{money(example.nav)}</dd></div><div><dt>Example fee · 0.25%</dt><dd>{valid ? money(fee) : "—"}</dd></div><div><dt>Receive in</dt><dd>Example account</dd></div></dl><button className="gmd-button" disabled={!valid} onClick={() => setReview(true)}>Review investment <Icon name="arrow" size={17} /></button><p className="gmd-caption">Example terms only. No wallet signature or transaction.</p></>}</aside>;
}

export function ProductDesignPreview({ order = false }: { order?: boolean }) { return <ProductScreen preview orderPanel={<OrderPreview startReview={order} />} />; }

export function HoldingDesignPreview() {
  return <ProductScreen preview holding orderPanel={<aside className="gmd-order-panel"><div className="gmd-order-heading"><h2>Your USTX position</h2><Icon name="portfolio" /></div><p className="gmd-example-note">Example holding · Design preview</p><span className="gmd-label">Position value</span><strong className="gmd-value">{money(example.nav * example.shares)}</strong><dl className="gmd-facts"><div><dt>Available shares</dt><dd>125.250000 USTX</dd></div><div><dt>Invested</dt><dd>{money(example.cost)}</dd></div><div><dt>Example valuation</dt><dd>$99.4392 / share</dd></div><div><dt>Unrealized return</dt><dd className="gmd-negative">−$70.24 (−0.56%)</dd></div></dl><Link className="gmd-button" href={designLink("product")} prefetch={false}>Add to this position <Icon name="arrow" size={16} /></Link><a className="gmd-text-button gmd-inline-link" href="#terms">Read withdrawal terms</a><p className="gmd-caption">This example holding is separate from the published model NAV shown on the left.</p></aside>} />;
}

export function PortfolioDesignPreview() {
  const value = example.nav * example.shares;
  const pnl = value - example.cost;
  return <><div className="gmd-page-heading"><div><h1>Portfolio</h1><p>Your investments, in focus.</p></div><Link className="gmd-button" prefetch={false} href={designLink("product")}>Explore markets <Icon name="arrow" size={17} /></Link></div>
    <section className="gmd-portfolio-summary" aria-label="Example portfolio summary"><div><span className="gmd-label">Total portfolio value</span><strong className="gmd-value">{money(value)}</strong><p>Example valuation · 24 Sept, 09:40 UTC</p></div><dl><div><dt>Invested</dt><dd>{money(example.cost)}</dd></div><div><dt>Unrealized return</dt><dd className="gmd-negative">−{money(-pnl)}<small>−0.56%</small></dd></div><div><dt>Holdings</dt><dd>1<small>basket</small></dd></div></dl></section>
    <Link href={designLink("transaction", "pending")} className="gmd-pending-strip" prefetch={false}><span className="gmd-transaction-symbol"><Icon name="activity" /></span><span><b>Your USTX investment is processing</b><small>1,000 USDC · Funds received · Not included in portfolio value</small></span><span>View progress <Icon name="chevron" size={16} /></span></Link>
    <section className="gmd-positions"><header className="gmd-section-heading"><div><h2>Holdings</h2><p>Your shares and their latest valuation</p></div><span className="gmd-count">1 basket</span></header><div className="gmd-position-table"><div className="gmd-position-row is-head"><span>Basket</span><span>Shares</span><span>Value</span><span>Return</span><span>Actions</span></div><div className="gmd-position-row"><div className="gmd-position-name"><span className="gmd-mini-monogram">G</span><div><b>US Tech Basket</b><small>USTX · 6 xStocks</small></div></div><div><span className="gmd-mobile-label">Shares</span><b>125.250000</b><small>{money(example.nav)} / share</small></div><div><span className="gmd-mobile-label">Value</span><b>{money(value)}</b><small>{money(example.cost)} invested</small></div><div className="gmd-negative"><span className="gmd-mobile-label">Return</span><b>−{money(-pnl)}</b><small>−0.56%</small></div><div><Link className="gmd-small-button" prefetch={false} href={designLink("holding")}>View position <Icon name="arrow" size={15} /></Link></div></div></div></section>
    <div className="gmd-portfolio-bottom"><section className="gmd-portfolio-allocation"><header className="gmd-section-heading"><h2>Allocation</h2><span>By value</span></header><div className="gmd-full-allocation" /><div><span><i />US Tech Basket</span><b>100%</b></div><p>Exposure to six US technology xStocks through one basket.</p></section><section className="gmd-recent-activity"><header className="gmd-section-heading"><h2>Recent activity</h2><Link prefetch={false} href={designLink("activity")}>View all <Icon name="arrow" size={16} /></Link></header><ActivityRows /></section></div>
  </>;
}

function ActivityRows() {
  return <div className="gmd-activity-rows"><Link href={designLink("transaction", "pending")} prefetch={false}><span className="gmd-transaction-symbol"><Icon name="arrow" /></span><span><b>Invest in USTX</b><small>24 Sept · 09:41 UTC</small></span><span><b>1,000 USDC</b><small className="gmd-waiting">Processing</small></span><Icon name="chevron" size={16} /></Link><Link href={designLink("transaction", "completed")} prefetch={false}><span className="gmd-transaction-symbol is-complete"><Icon name="check" /></span><span><b>Invest in USTX</b><small>23 Sept · 10:20 UTC</small></span><span><b>12,525 USDC</b><small className="gmd-positive">Completed</small></span><Icon name="chevron" size={16} /></Link></div>;
}

export function ActivityDesignPreview() { return <><div className="gmd-page-heading"><div><h1>Activity</h1><p>Your investments and withdrawals, from start to finish.</p></div><span className="gmd-page-context">Example account</span></div><section className="gmd-activity-page"><header className="gmd-section-heading"><h2>All transactions</h2><span>2 transactions</span></header><ActivityRows /></section></>; }

export function TransactionDesignPreview({ scenario = "pending", amount }: { scenario?: string; amount?: number }) {
  const router = useRouter();
  const complete = scenario === "completed";
  const recovery = scenario === "recovery";
  const value = amount ?? (complete ? example.cost : 1000);
  const displayAmount = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const units = amount === undefined && complete ? example.shares : Math.floor(value * .9975 / example.nav * 1e6) / 1e6;
  const stages = [
    { label: "Investment submitted", copy: "Your request has been received.", done: true, at: "09:40" },
    { label: "Funds received", copy: `${displayAmount} USDC confirmed.`, done: true, at: "09:41" },
    { label: recovery ? "Purchase needs attention" : "Basket purchase", copy: recovery ? "Funds received. Asset purchase did not complete." : complete ? "The basket purchase is complete." : "Your investment is being allocated to the basket.", done: complete, active: !complete, at: complete ? "09:42" : "" },
    { label: "Shares in your portfolio", copy: complete ? `${units.toFixed(6)} USTX credited.` : "Your shares appear after settlement is confirmed.", done: complete, at: complete ? "09:43" : "" },
  ];
  return <><Link className="gmd-breadcrumb" href={designLink("activity")} prefetch={false}><Icon name="back" size={16} />All activity</Link><div className="gmd-page-heading"><div><h1>{recovery ? "Your investment needs attention" : complete ? "Investment complete" : "Your investment is on its way"}</h1><p>US Tech Basket · USTX</p></div><span className={`gmd-status ${complete ? "is-positive" : "is-waiting"}`}><i />{complete ? "Completed" : recovery ? "Recovery in progress" : "Processing"}</span></div>
    <div className="gmd-transaction-layout"><section className="gmd-transaction-main"><div className="gmd-transaction-amount"><span>{complete ? "Invested" : "Investment amount"}</span><strong>{displayAmount}<small>USDC</small></strong><p>{complete ? "Your shares are now part of your portfolio." : "You can leave this page and follow this transaction in Activity."}</p></div><ol className="gmd-timeline">{stages.map((stage, i) => <li key={i} className={stage.done ? "is-done" : stage.active ? recovery ? "is-recovery" : "is-current" : ""}><span className="gmd-timeline-dot">{stage.done ? <Icon name="check" size={14} /> : i + 1}</span><div><b>{stage.label}</b><p>{stage.copy}</p></div><span>{stage.at && `${stage.at} UTC`}</span></li>)}</ol>{recovery && <div className="gmd-recovery-note"><Icon name="info" /><div><b>Your funds are not counted as invested.</b><p>Example recovery state: a return of funds is pending. Do not submit the same investment again.</p></div></div>}<Link className="gmd-button" prefetch={false} href={designLink("portfolio")}>{complete ? "View portfolio" : "Back to portfolio"}<Icon name="arrow" size={17} /></Link></section><aside className="gmd-transaction-details"><h2>Transaction details</h2><dl className="gmd-facts"><div><dt>Type</dt><dd>Investment</dd></div><div><dt>Basket</dt><dd>US Tech Basket</dd></div><div><dt>Paid with</dt><dd>USDC</dd></div><div><dt>Account</dt><dd>Example account</dd></div><div><dt>Reference</dt><dd>Example only</dd></div></dl><p>This screen uses example transaction states. No funds move.</p><div className="gmd-scenario-picker"><label htmlFor="design-state">Preview another state</label><select id="design-state" value={scenario} onChange={event => { router.push(`${designLink("transaction", event.target.value)}&amount=${value.toFixed(2)}`); }}><option value="pending">Processing</option><option value="completed">Completed</option><option value="recovery">Recovery</option></select></div></aside></div>
  </>;
}
