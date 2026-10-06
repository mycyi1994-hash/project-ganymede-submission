"use client";

import { useEffect, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { Skeleton } from "./Icons";

// The two USTX/dUSD pools side by side over the same blocks: what each pool's trades made or lost for
// its liquidity providers at the NAV, read from GET /api/v1/ustx/pools, which serves the totals the
// scheduled job keeps (lib/xstocks/lp-markout.ts). Demo dollars and USTX have no value.

type Result = { trades: number; volumeMicros: string; resultMicros: string; arbitrages: number; arbitrageResultMicros: string; per10kYearMicros: string | null; repegs?: number };
type Served = { window: { from: string; to: string; navRecords: number }; constantProduct: Result; v4: Result | null };

/** The comparison as served, checked loosely: null when the API has none yet. */
function servedResults(body: unknown): Served | null {
  const value = body as { lpResults?: { from?: unknown; to?: unknown; navRecords?: unknown } | null; pools?: Array<{ id?: unknown; lpResult?: Result | null }> };
  const window = value?.lpResults;
  const pool = (id: string) => value?.pools?.find(entry => entry.id === id)?.lpResult ?? null;
  const constantProduct = pool("ustx-dusd");
  if (!window || typeof window.from !== "string" || typeof window.to !== "string" || typeof window.navRecords !== "number" || !constantProduct) return null;
  return { window: { from: window.from, to: window.to, navRecords: window.navRecords }, constantProduct, v4: pool("ustx-dusd-v4") };
}

/** Every five minutes, as the scheduled job adds the blocks since its last run. */
function useServedResults() {
  const [state, setState] = useState<{ value: Served | null; loaded: boolean }>({ value: null, loaded: false });
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch("/api/v1/ustx/pools", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!cancelled) setState(previous => ({ value: servedResults(body) ?? previous.value, loaded: true })); })
      .catch(() => { if (!cancelled) setState(previous => ({ ...previous, loaded: true })); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 300_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return state;
}

/** "+$0.0123" or "−$1.23": four decimals under a dollar, where these amounts usually are. */
export function signedUsd(micros: string | bigint): string {
  const value = BigInt(micros);
  if (value === 0n) return "$0.00";
  const size = value < 0n ? -value : value;
  const text = formatUsdMicros(size, size < 1_000_000n ? 4 : 2);
  return value < 0n ? `−${text}` : value > 0n ? `+${text}` : text;
}

const tone = (micros: string) => BigInt(micros) < 0n ? "gmd-negative" : BigInt(micros) > 0n ? "gmd-positive" : undefined;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const trades = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "trade" : "trades"}`;

function PoolColumn({ title, kind, result, note }: { title: string; kind: string; result: Result | null; note: string }) {
  return <article>
    <h3>{title}</h3>
    <span>{kind}</span>
    <strong className={result ? tone(result.resultMicros) : undefined}>{result ? signedUsd(result.resultMicros) : "—"}</strong>
    <small>For its liquidity providers, every trade valued at the NAV</small>
    <dl>
      <div><dt>Lost to arbitrage</dt><dd className={result ? tone(result.arbitrageResultMicros) : undefined}>{result ? `${signedUsd(result.arbitrageResultMicros)} · ${trades(result.arbitrages)}` : "—"}</dd></div>
      <div><dt>All trades</dt><dd>{result ? `${trades(result.trades)} · ${formatUsdMicros(BigInt(result.volumeMicros), 2)}` : "—"}</dd></div>
      <div><dt>Per $10,000, a year</dt><dd className={result?.per10kYearMicros ? tone(result.per10kYearMicros) : undefined}>{result?.per10kYearMicros ? signedUsd(result.per10kYearMicros) : "—"}</dd></div>
      <div><dt>At each NAV record</dt><dd>{note}</dd></div>
    </dl>
  </article>;
}

/** Compare liquidity returns: the constant-product pool and the v4 pool held at the NAV, over the same NAV records. */
export function PoolResults() {
  const { value, loaded } = useServedResults();
  if (loaded && !value) return null;
  return <section id="lp-results" className="gmd-fund gmd-lp-results" aria-labelledby="lp-results-title">
    <header className="gmd-section-heading">
      <div><h2 id="lp-results-title">Compare liquidity returns</h2><p>See how trading has affected providers in each USTX/dUSD pool over the same period.</p></div>
      <span className="gmd-badge">Measured on X Layer Testnet</span>
    </header>
    {value ? <>
      <div className="gmd-lp-compare">
        <PoolColumn title="Constant product" kind="USTX / dUSD · 0.30%" result={value.constantProduct} note="Keeps the old price until a trade moves it" />
        <PoolColumn title="Uniswap v4, held at the NAV" kind="USTX / dUSD · 0.30–1.00%" result={value.v4}
          note={value.v4?.repegs !== undefined ? `Moved to the NAV before trading, ${value.v4.repegs.toLocaleString("en-US")} times` : "Moved to the NAV before trading"} />
      </div>
      <p className="gmd-caption">
        From {when(value.window.from)} to {when(value.window.to)} UTC, with the {value.window.navRecords.toLocaleString("en-US")} NAV records published in that time.
        Each trade counts what the pool took in less what it paid out, USTX at the NAV of the moment: the fee, less what the trader gained from a stale price.
        After a record the constant-product pool still quotes the old NAV until arbitrage moves it; the v4 pool moves first. Demo dollars, no value.
      </p>
    </> : <div className="gmd-lp-compare" aria-busy="true"><article><Skeleton width="60%" /><Skeleton width={120} /></article><article><Skeleton width="60%" /><Skeleton width={120} /></article></div>}
  </section>;
}
