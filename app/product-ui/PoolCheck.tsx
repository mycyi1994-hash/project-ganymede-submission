"use client";

import { useEffect, useState } from "react";
import type { Composition } from "@/lib/xstocks/basket";
import { MAINNET } from "@/lib/xstocks/mainnet";
import { comparePrices, formatDifference, POOL_TOLERANCE, readPoolPrices, XSTOCK_POOLS, type PoolPrices } from "@/lib/xstocks/pool-prices";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { Icon } from "./Icons";

type Read = { key: string; pools: PoolPrices | null; error: string | null };
type State = "waiting" | "loading" | "unavailable" | "matched" | "failed";

const LABEL: Record<State, string> = { waiting: "Waiting for the record", loading: "Reading the X Layer pools…", unavailable: "Pools unavailable", matched: "Prices agree", failed: "Prices disagree" };

/**
 * The second price source, checked by the browser: the recorded prices beside the X Layer mainnet
 * pools read directly from the public RPC, with the recorded units valued at the pool prices.
 * `detailed` adds how the pools are found and read, for the developer page.
 */
export default function PoolCheck({ composition, detailed = false }: { composition: Composition | null; detailed?: boolean }) {
  const key = composition ? `${composition.asOf}:${composition.navPerShareMicros}` : "";
  const [read, setRead] = useState<Read | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    readPoolPrices()
      .then(pools => { if (!cancelled) setRead({ key, pools, error: null }); })
      .catch(reason => { if (!cancelled) setRead({ key, pools: null, error: reason instanceof Error ? reason.message : "The X Layer pools could not be read." }); });
    return () => { cancelled = true; };
  }, [key, attempt]);
  const current = read?.key === key ? read : null;
  const comparison = composition && current?.pools ? comparePrices(composition, current.pools) : null;
  const state: State = !composition ? "waiting" : !current ? "loading" : !comparison ? "unavailable" : comparison.agrees ? "matched" : "failed";
  const pool = (symbol: string) => XSTOCK_POOLS.find(entry => entry.symbol === symbol);
  const tolerance = `${POOL_TOLERANCE.navBps / 100}%`;
  const titleId = detailed ? "verify-pools-title" : "pools-title";
  return <section className="gmd-proof-history gmd-pool-check" id={detailed ? "verify-pools" : "proof-pools"} aria-labelledby={titleId}>
    <header className="gmd-section-heading"><div><h2 id={titleId}>A second price source</h2><p>The recorded OKX OnchainOS prices beside the xStocks’ trading pools on X Layer, read by your browser.</p></div><span className={`gmd-check-chip is-${state}`} aria-live="polite">{state === "matched" ? <Icon name="check" size={15} /> : <i aria-hidden="true" />}{LABEL[state]}</span></header>
    {comparison && <p className="gmd-pool-summary">The recorded holdings are worth <strong>{formatUsdMicros(comparison.poolNavMicros, 4)}</strong> per share at the pool prices, against the recorded NAV of <strong>{formatUsdMicros(comparison.recordedNavMicros, 4)}</strong>: <strong>{formatDifference(comparison.navDifferenceBps)}</strong>.</p>}
    {state === "unavailable" && <p className="gmd-pool-summary">{current?.error ? "Your browser could not read the X Layer pools just now." : "This record’s holdings have no pinned X Layer pools to compare."} {current?.error && <button className="gmd-text-button" onClick={() => { setRead(null); setAttempt(value => value + 1); }}>Try again</button>}</p>}
    {comparison && <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>xStock</th><th>Recorded</th><th>Pool now</th><th>Difference</th><th>Pool</th></tr></thead><tbody>{comparison.rows.map(row => { const entry = pool(row.symbol); return <tr key={row.symbol}><th scope="row">{row.symbol}</th><td>{formatUsdMicros(row.recordedMicros, 2)}</td><td>{formatUsdMicros(row.poolMicros, 2)}</td><td>{formatDifference(row.differenceBps)}</td><td>{entry ? <a className="gmd-inline-tx" href={`${MAINNET.explorerUrl}/address/${entry.pool}`} target="_blank" rel="noreferrer">{entry.stable.symbol}<Icon name="external" size={12} /><span className="gmd-sr-only"> pool on OKX Explorer (opens in a new tab)</span></a> : "—"}</td></tr>; })}</tbody></table></div>}
    {detailed
      ? <p className="gmd-caption">{current?.pools ? `Read at X Layer block ${current.pools.blockNumber.toLocaleString("en-US")}, ${shortTime(current.pools.blockTime)}. ` : ""}Each pool is the Uniswap V3 pool where the xStock’s ERC-4626 wrapper trades against a dollar stablecoin, named in the last column. Every read confirms the pool with the factory and the wrapper’s underlying token, converts at the wrapper’s rate and counts the stablecoin as $1. The prices agree when the NAV at pool prices is within {tolerance} of the recorded NAV. The publisher runs the same comparison before each record and does not record a NAV more than {tolerance} from it; if the pools cannot be read, the record goes ahead with a warning.</p>
      : <p className="gmd-caption">{current?.pools ? `Read ${shortTime(current.pools.blockTime)}. ` : ""}Pool prices move with every trade and the record can be a few minutes older, so small differences are expected. The prices agree when the NAV at pool prices is within {tolerance} of the recorded NAV, and the publisher refuses a NAV further than that unless the pools cannot be read.</p>}
  </section>;
}
