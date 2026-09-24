"use client";

import Link from "next/link";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { compositionForRecord, shortTime } from "@/lib/product-market";
import { formatUsdMicros } from "@/lib/nav-display";
import { pricingStatus, publicationStatus } from "@/lib/nav-status";
import { useMarket } from "./MarketProvider";
import { Icon } from "./Icons";
import { DataState } from "./ProductScreens";
import Holdings from "./Holdings";
import { useRecordCheck } from "./useRecordCheck";
import TamperExperiment from "./TamperExperiment";
import TokenContractsCheck from "./TokenContractsCheck";
import { buildEvidence } from "@/lib/xstocks/evidence";

export default function Transparency() {
  const { data, error, loading, now, reload } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const title = { unavailable: "We couldn’t verify this record.", failed: "The record needs attention.", matched: "The record and calculation match.", waiting: "Waiting for matching evidence.", loading: "Reading the published record…" }[state];
  const record = checks?.record ?? data?.onchain;
  const composition = data ? compositionForRecord(data, record) : null;
  const pricing = pricingStatus(data?.latest ?? null, now, Boolean(error));
  const publication = publicationStatus(record ?? null, data?.latest ?? null, now, Boolean(error || checks?.error));
  const canonical = checks?.canonical;
  const evidenceRecord = checks?.record?.effectiveAt && checks.canonical ? checks.record : null;
  const evidenceTx = evidenceRecord ? [data?.latest?.publication, ...(data?.history ?? [])].find(entry => entry?.holdingsHash.toLowerCase() === evidenceRecord.holdingsHash.toLowerCase())?.txHash ?? null : null;
  function downloadEvidence() {
    if (!checks || !evidenceRecord || !checks.canonical) return;
    const bundle = buildEvidence({ record: evidenceRecord, document: checks.canonical, transactionHash: evidenceTx, checks: { chain: checks.chain, hash: checks.hash, nav: checks.nav }, now: new Date() });
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `ustx-evidence-${bundle.record.effectiveAt.replace(/[:.]/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const oldestQuote = composition ? Math.max(0, ...composition.holdings.map(holding => (Date.parse(composition.asOf) - Date.parse(holding.priceTime)) / 60_000)) : null;
  let document = canonical ?? "A matching document is not available.";
  if (canonical) { try { document = JSON.stringify(JSON.parse(canonical), null, 2); } catch { /* Preserve original text for inspection. */ } }
  return <><Link className="gmd-breadcrumb" prefetch={false} href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link><div className="gmd-page-heading"><div><h1>Transparency</h1><p>The composition and record behind USTX’s published value.</p></div><button className="gmd-small-button" onClick={reload} disabled={loading || Boolean(data && !checks)}><Icon name="refresh" size={16} />{loading || Boolean(data && !checks) ? "Refreshing…" : "Refresh record"}</button></div><DataState />
    <section id="proof-verify" className={`gmd-evidence-summary is-${state}`} aria-live="polite"><div className="gmd-evidence-icon"><Icon name={state === "matched" ? "check" : "info"} size={26} /></div><div><h2>{title}</h2><p>{state === "matched" ? "The published document, its calculation and the chain record agree." : state === "failed" ? "A document or calculation mismatch was found. Review the evidence below." : state === "unavailable" ? "The available snapshot is shown for reference. Independent verification has not completed." : "Your browser reads the chain and compares the matching document automatically."}</p><span>This checks consistency, not custody or asset backing.</span><div className="gmd-evidence-actions"><button className="gmd-small-button" type="button" onClick={downloadEvidence} disabled={!evidenceRecord}><Icon name="download" size={16} />Download evidence</button><span>Re-check the file anywhere with <code>npm run verify:evidence</code>.</span></div></div><div className="gmd-evidence-value"><span>Recorded NAV / USD</span><strong>{record?.effectiveAt ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong><small>{shortTime(record?.effectiveAt)}</small></div></section>
    <section className="gmd-scope" aria-label="What this check covers"><div><h2>What a match confirms</h2><ul><li>The document’s SHA-256 fingerprint equals the one recorded on X Layer.</li><li>Each row’s token units × price equals its value, and the rows sum exactly to the recorded NAV.</li><li>The document time equals the record time.</li></ul></div><div><h2>What it does not confirm</h2><ul><li>That the prices are right. They come from one provider, OKX OnchainOS.</li><li>That anyone holds the tokens. USTX is a model basket, and nothing is held in custody.</li><li>That the NAV can be traded or redeemed.</li></ul></div></section>
    <div className="gmd-transparency-layout"><section className="gmd-transparency-composition" id="proof-holdings"><Holdings composition={composition} loading={loading} /></section><aside className="gmd-record-aside" id="proof-record"><h2>Record details</h2><dl className="gmd-facts"><div><dt>Network</dt><dd>X Layer Testnet</dd></div><div><dt>Effective at</dt><dd>{shortTime(record?.effectiveAt)}</dd></div><div><dt>Read from</dt><dd>{checks?.record ? "Direct public RPC" : "Server snapshot"}</dd></div></dl><div className="gmd-record-hash"><span>Composition fingerprint</span><code>{record?.holdingsHash ?? "Awaiting a record"}</code></div><a className="gmd-inline-link" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">View registry <Icon name="external" size={14} /></a><TokenContractsCheck canonical={checks?.canonical ?? null} /><div className="gmd-record-condition"><span>Price evaluation</span><b>{data ? pricing.label : loading ? "Loading prices…" : "Unavailable"}</b><p>{data ? shortTime(data.latest?.evaluatedAt) : "—"}</p><small>{oldestQuote == null ? "Evaluation time can be later than individual price timestamps." : `Oldest price ${oldestQuote < 1 ? "under a minute" : `${Math.round(oldestQuote)} min`} before evaluation · limit ${data?.pricing.maxQuoteAgeMinutes ?? "—"} min`}</small></div><div className="gmd-record-condition"><span>Publication</span><b>{data ? publication.label : "Awaiting data"}</b><p>{publication.detail}</p></div></aside></div>
    <TamperExperiment canonical={checks?.canonical ?? null} record={checks?.record ?? null} />
    <details id="proof-source" className="gmd-disclosure"><summary>Calculation & verification details <span>+</span></summary><div><div className="gmd-check-list">{[{ title: "Direct chain read", check: checks?.chain }, { title: "Document fingerprint", check: checks?.hash }, { title: "Recalculated NAV", check: checks?.nav }].map(row => <article key={row.title}><div><b>{row.title}</b><span className={`gmd-status ${row.check?.state === "pass" ? "is-positive" : "is-waiting"}`}>{row.check?.state === "pass" ? "Matched" : row.check?.state === "fail" ? "Mismatch" : "Not yet verified"}</span></div><p>{row.check?.detail ?? "Waiting for evidence."}</p></article>)}</div><p className="gmd-caption">For each holding: token units × token price, rounded down to USD micros before summing. Displayed prices are shortened for readability.</p><p className="gmd-caption">Configured quote-age limit: {data?.pricing.maxQuoteAgeMinutes != null ? `${data.pricing.maxQuoteAgeMinutes} minutes at evaluation` : "Unavailable"}. Eligible quotes are not necessarily live market prices.</p><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Token</th><th>Price / USD</th><th>Price timestamp</th></tr></thead><tbody>{composition?.holdings.map(h => <tr key={h.symbol}><th scope="row">{h.symbol}</th><td>{formatUsdMicros(h.priceMicros, 4)}</td><td>{shortTime(h.priceTime)}</td></tr>)}</tbody></table></div></div></details>
    <details className="gmd-disclosure"><summary>Publication history <span>+</span></summary><div className="gmd-data-table-scroll"><p className="gmd-caption gmd-retention">Documents are kept for the latest 12 publications, about one hour. Older NAVs and fingerprints stay on X Layer, but their documents are no longer served here.</p><table className="gmd-table"><thead><tr><th>Effective at</th><th>NAV / USD</th><th>Status</th><th>Transaction</th></tr></thead><tbody>{(data?.history ?? []).map(entry => <tr key={`${entry.holdingsHash}-${entry.status}`}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{entry.status}</td><td>{entry.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? <a href={`${PROOF_DEPLOYMENT.explorerUrl}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">{entry.txHash.slice(0, 10)}… <Icon name="external" size={12} /></a> : "—"}</td></tr>)}</tbody></table>{!data?.history.length && <p className="gmd-caption">{loading ? "Loading publications…" : "No publication history available."}</p>}</div></details>
    <details className="gmd-disclosure"><summary>Original composition document <span>+</span></summary><div><p className="gmd-caption">Formatted for reading. The verifier hashes the original document bytes.</p><pre>{document}</pre></div></details><div className="gmd-terms-links"><Link href="/methodology" prefetch={false}>Calculation methodology <Icon name="arrow" size={16} /></Link><Link href="/limitations" prefetch={false}>Evidence limitations <Icon name="arrow" size={16} /></Link></div>
  </>;
}
