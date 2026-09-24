"use client";
import { useState } from "react";
import { REPORT_EXAMPLES } from "@/lib/xstocks/report-examples";
import { parseReport, verifyReport } from "@/lib/xstocks/proof";
import { sha256Hex, stableJson } from "@/lib/engine/fixed";
import { formatUsdMicros } from "@/lib/nav-display";

export default function ReportExamples() {
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof verifyReport>> | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const example = REPORT_EXAMPLES[selected];
  async function run(change: boolean) {
    setBusy(true); setError("");
    try {
      const document = parseReport(example.canonical, example.profile);
      if (change) document.holdings[0].priceMicros = (BigInt(document.holdings[0].priceMicros) + 1_000_000n).toString();
      const record = { holdingsHash: await sha256Hex(example.canonical), navPerShareMicros: example.document.navPerShareMicros, effectiveAt: example.document.asOf, publishedAt: null, sharesOutstandingMicros: "0" };
      setResult(await verifyReport(change ? stableJson(document) : example.canonical, record, example.profile)); setEdited(change);
    } catch { setResult(null); setError("This browser could not complete the example checks. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="proof-section report-examples" aria-labelledby="report-examples-title">
    <header><div><p className="proof-kicker">Offline examples · not published on chain</p><h2 id="report-examples-title">Different baskets. The same calculation checks.</h2></div><p>These synthetic reports demonstrate reuse of the verifier. They are not market data, customer portfolios or independently authenticated records.</p></header>
    <label className="example-selector">Example report <select value={selected} disabled={busy} onChange={event => { setSelected(Number(event.target.value)); setResult(null); setEdited(false); setError(""); }}>{REPORT_EXAMPLES.map((item, index) => <option value={index} key={item.profile.productId}>{item.name}</option>)}</select></label>
    <div className="proof-table-wrap"><table className="proof-table"><thead><tr><th scope="col">Example holding</th><th scope="col">Original token price</th><th scope="col">Price in copy</th><th scope="col">Reported value</th></tr></thead><tbody>{example.document.holdings.map((row, index) => <tr key={row.symbol}><th scope="row">{row.symbol}</th><td>{formatUsdMicros(row.priceMicros, 2)}</td><td>{formatUsdMicros((BigInt(row.priceMicros) + (edited && index === 0 ? 1_000_000n : 0n)).toString(), 2)}</td><td>{formatUsdMicros(row.valueMicros, 2)}</td></tr>)}</tbody></table></div>
    <div className="experiment-actions"><button className="button is-primary" disabled={busy} onClick={() => void run(false)}>Verify original report</button><button className="button" disabled={busy} onClick={() => void run(true)}>Change first price by $1</button></div>
    <div role="status" aria-live="polite" aria-atomic="true"><p>{busy ? "Checking example bytes and arithmetic…" : error || (result ? `${edited ? "Edited copy" : "Original report"}: fingerprint ${result.hash.state === "pass" ? "matched" : "mismatch"}; calculation ${result.nav.state === "pass" ? "matched" : "mismatch"}.` : "Choose a report and run the checks. No result is preset.")}</p>{result && <p>{result.nav.detail}</p>}</div>
    <p className="proof-footnote">Reference fingerprints are computed from the bundled original examples. Only the live USTX flow above reads X Layer. All edits stay in this browser.</p>
  </section>;
}
