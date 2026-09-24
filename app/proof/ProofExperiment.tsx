"use client";

import { useEffect, useState } from "react";
import { changedPriceCopy } from "@/lib/xstocks/proof-experiment";
import { verifyComposition } from "@/lib/xstocks/proof";
import type { OnchainNav } from "@/lib/xstocks/onchain";
import { formatRecordTime } from "@/lib/nav-status";
import { formatUsdMicros } from "@/lib/nav-display";

type Result = Awaited<ReturnType<typeof verifyComposition>>;

export default function ProofExperiment({ canonical, record }: { canonical: string; record: OnchainNav }) {
  const [result, setResult] = useState<{ mode: "original" | "changed"; checks: Result } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const changed = changedPriceCopy(canonical);
  // Establish the displayed baseline with the same real checks as an edit. It runs once per
  // record: a background refresh hands over an equal record as a new object, and re-running on
  // that would overwrite the visitor's edited-copy result with the original's.
  const recordKey = `${record.holdingsHash}:${record.effectiveAt}:${record.navPerShareMicros}`;
  useEffect(() => {
    let cancelled = false;
    void verifyComposition(canonical, record).then(checks => {
      if (!cancelled) setResult({ mode: "original", checks });
    }).catch(() => {
      if (!cancelled) setError("This browser could not run the checks. Try again; no record was changed.");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the record's identity, not the object
  }, [canonical, recordKey]);
  const run = async (mode: "original" | "changed") => {
    setBusy(true); setError("");
    try {
      const checks = await verifyComposition(mode === "changed" ? changed.canonical : canonical, record);
      setResult({ mode, checks });
    } catch {
      setResult(null); setError("This browser could not run the checks. Try again; no record was changed.");
    } finally { setBusy(false); }
  };
  return <section className="proof-section proof-experiment" aria-labelledby="experiment-title" data-copy={result?.mode ?? "checking"}>
    <header><p className="proof-kicker">Test a copy of this report</p><h2 id="experiment-title">What happens if one price changes?</h2><p>Add $1 to {changed.symbol} in a local copy. The reported holding values and chain record stay unchanged, so the checks should detect the difference.</p></header>
    <p className="proof-footnote">Verified snapshot effective {formatRecordTime(record.effectiveAt)}. This experiment stays on that snapshot while a refresh is in progress.</p>
    <div className="experiment-prices"><div><span>Published {changed.symbol} price</span><strong>{formatUsdMicros(changed.originalPrice, 4)}</strong></div><span aria-hidden="true">→</span><div className="experiment-copy-price"><span>{result?.mode === "changed" ? "Price in your edited copy" : "Price in your original copy"}</span><strong key={result?.mode ?? "checking"}>{formatUsdMicros(result?.mode === "changed" ? changed.changedPrice : changed.originalPrice, 4)}</strong></div></div>
    <div className="experiment-actions"><button type="button" className="button is-primary" onClick={() => void run("changed")} disabled={busy}>Change price by $1 & verify</button><button type="button" className="button" onClick={() => void run("original")} disabled={busy}>{result?.mode === "changed" ? "Restore original & verify" : "Verify original copy"}</button></div>
    <div className="experiment-outcome" role="status" aria-live="polite" aria-atomic="true" aria-busy={busy}>
      <h3>{busy ? "Checking this copy…" : error ? "Verification unavailable" : result?.mode === "changed" ? "Edited copy: actual verification results" : "Original document: actual verification results"}</h3>
      <dl>{[{ label: "Document fingerprint", evidence: result?.checks.hash }, { label: "NAV calculation", evidence: result?.checks.nav }].map(({label, evidence}) => {
        const state = busy || error ? "pending" : evidence?.state ?? "pending";
        const explanation = label === "Document fingerprint"
          ? state === "pass" ? "The document matches the on-chain fingerprint." : "The edited document no longer matches the on-chain fingerprint."
          : state === "pass" ? "The holding values add up to the recorded NAV." : "The changed price does not agree with the reported holding value.";
        return <div key={`${label}:${state}`} className={`experiment-check is-${state}`}><dt>{label}</dt><dd><strong>{state === "pass" ? "Matched" : state === "fail" ? "Mismatch detected" : busy ? "Checking…" : "Unavailable"}</strong><p>{error || (busy ? "Recalculating in your browser." : state === "pending" ? "No verification result available." : explanation)}</p></dd></div>;
      })}</dl>
    </div>
    {result && !busy && !error && <details className="experiment-check-details"><summary>Read the check details</summary><p>{result.checks.hash.detail}</p><p>{result.checks.nav.detail}</p></details>}
    <p className="proof-footnote">Runs entirely in this browser. No transaction, upload or change to published data. A newly loaded record resets this experiment. These checks do not establish asset backing or price accuracy.</p>
  </section>;
}
