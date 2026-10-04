"use client";

import Link from "next/link";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
import { shortTime } from "@/lib/product-market";
import { formatUsdMicros } from "@/lib/nav-display";
import { formatSharesShort } from "@/lib/demo/format";
import { useMarket } from "./MarketProvider";
import { Icon } from "./Icons";
import { DataState } from "./ProductScreens";
import Holdings from "./Holdings";
import { useRecordCheck } from "./useRecordCheck";
import { usePoolCheck } from "./PoolCheck";
import { PriceConfidenceView } from "./PriceConfidence";

// Proof of NAV for customers, in the manner of an exchange's proof-of-reserves page: the result,
// how a price is made, the holdings and the records. The technical checks live on /developers.

const txUrl = (hash: string | null | undefined) => hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${hash}` : null;
const registryUrl = `${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`;

function ExplorerLink({ href }: { href: string }) {
  return <a className="gmd-inline-tx" href={href} target="_blank" rel="noreferrer">OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>;
}

export default function Transparency() {
  const { data, error, loading, reload, now } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const record = checks?.record;
  const composition = checks?.composition ?? null;
  const poolCheck = usePoolCheck(composition);
  const current = record?.effectiveAt ? [data?.latest?.publication, ...(data?.history ?? [])].find(entry => entry?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase()) : null;
  const tx = txUrl(current?.txHash);
  const shares = record?.effectiveAt && /^\d+$/.test(record.sharesOutstandingMicros ?? "") ? record.sharesOutstandingMicros : null;
  const records = (data?.history ?? []).filter(entry => entry.status === "confirmed").slice(0, 8);
  return <><Link className="gmd-breadcrumb" prefetch={false} href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link><div className="gmd-page-heading"><div><h1>Transparency</h1><p>See where the USTX price comes from and how it compares.</p></div></div><DataState />
    <PriceConfidenceView checks={checks} state={state} pools={poolCheck} now={now} onRefresh={reload} />
    <div className="gmd-transparency-layout"><section className="gmd-transparency-composition" id="proof-holdings"><Holdings composition={composition} loading={loading} /></section><aside className="gmd-record-aside" id="proof-record"><h2>Latest record</h2><dl className="gmd-facts">
      <div><dt>NAV per share</dt><dd>{record?.effectiveAt ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</dd></div>
      <div><dt>Prices as of</dt><dd>{shortTime(record?.effectiveAt)}</dd></div>
      <div><dt>Valid for orders and loans until</dt><dd>{record?.effectiveAt ? shortTime(new Date(Date.parse(record.effectiveAt) + 3_600_000).toISOString()) : "—"}</dd></div>
      <div><dt>Shares outstanding</dt><dd>{shares ? `${formatSharesShort(shares)} USTX` : "—"}</dd></div>
      <div><dt>Prices</dt><dd>OKX OnchainOS</dd></div>
      <div><dt>Network</dt><dd>X Layer Testnet</dd></div>
      <div><dt>Transaction</dt><dd>{tx ? <ExplorerLink href={tx} /> : "—"}</dd></div>
      <div><dt>Price history on X Layer</dt><dd><ExplorerLink href={registryUrl} /></dd></div>
      <div><dt>USTX token</dt><dd><ExplorerLink href={`${FUND_DEPLOYMENT.explorerUrl}/token/${FUND_DEPLOYMENT.fund}`} /></dd></div>
    </dl></aside></div>
    <section className="gmd-proof-history" aria-labelledby="history-title"><header className="gmd-section-heading"><h2 id="history-title">Recent records</h2><span>A new record every five minutes</span></header><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Time</th><th>NAV per share</th><th>Transaction</th></tr></thead><tbody>{records.map(entry => { const link = txUrl(entry.txHash); return <tr key={entry.holdingsHash}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{link ? <ExplorerLink href={link} /> : "—"}</td></tr>; })}</tbody></table>{!records.length && <p className="gmd-caption">{loading ? "Loading records…" : "No recent records are available."}</p>}</div></section>
    <div className="gmd-terms-links"><Link href="/methodology" prefetch={false}>How USTX is priced <Icon name="arrow" size={16} /></Link><Link href="/limitations" prefetch={false}>Risks and limitations <Icon name="arrow" size={16} /></Link></div>
  </>;
}
