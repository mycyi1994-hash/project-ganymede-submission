"use client";

import { useState } from "react";
import type { Composition } from "@/lib/xstocks/basket";
import { lookThrough } from "@/lib/demo/basket";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { compositionForRecord } from "@/lib/product-market";
import { tokenExplorerUrl } from "@/lib/xstocks/mainnet";
import { formatUnits } from "@/lib/xstocks/wallet";
import { useMarket } from "./MarketProvider";
import { AssetMark, assetColors, assetNames, assetStyle, Icon } from "./Icons";
import { useConstituentDrawer } from "./ConstituentDrawer";

// A USTX share is a slice of the basket: fixed token units of six xStocks. These views show
// what a number of shares holds of each one, at the prices in the record on X Layer.

const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/** The published composition behind the displayed X Layer record, and that record's fingerprint. */
export function useRecordComposition(): { composition: Composition | null; holdingsHash: string | null } {
  const { data } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  return { composition, holdingsHash: composition && data?.onchain ? data.onchain.holdingsHash.toLowerCase() : null };
}

function WeightBar({ rows, large = false }: { rows: { symbol: string; weightBps: number }[]; large?: boolean }) {
  return <div className={`gmd-basket-bar${large ? " is-large" : ""}`} aria-hidden="true">{rows.map(row => <i key={row.symbol} style={{ ...assetStyle(row.symbol), flexGrow: row.weightBps }} />)}</div>;
}

/** A compact list for the order panel: each xStock, its token amount and value. */
export function BasketList({ composition, sharesMicros, label }: { composition: Composition; sharesMicros: bigint; label: string }) {
  const view = lookThrough(composition, sharesMicros);
  return <div className="gmd-basket-list">
    <WeightBar rows={view.rows} />
    <ul aria-label={label}>{view.rows.map(row => <li key={row.symbol} style={assetStyle(row.symbol)}>
      <AssetMark symbol={row.symbol} />
      <span><b>{assetNames[row.symbol] ?? row.symbol}</b><small>{formatUnits(row.units, 4)} {row.symbol}</small></span>
      <b>{formatUsdRounded(row.valueMicros)}</b>
    </li>)}</ul>
  </div>;
}

/**
 * A full table: token amounts, prices, values and weights, with explorer links for each token.
 * Each asset's name opens its detail panel. With `chart`, a donut of the values leads the table.
 */
export function BasketTable({ composition, sharesMicros, label, chart = false }: { composition: Composition; sharesMicros: bigint; label: string; chart?: boolean }) {
  const view = lookThrough(composition, sharesMicros);
  const { open, drawer } = useConstituentDrawer();
  return <div className="gmd-basket-table">
    {chart ? <AllocationDonut rows={view.rows} totalMicros={BigInt(view.totalMicros)} label={label} /> : <WeightBar rows={view.rows} large />}
    <div className="gmd-data-table-scroll"><table className="gmd-table" aria-label={label}><thead><tr><th>Asset</th><th>Tokens</th><th>OKX price</th><th>Value</th><th>Weight</th></tr></thead><tbody>{view.rows.map(row => {
      const holding = composition.holdings.find(item => item.symbol === row.symbol);
      return <tr key={row.symbol} style={assetStyle(row.symbol)}>
        <th scope="row"><span className="gmd-basket-asset"><AssetMark symbol={row.symbol} /><span><button type="button" className="gmd-asset-open" aria-haspopup="dialog" onClick={() => open(row.symbol)}>{assetNames[row.symbol] ?? row.symbol}<Icon name="chevron" size={14} /></button><a href={tokenExplorerUrl(row.address)} target="_blank" rel="noreferrer">{row.symbol}<Icon name="external" size={12} /><span className="gmd-sr-only"> on the OKX X Layer explorer (opens in a new tab)</span></a></span></span></th>
        <td>{formatUnits(row.units, 4)}</td>
        <td>{holding ? formatUsdMicros(holding.priceMicros, 2) : "—"}</td>
        <td>{formatUsdRounded(row.valueMicros)}</td>
        <td><span>{percent(row.weightBps)}</span><span className="gmd-weight-track" aria-hidden="true"><i style={{ width: `${row.weightBps / 100}%` }} /></span></td>
      </tr>;
    })}</tbody></table></div>
    {drawer}
  </div>;
}

