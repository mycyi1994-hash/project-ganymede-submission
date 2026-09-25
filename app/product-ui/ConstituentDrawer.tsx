"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatSharesShort } from "@/lib/demo/format";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { compositionForRecord, constituentFigures, navAtFixing, publicationHistory, shortTime, signedPercent, type ConstituentFigures } from "@/lib/product-market";
import { tokenExplorerUrl } from "@/lib/xstocks/mainnet";
import { formatUnits } from "@/lib/xstocks/wallet";
import { useMarket } from "./MarketProvider";
import { AssetMark, assetNames, assetStyle, Icon } from "./Icons";

// One xStock of the basket in detail: its OKX OnchainOS price and change since the units were fixed,
// what it adds to the NAV, its weight against the equal-weight target, the tokens in a share and in
// the whole fund, and its token contract on X Layer mainnet. A dialog: a side panel on wide
// screens and a sheet from the bottom on phones.

const SHARE = 1_000_000n;
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDay = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const changeTone = (percent: number | null) => percent === null || Math.round(percent * 100) === 0 ? "is-flat" : percent > 0 ? "is-up" : "is-down";
/** Weight bars run from 0 to 25%, so the gap to the 16.67% target is visible. */
export const WEIGHT_SCALE = 25;

/** The basket's figures for the displayed record, the fixing date and the shares recorded with it. */
export function useConstituents() {
  const { data } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const figures = composition && data ? constituentFigures(composition, navAtFixing(composition, publicationHistory(data))) : [];
  const shares = data?.onchain?.sharesOutstandingMicros && /^\d+$/.test(data.onchain.sharesOutstandingMicros) ? BigInt(data.onchain.sharesOutstandingMicros) : 0n;
  return { composition, figures, fixedAt: composition?.basketFixedAt ?? null, shares };
}

/** A weight against the equal-weight target, on a 0–25% scale. */
export function WeightMeter({ weight, target }: { weight: number; target: number }) {
  return <span className="gmd-weight-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, weight / WEIGHT_SCALE * 100)}%` }} /><em style={{ left: `${target / WEIGHT_SCALE * 100}%` }} /></span>;
}

/**
 * Opens the detail panel for one asset; render `drawer` once where the list is. The panel is placed
 * at the app's root, so it takes none of the list's own styles.
 */
export function useConstituentDrawer() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const drawer: ReactNode = symbol ? createPortal(<ConstituentDrawer symbol={symbol} onSelect={setSymbol} onClose={() => setSymbol(null)} />, document.querySelector(".gmd-app") ?? document.body) : null;
  return { open: setSymbol, drawer };
}

