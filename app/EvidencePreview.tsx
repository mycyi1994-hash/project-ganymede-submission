"use client";

import { useEffect, useState } from "react";
import { PROOF_DEPLOYMENT, verifyComposition } from "@/lib/xstocks/proof";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import ProofExperiment from "./proof/ProofExperiment";

/** A live read, not a preset illustration; never uses API values as a trust anchor. */
export default function EvidencePreview() {
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
  return <section className="home-verification" id="try-verification" aria-label="Try live report verification">
    <div className="home-verification-intro"><div><span className="eyebrow">Try the published report</span><h2>A changed number<br />leaves a trace.</h2><p>Check a real USTX report, then edit a local copy. Your browser recalculates the evidence. No wallet needed.</p></div><a className="text-link" href="/proof">Open full verification ↗</a></div>
    {snapshot ? <ProofExperiment canonical={snapshot.canonical} record={snapshot.record} /> : <div className="verification-placeholder" role="status"><p>{message}</p><button className="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? "Checking…" : "Retry verification"}</button></div>}
  </section>;
}
