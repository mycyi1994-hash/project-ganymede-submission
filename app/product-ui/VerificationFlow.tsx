"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { formatRecordTime } from "@/lib/nav-status";
import { formatDifference, POOL_TOLERANCE } from "@/lib/xstocks/pool-prices";
import type { Check } from "@/lib/xstocks/proof";
import type { RecordCheck, RecordCheckState } from "./useRecordCheck";
import type { PoolCheckResult } from "./PoolCheck";
import { AssetMark, Icon } from "./Icons";

type Step = "fingerprint" | "arithmetic" | "prices";
const STEPS: { id: Step; name: string; description: string }[] = [
  { id: "fingerprint", name: "Match the document", description: "Did these exact bytes get recorded?" },
  { id: "arithmetic", name: "Recalculate the NAV", description: "Do the holdings and their times add up?" },
  { id: "prices", name: "Compare pool prices", description: "Does a second price source agree?" },
];
const money = (value: string | null | undefined) => value == null ? "—" : formatUsdMicros(value, 6);
const fingerprint = (value: string | null | undefined) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "Waiting for data";
const units = (wad: string) => {
  const value = BigInt(wad), scale = 10n ** 18n;
  const fraction = (value % scale).toString().padStart(18, "0").replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
};

function Result({ state, pending = "Waiting" }: { state: Check["state"]; pending?: string }) {
  return <span className={`gmd-flow-result is-${state}`}><Icon name={state === "pass" ? "check" : state === "fail" ? "close" : "info"} size={14} />{state === "pass" ? "Matches" : state === "fail" ? "Mismatch" : pending}</span>;
}

