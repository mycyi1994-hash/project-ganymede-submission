"use client";

import { useEffect, useState } from "react";
import { basketConfigPath, parseBasketConfig, verifyBasket, type BasketCheck, type BasketConfig } from "@/lib/xstocks/basket-config";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { formatUnits } from "@/lib/xstocks/wallet";
import { BrandMark } from "../DesignElements";
import { Icon } from "./Icons";

type RecordLink = { holdingsHash: string; transactionHash: string };
type Loaded = { path: string; config: BasketConfig | null; check: BasketCheck | null; records: RecordLink[]; error: string | null };
export type BasketState = "loading" | "unavailable" | "failed" | "matched" | "waiting";

/**
 * Loads a basket's configuration file from this site and runs the shared checks in the browser:
 * the registry it names is read directly, and the document for the record's fingerprint is
 * hashed, recalculated and compared with the configured units.
 */
export function useBasketCheck(path: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const safe = basketConfigPath(path);
    if (!safe) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(safe, { cache: "no-store" });
        if (!response.ok) throw new Error("The basket's configuration is not served here.");
        const config = parseBasketConfig(await response.json());
        const [check, records] = await Promise.all([
          verifyBasket(config, { base: window.location.origin }),
          fetch(safe.replace(/basket\.json$/, "records.json"), { cache: "no-store" }).then(reply => reply.ok ? reply.json() : []).catch(() => []),
        ]);
        const links = Array.isArray(records) ? records.filter((entry): entry is RecordLink => typeof entry?.holdingsHash === "string" && typeof entry?.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.transactionHash)) : [];
        if (!cancelled) setLoaded({ path: safe, config, check, records: links, error: null });
      } catch (reason) {
        if (!cancelled) setLoaded({ path: safe, config: null, check: null, records: [], error: reason instanceof Error ? reason.message : "The basket could not be checked." });
      }
    })();
    return () => { cancelled = true; };
  }, [path, attempt]);
  const current = loaded?.path === basketConfigPath(path) ? loaded : null;
  const checks = current?.check ? [current.check.chain, current.check.hash, current.check.nav, current.check.definition] : [];
  // The check has finished once it returns, so a step still pending means it could not be completed.
  const state: BasketState = !basketConfigPath(path) ? "unavailable" : !current ? "loading" : current.error || !current.check ? "unavailable" : checks.some(check => check.state === "fail") ? "failed" : checks.every(check => check.state === "pass") ? "matched" : "unavailable";
  return { ...current, state, retry: () => { setLoaded(null); setAttempt(value => value + 1); } };
}

const LABEL: Record<BasketState, string> = { loading: "Checking the record…", waiting: "Not yet verified", unavailable: "Not verified", failed: "Record needs attention", matched: "Verified in your browser" };
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/** The developer page's live check of a basket published from a configuration file. */
export default function BasketCheckPanel({ path }: { path: string }) {
  const { config, check, records, state, error, retry } = useBasketCheck(path);
  const record = check?.record?.effectiveAt ? check.record : null;
  const transaction = record ? records?.find(entry => entry.holdingsHash?.toLowerCase() === record.holdingsHash.toLowerCase())?.transactionHash : null;
  const explorer = config?.registry.explorerUrl;
  return <div className="gmd-verify-yourself gmd-basket-check" aria-live="polite">
    <p className="gmd-verify-status"><b>Live result:</b> {LABEL[state]}. {config ? `${config.ticker} · ${config.name}. ` : ""}{record ? `Record of ${shortTime(record.effectiveAt)}, NAV ${formatUsdMicros(record.navPerShareMicros, 4)}.` : error ?? ""} {state === "unavailable" && <button className="gmd-text-button" type="button" onClick={retry}>Try again</button>}</p>
    {config && <dl className="gmd-facts">
      <div><dt>Issuer</dt><dd>{config.issuer}</dd></div>
      <div><dt>Registry</dt><dd>{explorer ? <a className="gmd-inline-tx" href={`${explorer}/address/${config.registry.address}`} target="_blank" rel="noreferrer">{short(config.registry.address)}<Icon name="external" size={12} /><span className="gmd-sr-only"> on OKX Explorer (opens in a new tab)</span></a> : config.registry.address}</dd></div>
      <div><dt>Prices</dt><dd>{config.pricing.source}</dd></div>
      <div><dt>Transaction</dt><dd>{transaction && explorer ? <a className="gmd-inline-tx" href={`${explorer}/tx/${transaction}`} target="_blank" rel="noreferrer">{short(transaction)}<Icon name="external" size={12} /><span className="gmd-sr-only"> on OKX Explorer (opens in a new tab)</span></a> : "—"}</dd></div>
    </dl>}
    <div className="gmd-check-list">{[{ title: "Direct chain read", check: check?.chain }, { title: "Document fingerprint", check: check?.hash }, { title: "Recalculated NAV", check: check?.nav }, { title: "Basket definition", check: check?.definition }].map(row => <article key={row.title}><div><b>{row.title}</b><span className={`gmd-status ${row.check?.state === "pass" ? "is-positive" : "is-waiting"}`}>{row.check?.state === "pass" ? "Matched" : row.check?.state === "fail" ? "Mismatch" : "Not yet verified"}</span></div><p>{row.check?.detail ?? "Waiting for evidence."}</p></article>)}</div>
    {check?.composition && <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>xStock</th><th>Units per share</th><th>Price</th><th>Value</th></tr></thead><tbody>{check.composition.holdings.map(row => <tr key={row.symbol}><th scope="row">{row.symbol}</th><td>{formatUnits(row.unitsWad, 6)}</td><td>{formatUsdMicros(row.priceMicros, 2)}</td><td>{formatUsdMicros(row.valueMicros, 4)}</td></tr>)}</tbody></table></div>}
  </div>;
}

/** A badge for any basket configured on this site: `/embed/basket?config=/baskets/<id>/basket.json`. */
export function BasketBadge({ path, site }: { path: string | null; site: string }) {
  const { config, check, state } = useBasketCheck(path);
  const record = check?.record?.effectiveAt ? check.record : null;
  return <div className="gmd-embed-card">
    <header><span className="gmd-embed-brand"><BrandMark />Ganymede</span><span className="gmd-embed-network">{config?.registry.network ?? "X Layer"}</span></header>
    <div className="gmd-embed-product"><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><h1>{config ? `${config.ticker} · ${config.name}` : !basketConfigPath(path) ? "No basket configured" : state === "loading" ? "Loading the basket…" : "Basket unavailable"}</h1><small>{config ? config.constituents.map(row => row.symbol).join(", ") : " "}</small></div></div>
    <div className="gmd-embed-nav"><span>NAV per share</span><strong>{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong><small>{record && config ? `Recorded in ${short(config.registry.address)} · ${shortTime(record.effectiveAt)}` : state === "loading" ? "Reading the record on X Layer…" : "The record could not be checked just now."}</small></div>
    <footer>
      <a className={`gmd-check-chip is-${state}`} href={`${site}/developers#baskets`} target="_blank" rel="noreferrer" aria-live="polite">{state === "matched" ? <Icon name="check" size={15} /> : <i aria-hidden="true" />}<span>{LABEL[state]}</span></a>
    </footer>
  </div>;
}
