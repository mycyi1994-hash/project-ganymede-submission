"use client";

import { compositionForRecord, shortTime } from "@/lib/product-market";
import { formatUsdMicros } from "@/lib/nav-display";
import { buildEvidence } from "@/lib/xstocks/evidence";
import { useMarket } from "./MarketProvider";
import { useRecordCheck } from "./useRecordCheck";
import TamperExperiment from "./TamperExperiment";
import TokenContractsCheck from "./TokenContractsCheck";
import { Icon } from "./Icons";

// The technical checks behind the Transparency page, for developers and reviewers: the three
// checks one by one, the tamper experiment, the evidence file and the original document.

export default function VerifyYourself() {
  const { data, error } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const record = checks?.record ?? data?.onchain;
  const composition = data ? compositionForRecord(data, record) : null;
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
  let document = checks?.canonical ?? "A matching document is not available.";
  if (checks?.canonical) { try { document = JSON.stringify(JSON.parse(checks.canonical), null, 2); } catch { /* Preserve original text for inspection. */ } }
  const status = { matched: "All three checks pass in this browser.", failed: "A check failed in this browser.", unavailable: "This browser could not read X Layer.", waiting: "Waiting for a matching document.", loading: "Reading the published record…" }[state];
  return <div className="gmd-verify-yourself" aria-live="polite">
    <p className="gmd-verify-status"><b>Live result:</b> {status} {record?.effectiveAt ? `Record of ${shortTime(record.effectiveAt)}, NAV ${formatUsdMicros(record.navPerShareMicros, 4)}.` : ""}</p>
    <div className="gmd-check-list">{[{ title: "Direct chain read", check: checks?.chain }, { title: "Document fingerprint", check: checks?.hash }, { title: "Recalculated NAV", check: checks?.nav }].map(row => <article key={row.title}><div><b>{row.title}</b><span className={`gmd-status ${row.check?.state === "pass" ? "is-positive" : "is-waiting"}`}>{row.check?.state === "pass" ? "Matched" : row.check?.state === "fail" ? "Mismatch" : "Not yet verified"}</span></div><p>{row.check?.detail ?? "Waiting for evidence."}</p></article>)}</div>
    <TokenContractsCheck canonical={checks?.canonical ?? null} />
    <div className="gmd-evidence-actions"><button className="gmd-small-button" type="button" onClick={downloadEvidence} disabled={!evidenceRecord}><Icon name="download" size={16} />Download evidence</button><span>Re-check the file anywhere with <code>npm run verify:evidence</code>.</span></div>
    <TamperExperiment canonical={checks?.canonical ?? null} record={checks?.record ?? null} />
    <details className="gmd-disclosure"><summary>OKX OnchainOS prices in this record <span>+</span></summary><div className="gmd-data-table-scroll"><p className="gmd-caption">Each row: token units × price, rounded down to USD micros, then summed to the NAV. Price timestamps come from OKX OnchainOS.</p><table className="gmd-table"><thead><tr><th>Token</th><th>Price / USD</th><th>Price timestamp</th></tr></thead><tbody>{composition?.holdings.map(h => <tr key={h.symbol}><th scope="row">{h.symbol}</th><td>{formatUsdMicros(h.priceMicros, 4)}</td><td>{shortTime(h.priceTime)}</td></tr>)}</tbody></table></div></details>
    <details className="gmd-disclosure"><summary>Original composition document <span>+</span></summary><div><p className="gmd-caption">Formatted for reading; the verifier hashes the original bytes. Documents are kept for the latest 12 publications, about one hour. Older NAVs and fingerprints stay on X Layer.</p><pre>{document}</pre></div></details>
  </div>;
}
