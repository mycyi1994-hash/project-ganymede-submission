"use client";

import { useEffect, useState } from "react";
import { XSTOCKS_CONSTITUENTS } from "@/lib/xstocks/basket";
import { formatUsdMicros } from "@/lib/nav-display";
import { formatRecordTime } from "@/lib/nav-status";
import { StockMark } from "./DesignElements";

type Snapshot = { latest: { status: string; composition: { asOf: string; holdings: Array<{ symbol: string; weightBps: number; priceMicros: string; valueMicros: string }> } | null } | null };

export default function BasketOverview() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/xstocks", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Unavailable"); return response.json() as Promise<Snapshot>; })
      .then(value => { setData(value); setError(false); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  const composition = data?.latest?.composition;
  return <section className="basket-overview" id="ustx-basket" aria-labelledby="ustx-basket-title">
    <header><div><h2 id="ustx-basket-title">What makes up one model share?</h2><p>Fixed token units, valued with prices from OKX OnchainOS on X Layer mainnet.</p></div><a className="text-link" href="/proof">Verify this basket’s NAV ↗</a></header>
    <div className="basket-overview-facts"><span><b>6 xStocks</b>US technology companies</span><span><b>Equal weight at fixing</b>Weights drift as prices change</span><span><b>Quarterly review</b>Token units are re-fixed</span></div>
    <div className="proof-table-wrap"><table className="proof-table"><thead><tr><th scope="col">Token</th><th scope="col">Weight at fixing</th><th scope="col">Token price / USD</th><th scope="col">Value per model share</th></tr></thead><tbody>{XSTOCKS_CONSTITUENTS.map(item => {
      const holding = composition?.holdings.find(row => row.symbol === item.symbol);
      return <tr key={item.symbol}><th scope="row"><span className="basket-token"><StockMark symbol={item.symbol} /><span>{item.symbol}<small>{item.name}</small></span></span></th><td>{holding ? `${(holding.weightBps / 100).toFixed(2)}%` : "—"}</td><td>{holding ? formatUsdMicros(holding.priceMicros, 4) : "—"}</td><td>{holding ? formatUsdMicros(holding.valueMicros, 4) : "—"}</td></tr>;
    })}</tbody></table></div>
    <p className="basket-snapshot-note" role="status">{error ? "Price snapshot unavailable. " : composition ? `Price snapshot: ${formatRecordTime(composition.asOf)}. ` : data ? "Awaiting a priced composition. " : "Loading the price snapshot. "}This is a pricing snapshot; Proof of NAV checks the separately published testnet record.{error && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}</p>
    <footer><div><h3>From basket to evidence.</h3><p>See how the holding values add up, then compare the published document with X Layer Testnet.</p></div><a className="button is-primary" href="/proof">Inspect NAV ↗</a></footer>
  </section>;
}
