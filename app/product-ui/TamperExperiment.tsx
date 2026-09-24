"use client";

import { useEffect, useMemo, useState } from "react";
import { compensatedEditCopy, consistentEditCopy, layeredChecks, priceEditCopy, type LayeredChecks } from "@/lib/xstocks/proof-experiment";
import type { OnchainNav } from "@/lib/xstocks/onchain";
import { formatUsdMicros } from "@/lib/nav-display";

type Choice = "original" | "price" | "consistent" | "compensated";
const OPTIONS: { id: Choice; label: string; result: string }[] = [
  { id: "original", label: "Published document", result: "All three checks match the record on X Layer." },
  { id: "price", label: "Change one price", result: "The edited row no longer adds up, and the fingerprint differs from X Layer." },
  { id: "consistent", label: "Fix the arithmetic too", result: "Every row adds up, but the NAV and the fingerprint no longer match X Layer." },
  { id: "compensated", label: "Keep the same NAV", result: "Every number adds up and the NAV is unchanged. Only the fingerprint recorded on X Layer shows that the document was altered." },
];

/** Edits a copy of the published document in this browser and checks it against the live record. */
export default function TamperExperiment({ canonical, record }: { canonical: string | null; record: OnchainNav | null }) {
  const [choice, setChoice] = useState<Choice>("original");
  const [result, setResult] = useState<{ key: string; checks: LayeredChecks } | null>(null);
  const copies = useMemo(() => {
    if (!canonical) return null;
    try { return { price: priceEditCopy(canonical), consistent: consistentEditCopy(canonical), compensated: compensatedEditCopy(canonical) }; } catch { return null; }
  }, [canonical]);
  const edited = copies && choice !== "original" ? copies[choice] : null;
  const bytes = choice === "original" ? canonical : edited?.canonical ?? null;
  const key = `${choice}:${record?.holdingsHash}:${record?.effectiveAt}`;
  useEffect(() => {
    if (!bytes || !record) return;
    let cancelled = false;
    void layeredChecks(bytes, record).then(checks => { if (!cancelled) setResult({ key, checks }); });
    return () => { cancelled = true; };
  }, [bytes, record, key]);
  const checks = result?.key === key ? result.checks : null;
  const ready = Boolean(canonical && record && copies);
  const rows: [string, LayeredChecks[keyof LayeredChecks] | undefined][] = [["Fingerprint on X Layer", checks?.fingerprint], ["Row arithmetic", checks?.arithmetic], ["NAV and time vs the X Layer record", checks?.record]];
  return <section id="experiment" className="gmd-experiment" aria-labelledby="experiment-title">
    <div className="gmd-experiment-intro"><h2 id="experiment-title">Try to break it</h2><p>Each option edits a copy of the published document in your browser and checks it against the record on X Layer. The published record is not changed.</p></div>
    <div className="gmd-experiment-options" role="group" aria-label="Document to check">{OPTIONS.map(option => <button key={option.id} type="button" aria-pressed={choice === option.id} disabled={!ready || (option.id === "compensated" && !copies?.compensated)} onClick={() => setChoice(option.id)}>{option.label}</button>)}</div>
    {edited && <p className="gmd-experiment-edit">Edited: {edited.changes.map(change => `${change.symbol} ${formatUsdMicros(change.from, 4)} → ${formatUsdMicros(change.to, 4)}`).join(" · ")}</p>}
    <ul className="gmd-experiment-checks" aria-live="polite">{rows.map(([title, check]) => <li key={title}><span className={`gmd-status ${check?.state === "pass" ? "is-positive" : check?.state === "fail" ? "is-waiting" : ""}`}><i />{check ? check.state === "pass" ? "Matches" : "Fails" : "Waiting"}</span><div><b>{title}</b><p>{check?.detail ?? (ready ? "Running the check…" : "Runs after this browser reads the record.")}</p></div></li>)}</ul>
    <p className="gmd-experiment-result">{ready ? OPTIONS.find(option => option.id === choice)?.result : "The experiment starts once this browser has read the published record."}</p>
  </section>;
}
