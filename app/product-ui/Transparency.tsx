"use client";

import Link from "next/link";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { compositionForRecord, shortTime } from "@/lib/product-market";
import { formatUsdMicros } from "@/lib/nav-display";
import { formatSharesShort } from "@/lib/demo/format";
import { useMarket } from "./MarketProvider";
import { Icon } from "./Icons";
import { DataState } from "./ProductScreens";
import Holdings from "./Holdings";
import { OkxSource } from "./OkxSource";
import { useRecordCheck } from "./useRecordCheck";

// Proof of NAV for customers, in the manner of an exchange's proof-of-reserves page: the result,
// how a price is made, the holdings and the records. The technical checks live on /developers.

const txUrl = (hash: string | null | undefined) => hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${hash}` : null;
const registryUrl = `${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`;

function ExplorerLink({ href }: { href: string }) {
  return <a className="gmd-inline-tx" href={href} target="_blank" rel="noreferrer">OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>;
}

export default function Transparency() {
  const { data, error, loading, reload } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const record = checks?.record ?? data?.onchain;
  const composition = data ? compositionForRecord(data, record) : null;
  const current = record?.effectiveAt ? [data?.latest?.publication, ...(data?.history ?? [])].find(entry => entry?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = txUrl(current?.txHash);
  const shares = record?.effectiveAt && /^\d+$/.test(record.sharesOutstandingMicros ?? "") ? record.sharesOutstandingMicros : null;
  const records = (data?.history ?? []).filter(entry => entry.status === "confirmed").slice(0, 8);
  const title = { matched: "NAV verified on X Layer", failed: "This NAV could not be verified", unavailable: "Verification unavailable", waiting: "Checking the latest NAV…", loading: "Checking the latest NAV…" }[state];
  const lead = { matched: "Your browser just checked that this price, its holdings and its time match the record on X Layer.", failed: "The published holdings do not match the record on X Layer. Do not rely on this price until it is resolved.", unavailable: "Your browser could not read X Layer just now. Try again in a moment.", waiting: "Your browser is reading the record on X Layer.", loading: "Your browser is reading the record on X Layer." }[state];
  return <><Link className="gmd-breadcrumb" prefetch={false} href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link><div className="gmd-page-heading"><div><h1>Transparency</h1><p>How every USTX price is set, recorded and checked.</p></div><button className="gmd-small-button" onClick={reload} disabled={loading}><Icon name="refresh" size={16} />{loading ? "Refreshing…" : "Refresh"}</button></div><DataState />
    <section id="proof-verify" className={`gmd-evidence-summary is-${state}`} aria-live="polite"><div className="gmd-evidence-icon"><Icon name={state === "matched" ? "check" : "info"} size={26} /></div><div><h2>{title}</h2><p>{lead}</p><div className="gmd-evidence-actions">{tx && <a className="gmd-small-button" href={tx} target="_blank" rel="noreferrer">View on OKX Explorer<Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>}<OkxSource>Priced by OKX OnchainOS</OkxSource></div></div><div className="gmd-evidence-value"><span>NAV per share / USD</span><strong>{record?.effectiveAt ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong><small>{shortTime(record?.effectiveAt)}</small></div></section>
    <section className="gmd-proof-steps" aria-label="How a USTX price is made">
      <article><span aria-hidden="true">1</span><h2>Priced by OKX OnchainOS</h2><p>Every five minutes, the six xStocks are priced from OKX OnchainOS market data on X Layer.</p></article>
      <article><span aria-hidden="true">2</span><h2>Recorded on X Layer</h2><p>The NAV, the shares outstanding and a fingerprint of the full holdings are written to X Layer, where they cannot be changed.</p></article>
      <article><span aria-hidden="true">3</span><h2>Checked in your browser</h2><p>Your browser reads that record directly and recalculates the NAV from the holdings. No account needed.</p></article>
    </section>
    <div className="gmd-transparency-layout"><section className="gmd-transparency-composition" id="proof-holdings"><Holdings composition={composition} loading={loading} /></section><aside className="gmd-record-aside" id="proof-record"><h2>Latest record</h2><dl className="gmd-facts">
      <div><dt>NAV per share</dt><dd>{record?.effectiveAt ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</dd></div>
      <div><dt>As of</dt><dd>{shortTime(record?.effectiveAt)}</dd></div>
      <div><dt>Shares outstanding</dt><dd>{shares ? `${formatSharesShort(shares)} USTX` : "—"}</dd></div>
      <div><dt>Prices</dt><dd>OKX OnchainOS</dd></div>
      <div><dt>Network</dt><dd>X Layer Testnet</dd></div>
      <div><dt>Transaction</dt><dd>{tx ? <ExplorerLink href={tx} /> : "—"}</dd></div>
      <div><dt>NAV registry</dt><dd><ExplorerLink href={registryUrl} /></dd></div>
    </dl></aside></div>
    <section className="gmd-proof-history" aria-labelledby="history-title"><header className="gmd-section-heading"><h2 id="history-title">Recent records</h2><span>A new record every five minutes</span></header><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Time</th><th>NAV per share</th><th>Transaction</th></tr></thead><tbody>{records.map(entry => { const link = txUrl(entry.txHash); return <tr key={entry.holdingsHash}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{link ? <ExplorerLink href={link} /> : "—"}</td></tr>; })}</tbody></table>{!records.length && <p className="gmd-caption">{loading ? "Loading records…" : "No recent records are available."}</p>}</div></section>
    <section className="gmd-scope" aria-label="What verification covers"><div><h2>What verification covers</h2><ul><li>The NAV matches the record on X Layer.</li><li>The holdings add up exactly to that NAV.</li><li>The holdings are the ones recorded, unchanged since.</li></ul></div><div><h2>What it does not cover</h2><ul><li>Whether market prices are right. They come from OKX OnchainOS.</li><li>Custody. USTX is a demo fund, and no real assets are held.</li></ul></div></section>
    <div className="gmd-terms-links"><Link href="/developers#verify" prefetch={false}>The technical checks, for developers <Icon name="arrow" size={16} /></Link><Link href="/methodology" prefetch={false}>Methodology <Icon name="arrow" size={16} /></Link><Link href="/limitations" prefetch={false}>Limitations <Icon name="arrow" size={16} /></Link></div>
  </>;
}
