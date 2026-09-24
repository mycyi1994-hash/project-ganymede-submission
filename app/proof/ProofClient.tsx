"use client";

import { useCallback, useEffect, useState } from "react";
import ProofExperiment from "./ProofExperiment";
import ReportExamples from "./ReportExamples";
import SiteHeader from "../SiteHeader";
import { formatUsdMicros as usd } from "@/lib/nav-display";
import { PROOF_DEPLOYMENT, parseComposition, verifyComposition, type Check } from "@/lib/xstocks/proof";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import { formatRecordTime as time, pricingStatus, publicationStatus } from "@/lib/nav-status";
import RecordTime from "../RecordTime";
import { SiteFooter, StockMark } from "../DesignElements";

type Holding = {
  symbol: string;
  address: string;
  weightBps: number;
  unitsWad: string;
  priceMicros: string;
  valueMicros: string;
  priceTime: string;
  priceSource: string;
};

type Composition = {
  productId: string;
  asOf: string;
  pricingChainIndex: string;
  basketFixedAt: string;
  navPerShareMicros: string;
  holdings: Holding[];
};

type Publication = {
  asOf: string;
  navPerShareMicros: string;
  holdingsHash: string;
  canonical: string;
  status: string;
  txHash: string | null;
  error: string | null;
};

type ProofResponse = {
  product: { id: string; ticker: string; name: string; benchmark: string; methodology: string; inceptionNavMicros: string };
  pricing: { maxQuoteAgeMinutes?: number; chainIndex: string; name: string; explorerUrl: string; constituents: Array<{ symbol: string; underlying: string; name: string; address: string | null }> };
  registry: { chain: string; chainName: string; chainId: number; explorerUrl: string; address: string | null };
  latest: {
    evaluatedAt: string;
    status: "awaiting_configuration" | "awaiting_prices" | "priced";
    blockers: string[];
    warnings: string[];
    composition: Composition | null;
    canonical: string | null;
    holdingsHash: string | null;
    publication: Publication | null;
  } | null;
  history: Publication[];
  onchain: { navPerShareMicros: string; sharesOutstandingMicros: string; holdingsHash: string; effectiveAt: string | null; publishedAt: string | null } | null;
  onchainError: string | null;
};

const WAD = 10n ** 18n;

function units(wad: string): string {
  const value = BigInt(wad);
  return `${(value / WAD).toString()}.${(value % WAD).toString().padStart(18, "0").slice(0, 6)}`;
}

function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "—";
}

const STATUS_LABEL: Record<string, string> = {
  priced: "QUOTES ACCEPTED",
  awaiting_prices: "AWAITING ELIGIBLE QUOTES",
  awaiting_configuration: "AWAITING CONFIGURATION",
};

