"use client";

import { useEffect, useState } from "react";
import type { Composition } from "@/lib/xstocks/basket";
import { CHAINLINK_CHAIN, CHAINLINK_FEEDS, compareChainlink, readChainlinkPrices, type ChainlinkPrices } from "@/lib/xstocks/chainlink-prices";
import { formatDifference, POOL_TOLERANCE } from "@/lib/xstocks/pool-prices";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { Icon } from "./Icons";
import type { PoolCheckState } from "./PoolCheck";

type Read = { key: string; prices: ChainlinkPrices | null; error: string | null };

const LABEL: Record<PoolCheckState, string> = { waiting: "Waiting for the record", loading: "Reading Chainlink…", unavailable: "Chainlink unavailable", matched: "Stock prices agree", failed: "Stock prices disagree" };

/**
 * The stock-market reference, checked by the browser: the recorded prices beside Chainlink's US
 * equity feeds on OP Mainnet, read directly from its public RPC. It informs; it does not stop a record.
 */
export function useChainlinkCheck(composition: Composition | null) {
  const key = composition ? `${composition.asOf}:${composition.navPerShareMicros}` : "";
  const [read, setRead] = useState<Read | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    readChainlinkPrices()
      .then(prices => { if (!cancelled) setRead({ key, prices, error: null }); })
      .catch(reason => { if (!cancelled) setRead({ key, prices: null, error: reason instanceof Error ? reason.message : "Chainlink could not be read." }); });
    return () => { cancelled = true; };
  }, [key, attempt]);
  const current = read?.key === key ? read : null;
  const comparison = composition && current?.prices ? compareChainlink(composition, current.prices) : null;
  const state: PoolCheckState = !composition ? "waiting" : !current ? "loading" : !comparison ? "unavailable" : comparison.agrees ? "matched" : "failed";
  return { state, comparison, prices: current?.prices ?? null, error: current?.error ?? null, retry: () => { setRead(null); setAttempt(value => value + 1); } };
}

export type ChainlinkCheckResult = ReturnType<typeof useChainlinkCheck>;

export default function ChainlinkCheck({ composition, detailed = false }: { composition: Composition | null; detailed?: boolean }) {
  const check = useChainlinkCheck(composition);
  return <ChainlinkCheckDetails check={check} detailed={detailed} />;
}

export function ChainlinkCheckDetails({ check, detailed = false }: { check: ChainlinkCheckResult; detailed?: boolean }) {
  const { state, comparison, prices, error, retry } = check;
  const feed = (symbol: string) => CHAINLINK_FEEDS.find(entry => entry.symbol === symbol);
  const tolerance = `${POOL_TOLERANCE.navBps / 100}%`;
  const titleId = detailed ? "verify-chainlink-title" : "chainlink-title";
  return <section className="gmd-proof-history gmd-pool-check" id={detailed ? "verify-chainlink" : "proof-chainlink"} aria-labelledby={titleId}>
    <header className="gmd-section-heading"><div><h2 id={titleId}>The stock market’s price</h2><p>The recorded prices beside Chainlink’s US stock prices, read by your browser.</p></div><span className={`gmd-check-chip is-${state}`} aria-live="polite">{state === "matched" ? <Icon name="check" size={15} /> : <i aria-hidden="true" />}{LABEL[state]}</span></header>
    {comparison && <p className="gmd-pool-summary">The {comparison.rows.length} holdings Chainlink prices, {(comparison.coveredWeightBps / 100).toFixed(1)}% of the NAV, are worth <strong>{formatUsdMicros(comparison.chainlinkMicros, 4)}</strong> per share at stock prices, against <strong>{formatUsdMicros(comparison.recordedMicros, 4)}</strong> recorded: <strong>{formatDifference(comparison.differenceBps)}</strong>.{comparison.uncovered.length ? ` Chainlink has no feed for ${comparison.uncovered.join(" or ")}.` : ""}</p>}
    {state === "unavailable" && <p className="gmd-pool-summary">{error ? "Your browser could not read Chainlink just now." : "This record’s holdings have no pinned Chainlink feeds to compare."} {error && <button className="gmd-text-button" onClick={retry}>Try again</button>}</p>}
    {comparison && <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>xStock</th><th>Recorded</th><th>Stock</th><th>Difference</th><th>Updated</th></tr></thead><tbody>{comparison.rows.map(row => { const entry = feed(row.symbol); return <tr key={row.symbol}><th scope="row">{row.symbol}</th><td>{formatUsdMicros(row.recordedMicros, 2)}</td><td>{formatUsdMicros(row.chainlinkMicros, 2)}</td><td>{formatDifference(row.differenceBps)}</td><td>{entry ? <a className="gmd-inline-tx" href={`${CHAINLINK_CHAIN.explorerUrl}/address/${entry.feed}`} target="_blank" rel="noreferrer">{shortTime(row.updatedAt)}<Icon name="external" size={12} /><span className="gmd-sr-only"> {entry.description} feed on the OP Mainnet explorer (opens in a new tab)</span></a> : shortTime(row.updatedAt)}</td></tr>; })}</tbody></table></div>}
    {detailed
      ? <p className="gmd-caption">{prices ? `Read at OP Mainnet block ${prices.blockNumber.toLocaleString("en-US")}, ${shortTime(prices.blockTime)}. ` : ""}Each feed is Chainlink’s 24/5 US equity feed for the share on OP Mainnet, pinned by address and checked for its description and 8 decimals at every read. Chainlink has no US equity feed on X Layer and none for ORCL or PLTR. A feed updates when the price moves 0.5% or once a day, through pre-market, regular, after-hours and overnight trading on weekdays, so at weekends it holds Friday’s last price while xStocks keep trading. The prices agree when the compared holdings are within {tolerance}. This comparison informs; it does not stop a record. xStocks reinvest dividends, so a token can be worth a little more than one share.</p>
      : <p className="gmd-caption">{prices ? `Read ${shortTime(prices.blockTime)}. ` : ""}The other two prices are xStock markets; this one is the stock itself, from licensed market data, for {CHAINLINK_FEEDS.length} of the nine holdings. It updates on weekdays only and when the price moves 0.5%, so small differences are expected. It informs; it does not stop a record.</p>}
  </section>;
}