/** A view of the real verifier's inputs and intermediate values; it never invents a successful step. */
export default function VerificationFlow({ checks, state, pools, detailed = false }: { checks: RecordCheck | null; state: RecordCheckState; pools: PoolCheckResult; detailed?: boolean }) {
  const [step, setStep] = useState<Step>("fingerprint");
  const [symbol, setSymbol] = useState<string | null>(null);
  const id = useId();
  const document = checks?.composition;
  const record = checks?.record;
  const holding = document?.holdings.find(row => row.symbol === symbol) ?? document?.holdings[0];
  const poolState = pools.state === "matched" ? "pass" : pools.state === "failed" ? "fail" : "pending";
  const stepStates: Record<Step, Check["state"]> = { fingerprint: checks?.hash.state ?? "pending", arithmetic: checks?.nav.state ?? "pending", prices: poolState };
  const proofLabel = { matched: "Record proof matches", failed: "Record proof failed", unavailable: "Record proof unavailable", waiting: "Waiting for the document", loading: "Reading the record" }[state];
  const priceLabel = { matched: "Pool prices agree", failed: "Pool prices disagree", unavailable: "Pool prices unavailable", waiting: "Waiting for holdings", loading: "Reading pool prices" }[pools.state];
  const oldestPrice = document ? new Date(Math.min(...document.holdings.map(row => Date.parse(row.priceTime)))).toISOString() : null;
  const value = holding ? (BigInt(holding.unitsWad) * BigInt(holding.priceMicros) / 10n ** 18n).toString() : null;
  return <section className="gmd-verification-flow" aria-labelledby={`${id}-title`}>
    <header className="gmd-flow-heading"><div><span className="gmd-flow-eyebrow">Follow the evidence</span><h2 id={`${id}-title`}>Your browser does the checking.</h2><p>Three inputs arrive on your device. This tab compares them itself.</p></div><span className="gmd-flow-local"><i aria-hidden="true" />Running in this tab</span></header>

    <div className="gmd-flow-publishing"><span>Before you visit</span><b>OKX OnchainOS prices</b><Icon name="arrow" size={15} /><b>Ganymede calculates the NAV</b><Icon name="arrow" size={15} /><b>Records the NAV + document fingerprint on X Layer</b><small>Every five minutes</small></div>

    <div className="gmd-flow-sources" aria-label="Data arriving in your browser">
      <article className={`gmd-flow-source ${step !== "prices" ? "is-selected" : ""}`}><div className="gmd-flow-source-top"><span className="gmd-flow-source-icon"><Icon name="activity" /></span><span>From our server</span></div><h3>Holdings document</h3><p>Token units, OKX prices and timestamps. The document is the input being checked.</p><div className="gmd-flow-source-value">{document ? `${document.holdings.length} holdings received` : checks?.canonical ? "Document received" : "Waiting for the document"}</div><small>Ganymede API → your browser</small></article>
      <article className={`gmd-flow-source ${step !== "prices" ? "is-selected" : ""}`}><div className="gmd-flow-source-top"><span className="gmd-flow-source-icon"><Icon name="lock" /></span><span>X Layer Testnet · 1952</span></div><h3>On-chain record</h3><p>The published NAV, document fingerprint and record time, read from a public node.</p><div className="gmd-flow-source-value">{record?.effectiveAt ? money(record.navPerShareMicros) : "Waiting for the chain read"}</div><small>Public RPC → your browser · direct</small></article>
      <article className={`gmd-flow-source is-comparison ${step === "prices" ? "is-selected" : ""}`}><div className="gmd-flow-source-top"><span className="gmd-flow-source-icon"><Icon name="pool" /></span><span>X Layer mainnet · 196</span></div><h3>xStock pool prices</h3><p>Current Uniswap pool prices provide an additional comparison of the basket’s value.</p><div className="gmd-flow-source-value">{pools.pools ? `${pools.pools.prices.length} pools read at one block` : priceLabel}</div><small>Public RPC → your browser · direct</small></article>
    </div>

    <div className="gmd-flow-connector" aria-hidden="true"><svg viewBox="0 0 900 62" preserveAspectRatio="none"><path className={step !== "prices" ? "is-active" : ""} d="M150 0V25Q150 32 158 32H442Q450 32 450 40V61M450 0V61" /><path className={step === "prices" ? "is-active is-comparison" : "is-comparison"} d="M750 0V25Q750 32 742 32H458Q450 32 450 40V61" /><path className="gmd-flow-arrow" d="m443 52 7 8 7-8" /></svg><span>Inputs meet here, on your device</span></div>

    <div className="gmd-flow-browser">
      <div className="gmd-flow-browser-bar"><span aria-hidden="true" className="gmd-flow-window-dots"><i /><i /><i /></span><b>Your browser</b><span>No wallet or signature needed</span></div>
      <div className="gmd-flow-steps" role="group" aria-label="Inspect a browser check">{STEPS.map((item, index) => <button key={item.id} type="button" aria-pressed={step === item.id} aria-controls={`${id}-inspection`} onClick={() => setStep(item.id)}><span className="gmd-flow-step-number">{index + 1}</span><span><b>{item.name}</b><small>{item.description}</small></span><Result state={stepStates[item.id]} pending={item.id === "prices" && pools.state === "unavailable" ? "Unavailable" : state === "unavailable" ? "Unavailable" : "Waiting"} /></button>)}</div>
      <div className="gmd-flow-inspection" id={`${id}-inspection`} aria-live="polite">
        {step === "fingerprint" && <>
          <div className="gmd-flow-detail-title"><div><h3>Same document. Same fingerprint.</h3><p>This tab computes SHA-256 from the document’s exact bytes, then compares it with the chain.</p></div><Result state={stepStates.fingerprint} /></div>
          <div className={`gmd-flow-pair is-${stepStates.fingerprint}`}><div><span>Computed on your device</span><code>{fingerprint(checks?.computedHash)}</code><small>From the document our server delivered</small></div><b className="gmd-flow-equals" aria-label={stepStates.fingerprint === "pass" ? "Matches" : stepStates.fingerprint === "fail" ? "Does not match" : "Not yet compared"}>{stepStates.fingerprint === "pass" ? "=" : stepStates.fingerprint === "fail" ? "≠" : "?"}</b><div><span>Read directly from X Layer</span><code>{fingerprint(record?.effectiveAt ? record.holdingsHash : null)}</code><small>From the NAV registry on Testnet</small></div></div>
          <p className="gmd-flow-explanation">{checks?.hash.state === "fail" ? "The fingerprints differ. This document is not the one committed in the chain record." : "Change even one character and the fingerprint changes. A matching fingerprint ties these exact bytes to this record; it does not prove the prices are true."}</p>
          <details className="gmd-flow-full-hashes"><summary>See both full fingerprints</summary><dl><div><dt>Computed here</dt><dd><code>{checks?.computedHash ?? "Not computed yet"}</code></dd></div><div><dt>Recorded on X Layer</dt><dd><code>{record?.effectiveAt ? record.holdingsHash : "Not read yet"}</code></dd></div></dl></details>
        </>}
        {step === "arithmetic" && <>
          <div className="gmd-flow-detail-title"><div><h3>Rebuild one share, holding by holding.</h3><p>Your device multiplies each token amount by its documented price, then adds the values.</p></div><Result state={stepStates.arithmetic} /></div>
          {holding ? <div className="gmd-flow-calculation"><label htmlFor={`${id}-holding`}>Inspect a holding<select aria-label="Inspect a holding" id={`${id}-holding`} value={holding.symbol} onChange={event => setSymbol(event.target.value)}>{document?.holdings.map(row => <option key={row.symbol} value={row.symbol}>{row.symbol}</option>)}</select></label><div><span>Units per USTX share</span><code>{units(holding.unitsWad)}</code></div><b aria-hidden="true">×</b><div><span>Documented token price</span><strong>{money(holding.priceMicros)}</strong></div><b aria-hidden="true">=</b><div><span>Calculated value per share</span><strong>{money(value)}</strong></div></div> : <p className="gmd-flow-empty">The calculation appears when a matching document is available.</p>}
          {document && <div className="gmd-flow-addends" aria-label="Calculated contributions to one USTX share">{document.holdings.map(row => <span key={row.symbol}><AssetMark symbol={row.symbol} /><span>{row.symbol}<b>{money((BigInt(row.unitsWad) * BigInt(row.priceMicros) / 10n ** 18n).toString())}</b></span></span>)}</div>}
          <div className={`gmd-flow-pair is-${stepStates.arithmetic}`}><div><span>Sum calculated on your device</span><strong>{money(checks?.computedNavMicros)}</strong></div><b className="gmd-flow-equals" aria-hidden="true">{stepStates.arithmetic === "pass" ? "=" : stepStates.arithmetic === "fail" ? "!" : "?"}</b><div><span>NAV read directly from X Layer</span><strong>{record?.effectiveAt ? money(record.navPerShareMicros) : "—"}</strong></div></div>
          <div className="gmd-flow-times"><div><span>Document time</span><b>{formatRecordTime(document?.asOf)}</b></div><div><span>Chain record time</span><b>{formatRecordTime(record?.effectiveAt)}</b></div><div><span>Oldest documented price</span><b>{formatRecordTime(oldestPrice)}</b></div></div>
          <p className="gmd-flow-explanation">{checks?.nav.state === "fail" ? checks.nav.detail : "Each row is rounded down to one micro-dollar before summing. Document and record times must match; price timestamps must fall within one minute of the record. This checks recorded timestamps, not the truth of the market prices."}</p>
        </>}
        {step === "prices" && <>
          <div className="gmd-flow-detail-title"><div><h3>Same token amounts. A second set of prices.</h3><p>Your browser reads the xStock pools directly and values the same basket again.</p></div><Result state={poolState} pending={pools.state === "unavailable" ? "Unavailable" : "Waiting"} /></div>
          <div className={`gmd-flow-pair is-${poolState}`}><div><span>NAV at recorded OKX prices</span><strong>{money(pools.comparison?.recordedNavMicros)}</strong></div><b className="gmd-flow-equals" aria-hidden="true">↔</b><div><span>Same basket at pool prices now</span><strong>{money(pools.comparison?.poolNavMicros)}</strong></div></div>
          <div className="gmd-flow-price-verdict"><span>Basket NAV difference <b>{pools.comparison ? formatDifference(pools.comparison.navDifferenceBps) : "—"}</b></span><span>Agreement threshold <b>±{POOL_TOLERANCE.navBps / 100}% of NAV</b></span><span>{pools.pools ? `Mainnet block ${pools.pools.blockNumber.toLocaleString("en-US")}` : "Waiting for a direct pool read"}</span></div>
          <p className="gmd-flow-explanation">This is an additional comparison, separate from the record proof. The 1% threshold applies to the whole basket’s NAV, not to each token. Both sources price xStocks on X Layer; neither establishes the stock-exchange price or asset custody.</p>
          {pools.state === "unavailable" && <button type="button" className="gmd-small-button" onClick={pools.retry}><Icon name="refresh" size={15} />Retry pool read</button>}
        </>}
      </div>
      <div className="gmd-flow-verdicts" aria-live="polite"><div className={`is-${state}`}><Icon name={state === "matched" ? "check" : "info"} size={18} /><span><b>{proofLabel}</b><small>Chain read + document fingerprint + NAV and time</small></span></div><div className={`is-${pools.state}`}><Icon name={pools.state === "matched" ? "check" : "info"} size={18} /><span><b>{priceLabel}</b><small>A separate market comparison; it does not set the proof badge</small></span></div></div>
    </div>
    <footer className="gmd-flow-trust"><div><h3>What you still trust</h3><p>Ganymede supplies this page’s JavaScript as well as the document. Direct reads rely on public RPC nodes and X Layer. You can inspect the public code and re-check an exported record outside this site.</p></div><Link className="gmd-small-button" prefetch={false} href={detailed ? "#experiment" : "/developers#experiment"}>Change a price in a local copy<Icon name="arrow" size={15} /></Link></footer>
    {detailed && <p className="gmd-flow-independent">Use the evidence download below to run the checks separately. <a href="https://github.com/mycyi1994-hash/project-ganymede-submission" target="_blank" rel="noreferrer">Inspect the public source<Icon name="external" size={13} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></p>}
  </section>;
}
