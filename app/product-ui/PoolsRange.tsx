"use client";

import { useEffect, useState } from "react";
import { formatUsdRounded } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatSharesShort } from "@/lib/demo/format";
import { readRangePool, rangeErrorMessage, rangeValueMicros, type RangeAccount, type RangeDeployment, type RangePool, type RangePosition } from "@/lib/xstocks/range-liquidity";
import { SHAPE_LABELS } from "./PoolStrategy";

// The range pool on Pools: positions of one's own, read from X Layer Testnet the way the two pooled
// pools are read, and the list of a wallet's open positions with what each would pay now.

export type RangeSnapshot = { owner: string | null; pool: RangePool; account: RangeAccount | null };
export type RangeReader = { snapshot: RangeSnapshot | null; failure: string | null; watermark: number; raise: (block: number) => void; retry: () => void };

export function useRangePool(deployment: RangeDeployment | null, owner: string | null, paused: boolean): RangeReader {
  const [snapshot, setSnapshot] = useState<RangeSnapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [watermark, setWatermark] = useState(0);
  useEffect(() => {
    if (!deployment) return;
    let cancelled = false;
    readRangePool(deployment, owner, { minBlock: watermark })
      .then(result => { if (!cancelled) { setSnapshot({ owner, ...result }); setFailure(null); } })
      .catch(error => { if (!cancelled) setFailure(rangeErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [deployment, owner, watermark, reload]);
  useEffect(() => {
    const onOrder = (event: Event) => { const block = (event as CustomEvent<{ block?: number }>).detail?.block; if (typeof block === "number") setWatermark(current => Math.max(current, block)); };
    window.addEventListener(DEMO_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(DEMO_ORDER_EVENT, onOrder);
  }, []);
  useEffect(() => {
    if (!deployment || paused) return;
    const timer = window.setInterval(() => { if (!document.hidden) setReload(value => value + 1); }, 30_000);
    return () => window.clearInterval(timer);
  }, [deployment, paused]);
  return { snapshot, failure, watermark, raise: block => setWatermark(current => Math.max(current, block)), retry: () => setReload(value => value + 1) };
}

/** How far a position reaches either side of the price, from its bins. */
function reach(position: RangePosition, priceUsd: number) {
  if (!position.bins.length) return "";
  const low = position.bins[0].fromUsd, high = position.bins[position.bins.length - 1].toUsd;
  const pct = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
  return `${pct(low / priceUsd - 1)} to ${pct(high / priceUsd - 1)}`;
}

/** A wallet's open positions in the range pool, with a close button each. */
export function RangePositions({ positions, pool, disabled, onClose }: { positions: RangePosition[]; pool: RangePool; disabled: boolean; onClose: (position: RangePosition) => void }) {
  if (!positions.length) return null;
  const nav = pool.navMicros ?? pool.priceMicros;
  const priceUsd = Number(pool.priceMicros) / 1e6;
  return <div className="gmd-liquidity-position gmd-range-positions">
    <span>Your own positions</span>
    <ul>{positions.map(position => {
      const fees = rangeValueMicros(position.fees, nav);
      return <li key={String(position.id)}>
        <div><b>{SHAPE_LABELS[position.shape]} #{String(position.id)}</b><small>{reach(position, priceUsd)} · {position.binsBelow + position.binsAbove} bins</small></div>
        <div><strong>{formatUsdRounded(rangeValueMicros(position.amounts, nav))}</strong><small>{formatSharesShort(position.amounts.sharesMicros, 4)} USTX · {formatUsdRounded(position.amounts.dollarsMicros)}{fees > 0n ? ` · fees ${formatUsdRounded(fees)}` : ""}</small></div>
        <button type="button" className="gmd-small-button" disabled={disabled} onClick={() => onClose(position)}>Close</button>
      </li>;
    })}</ul>
  </div>;
}
