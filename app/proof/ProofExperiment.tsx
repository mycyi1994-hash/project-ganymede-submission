"use client";

import { useState } from "react";
import { changedPriceCopy } from "@/lib/xstocks/proof-experiment";
import { verifyComposition } from "@/lib/xstocks/proof";
import type { OnchainNav } from "@/lib/xstocks/onchain";
import { formatRecordTime } from "@/lib/nav-status";
import { formatUsdMicros } from "@/lib/nav-display";

type Result = Awaited<ReturnType<typeof verifyComposition>>;

export default function ProofExperiment({ canonical, record }: { canonical: string; record: OnchainNav }) {
  const [result, setResult] = useState<{ mode: "original" | "changed"; checks: Result } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = changedPriceCopy(canonical);
  const run = async (mode: "original" | "changed") => {
    setBusy(true); setError("");
    try {
      const checks = await verifyComposition(mode === "changed" ? changed.canonical : canonical, record);
      setResult({ mode, checks });
    } catch {
      setResult(null); setError("This browser could not run the checks. Try again; no record was changed.");
    } finally { setBusy(false); }
  };
  return <section className="proof-section proof-experiment" aria-labelledby="experiment-title">
    <header><p className="proof-kicker">Local verification experiment</p><h2 id="experiment-title">Change one price. Check the evidence.</h2><p>Try a $1 increase to {changed.symbol} in a copy of the published document. The holding values, NAV and chain record stay unchanged.</p></header>
    <p className="proof-footnote">Verified snapshot effective {formatRecordTime(record.effectiveAt)}. This experiment stays on that snapshot while a refresh is in progress.</p>
    <div className="experiment-prices"><div><span>Published token price</span><strong>{formatUsdMicros(changed.originalPrice, 4)}</strong></div><span aria-hidden="true">→</span><div><span>Price in the edited copy</span><strong>{formatUsdMicros(changed.changedPrice, 4)}</strong></div></div>
    <div className="experiment-actions"><button type="button" className="button is-primary" onClick={() => void run("changed")} disabled={busy}>Change price by $1 & verify</button><button type="button" className="button" onClick={() => void run("original")} disabled={busy}>Restore original & verify</button></div>
    <div className="experiment-outcome" role="status" aria-live="polite" aria-atomic="true" aria-busy={busy}>
      {busy ? <p>Recalculating the hash and NAV in your browser…</p> : error ? <p>{error}</p> : result ? <><h3>{result.mode === "changed" ? "Edited copy: actual verification results" : "Original document: actual verification results"}</h3><dl>{[{ label: "Document fingerprint", evidence: result.checks.hash }, { label: "NAV calculation", evidence: result.checks.nav }].map(({label, evidence}) => {
        return <div key={String(label)} className={`experiment-check is-${evidence.state}`}><dt>{String(label)}</dt><dd><strong>{evidence.state === "pass" ? "Matched" : evidence.state === "fail" ? "Mismatch detected" : "Not yet checked"}</strong><p>{evidence.detail}</p></dd></div>;
      })}</dl></> : <p>The same verifier used above will check your copy against the directly read record. No result is simulated.</p>}
    </div>
    <p className="proof-footnote">Runs entirely in this browser. No transaction, upload or change to published data. A newly loaded record resets this experiment. These checks do not establish asset backing or price accuracy.</p>
  </section>;
}
