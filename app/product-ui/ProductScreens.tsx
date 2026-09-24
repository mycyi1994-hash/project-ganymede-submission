"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { publicationStatus } from "@/lib/nav-status";
import { compositionForRecord, publicationHistory, shortTime } from "@/lib/product-market";
import { USTX_CAPABILITY } from "@/lib/product-contract";
import { useMarket } from "./MarketProvider";
import { Icon, AssetMark, assetSymbols } from "./Icons";
import { designLink } from "./ProductShell";
import MarketChart from "./MarketChart";
import Holdings from "./Holdings";

export function DataState() {
  const { error, data, loading, reload } = useMarket();
  if (!error && !data?.onchainError) return null;
  return <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error ? data ? "Refresh unavailable. Showing the last loaded record." : "Market data could not be loaded." : "The chain read is unavailable. Any displayed value is the last available record."}</span><button disabled={loading} onClick={reload}>{loading ? "Refreshing…" : "Try again"}</button></div>;
}

function NavValue() {
  const { data, now, error, loading } = useMarket();
  const record = data?.onchain?.effectiveAt ? data.onchain : null;
  const status = publicationStatus(record, data?.latest ?? null, now, Boolean(error || data?.onchainError));
  return <div className="gmd-nav-summary"><div><span className="gmd-label">Published NAV <span>/ USD</span></span><strong className="gmd-value">{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong></div><div className="gmd-nav-meta"><span className={`gmd-status ${status.tone === "ready" ? "is-neutral" : "is-waiting"}`}><i />{!data && loading ? "Loading record" : status.tone === "ready" ? "Recorded on chain" : status.label}</span><time dateTime={record?.effectiveAt ?? undefined}>{record ? shortTime(record.effectiveAt) : "Awaiting a published value"}</time></div></div>;
}

function ProductIdentity({ compact = false }: { compact?: boolean }) {
  return <div className={`gmd-product-identity${compact ? " is-compact" : ""}`}><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">USTX <span>Equity basket</span></span>{compact ? <h2>US Tech Basket</h2> : <h1>US Tech Basket</h1>}<p>Apple, Microsoft, NVIDIA, Amazon, Meta and Tesla.</p></div></div>;
}

export function MarketScreen({ preview = false }: { preview?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  const detail = preview ? designLink("product") : "/products/ustx";
  return <><div className="gmd-page-heading"><div><h1>Markets</h1><p>Know what you own. Start with the basket.</p></div><span className="gmd-badge">Subscriptions not open</span></div><DataState />
    <section className="gmd-market-feature" aria-label="US Tech Basket"><div className="gmd-market-primary"><div className="gmd-feature-title"><ProductIdentity compact /><Link prefetch={false} className="gmd-button" href={detail}>Explore basket <Icon name="arrow" size={18} /></Link></div><NavValue /><MarketChart points={points} loading={loading} /><div className="gmd-feature-bottom"><span>Equal weight at fixing <i /> Quarterly review</span><span className="gmd-badge">Model basket</span></div></div><div className="gmd-market-composition"><Holdings composition={composition} compact loading={loading} /></div></section>
    <section className="gmd-market-notes" aria-label="Product overview"><article><span className="gmd-note-icon"><Icon name="market" /></span><h2>A defined allocation</h2><p>Six tokenized US stocks. Equal weights at fixing, with token units reviewed quarterly.</p><Link prefetch={false} href={`${detail}#composition`}>View composition <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="wallet" /></span><h2>Investment access</h2><p>Subscriptions are not open. Review the basket and its available records before investing becomes available.</p><Link prefetch={false} href={`${detail}#terms`}>Product terms <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="activity" /></span><h2>A traceable value</h2><p>Published values have a composition record. Read the calculation and its corresponding chain entry.</p><Link prefetch={false} href="/products/ustx/transparency">View transparency <Icon name="arrow" size={16} /></Link></article></section>
    <div className="gmd-market-foot"><div className="gmd-stock-row" aria-hidden="true">{assetSymbols.map(symbol => <AssetMark key={symbol} symbol={symbol} />)}</div><p>Pricing on X Layer. NAV records on X Layer Testnet.</p><Link prefetch={false} href="/limitations">What to know <Icon name="external" size={14} /></Link></div>
  </>;
}

export function AccessPanel() {
  return <aside className="gmd-order-panel" aria-labelledby="invest-title"><div className="gmd-order-heading"><h2 id="invest-title">Invest in USTX</h2><Icon name="wallet" /></div><div className="gmd-availability"><span className="gmd-status is-waiting"><i />Subscriptions not open</span><h3>Get to know<br />the basket.</h3><p>{USTX_CAPABILITY.reason} The published NAV represents a model share.</p></div><dl className="gmd-facts"><div><dt>Constituents</dt><dd>6 xStocks</dd></div><div><dt>Allocation at fixing</dt><dd>Equal weight</dd></div><div><dt>Review</dt><dd>Quarterly</dd></div></dl><a className="gmd-button is-secondary" href="#terms">Read product terms <Icon name="arrow" size={16} /></a><p className="gmd-caption">A recorded NAV is not an executable quote.</p></aside>;
}

export function ProductScreen({ preview = false, orderPanel, holding = false }: { preview?: boolean; orderPanel?: ReactNode; holding?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  return <><Link prefetch={false} className="gmd-breadcrumb" href={holding ? designLink("portfolio") : preview ? designLink("markets") : "/"}><Icon name="back" size={16} />{holding ? "Your portfolio" : "All markets"}</Link><div className="gmd-product-heading"><ProductIdentity /><span className="gmd-badge">{preview ? "Example account view" : "Subscriptions not open"}</span></div><div className={`gmd-mobile-entry${holding ? " is-holding" : ""}`}><a className="gmd-button" href="#investment">{preview ? "View investment panel" : "Investment access"}<Icon name="arrow" size={16} /></a></div><DataState />
    <div className={`gmd-detail-layout${holding ? " is-holding" : ""}`}><div className="gmd-detail-content"><section className="gmd-price-surface" aria-label="Basket value"><NavValue /><MarketChart points={data ? publicationHistory(data) : []} loading={loading} /></section><nav className="gmd-product-sections" aria-label="Product sections"><a href="#composition">Composition</a><a href="#terms">Terms & approach</a><Link prefetch={false} href="/products/ustx/transparency">Transparency <Icon name="external" size={14} /></Link></nav><div id="composition" className="gmd-composition-surface"><Holdings composition={composition} loading={loading} /></div>
      <section id="terms" className="gmd-terms"><h2>Terms & approach</h2><p>USTX tracks a model allocation to six technology xStocks. It does not currently accept investments or hold the underlying assets.</p><dl><div><dt>Weighting</dt><dd>Equal weight at fixing. Fixed token units change in value as prices move.</dd></div><div><dt>Review schedule</dt><dd>Quarterly re-fixing at the prevailing model NAV.</dd></div><div><dt>Fees & minimum</dt><dd>Investment terms have not been published. No subscription is available.</dd></div><div><dt>Redemption</dt><dd>Not available. The current model does not issue redeemable fund shares.</dd></div><div><dt>Price basis</dt><dd>OKX OnchainOS DEX prices on X Layer. These can differ from the underlying stock price and may be delayed.</dd></div></dl><div className="gmd-terms-links"><Link prefetch={false} href="/methodology">Full methodology <Icon name="external" size={14} /></Link><Link prefetch={false} href="/limitations">Risks & limitations <Icon name="external" size={14} /></Link></div></section>
    </div><div className="gmd-detail-aside" id="investment">{orderPanel ?? <AccessPanel />}<div className="gmd-aside-note"><Icon name="info" size={18} /><p>Record consistency does not establish asset custody or backing. <Link prefetch={false} href="/products/ustx/transparency">See the evidence</Link></p></div></div></div>
  </>;
}

export function AccountUnavailable({ activity = false }: { activity?: boolean }) {
  return <><div className="gmd-page-heading"><div><h1>{activity ? "Activity" : "Portfolio"}</h1><p>{activity ? "A record of your investments and withdrawals." : "Your holdings, value and pending transactions."}</p></div></div><section className="gmd-account-empty"><div className="gmd-empty-symbol"><Icon name={activity ? "activity" : "portfolio"} size={36} /></div><h2>{activity ? "Your transactions will live here." : "A place for your investments."}</h2><p>{activity ? "Transactions will appear when investment access opens. No live investment account is available for USTX yet." : "USTX subscriptions are not open yet. You can explore the basket’s composition, published value and terms."}</p><Link prefetch={false} className="gmd-button" href="/products/ustx">Explore US Tech Basket <Icon name="arrow" size={17} /></Link></section><div className="gmd-lab-reference"><div><b>Looking for your paper portfolio?</b><p>Your saved simulations are separate from investment holdings.</p></div><Link prefetch={false} href="/lab">Open Lab <Icon name="external" size={16} /></Link></div></>;
}
