"use client";

import { useEffect, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { OkxSource } from "./OkxSource";

type Served = {
  at: string;
  basketUsd: number;
  error?: string;
  legs: { symbol: string; paidMicros: string; receivedMicros: string | null; priceImpactPercent: string | null; routes: string[] }[];
  total: { swaps: number; paidMicros: string; receivedMicros: string | null; costMicros: string | null; networkFeeUsd: number | null; maxPriceImpactPercent: number | null };
};

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** Building USTX's basket by hand on X Layer mainnet, from GET /api/v1/ustx/dex-quotes. Hidden until quotes exist. */
export default function DexCompare() {
  const [quotes, setQuotes] = useState<Served | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/ustx/dex-quotes", { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<Served> : null)
      .then(value => { if (value) setQuotes(value); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!quotes || quotes.error || !quotes.legs.length) return null;
  const { total } = quotes;
  const cost = total.costMicros !== null ? BigInt(total.costMicros) : null;
  const percent = cost !== null && BigInt(total.paidMicros) > 0n ? Number(cost * 10_000n / BigInt(total.paidMicros)) / 100 : null;
  return <div className="gmd-dex-compare">
    <h3>Building a ${quotes.basketUsd.toLocaleString("en-US")} basket by hand on X Layer mainnet</h3>
    <dl className="gmd-usage">
      <div><dt>Swaps to sign</dt><dd><strong>{total.swaps}</strong><small>plus an approval each the first time</small></dd></div>
      <div><dt>Lost to price and fees</dt><dd><strong>{cost !== null ? formatUsdMicros(cost < 0n ? 0n : cost, 2) : "—"}</strong><small>{percent !== null ? `${Math.max(percent, 0).toFixed(2)}% of the order, at the aggregator's prices` : "at the aggregator's prices"}</small></dd></div>
      <div><dt>Network fees</dt><dd><strong>{total.networkFeeUsd !== null ? `$${total.networkFeeUsd.toFixed(4)}` : "—"}</strong><small>estimated for all the swaps</small></dd></div>
      <div><dt>Largest price impact</dt><dd><strong>{total.maxPriceImpactPercent !== null ? `${total.maxPriceImpactPercent.toFixed(2)}%` : "—"}</strong><small>{quotes.legs.find(leg => leg.priceImpactPercent !== null && Math.abs(Number(leg.priceImpactPercent)) === total.maxPriceImpactPercent)?.symbol ?? ""}</small></dd></div>
    </dl>
    <p className="gmd-caption">Quoted by the OKX OnchainOS DEX aggregator at {time(quotes.at)} for USDT into each xStock, an equal share each; nothing was sent. A fund share is one order for the whole basket, rebalanced for every holder at once. <OkxSource>OKX OnchainOS</OkxSource></p>
  </div>;
}
