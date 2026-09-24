"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROOF_DEPLOYMENT, verifyComposition, type Check } from "@/lib/xstocks/proof";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import { compositionForRecord, shortTime, type MarketSnapshot } from "@/lib/product-market";
import { formatUsdMicros } from "@/lib/nav-display";
import { pricingStatus, publicationStatus } from "@/lib/nav-status";
import { useMarket } from "./MarketProvider";
import { Icon } from "./Icons";
import { DataState } from "./ProductScreens";
import Holdings from "./Holdings";

type Evidence = { source: MarketSnapshot; chain: Check; hash: Check; nav: Check; record: OnchainNav | null; canonical: string | null; error: string | null };
export default function Transparency() {
  const { data, error, loading, now, reload } = useMarket();
  const [result, setResult] = useState<Evidence | null>(null);
  const checks = result?.source === data ? result : null;
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    async function verify(source: MarketSnapshot) {
      let record: OnchainNav | null = null;
      let canonical: string | null = null;
      let chain: Check = { state: "pending", detail: "Waiting for a direct chain read." };
      let hash: Check = { state: "pending", detail: "Waiting for a matching document." };
      let nav: Check = { state: "pending", detail: "Waiting for the published composition." };
      let failure: string | null = null;
      try {
        if (source.registry.chainId !== PROOF_DEPLOYMENT.chainId || source.registry.address?.toLowerCase() !== PROOF_DEPLOYMENT.registry) throw new Error("The registry does not match the deployment pinned in this browser.");
        record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId });
        if (record.effectiveAt) {
          chain = { state: "pass", detail: "Read directly from the pinned registry on X Layer Testnet (1952)." };
          const entry = [source.latest?.publication, ...source.history].find(p => p?.holdingsHash.toLowerCase() === record!.holdingsHash.toLowerCase());
          if (entry) { canonical = entry.canonical; const verified = await verifyComposition(canonical, record); hash = verified.hash; nav = verified.nav; }
        }
      } catch (reason) { failure = reason instanceof Error ? reason.message : "Direct verification is unavailable."; chain = { state: "pending", detail: failure }; }
      if (!cancelled) setResult({ source, chain, hash, nav, record, canonical, error: failure });
    }
    void verify(data);
    return () => { cancelled = true; };
  }, [data]);
  const passed = checks && [checks.chain, checks.hash, checks.nav].every(c => c.state === "pass");
  const failed = checks && [checks.chain, checks.hash, checks.nav].some(c => c.state === "fail");
  const state = error || checks?.error ? "unavailable" : failed ? "failed" : passed ? "matched" : checks ? "waiting" : "loading";
  const title = { unavailable: "We couldn’t verify this record.", failed: "The record needs attention.", matched: "The record and calculation match.", waiting: "Waiting for matching evidence.", loading: "Reading the published record…" }[state];
  const record = checks?.record ?? data?.onchain;
  const composition = data ? compositionForRecord(data, record) : null;
  const pricing = pricingStatus(data?.latest ?? null, now, Boolean(error));
  const publication = publicationStatus(record ?? null, data?.latest ?? null, now, Boolean(error || checks?.error));
  const canonical = checks?.canonical;
  let document = canonical ?? "A matching document is not available.";
  if (canonical) { try { document = JSON.stringify(JSON.parse(canonical), null, 2); } catch { /* Preserve original text for inspection. */ } }
  return <><Link className="gmd-breadcrumb" prefetch={false} href="/products/ustx"><Icon name="back" size={16} />US Tech Basket</Link><div className="gmd-page-heading"><div><h1>Transparency</h1><p>The composition and record behind USTX’s published value.</p></div><button className="gmd-small-button" onClick={reload} disabled={loading || Boolean(data && !checks)}><Icon name="refresh" size={16} />{loading || Boolean(data && !checks) ? "Refreshing…" : "Refresh record"}</button></div><DataState />
    <section id="proof-verify" className={`gmd-evidence-summary is-${state}`} aria-live="polite"><div className="gmd-evidence-icon"><Icon name={state === "matched" ? "check" : "info"} size={26} /></div><div><h2>{title}</h2><p>{state === "matched" ? "The published document, its calculation and the chain record agree." : state === "failed" ? "A document or calculation mismatch was found. Review the evidence below." : state === "unavailable" ? "The available snapshot is shown for reference. Independent verification has not completed." : "Your browser reads the chain and compares the matching document automatically."}</p><span>This checks consistency, not custody or asset backing.</span></div><div className="gmd-evidence-value"><span>Recorded NAV / USD</span><strong>{record?.effectiveAt ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong><small>{shortTime(record?.effectiveAt)}</small></div></section>
    <div className="gmd-transparency-layout"><section className="gmd-transparency-composition" id="proof-holdings"><Holdings composition={composition} loading={loading} /></section><aside className="gmd-record-aside" id="proof-record"><h2>Record details</h2><dl className="gmd-facts"><div><dt>Network</dt><dd>X Layer Testnet</dd></div><div><dt>Effective at</dt><dd>{shortTime(record?.effectiveAt)}</dd></div><div><dt>Read from</dt><dd>{checks?.record ? "Direct public RPC" : "Server snapshot"}</dd></div></dl><div className="gmd-record-hash"><span>Composition fingerprint</span><code>{record?.holdingsHash ?? "Awaiting a record"}</code></div><a className="gmd-inline-link" href={`${PROOF_DEPLOYMENT.explorerUrl}/address/${PROOF_DEPLOYMENT.registry}`} target="_blank" rel="noreferrer">View registry <Icon name="external" size={14} /></a><div className="gmd-record-condition"><span>Price evaluation</span><b>{data ? pricing.label : loading ? "Loading prices…" : "Unavailable"}</b><p>{data ? shortTime(data.latest?.evaluatedAt) : "—"}</p><small>Evaluation time can be later than individual price timestamps.</small></div><div className="gmd-record-condition"><span>Publication</span><b>{data ? publication.label : "Awaiting data"}</b><p>{publication.detail}</p></div></aside></div>
    <details id="proof-source" className="gmd-disclosure"><summary>Calculation & verification details <span>+</span></summary><div><div className="gmd-check-list">{[{ title: "Direct chain read", check: checks?.chain }, { title: "Document fingerprint", check: checks?.hash }, { title: "Recalculated NAV", check: checks?.nav }].map(row => <article key={row.title}><div><b>{row.title}</b><span className={`gmd-status ${row.check?.state === "pass" ? "is-positive" : "is-waiting"}`}>{row.check?.state === "pass" ? "Matched" : row.check?.state === "fail" ? "Mismatch" : "Not yet verified"}</span></div><p>{row.check?.detail ?? "Waiting for evidence."}</p></article>)}</div><p className="gmd-caption">For each holding: token units × token price, rounded down to USD micros before summing. Displayed prices are shortened for readability.</p><p className="gmd-caption">Configured quote-age limit: {data?.pricing.maxQuoteAgeMinutes != null ? `${data.pricing.maxQuoteAgeMinutes} minutes at evaluation` : "Unavailable"}. Eligible quotes are not necessarily live market prices.</p><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Token</th><th>Price / USD</th><th>Price timestamp</th></tr></thead><tbody>{composition?.holdings.map(h => <tr key={h.symbol}><th scope="row">{h.symbol}</th><td>{formatUsdMicros(h.priceMicros, 4)}</td><td>{shortTime(h.priceTime)}</td></tr>)}</tbody></table></div></div></details>
    <details className="gmd-disclosure"><summary>Publication history <span>+</span></summary><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Effective at</th><th>NAV / USD</th><th>Status</th><th>Transaction</th></tr></thead><tbody>{(data?.history ?? []).map(entry => <tr key={`${entry.holdingsHash}-${entry.status}`}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{entry.status}</td><td>{entry.txHash && /^0x[0-9a-f]{64}$/i.test(entry.txHash) ? <a href={`${PROOF_DEPLOYMENT.explorerUrl}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">{entry.txHash.slice(0, 10)}… <Icon name="external" size={12} /></a> : "—"}</td></tr>)}</tbody></table>{!data?.history.length && <p className="gmd-caption">{loading ? "Loading publications…" : "No publication history available."}</p>}</div></details>
    <details className="gmd-disclosure"><summary>Original composition document <span>+</span></summary><div><p className="gmd-caption">Formatted for reading. The verifier hashes the original document bytes.</p><pre>{document}</pre></div></details><div className="gmd-terms-links"><Link href="/methodology" prefetch={false}>Calculation methodology <Icon name="arrow" size={16} /></Link><Link href="/limitations" prefetch={false}>Evidence limitations <Icon name="arrow" size={16} /></Link></div>
  </>;
}
