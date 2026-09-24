"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { publicationStatus } from "@/lib/nav-status";
import { compositionForRecord, publicationHistory, shortTime } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { Icon, AssetMark, assetSymbols } from "./Icons";
import { designLink } from "./ProductShell";
import MarketChart from "./MarketChart";
import Holdings from "./Holdings";
import { useRecordCheck } from "./useRecordCheck";

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
  return <div className="gmd-nav-summary"><div><span className="gmd-label">Published NAV <span>/ USD</span></span><strong className="gmd-value">{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong></div><div className="gmd-nav-meta"><span className={`gmd-status ${status.tone === "ready" ? "is-neutral" : "is-waiting"}`}><i />{!data && loading ? "Loading record" : status.tone === "ready" ? "Recorded on X Layer" : status.label}</span><time dateTime={record?.effectiveAt ?? undefined}>{record ? shortTime(record.effectiveAt) : "Awaiting a published value"}</time></div></div>;
}

function ProductIdentity({ compact = false }: { compact?: boolean }) {
  return <div className={`gmd-product-identity${compact ? " is-compact" : ""}`}><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">USTX <span>Equity basket</span></span>{compact ? <h2>US Tech Basket</h2> : <h1>US Tech Basket</h1>}<p>Apple, Microsoft, NVIDIA, Amazon, Meta and Tesla.</p></div></div>;
}

