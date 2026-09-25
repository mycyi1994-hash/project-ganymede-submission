"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { publicationStatus } from "@/lib/nav-status";
import { compositionForRecord, publicationHistory, publishedRecordCount, shortTime } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { Icon, AssetMark, assetSymbols } from "./Icons";
import { designLink } from "./ProductShell";
import MarketChart from "./MarketChart";
import { InvestPanel } from "./DemoInvest";
import { FundOverview, FundStats } from "./Fund";
import Holdings from "./Holdings";
import { useRecordCheck } from "./useRecordCheck";
import { OkxSource } from "./OkxSource";

const VERIFY = "/products/ustx/transparency";

export function DataState() {
  const { error, data, loading, reload } = useMarket();
  if (!error && !data?.onchainError) return null;
  return <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error ? data ? "Refresh unavailable. Showing the last loaded record." : "Market data could not be loaded." : "The chain read is unavailable. Any displayed value is the last available record."}</span><button disabled={loading} onClick={reload}>{loading ? "Refreshing…" : "Try again"}</button></div>;
}

/** Runs the same direct chain check as the verification page and links to its evidence. */
export function RecordCheckStatus() {
  const { data, error } = useMarket();
  const { state } = useRecordCheck(data, error);
  const label = { matched: "Verified in your browser", failed: "Record needs attention", unavailable: "Not verified", waiting: "Checking the record…", loading: "Checking the record…" }[state];
  return <Link prefetch={false} href={VERIFY} className={`gmd-check-chip is-${state}`} aria-live="polite">{state === "matched" ? <Icon name="check" size={16} /> : <i aria-hidden="true" />}<span>{label}</span><Icon name="arrow" size={14} /></Link>;
}

