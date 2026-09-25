"use client";

import type { Composition } from "@/lib/xstocks/basket";
import { lookThrough } from "@/lib/demo/basket";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { compositionForRecord } from "@/lib/product-market";
import { tokenExplorerUrl } from "@/lib/xstocks/mainnet";
import { formatUnits } from "@/lib/xstocks/wallet";
import { useMarket } from "./MarketProvider";
import { AssetMark, assetNames, assetStyle, Icon } from "./Icons";

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

/** A full table: token amounts, prices, values and weights, with explorer links for each token. */
export function BasketTable({ composition, sharesMicros, label }: { composition: Composition; sharesMicros: bigint; label: string }) {
  const view = lookThrough(composition, sharesMicros);
  return <div className="gmd-basket-table">
    <WeightBar rows={view.rows} large />
    <div className="gmd-data-table-scroll"><table className="gmd-table" aria-label={label}><thead><tr><th>Asset</th><th>Tokens</th><th>OKX price</th><th>Value</th><th>Weight</th></tr></thead><tbody>{view.rows.map(row => {
      const holding = composition.holdings.find(item => item.symbol === row.symbol);
      return <tr key={row.symbol} style={assetStyle(row.symbol)}>
        <th scope="row"><span className="gmd-basket-asset"><AssetMark symbol={row.symbol} /><span><b>{assetNames[row.symbol] ?? row.symbol}</b><a href={tokenExplorerUrl(row.address)} target="_blank" rel="noreferrer">{row.symbol}<Icon name="external" size={12} /><span className="gmd-sr-only"> on the OKX X Layer explorer (opens in a new tab)</span></a></span></span></th>
        <td>{formatUnits(row.units, 4)}</td>
        <td>{holding ? formatUsdMicros(holding.priceMicros, 2) : "—"}</td>
        <td>{formatUsdRounded(row.valueMicros)}</td>
        <td><span>{percent(row.weightBps)}</span><span className="gmd-weight-track" aria-hidden="true"><i style={{ width: `${row.weightBps / 100}%` }} /></span></td>
      </tr>;
    })}</tbody></table></div>
  </div>;
}