type Slice = { symbol: string; valueMicros: string; weightBps: number };

// Ring geometry in the SVG's own units: a 2-unit surface gap between slices at the ring's middle.
const SIZE = 200, CENTER = 100, RADIUS = 78, WIDTH = 26, GAP = 2;

function arc(start: number, end: number): string {
  const point = (angle: number, radius: number) => `${(CENTER + radius * Math.sin(angle)).toFixed(3)},${(CENTER - radius * Math.cos(angle)).toFixed(3)}`;
  const outer = RADIUS + WIDTH / 2, inner = RADIUS - WIDTH / 2;
  const large = end - start > Math.PI ? 1 : 0;
  return `M${point(start, outer)} A${outer},${outer} 0 ${large} 1 ${point(end, outer)} L${point(end, inner)} A${inner},${inner} 0 ${large} 0 ${point(start, inner)} Z`;
}

/**
 * The value in each xStock as a ring of six slices, clockwise from the top in basket order, with
 * the total in the middle. The legend beside it names every slice with its weight
 * and value, so nothing depends on colour or on hovering.
 */
export function AllocationDonut({ rows, totalMicros, label }: { rows: Slice[]; totalMicros: bigint; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const total = rows.reduce((sum, row) => sum + row.weightBps, 0);
  const gapAngle = GAP / RADIUS;
  const turn = (bps: number) => total > 0 ? bps / total * Math.PI * 2 : 0;
  const slices = rows.map((row, index) => {
    const start = turn(rows.slice(0, index).reduce((sum, item) => sum + item.weightBps, 0));
    const end = start + turn(row.weightBps);
    return { ...row, start: start + gapAngle / 2, end: Math.max(start + gapAngle / 2, end - gapAngle / 2) };
  });
  const focus = active ? rows.find(row => row.symbol === active) : null;
  return <div className="gmd-allocation">
    <figure className="gmd-donut" aria-label={`${label}: ${rows.map(row => `${assetNames[row.symbol] ?? row.symbol} ${percent(row.weightBps)}`).join(", ")}`} role="img">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" onPointerLeave={() => setActive(null)}>
        {slices.map(slice => <path key={slice.symbol} d={arc(slice.start, slice.end)} fill={assetColors[slice.symbol] ?? "#526570"} className={active && active !== slice.symbol ? "is-muted" : ""} onPointerEnter={() => setActive(slice.symbol)} />)}
      </svg>
      <figcaption aria-hidden="true">{focus ? <><span>{assetNames[focus.symbol] ?? focus.symbol}</span><strong>{formatUsdRounded(focus.valueMicros)}</strong><small>{percent(focus.weightBps)} of the basket</small></> : <><span>Across 6 xStocks</span><strong>{formatUsdRounded(totalMicros)}</strong><small>At OKX OnchainOS prices</small></>}</figcaption>
    </figure>
    <ul className="gmd-allocation-legend" aria-label="Weights">{rows.map(row => <li key={row.symbol} style={assetStyle(row.symbol)} className={active === row.symbol ? "is-active" : ""} onPointerEnter={() => setActive(row.symbol)} onPointerLeave={() => setActive(null)}>
      <i aria-hidden="true" /><span><b>{assetNames[row.symbol] ?? row.symbol}</b><small>{row.symbol}</small></span><span><b>{percent(row.weightBps)}</b><small>{formatUsdRounded(row.valueMicros)}</small></span>
    </li>)}</ul>
  </div>;
}