export function MarketScreen({ preview = false }: { preview?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  const detail = preview ? designLink("product") : "/products/ustx";
  return <><div className="gmd-page-heading"><div><h1>Markets</h1><p>Six tokenized US stocks, priced by OKX and recorded on X Layer. Check any published value in your browser.</p></div>{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><DataState />
    <section className="gmd-market-feature" aria-label="US Tech Basket"><div className="gmd-market-primary"><div className="gmd-feature-title"><ProductIdentity compact /><Link prefetch={false} className="gmd-button" href={detail}>Explore basket <Icon name="arrow" size={18} /></Link></div><NavValue /><MarketChart points={points} loading={loading} /><div className="gmd-feature-bottom"><span>Equal weight at fixing <i /> Quarterly review</span><span className="gmd-badge">Model basket</span></div></div><div className="gmd-market-composition"><Holdings composition={composition} compact loading={loading} /></div></section>
    <section className="gmd-market-notes" aria-label="What you can do"><article><span className="gmd-note-icon"><Icon name="market" /></span><h2>A defined allocation</h2><p>Six tokenized US stocks. Equal weights at fixing, with token units reviewed quarterly.</p><Link prefetch={false} href={`${detail}#composition`}>View composition <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="check" /></span><h2>Verify it yourself</h2><p>Your browser reads the X Layer record, hashes the published document and recalculates the NAV. No account needed.</p><Link prefetch={false} href={VERIFY}>Run the check <Icon name="arrow" size={16} /></Link></article><article><span className="gmd-note-icon"><Icon name="refresh" /></span><h2>Try to break it</h2><p>Change one price in a copy and the check fails. Restore it and it passes again.</p><Link prefetch={false} href={`${VERIFY}#experiment`}>Open the experiment <Icon name="arrow" size={16} /></Link></article></section>
    <div className="gmd-market-foot"><div className="gmd-stock-row" aria-hidden="true">{assetSymbols.map(symbol => <AssetMark key={symbol} symbol={symbol} />)}</div><p>Prices from OKX OnchainOS on X Layer. NAV records on X Layer Testnet.</p><Link prefetch={false} href="/limitations">What to know <Icon name="external" size={14} /></Link></div>
  </>;
}

function RecordPanel() {
  const { data } = useMarket();
  const record = data?.onchain?.effectiveAt ? data.onchain : null;
  const entry = record ? [data?.latest?.publication, ...(data?.history ?? [])].find(item => item?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = entry?.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? entry.txHash : null;
  return <aside className="gmd-order-panel" aria-labelledby="record-title"><div className="gmd-order-heading"><h2 id="record-title">Latest record</h2><Icon name="lock" /></div><dl className="gmd-facts"><div><dt>NAV per model share</dt><dd>{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</dd></div><div><dt>Recorded</dt><dd>{record ? shortTime(record.effectiveAt) : "—"}</dd></div><div><dt>Network</dt><dd>X Layer Testnet</dd></div><div><dt>Transaction</dt><dd>{tx ? <a className="gmd-inline-tx" href={`${PROOF_DEPLOYMENT.explorerUrl}/tx/${tx}`} target="_blank" rel="noreferrer">{tx.slice(0, 10)}…<Icon name="external" size={12} /></a> : "—"}</dd></div><div><dt>Constituents</dt><dd>6 xStocks</dd></div></dl><Link prefetch={false} className="gmd-button" href={VERIFY}>Verify this record <Icon name="arrow" size={16} /></Link><p className="gmd-caption">Your browser reads X Layer directly and recalculates the NAV. No account or signature.</p></aside>;
}

export function ProductScreen({ preview = false, orderPanel, holding = false }: { preview?: boolean; orderPanel?: ReactNode; holding?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  return <><Link prefetch={false} className="gmd-breadcrumb" href={holding ? designLink("portfolio") : preview ? designLink("markets") : "/"}><Icon name="back" size={16} />{holding ? "Your portfolio" : "All markets"}</Link><div className="gmd-product-heading"><ProductIdentity />{preview ? <span className="gmd-badge">Example account view</span> : <RecordCheckStatus />}</div><div className={`gmd-mobile-entry${holding ? " is-holding" : ""}`}>{preview ? <a className="gmd-button" href="#investment">View investment panel<Icon name="arrow" size={16} /></a> : <Link prefetch={false} className="gmd-button" href={VERIFY}>Verify this NAV<Icon name="arrow" size={16} /></Link>}</div><DataState />
    <div className={`gmd-detail-layout${holding ? " is-holding" : ""}`}><div className="gmd-detail-content"><section className="gmd-price-surface" aria-label="Basket value"><NavValue /><MarketChart points={data ? publicationHistory(data) : []} loading={loading} /></section><nav className="gmd-product-sections" aria-label="Product sections"><a href="#composition">Composition</a><a href="#terms">Terms & approach</a><Link prefetch={false} href={VERIFY}>Verification <Icon name="external" size={14} /></Link></nav><div id="composition" className="gmd-composition-surface"><Holdings composition={composition} loading={loading} /></div>
      <section id="terms" className="gmd-terms"><h2>Terms & approach</h2><p>USTX is a model basket. It tracks the value of fixed token units of six technology xStocks. It is a reference value, not a fund share, and it holds no assets.</p><dl><div><dt>Weighting</dt><dd>Equal weight at fixing. Fixed token units change in value as prices move.</dd></div><div><dt>Review schedule</dt><dd>Quarterly re-fixing at the prevailing model NAV.</dd></div><div><dt>Shares</dt><dd>None are issued. USTX cannot be bought, held or redeemed.</dd></div><div><dt>Price basis</dt><dd>OKX OnchainOS DEX prices for the xStocks on X Layer. These can differ from the underlying stock price and may be delayed.</dd></div><div><dt>Record</dt><dd>Each published NAV and a fingerprint of its composition document are recorded on X Layer Testnet.</dd></div></dl><div className="gmd-terms-links"><Link prefetch={false} href="/methodology">Full methodology <Icon name="external" size={14} /></Link><Link prefetch={false} href="/limitations">Risks & limitations <Icon name="external" size={14} /></Link></div></section>
    </div><div className="gmd-detail-aside" id="investment">{orderPanel ?? <RecordPanel />}<div className="gmd-aside-note"><Icon name="info" size={18} /><p>A matching record shows the published numbers are consistent. It does not show custody or backing. <Link prefetch={false} href={VERIFY}>See the evidence</Link></p></div></div></div>
  </>;
}
