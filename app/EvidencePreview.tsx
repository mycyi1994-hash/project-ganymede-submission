"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROOF_DEPLOYMENT, parseComposition, verifyComposition } from "@/lib/xstocks/proof";
import { formatUsdMicros } from "@/lib/nav-display";
import { StockMark } from "./DesignElements";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import ProofExperiment from "./proof/ProofExperiment";

/** On the home page the basket opens in place; elsewhere the link navigates as usual. */
type ViewLink = { href: string; onNavigate?: (event: { preventDefault: () => void }) => void };

/** A live read, not a preset illustration; never uses API values as a trust anchor. */
export default function EvidencePreview({ basketLink = { href: "/?app=select" } }: { basketLink?: ViewLink }) {
  const [snapshot, setSnapshot] = useState<{ canonical: string; record: OnchainNav } | null>(null);
  const [message, setMessage] = useState("Reading the chain record and checking its document…");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setSnapshot(null);
      setMessage("Reading the chain record and checking its document…");
      try {
        const [response, record] = await Promise.all([
          fetch("/api/xstocks", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }),
          readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId }),
        ]);
        if (!response.ok) throw new Error("Report data is unavailable. Retry or open the full verification view.");
        const data = await response.json() as { latest?: { publication?: { holdingsHash: string; canonical: string } }; history?: Array<{ holdingsHash: string; canonical: string }> };
        const document = [data.latest?.publication, ...(data.history ?? [])].find(item => item?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase());
        if (!record.effectiveAt || !document) throw new Error("A matching report is not available yet. The record may have updated during loading; retry to check again.");
        const result = await verifyComposition(document.canonical, record);
        if (result.hash.state !== "pass" || result.nav.state !== "pass") throw new Error("The report does not pass verification. Open the full checks to inspect the mismatch.");
        if (!cancelled) setSnapshot({ canonical: document.canonical, record });
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Verification unavailable. Retry to check again.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [attempt]);
  const composition = snapshot ? parseComposition(snapshot.canonical) : null;
  return <section className="home-verification" id="try-verification" aria-label="Try live report verification">
    <div className="home-verification-intro"><div><h2>Six holdings. One reported value.</h2><p>Each holding contributes to the value of one model share. Follow a published report from its basket to its checks, then change a copy. No wallet needed.</p></div><Link className="text-link" {...basketLink} prefetch={false}>View basket details</Link></div>
    {snapshot && composition ? <>
      <div className="journey-composition"><ol aria-label="Published holding values">{composition.holdings.map(holding => <li key={holding.symbol}><StockMark symbol={holding.symbol} /><b>{holding.symbol}</b><span>{formatUsdMicros(holding.valueMicros, 4)}</span></li>)}</ol><div className="journey-total"><span>Sum per model share</span><strong>{formatUsdMicros(composition.navPerShareMicros, 4)}</strong><small>From this published report, not a live quote</small></div></div>
      <div className="journey-baseline" role="status"><strong>Original report verified</strong><span>Direct chain read · Document fingerprint matched · NAV calculation matched</span></div>
      <ProofExperiment key={snapshot.record.holdingsHash} canonical={snapshot.canonical} record={snapshot.record} />
      <footer className="journey-next"><div><h3>Inspect the evidence behind the result.</h3><p>See the calculation, exact document and X Layer record.</p></div><a className="button is-primary" href="/proof">View full evidence</a></footer>
    </> : <div className="verification-placeholder" role="status"><p>{message}</p><button className="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? "Checking…" : "Retry verification"}</button><a className="text-link" href="/proof">View full evidence</a></div>}
  </section>;
}