function Fact({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return <div><dt>{label}</dt><dd><b>{children}</b>{note && <small>{note}</small>}</dd></div>;
}

function ConstituentDrawer({ symbol, onSelect, onClose }: { symbol: string; onSelect: (symbol: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { composition, figures, fixedAt, shares } = useConstituents();
  const { data } = useMarket();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const index = figures.findIndex(item => item.symbol === symbol);
  const asset: ConstituentFigures | undefined = figures[index];
  const nav = data?.onchain?.navPerShareMicros ? BigInt(data.onchain.navPerShareMicros) : null;
  const name = assetNames[symbol] ?? symbol;
  const drift = asset ? asset.weightPercent - asset.targetPercent : 0;
  const previous = figures.length ? figures[(index - 1 + figures.length) % figures.length] : null;
  const next = figures.length ? figures[(index + 1) % figures.length] : null;
  const close = () => ref.current?.close();
  return <dialog ref={ref} className="gmd-drawer" aria-labelledby="constituent-title" style={assetStyle(symbol)} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="gmd-drawer-body">
      <header className="gmd-drawer-head">
        <AssetMark symbol={symbol} />
        <div><h2 id="constituent-title">{name}</h2><p>{symbol} · xStock on X Layer</p></div>
        <button type="button" className="gmd-drawer-close" onClick={close} aria-label="Close"><Icon name="close" size={20} /></button>
      </header>
      {!asset || !composition ? <p className="gmd-caption">The latest record’s holdings are not available right now. They appear with the next recorded NAV.</p> : <>
        <div className="gmd-drawer-price">
          <span className="gmd-label">OKX price</span>
          <strong>{formatUsdMicros(asset.priceMicros, 2)}</strong>
          {asset.changePercent !== null && fixedAt && <span className={`gmd-change ${changeTone(asset.changePercent)}`}>{signedPercent(asset.changePercent)}<span> since {shortDay(fixedAt)}</span></span>}
          <small>OKX OnchainOS DEX price on X Layer, as of {shortTime(asset.priceTime)}</small>
        </div>
        <section aria-labelledby="constituent-share">
          <h3 id="constituent-share">In one USTX share</h3>
          <dl className="gmd-drawer-facts">
            <Fact label="Tokens" note="Fixed until the next quarterly rebalance">{formatUnits(asset.unitsWad.toString(), 6)} {symbol}</Fact>
            <Fact label="Adds to the NAV" note={nav ? `Of ${formatUsdMicros(nav, 4)} per share` : undefined}>{formatUsdMicros(asset.valueMicros, 4)}</Fact>
            <Fact label="Weight" note={`Target ${asset.targetPercent.toFixed(2)}%, equal weight · ${Math.abs(drift) < 0.005 ? "on target" : `${drift > 0 ? "+" : "−"}${Math.abs(drift).toFixed(2)} pts ${drift > 0 ? "above" : "below"}`}`}>{asset.weightPercent.toFixed(2)}%</Fact>
          </dl>
          <div className="gmd-drawer-meter"><WeightMeter weight={asset.weightPercent} target={asset.targetPercent} /><span aria-hidden="true"><span>0%</span><span>Target {asset.targetPercent.toFixed(2)}%</span><span>{WEIGHT_SCALE}%</span></span></div>
        </section>
        {asset.fixingPriceMicros !== null && fixedAt && <section aria-labelledby="constituent-fixing">
          <h3 id="constituent-fixing">Since the units were fixed</h3>
          <dl className="gmd-drawer-facts">
            <Fact label="Fixed at" note={`At equal weight on ${day(fixedAt)}`}>{formatUsdMicros(asset.fixingPriceMicros, 2)}</Fact>
            <Fact label="Change" note="The OKX price now against the fixing price">{asset.changePercent === null ? "—" : <span className={`gmd-change-text ${changeTone(asset.changePercent)}`}>{signedPercent(asset.changePercent)}</span>}</Fact>
          </dl>
        </section>}
        {shares > 0n && <section aria-labelledby="constituent-fund">
          <h3 id="constituent-fund">Across the fund</h3>
          <dl className="gmd-drawer-facts">
            <Fact label="Tokens for all shares" note={`${formatSharesShort(shares)} USTX shares recorded on X Layer`}>{formatUnits((shares * asset.unitsWad / SHARE).toString(), 4)} {symbol}</Fact>
            <Fact label="Value" note="On testnet no xStocks are bought">{formatUsdRounded(shares * asset.valueMicros / SHARE)}</Fact>
          </dl>
        </section>}
        <section aria-labelledby="constituent-token">
          <h3 id="constituent-token">Token</h3>
          <a className="gmd-drawer-token" href={tokenExplorerUrl(asset.address)} target="_blank" rel="noreferrer">
            <span><b>{symbol} on X Layer mainnet</b><code>{asset.address.slice(0, 10)}…{asset.address.slice(-8)}</code></span>
            <span>OKX Explorer<Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span></span>
          </a>
        </section>
      </>}
      {previous && next && figures.length > 1 && <nav className="gmd-drawer-nav" aria-label="Other assets">
        <button type="button" onClick={() => onSelect(previous.symbol)}><Icon name="back" size={16} />{assetNames[previous.symbol] ?? previous.symbol}</button>
        <button type="button" onClick={() => onSelect(next.symbol)}>{assetNames[next.symbol] ?? next.symbol}<Icon name="arrow" size={16} /></button>
      </nav>}
    </div>
  </dialog>;
}
