"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { publicationStatus } from "@/lib/nav-status";
import { compositionForRecord, publicationHistory, shortTime } from "@/lib/product-market";
import { useMarket } from "./MarketProvider";
import { Icon, AssetMark, assetSymbols } from "./Icons";
import { designLink } from "./ProductShell";
import MarketChart from "./MarketChart";
import { InvestPanel } from "./DemoInvest";
import { FundHoldings, FundOverview, FundStats } from "./Fund";
import { LendingSection } from "./Lending";
import { MarketActivitySection, MarketPulse } from "./MarketActivity";
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
  return <><div className="gmd-page-heading"><div><h1>Markets</h1><p>Tokenized US stock baskets on X Layer, priced by OKX OnchainOS and verified on chain.</p></div>{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><DataState />
    <section className="gmd-market-feature" aria-label="US Tech Basket"><div className="gmd-market-primary"><div className="gmd-feature-title"><ProductIdentity compact /><Link prefetch={false} className="gmd-button" href={preview ? detail : `${detail}#investment`}>Invest <Icon name="arrow" size={18} /></Link></div><NavValue />{!preview && <FundStats />}<MarketChart points={points} loading={loading} /><div className="gmd-feature-bottom"><span>Equal weight <i /> Rebalanced quarterly <i /> Min. $10</span><span className="gmd-badge">Demo fund</span></div></div><div className="gmd-market-composition"><Holdings composition={composition} compact loading={loading} /></div></section>
    {!preview && <MarketPulse />}
    <div className="gmd-market-foot"><div className="gmd-stock-row" aria-hidden="true">{assetSymbols.map(symbol => <AssetMark key={symbol} symbol={symbol} />)}</div><p>Market data by OKX OnchainOS · xStocks on X Layer · NAV records on X Layer Testnet</p><Link prefetch={false} href="/limitations">Risks <Icon name="external" size={14} /></Link></div>
  </>;
}

export function ProductScreen({ preview = false, orderPanel, holding = false }: { preview?: boolean; orderPanel?: ReactNode; holding?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  return <><Link prefetch={false} className="gmd-breadcrumb" href={holding ? designLink("portfolio") : preview ? designLink("markets") : "/"}><Icon name="back" size={16} />{holding ? "Your portfolio" : "All markets"}</Link><div className="gmd-product-heading"><ProductIdentity />{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><div className={`gmd-mobile-entry${holding ? " is-holding" : ""}`}>{preview ? <a className="gmd-button" href="#investment">View investment panel<Icon name="arrow" size={16} /></a> : <a className="gmd-button" href="#investment">Invest<Icon name="arrow" size={16} /></a>}</div><DataState />
    <div className={`gmd-detail-layout${holding ? " is-holding" : ""}`}><div className="gmd-detail-content"><section className="gmd-price-surface" aria-label="Basket value"><NavValue /><MarketChart points={points} loading={loading} /></section><nav className="gmd-product-sections" aria-label="Product sections">{!preview && <a href="#overview">Overview</a>}{!preview && <a href="#activity">Activity</a>}{!preview && <a href="#borrow">Borrow</a>}<a href="#holdings">Holdings</a><a href="#terms">About</a><Link prefetch={false} href={VERIFY}>Transparency <Icon name="external" size={14} /></Link></nav>{!preview && <FundOverview />}{!preview && <MarketActivitySection />}{!preview && <LendingSection />}<div id="holdings" className="gmd-composition-surface">{preview ? <Holdings composition={composition} loading={loading} /> : <FundHoldings />}</div>
      <section id="terms" className="gmd-terms"><h2>About USTX</h2><p>One USTX share gives you equal-weight exposure to six US technology leaders through their xStocks on X Layer. Each share holds fixed amounts of each token, reset to equal weight every quarter. Its value is set every five minutes from OKX OnchainOS prices and recorded on X Layer.</p><dl><div><dt>Weighting</dt><dd>Equal weight at each fixing. Between fixings the weights drift with prices, like any buy-and-hold basket.</dd></div><div><dt>Rebalancing</dt><dd>Quarterly, back to equal weight at the prevailing NAV.</dd></div><div><dt>Orders</dt><dd>Minimum $10, no fees, filled at the latest NAV recorded on X Layer. From your wallet, the USTX contract on X Layer Testnet issues your shares to you; with a demo balance, they are held for this browser. Both use demo dollars with no value, so no real money moves.</dd></div><div><dt>Pricing</dt><dd>OKX OnchainOS DEX prices for the xStocks on X Layer, every five minutes. They can differ from the underlying stock price and may be delayed.</dd></div><div><dt>Record</dt><dd>Each NAV, the shares outstanding (in wallets and demo balances) and a fingerprint of the full composition are recorded on X Layer Testnet.</dd></div></dl><div className="gmd-terms-links"><Link prefetch={false} href="/methodology">Methodology <Icon name="external" size={14} /></Link><Link prefetch={false} href="/limitations">Risks <Icon name="external" size={14} /></Link></div></section>
    </div><div className="gmd-detail-aside" id="investment">{orderPanel ?? <InvestPanel />}</div></div>
  </>;
}
