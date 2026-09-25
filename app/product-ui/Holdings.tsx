"use client";

import type { Composition } from "@/lib/xstocks/basket";
import { formatUsdMicros } from "@/lib/nav-display";
import { constituentFigures, currentWeights, shortTime, signedPercent } from "@/lib/product-market";
import { AssetMark, assetNames, assetSymbols, assetStyle, Icon } from "./Icons";
import { changeTone, useConstituentDrawer, useConstituents, WeightMeter } from "./ConstituentDrawer";

const shortDay = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The six xStocks with their price, change since the fixing and weight; each opens its detail panel. */
export default function Holdings({ composition, compact = false, loading = false }: { composition: Composition | null; compact?: boolean; loading?: boolean }) {
  const { open, drawer } = useConstituentDrawer();
  const recorded = useConstituents();
  const weights = currentWeights(composition);
  // The record's own figures carry the change since the fixing; a composition passed in without one still lists.
  const same = Boolean(composition && recorded.composition && recorded.composition.asOf === composition.asOf && recorded.composition.basketFixedAt === composition.basketFixedAt);
  const figures = same ? recorded.figures : composition ? constituentFigures(composition, null) : [];
  const since = same && recorded.fixedAt ? shortDay(recorded.fixedAt) : null;
  return <section className={`gmd-holdings ${compact ? "is-compact" : ""}`} aria-label="Basket composition"><header className="gmd-section-heading"><div><h2>{compact ? "The basket" : "Constituents"}</h2><p>{composition ? "Weights at the latest OKX OnchainOS prices" : "Six US technology xStocks"}</p></div><span className="gmd-count">6 assets</span></header>
    {composition && <div className="gmd-composition-strip" role="group" aria-label="Weights in the basket">{assetSymbols.map(symbol => <button key={symbol} type="button" style={{ ...assetStyle(symbol), flexGrow: weights.get(symbol) ?? 0 }} onClick={() => open(symbol)} aria-haspopup="dialog" aria-label={`${assetNames[symbol]}, ${weights.get(symbol)?.toFixed(2)} percent. Details`} />)}</div>}
    <div className="gmd-constituents-head" aria-hidden="true"><span>Asset</span><span>Price</span><span>Weight</span></div>
    <ul className="gmd-constituents" aria-label="The six xStocks" aria-busy={!composition && loading}>{assetSymbols.map(symbol => {
      const asset = figures.find(item => item.symbol === symbol);
      return <li key={symbol} style={assetStyle(symbol)}><button type="button" className="gmd-constituent" aria-haspopup="dialog" onClick={() => open(symbol)} disabled={!composition && loading}>
        <AssetMark symbol={symbol} />
        <span className="gmd-constituent-name"><b>{assetNames[symbol]}</b><small>{symbol}</small></span>
        <span className="gmd-constituent-price">{asset ? <><b><span className="gmd-sr-only">Price </span>{formatUsdMicros(asset.priceMicros, 2)}</b>{asset.changePercent !== null && <small className={`gmd-change ${changeTone(asset.changePercent)}`}><span className="gmd-sr-only">Since {since}: </span>{signedPercent(asset.changePercent)}</small>}</> : !composition && loading ? <i className="gmd-skeleton" style={{ width: 64 }} aria-hidden="true" /> : <b>—</b>}</span>
        <span className="gmd-constituent-weight">{asset ? <><b><span className="gmd-sr-only">Weight </span>{asset.weightPercent.toFixed(2)}%</b><WeightMeter weight={asset.weightPercent} target={asset.targetPercent} /></> : !composition && loading ? <i className="gmd-skeleton" style={{ width: 48 }} aria-hidden="true" /> : <b>—</b>}</span>
        <Icon name="chevron" size={16} />
      </button></li>;
    })}</ul>
    {!compact && <p className="gmd-caption">Equal weight at each quarterly rebalance; weights move with prices. The line under each weight marks the {figures[0] ? `${figures[0].targetPercent.toFixed(2)}%` : "equal-weight"} target{since ? `, and each change is since the units were fixed on ${since}` : ""}. {composition ? `Prices from OKX OnchainOS as of ${shortTime(composition.asOf)}.` : "Values appear with the next recorded NAV."}</p>}
    {compact && <p className="gmd-caption">{since ? `Changes since the units were fixed on ${since}. ` : ""}The line under each weight marks the equal-weight target. Select an asset for its details.</p>}
    {drawer}
  </section>;
}
