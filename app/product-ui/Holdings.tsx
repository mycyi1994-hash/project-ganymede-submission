"use client";

import { useState } from "react";
import type { Composition } from "@/lib/xstocks/basket";
import { formatUsdMicros } from "@/lib/nav-display";
import { currentWeights, shortTime } from "@/lib/product-market";
import { AssetMark, assetNames, assetSymbols, assetStyle } from "./Icons";

export default function Holdings({ composition, compact = false, loading = false }: { composition: Composition | null; compact?: boolean; loading?: boolean }) {
  const [selected, setSelected] = useState("AAPLx");
  const weights = currentWeights(composition);
  const active = composition?.holdings.find(h => h.symbol === selected);
  return <section className={`gmd-holdings ${compact ? "is-compact" : ""}`} aria-label="Basket composition"><header className="gmd-section-heading"><div><h2>{compact ? "The basket" : "Constituents"}</h2><p>{composition ? "Current weights in this published record" : "Six US technology xStocks"}</p></div><span className="gmd-count">6 assets</span></header>
    {composition && <div className="gmd-composition-strip" aria-label="Select a constituent">{assetSymbols.map(symbol => <button key={symbol} style={{ ...assetStyle(symbol), flexGrow: weights.get(symbol) ?? 0 }} onClick={() => setSelected(symbol)} aria-pressed={selected === symbol} aria-label={`${assetNames[symbol]}, ${weights.get(symbol)?.toFixed(2)} percent`}><span>{symbol.replace("x", "")}</span></button>)}</div>}
    <div className="gmd-holdings-table"><table className="gmd-table"><thead><tr><th>Asset</th><th>Weight</th>{!compact && <><th>Token price</th><th>Value / share</th></>}</tr></thead><tbody>{assetSymbols.map(symbol => {
      const h = composition?.holdings.find(row => row.symbol === symbol);
      return <tr key={symbol} className={selected === symbol ? "is-selected" : ""} style={assetStyle(symbol)}><th scope="row"><button className="gmd-asset-select" aria-pressed={selected === symbol} onClick={() => setSelected(symbol)}><AssetMark symbol={symbol} /><span><b>{assetNames[symbol]}</b><small>{symbol}</small></span></button></th><td><span>{weights.has(symbol) ? `${weights.get(symbol)!.toFixed(2)}%` : "—"}</span>{!compact && <span className="gmd-weight-track" aria-hidden="true"><i style={{ width: `${weights.get(symbol) ?? 0}%` }} /></span>}</td>{!compact && <><td>{h ? formatUsdMicros(h.priceMicros, 2) : "—"}</td><td>{h ? formatUsdMicros(h.valueMicros, 4) : "—"}</td></>}</tr>;
    })}</tbody></table></div>
    <div className="gmd-contribution" aria-live="polite"><span><b>{assetNames[selected]}</b>{active ? " contributes per model share" : loading ? " · loading composition…" : " · published composition unavailable"}</span><strong key={selected}>{active ? formatUsdMicros(active.valueMicros, 4) : "—"}</strong></div>
    {!compact && <p className="gmd-caption">Equal weight at fixing; weights move with prices. {composition ? `Composition dated ${shortTime(composition.asOf)}.` : "Values appear when a document matches the published record."}</p>}
  </section>;
}