function NavValue() {
  const { data, now, error, loading } = useMarket();
  const record = data?.onchain?.effectiveAt ? data.onchain : null;
  const status = publicationStatus(record, data?.latest ?? null, now, Boolean(error || data?.onchainError));
  // Customers see when the price was recorded; an older record reads "last recorded", not an error.
  const state = !data && loading ? "Loading…" : !record ? "Awaiting the first record" : status.tone === "ready" ? "Recorded on X Layer" : "Last recorded on X Layer";
  return <div className="gmd-nav-summary"><div><span className="gmd-label">NAV per share <span>/ USD</span></span><strong className="gmd-value">{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong></div><div className="gmd-nav-meta"><OkxSource>Priced by OKX OnchainOS</OkxSource><span className={`gmd-status ${status.tone === "ready" ? "is-neutral" : "is-waiting"}`}><i />{state}</span><time dateTime={record?.effectiveAt ?? undefined}>{record ? shortTime(record.effectiveAt) : ""}</time></div></div>;
}

function ProductIdentity({ compact = false }: { compact?: boolean }) {
  return <div className={`gmd-product-identity${compact ? " is-compact" : ""}`}><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">USTX <span>Equity basket</span></span>{compact ? <h2>US Tech Basket</h2> : <h1>US Tech Basket</h1>}<p>Apple, Microsoft, NVIDIA, Amazon, Meta and Tesla.</p></div></div>;
}

export function MarketScreen({ preview = false }: { preview?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  const detail = preview ? designLink("product") : "/products/ustx";
  return <><div className="gmd-page-heading"><div><h1>Markets</h1><p>Invest in six tokenized US tech stocks with demo dollars, at a price you can check yourself.</p></div>{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><DataState />
    <section className="gmd-market-feature" aria-label="US Tech Basket"><div className="gmd-market-primary"><div className="gmd-feature-title"><ProductIdentity compact /><Link prefetch={false} className="gmd-button" href={preview ? detail : `${detail}#investment`}>Invest <Icon name="arrow" size={18} /></Link></div><NavValue />{!preview && <FundStats />}<MarketChart points={points} total={data ? publishedRecordCount(data, points) : 0} loading={loading} /><div className="gmd-feature-bottom"><span>Equal weight <i /> Rebalanced quarterly <i /> Min. $10</span><span className="gmd-badge">Demo fund</span></div></div><div className="gmd-market-composition"><Holdings composition={composition} compact loading={loading} /></div></section>
    <section className="gmd-market-notes" aria-label="What you can do"><article><span className="gmd-note-icon"><Icon name="wallet" /></span><h2>Invest with demo dollars</h2><p>Start with $10,000 in demo dollars. Buy and redeem USTX at the NAV recorded on X Layer.</p><Link prefetch={false} href={`${detail}#investment`}>Start investing <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="check" /></span><h2>Verified on X Layer</h2><p>Every NAV is priced by OKX OnchainOS and recorded on X Layer. Your browser checks it automatically.</p><Link prefetch={false} href={VERIFY}>See the proof <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="portfolio" /></span><h2>See what you own</h2><p>Every share looks through to the six xStocks, token by token, at OKX OnchainOS prices.</p><Link prefetch={false} href={preview ? detail : `${detail}#overview`}>View the fund <Icon name="arrow" size={16} /></Link></article></section>
    {!preview && <section className="gmd-ecosystem" aria-labelledby="ecosystem-title"><header className="gmd-section-heading"><div><h2 id="ecosystem-title">Built on X Layer and OKX</h2><p>Every number on this page comes from the OKX stack, and you can check each one.</p></div></header>
      <div className="gmd-ecosystem-grid">
        <article><b>OKX OnchainOS</b><p>Prices the six xStocks on X Layer every five minutes.</p></article>
        <article><b>X Layer registry</b><p>Records each NAV, the shares outstanding and a fingerprint of the full composition.</p></article>
        <article><b>X Layer mainnet</b><p>Where the xStocks live. Portfolio reads any wallet’s balances from it.</p></article>
        <article><b>OKX Wallet</b><p>Connects on Portfolio to read your xStocks. Nothing is signed.</p></article>
      </div>
      <div className="gmd-ecosystem-links"><Link prefetch={false} href="/issuers"><span><b>For issuers</b><small>Launch a basket investors can verify</small></span><Icon name="arrow" size={18} /></Link><Link prefetch={false} href="/developers"><span><b>Developers & API</b><small>Public NAV API and an embeddable verified badge</small></span><Icon name="arrow" size={18} /></Link></div>
    </section>}
    <div className="gmd-market-foot"><div className="gmd-stock-row" aria-hidden="true">{assetSymbols.map(symbol => <AssetMark key={symbol} symbol={symbol} />)}</div><p>Market data by OKX OnchainOS · xStocks on X Layer · NAV records on X Layer Testnet</p><Link prefetch={false} href="/limitations">What to know <Icon name="external" size={14} /></Link></div>
  </>;
}

function RecordPanel() {
  const { data } = useMarket();
  const record = data?.onchain?.effectiveAt ? data.onchain : null;
  const entry = record ? [data?.latest?.publication, ...(data?.history ?? [])].find(item => item?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = entry?.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? entry.txHash : null;
  return <aside className="gmd-order-panel" aria-labelledby="record-title"><div className="gmd-order-heading"><h2 id="record-title">Proof of NAV</h2><Icon name="lock" /></div><dl className="gmd-facts"><div><dt>NAV per share</dt><dd>{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</dd></div><div><dt>As of</dt><dd>{record ? shortTime(record.effectiveAt) : "—"}</dd></div><div><dt>Prices</dt><dd>OKX OnchainOS</dd></div><div><dt>Recorded on</dt><dd>X Layer Testnet</dd></div><div><dt>Transaction</dt><dd>{tx ? <a className="gmd-inline-tx" href={`${PROOF_DEPLOYMENT.explorerUrl}/tx/${tx}`} target="_blank" rel="noreferrer">OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> : "—"}</dd></div></dl><Link prefetch={false} className="gmd-button" href={VERIFY}>View proof <Icon name="arrow" size={16} /></Link><p className="gmd-caption">Checked in your browser against the record on X Layer. No account needed.</p></aside>;
}

export function ProductScreen({ preview = false, orderPanel, holding = false }: { preview?: boolean; orderPanel?: ReactNode; holding?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  return <><Link prefetch={false} className="gmd-breadcrumb" href={holding ? designLink("portfolio") : preview ? designLink("markets") : "/"}><Icon name="back" size={16} />{holding ? "Your portfolio" : "All markets"}</Link><div className="gmd-product-heading"><ProductIdentity />{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><div className={`gmd-mobile-entry${holding ? " is-holding" : ""}`}>{preview ? <a className="gmd-button" href="#investment">View investment panel<Icon name="arrow" size={16} /></a> : <a className="gmd-button" href="#investment">Invest<Icon name="arrow" size={16} /></a>}</div><DataState />
    <div className={`gmd-detail-layout${holding ? " is-holding" : ""}`}><div className="gmd-detail-content"><section className="gmd-price-surface" aria-label="Basket value"><NavValue /><MarketChart points={points} total={data ? publishedRecordCount(data, points) : 0} loading={loading} /></section><nav className="gmd-product-sections" aria-label="Product sections">{!preview && <a href="#overview">Overview</a>}<a href="#composition">Composition</a><a href="#terms">Terms & approach</a><Link prefetch={false} href={VERIFY}>Proof of NAV <Icon name="external" size={14} /></Link></nav>{!preview && <FundOverview />}<div id="composition" className="gmd-composition-surface"><Holdings composition={composition} loading={loading} /></div>
      <section id="terms" className="gmd-terms"><h2>Terms & approach</h2><p>One USTX share gives you equal-weight exposure to six US technology leaders through their xStocks on X Layer. Each share holds fixed amounts of each token, reset to equal weight every quarter, and its value is published every five minutes with the evidence to check it. During the demo you invest with demo dollars: no real money moves and no tokens are bought.</p><dl><div><dt>Weighting</dt><dd>Equal weight at each fixing. Between fixings the weights drift with prices, like any buy-and-hold basket.</dd></div><div><dt>Rebalancing</dt><dd>Quarterly, back to equal weight at the prevailing NAV.</dd></div><div><dt>Orders</dt><dd>Minimum $10, no fees. Orders fill instantly at the latest NAV recorded on X Layer. Demo dollars only. No real money moves and no shares are issued on chain.</dd></div><div><dt>Pricing</dt><dd>OKX OnchainOS DEX prices for the xStocks on X Layer, every five minutes. They can differ from the underlying stock price and may be delayed.</dd></div><div><dt>Record</dt><dd>Each NAV, the shares outstanding and a fingerprint of the full composition are recorded on X Layer Testnet.</dd></div></dl><div className="gmd-terms-links"><Link prefetch={false} href="/methodology">Full methodology <Icon name="external" size={14} /></Link><Link prefetch={false} href="/limitations">Risks & limitations <Icon name="external" size={14} /></Link></div></section>
    </div><div className="gmd-detail-aside" id="investment">{orderPanel ?? <><InvestPanel /><RecordPanel /></>}<div className="gmd-aside-note"><Icon name="info" size={18} /><p>Demo fund on X Layer Testnet. Prices come from OKX OnchainOS; no real assets are held. <Link prefetch={false} href={VERIFY}>How it’s verified</Link></p></div></div></div>
  </>;
}