export default function ProofClient() {
  const [data, setData] = useState<ProofResponse | null>(null);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<{ source: ProofResponse; hash: Check; chain: Check; nav: Check; record: OnchainNav | null; rpcError: string | null } | null>(null);
  const checks = verification?.source === data ? verification : null;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [experiment, setExperiment] = useState<{ canonical: string; record: OnchainNav } | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setNow(Date.now());
    try {
      const response = await fetch("/api/xstocks", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`API ${response.status}`);
      setData(await response.json() as ProofResponse);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load proof data");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(load, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  // No server-RPC fallback: a blocked direct RPC stays unavailable.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      let record: OnchainNav | null = null;
      let rpcError: string | null = null;
      let experimentSource: string | null = null;
      let hash: Check = { state: "pending", detail: "Waiting for a directly read on-chain record." };
      let nav: Check = { state: "pending", detail: "Waiting for the published composition." };
      let chain: Check = { state: "pending", detail: "Reading the public X Layer RPC from this browser." };
      try {
        if (data.registry.chainId !== PROOF_DEPLOYMENT.chainId || data.registry.address?.toLowerCase() !== PROOF_DEPLOYMENT.registry) throw new Error("The API registry differs from the deployment pinned in this browser.");
        record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId });
        chain = record.effectiveAt
          ? { state: "pass", detail: "This browser read latestNav directly from the pinned registry and confirmed X Layer Testnet (1952)." }
          : { state: "pending", detail: "The registry has no published NAV for this basket yet." };
        if (record.effectiveAt) {
          const published = [data.latest?.publication, ...data.history].find((entry) => entry?.holdingsHash.toLowerCase() === record!.holdingsHash.toLowerCase());
          if (published) {
            const result = await verifyComposition(published.canonical, record);
            hash = result.hash;
            nav = result.nav;
            if (hash.state === "pass" && nav.state === "pass") experimentSource = published.canonical;
          } else {
            hash = { state: "pending", detail: "The directly read hash has no matching document in this response. A publication may have occurred during loading; retry to fetch its composition." };
            nav = { state: "pending", detail: "A matching document is required to recalculate NAV." };
          }
        }
      } catch (reason) {
        rpcError = reason instanceof Error ? reason.message : "Direct RPC read failed.";
        chain = { state: "pending", detail: "Direct verification unavailable: " + rpcError };
      }
      if (!cancelled) {
        setVerification({ source: data, hash, chain, nav, record, rpcError });
        setExperiment(experimentSource && record ? { canonical: experimentSource, record } : null);
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  const displayedRecord = checks?.record ?? data?.onchain;
  const verifiedCanonical = displayedRecord ? [data?.latest?.publication, ...(data?.history ?? [])].find((entry) => entry?.holdingsHash === displayedRecord.holdingsHash)?.canonical ?? null : null;
  const canonical = verifiedCanonical ?? data?.latest?.canonical ?? null;
  let publishedComposition: Composition | null = null;
  if (verifiedCanonical) {
    try { publishedComposition = parseComposition(verifiedCanonical); } catch { /* The failed check is shown above the document. */ }
  }
  const composition = publishedComposition;
  const record = displayedRecord?.effectiveAt ? displayedRecord : null;
  const pricing = pricingStatus(data?.latest ?? null, now, Boolean(error));
  const publication = publicationStatus(record, data?.latest ?? null, now, Boolean(error || checks?.rpcError || data?.onchainError));
  const checkList = [
    { label: "Direct chain read", check: checks?.chain, description: "Read from X Layer in your browser." },
    { label: "Composition hash", check: checks?.hash, description: "The document matches the hash on chain." },
    { label: "Recalculated NAV", check: checks?.nav, description: "Six holding values sum to the recorded NAV." },
  ];
  const passed = checkList.filter(({ check }) => check?.state === "pass").length;
  const summaryState = error || checks?.rpcError ? "unavailable" : !data ? "loading" : !record ? "waiting" : !checks ? "checking" : checkList.some(({ check }) => check?.state === "fail") ? "fail" : passed === 3 ? "pass" : "waiting";
  const summaryText = { unavailable: "Verification is unavailable.", loading: "Loading NAV evidence.", waiting: record ? "Awaiting matching evidence." : "Awaiting a published record.", checking: "Checking the published record.", fail: "The checks need attention.", pass: "This NAV record checks out." }[summaryState];
  let prettyDocument = canonical ?? "No composition yet.";
  if (canonical) { try { prettyDocument = JSON.stringify(JSON.parse(canonical), null, 2); } catch { /* Keep the original bytes inspectable. */ } }
  const status = data ? data.latest?.status ?? "awaiting_configuration" : error ? "unavailable" : "loading";
  const registryUrl = data?.registry.address ? `${data.registry.explorerUrl}/address/${data.registry.address}` : null;

  const copy = async () => {
    if (!canonical) return;
    try {
      await navigator.clipboard.writeText(canonical);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyError("Copy was unavailable. Select the document text below to copy it manually.");
    }
  };

  return (
    <main className="product-detail-page ganymede-v4 proof-page">
      <SiteHeader current="proof" />

      <section className="proof-hero" aria-labelledby="proof-title">
        <div>
          <p className="proof-kicker">GMD USTX · NAV evidence</p>
          <h1 id="proof-title">The value.<br />And the evidence.</h1>
          <p className="proof-lede">Follow one published model share from its six holding values to the X Layer Testnet record. Your browser checks whether the calculation, document and record agree.</p>
          <div className="proof-jump-links"><a href="#proof-verify">Results</a><a href="#proof-experiment">Try a change</a><a href="#proof-holdings">Calculation</a><a href="#proof-record">Chain record</a></div>
        </div>
        <div className="proof-record" role="group" aria-label="Last on-chain NAV">
          <span>Last published NAV / USD</span>
          <strong>{record ? usd(record.navPerShareMicros, 4) : "—"}</strong>
          <dl><div><dt>RECORD EFFECTIVE</dt><dd><RecordTime value={record?.effectiveAt} /></dd></div><div><dt>NETWORK</dt><dd>{data?.registry.chainName ?? "X Layer Testnet"}</dd></div></dl>
          <p>{checks?.record ? "Read directly from X Layer · one model share" : record ? "Server snapshot · direct verification pending" : error ? "Record unavailable · retry below" : "Waiting for an on-chain record"}</p>
        </div>
      </section>

      <section className={`proof-section proof-result proof-result-${summaryState}`} aria-label="Evidence checks">
        <div className={`proof-result-heading proof-result-${summaryState}`} aria-live="polite" aria-atomic="true">
          <div><span className="proof-result-eyebrow">VERIFICATION / IN YOUR BROWSER</span><h2 id="proof-verify">{summaryText}</h2></div>
          <span className="proof-count">{summaryState === "pass" || summaryState === "fail" ? `${passed} / 3 CHECKS PASSED` : summaryState === "unavailable" ? "DATA UNAVAILABLE" : summaryState === "loading" ? "LOADING DATA" : summaryState === "waiting" ? "NOT YET VERIFIED" : "CHECKING…"}</span>
        </div>
        {error && <p className="proof-refresh-error" role="alert">{data ? "The latest refresh failed. The record shown is from the last successful load." : "NAV evidence could not be loaded."} <button type="button" onClick={() => void load()}>TRY AGAIN</button></p>}
        {checks?.rpcError && <p className="proof-refresh-error" role="alert">Your browser could not complete a direct chain read. The server snapshot is shown for reference; independent verification has not passed.</p>}
        {record && checks && !checks.rpcError && checks.hash.state === "pending" && <p className="proof-refresh-error" role="status">Matching document unavailable. The chain may have updated during loading. Check again to retrieve its evidence; this is not a confirmed data mismatch.</p>}
        {summaryState === "fail" && <p className="proof-refresh-error" role="alert">Evidence mismatch detected. Do not treat this document as verified. Inspect the failed checks and source records below, then check again.</p>}
        <div className="proof-recheck"><span>Checks apply to the record above, regardless of current price availability.</span><button type="button" onClick={() => void load()} disabled={refreshing || Boolean(data && !checks)}>{refreshing || Boolean(data && !checks) ? "CHECKING…" : "CHECK AGAIN"}</button></div>
        <ol className="proof-checks">{checkList.map(({ label, check, description }, index) => <li key={label} className={`proof-check proof-check-${check?.state ?? "pending"}`}><div className="proof-check-top"><span>0{index + 1} / {index === 0 ? "RECORD" : index === 1 ? "DOCUMENT" : "VALUE"}</span><b aria-hidden="true">{check?.state === "pass" ? "✓" : check?.state === "fail" ? "!" : "…"}</b></div><div><strong>{label}</strong><p>{check?.state === "pass" ? description : check?.state === "fail" ? "Could not confirm a match. Open the details below." : checks?.rpcError ? "Direct verification unavailable." : "Waiting for evidence."}</p><span className="check-state-label">{check?.state === "pass" ? "MATCHED" : check?.state === "fail" ? "NEEDS ATTENTION" : checks?.rpcError ? "UNAVAILABLE" : "PENDING"}</span></div></li>)}</ol>
        <p className="proof-footnote">These checks establish record and calculation consistency. They do not verify custody, backing or investment safety.</p>
        <details className="detail-disclosure proof-check-details"><summary>Inspect the checks & registry <span aria-hidden="true">+</span></summary><div className="disclosure-content">
          {checkList.map(({ label, check }) => <p key={label}><strong>{label}</strong> — {check?.detail ?? "Waiting for evidence."}</p>)}
          <p>Registry {registryUrl ? <a href={registryUrl} target="_blank" rel="noreferrer">{data?.registry.address} ↗</a> : data ? "not configured" : error ? "unavailable" : "loading…"}</p>
          <p>Published {time(record?.publishedAt)} · Network {data?.registry.chainName ?? "—"}{data ? ` / ${data.registry.chainId}` : ""}</p>
        </div></details>
      </section>

      <div id="proof-experiment">{!error && experiment ? <ProofExperiment key={`${experiment.record.holdingsHash}:${experiment.record.effectiveAt}`} canonical={experiment.canonical} record={experiment.record} /> : <section className="proof-section proof-experiment-unavailable"><h2>Try changing one price.</h2><p>The local experiment becomes available after the original document passes all three checks. Resolve any missing data or connection problem above first.</p></section>}</div>

      <section className="proof-section proof-basket-section" aria-labelledby="proof-holdings">
        <header><div><span className="proof-result-eyebrow">{publishedComposition ? "PUBLISHED COMPOSITION" : "PUBLISHED COMPOSITION UNAVAILABLE"}</span><h2 id="proof-holdings">Calculate one model share.</h2></div><p>{composition ? `Priced ${time(composition.asOf)}` : error ? "Composition unavailable" : data ? "No document matched to this record" : "Waiting for composition data"}</p></header>
        {composition && !publishedComposition && <p className="proof-footnote">This composition has not been matched to the on-chain record shown above.</p>}
        <div className="proof-basket-layout"><div className="proof-basket-method"><span>THE BASKET AT A GLANCE</span><strong>{composition ? String(composition.holdings.length).padStart(2, "0") : "—"}</strong><p>US tech xStocks</p><dl><div><dt>Allocation</dt><dd>Equal weight at fixing</dd></div><div><dt>Review</dt><dd>Quarterly</dd></div><div><dt>Pricing source</dt><dd>OKX OnchainOS · X Layer</dd></div></dl><p className="basket-method-note">Fixed token units per model share. Their value changes with market prices.</p></div>
        <div className="proof-table-wrap proof-simple-wrap"><table className="proof-table proof-simple-table"><thead><tr><th scope="col">Token</th><th scope="col">Weight at fixing</th><th scope="col">Value / share</th></tr></thead><tbody>
          {(composition?.holdings ?? []).map((holding) => <tr key={holding.symbol}><th scope="row"><div className="proof-stock"><StockMark symbol={holding.symbol} /><span><b>{holding.symbol}</b><small>{data?.pricing.constituents.find((item) => item.symbol === holding.symbol)?.name}</small></span></div></th><td><span>{(holding.weightBps / 100).toFixed(2)}%</span><span className="proof-weight-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, holding.weightBps / 100))}%` }} /></span></td><td>{usd(holding.valueMicros, 4)}</td></tr>)}
        </tbody></table>{!composition && <p className="proof-empty">{data ? "No published composition matched this chain record. Check again or inspect the source records below." : error ? "Composition unavailable." : "Loading composition…"}</p>}</div>
        </div>
        <div className="nav-calculation"><div><span>For each holding</span><strong>Token units × token price</strong><p>Each holding is rounded down to USD micros before summing. Displayed amounts are rounded for reading; checks use full precision.</p></div><div><span>Sum of the six holding values</span><strong>{composition ? usd(composition.holdings.reduce((sum, item) => sum + BigInt(item.valueMicros), 0n).toString(), 4) : "—"}</strong><p>USD per model share in the published document</p></div></div>
        <p className="proof-footnote">Weights are set at fixing and can drift with prices. {composition ? `Basket fixed ${time(composition.basketFixedAt)}.` : ""}</p>
        <details className="detail-disclosure"><summary>Token addresses & pricing details <span aria-hidden="true">+</span></summary><div className="disclosure-content"><div className="proof-table-wrap"><table className="proof-table"><thead><tr><th scope="col">Token / address</th><th scope="col">Units / share</th><th scope="col">Price</th><th scope="col">Priced at</th></tr></thead><tbody>{(composition?.holdings ?? []).map((holding) => <tr key={holding.symbol}><th scope="row">{holding.symbol}<small><a href={`${data?.pricing.explorerUrl}/address/${holding.address}`} target="_blank" rel="noreferrer">{shortHash(holding.address)} ↗</a></small></th><td>{units(holding.unitsWad)}</td><td>{usd(holding.priceMicros, 4)}</td><td>{time(holding.priceTime)}</td></tr>)}</tbody></table></div>{data?.latest?.blockers && data.latest.blockers.length > 0 && <ul className="proof-blockers" aria-label="Why the latest NAV was not published">{data.latest.blockers.map((blocker) => <li key={blocker}>Not published: {blocker}</li>)}</ul>}<p className="proof-footnote">Latest pricing: {status === "loading" ? "LOADING DATA" : status === "unavailable" ? "DATA UNAVAILABLE" : STATUS_LABEL[status]} · {time(data?.latest?.evaluatedAt)}. Prices: OKX OnchainOS DEX, X Layer (chain {data?.pricing.chainIndex ?? "196"}).</p></div></details>
      </section>

      <section className="proof-section proof-chain-summary" aria-labelledby="proof-record"><header><h2 id="proof-record">Read the chain record.</h2><p>{checks?.record ? "Fetched directly by your browser from X Layer Testnet." : "Server snapshot only until the direct browser read succeeds."}</p></header><dl><div><dt>Recorded NAV / USD</dt><dd>{record ? usd(record.navPerShareMicros, 4) : "—"}</dd></div><div><dt>Composition fingerprint</dt><dd><code>{record?.holdingsHash ?? "Awaiting a record"}</code></dd></div><div><dt>Effective at</dt><dd><RecordTime value={record?.effectiveAt} /></dd></div></dl><p>The fingerprint identifies the exact published document. A matching fingerprint does not establish custody or backing.</p></section>

      <div className="proof-status-pair" aria-label="Data availability">
      <section className="proof-pricing-status" aria-label="Latest pricing status"><div><span>LATEST PRICING</span><strong className={"pricing-label pricing-" + pricing.tone}>{data || error ? pricing.label : "Loading pricing status…"}</strong><p>{data || error ? pricing.detail : "Retrieving the latest pricing attempt."}</p></div><div className="pricing-last-attempt"><span>LAST PRICING ATTEMPT</span><RecordTime value={data?.latest?.evaluatedAt} /></div></section>

      <section className="proof-pricing-status" aria-label="Publication status"><div><span>Publication</span><strong className={"pricing-label pricing-" + publication.tone}>{data || error ? publication.label : "Loading publication status…"}</strong><p>{publication.detail}</p></div><div className="pricing-last-attempt"><span>Quote eligibility policy</span><p>{data?.pricing.maxQuoteAgeMinutes ? `Quotes up to ${data.pricing.maxQuoteAgeMinutes} minutes old may be accepted at evaluation. This is not a guarantee of live market prices.` : "Quote-age policy unavailable in this response."}</p></div></section>

      </div>

      <details className="proof-section detail-disclosure journey-examples"><summary>Explore synthetic report examples <span aria-hidden="true">+</span></summary><p>Optional offline examples. These are not the published USTX record.</p><ReportExamples /></details>

      <section id="proof-source" className="proof-section proof-supporting" aria-label="Supporting evidence">
        <details className="detail-disclosure"><summary><span>On-chain publications<small>{data ? `${data.history.length} recent records` : error ? "Publications unavailable" : "Loading publications…"}</small></span><span aria-hidden="true">+</span></summary><div className="disclosure-content">
          {data && data.history.length > 0 ? <div className="proof-table-wrap"><table className="proof-table"><thead><tr><th scope="col">Effective</th><th scope="col">NAV / share</th><th scope="col">Holdings hash</th><th scope="col">Status</th><th scope="col">Transaction</th></tr></thead><tbody>{data.history.map((entry) => <tr key={entry.asOf}><th scope="row">{time(entry.asOf)}</th><td>{usd(entry.navPerShareMicros, 4)}</td><td><code>{shortHash(entry.holdingsHash)}</code></td><td>{entry.status.toUpperCase()}</td><td>{entry.txHash ? <a href={`${data.registry.explorerUrl}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">{shortHash(entry.txHash)} ↗</a> : entry.error ?? "—"}</td></tr>)}</tbody></table></div> : <p className="proof-empty">{data ? "No publications yet." : error ? "Publications unavailable." : "Loading publications…"}</p>}
        </div></details>
        <details className="detail-disclosure"><summary><span>The original document<small>Canonical JSON & independent hash check</small></span><span aria-hidden="true">+</span></summary><div className="disclosure-content">
          {canonical && !verifiedCanonical && <p className="proof-footnote" role="note">This is the latest priced composition. It is not the document behind the on-chain record shown above, so its hash will not match the registry.</p>}
          <div className="proof-document-toolbar"><p>Copy the exact bytes used for the hash. The preview below is formatted for reading.</p><button type="button" className="proof-copy" onClick={copy} disabled={!canonical}>{copied ? "COPIED" : "COPY JSON"}</button></div>
          <p className="proof-copy-status" role="status">{copyError || (copied ? "Canonical JSON copied." : "")}</p>
          <pre className="proof-json">{prettyDocument}</pre>
          <p className="proof-footnote">To check independently, save the copied text as composition.json, run <code>printf &apos;%s&apos; &quot;$(cat composition.json)&quot; | sha256sum</code>, and compare it with the registry’s <code>holdingsHash</code> for <code>keccak256(&quot;{data?.product.id ?? "us-tech-x"}&quot;)</code>.</p>
        </div></details>
      </section>

      <nav className="proof-document-links" aria-label="Methodology and limitations"><a href="/methodology">Read the calculation method ↗</a><a href="/limitations">Understand the limits ↗</a></nav>
      <p className="proof-custody-note">Test environment. NAV evidence only. xStocks are issued by Backed; Ganymede does not custody them.</p><SiteFooter />
    </main>
  );
}
