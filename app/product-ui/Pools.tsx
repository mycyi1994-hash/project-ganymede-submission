"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatShares, formatSharesShort, parseShares } from "@/lib/demo/format";
import { waitLabel } from "@/lib/product-market";
import { parseUsd } from "@/lib/xstocks/wallet";
import {
  FUND_CLAIM_MICROS, FUND_DEPLOYMENT, FUND_WALLET_CHAIN, POOL_FEE_BPS, dollarsFor, fundCalls, fundErrorMessage, fundExplorer, fundFill, poolCalls, waitForFundReceipt, withSlippage,
  type PoolMarket,
} from "@/lib/xstocks/fund";
import {
  POOL_LAUNCHED_AT, changeWad, formatSharePpm, formatYield, liquidityCalls, liquidityErrorMessage, liquidityFill, liquidityPosition, lpTokenValueMicros, minimumDollarsOnly,
  pairedDollars, pairedShares, poolValueMicros, quoteAddLiquidity, quoteRemoveLiquidity, readLiquidity, readPoolYield, splitDollarsOnly,
  type LiquidityAccount, type LiquidityFill, type PoolLiquidity, type PoolYield,
} from "@/lib/xstocks/liquidity";
import { Icon, Skeleton } from "./Icons";
import { useMarket } from "./MarketProvider";
import { PremiumGauge } from "./Fund";
import { plain } from "./Lending";
import { ActivityProvider, PoolActivitySection, useActivityDay } from "./MarketActivity";
import { useWalletAccount } from "./WalletAccount";
import { TxLink, sendFromWallet, useInjectedWallet, useWalletChain, type Provider } from "./WalletInvest";
import { TxSteps, WalletGate, orderDeadline, runPlan, useUnmountSignal, type PlanProgress, type PlanStep, type StepState, type TxStep } from "./LiquidityParts";
import { V4_POOL_DEPLOYMENT, formatFeePips, v4ValueMicros } from "@/lib/xstocks/v4-liquidity";
import { V4LiquidityPanel, V4PoolGuide, V4PoolOverview, useV4Pool, v4Position, type V4Reader } from "./PoolsV4";
import { PoolResults } from "./PoolResults";

// Providing liquidity to the USTX/dUSD pool on X Layer Testnet from OKX Wallet: deposit USTX and
// demo dollars at the pool's ratio (or demo dollars alone, half invested at the fund at the NAV),
// receive the pool's LP token and earn the 0.3% fee on every trade; withdraw both, or have the USTX
// redeemed at the NAV. Demo dollars and USTX have no value.

const ONE = 1_000_000n;
const FEE_PERCENT = `${POOL_FEE_BPS / 100n}.${(POOL_FEE_BPS % 100n).toString().padStart(2, "0")}%`;
const usd = (micros: bigint) => formatUsdMicros(micros, 2);
const ustx = (micros: bigint) => `${formatShares(micros)} USTX`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Snapshot = { owner: string | null; pool: PoolLiquidity; account: LiquidityAccount | null };
type Reader = { snapshot: Snapshot | null; failure: string | null; watermark: number; raise: (block: number) => void; retry: () => void };

/**
 * The pool, and the connected wallet's place in it, read at one block: every minute while nothing
 * is being sent, and again from the block of any transaction on the page.
 */
function usePool(owner: string | null, paused: boolean): Reader {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [watermark, setWatermark] = useState(0);
  useEffect(() => {
    let cancelled = false;
    readLiquidity(owner, { minBlock: watermark })
      .then(result => { if (!cancelled) { setSnapshot({ owner, ...result }); setFailure(null); } })
      .catch(error => { if (!cancelled) setFailure(liquidityErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [owner, watermark, reload]);
  useEffect(() => {
    const onOrder = (event: Event) => { const block = (event as CustomEvent<{ block?: number }>).detail?.block; if (typeof block === "number") setWatermark(current => Math.max(current, block)); };
    window.addEventListener(DEMO_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(DEMO_ORDER_EVENT, onOrder);
  }, []);
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => { if (!document.hidden) setReload(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [paused]);
  return { snapshot, failure, watermark, raise: block => setWatermark(current => Math.max(current, block)), retry: () => setReload(value => value + 1) };
}

/** The fees providers earned over the last seven days, read from the pool's state then and now; every ten minutes. */
function usePoolYield() {
  const [state, setState] = useState<{ value: PoolYield | null; failed: boolean; loaded: boolean }>({ value: null, failed: false, loaded: false });
  useEffect(() => {
    let cancelled = false;
    const load = () => readPoolYield()
      .then(value => { if (!cancelled) setState({ value, failed: false, loaded: true }); })
      .catch(() => { if (!cancelled) setState(previous => ({ ...previous, failed: true, loaded: true })); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 600_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return state;
}

/** "7 days", or "since 25 Sept" while the pool is younger. */
function windowLabel(growth: PoolYield) {
  return Date.parse(POOL_LAUNCHED_AT) / 1000 >= growth.fromTime - 60 ? `since ${new Date(POOL_LAUNCHED_AT).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : `${Math.round((growth.toTime - growth.fromTime) / 86_400)} days`;
}

const signedYield = (wad: bigint) => `${wad > 0n ? "+" : ""}${formatYield(wad)}`;

/** An LP token's value change at the NAV over the window, against holding the same tokens outside the pool. */
function performance(growth: PoolYield | null): string {
  const pooled = growth ? changeWad(growth.lpValueFromMicros, growth.lpValueToMicros) : null;
  const held = growth ? changeWad(growth.lpValueFromMicros, growth.heldValueToMicros) : null;
  if (pooled === null || held === null) return "—";
  return `${signedYield(pooled)}, against ${signedYield(held)} holding the same tokens`;
}

/** The fee APR's window, in words: the last seven days, or since the first deposit. */
function yieldWindow(growth: PoolYield) {
  const days = Math.round((growth.toTime - growth.fromTime) / 86_400);
  return Date.parse(POOL_LAUNCHED_AT) / 1000 >= growth.fromTime - 60 ? `Since the pool opened on ${day(POOL_LAUNCHED_AT)}` : `Over the last ${days} days, annualized`;
}

export function PoolsScreen() {
  const provider = useInjectedWallet();
  const { address, source } = useWalletAccount();
  const connected = source === "wallet" && Boolean(address);
  const chain = useWalletChain(provider, connected ? address : "");
  const owner = provider && connected && chain === FUND_WALLET_CHAIN.chainId ? address : null;
  const [busy, setBusy] = useState(false);
  const reader = usePool(owner, busy);
  const growth = usePoolYield();
  // The Uniswap v4 pool joins the list once its deployment is pinned.
  const v4 = useV4Pool(V4_POOL_DEPLOYMENT, owner, busy);
  const [selected, setSelected] = useState<"live" | "v4">("live");
  const showV4 = V4_POOL_DEPLOYMENT !== null && selected === "v4";
  return <ActivityProvider>
    <div className="gmd-page-heading"><div><h1>Pools</h1><p>Provide liquidity to USTX on X Layer and earn the fee on every trade.</p></div><span className="gmd-badge">X Layer Testnet</span></div>
    <PoolList snapshot={reader.snapshot} failure={reader.failure} owner={owner} growth={growth} v4={V4_POOL_DEPLOYMENT ? v4 : null} selected={selected} onSelect={setSelected} busy={busy} />
    {/* The panel comes first, as it shows on a phone; on a wide screen it sits beside the pool. */}
    <div className="gmd-detail-layout gmd-pools-layout">
      {showV4 && V4_POOL_DEPLOYMENT ? <>
        <div className="gmd-detail-aside" id="provide"><V4LiquidityPanel deployment={V4_POOL_DEPLOYMENT} provider={provider} chain={chain} owner={owner} reader={v4} onBusy={setBusy} /></div>
        <div className="gmd-detail-content">
          <V4PoolOverview deployment={V4_POOL_DEPLOYMENT} reader={v4} />
          <V4PoolGuide />
        </div>
      </> : <>
        <div className="gmd-detail-aside" id="provide"><LiquidityPanel provider={provider} chain={chain} owner={owner} reader={reader} onBusy={setBusy} /></div>
        <div className="gmd-detail-content">
          <PoolOverview snapshot={reader.snapshot} failure={reader.failure} retry={reader.retry} growth={growth} />
          <PoolActivitySection />
          <PoolGuide growth={growth.value} />
        </div>
      </>}
    </div>
    {V4_POOL_DEPLOYMENT && <PoolResults />}
  </ActivityProvider>;
}

/** Every pool, in one table: a liquidity provider's first choice. Choosing one shows it below. */
function PoolList({ snapshot, failure, owner, growth, v4, selected, onSelect, busy }: {
  snapshot: Snapshot | null; failure: string | null; owner: string | null; growth: { value: PoolYield | null; loaded: boolean }; v4: V4Reader | null;
  selected: "live" | "v4"; onSelect: (pool: "live" | "v4") => void; busy: boolean;
}) {
  const pool = snapshot?.pool ?? null;
  const nav = pool?.nav.navMicros ?? null;
  const account = snapshot && snapshot.owner === owner ? snapshot.account : null;
  const mine = account && pool ? liquidityPosition(account.lpMicros, pool, nav) : null;
  const v4Pool = v4?.snapshot?.pool ?? null;
  const v4Account = v4?.snapshot && v4.snapshot.owner === owner ? v4.snapshot.account : null;
  const v4Mine = v4Pool && v4Account ? v4Position(v4Pool, v4Account) : null;
  // While a deposit or withdrawal is under way, its panel stays on screen.
  const choose = (next: "live" | "v4") => (event: { preventDefault(): void }) => { if (busy) event.preventDefault(); else onSelect(next); };
  const link = (next: "live" | "v4", children: ReactNode, className: string) => <a className={className} href="#provide" aria-disabled={busy || undefined} onClick={choose(next)}>{children}</a>;
  const loading = (width: number, unavailable: boolean) => unavailable ? "—" : <Skeleton width={width} />;
  return <section className="gmd-pool-list" aria-labelledby="pool-list-title">
    <h2 id="pool-list-title" className="gmd-sr-only">All pools</h2>
    <div className="gmd-data-table-scroll"><table className="gmd-table">
      <thead><tr><th scope="col">Pool</th><th scope="col">Fee</th><th scope="col">Total value</th><th scope="col">Fee APR</th><th scope="col">Your liquidity</th><th scope="col"><span className="gmd-sr-only">Action</span></th></tr></thead>
      <tbody>
        <tr aria-current={v4 && selected === "live" ? "true" : undefined}>
          <th scope="row">{link("live", <><span className="gmd-pair-mark" aria-hidden="true"><i>U</i><i>$</i></span><span><b>USTX / dUSD</b><small>Constant product · live</small></span></>, "gmd-pool-pair")}</th>
          <td>{FEE_PERCENT}</td>
          <td>{pool ? nav !== null ? formatUsdRounded(poolValueMicros(pool, nav)) : "—" : loading(70, Boolean(failure))}</td>
          <td>{growth.value ? formatYield(growth.value.aprWad) : loading(44, growth.loaded)}</td>
          <td>{!owner ? "—" : !account || !mine ? loading(56, Boolean(failure)) : account.lpMicros === 0n ? "None" : mine.valueMicros !== null ? formatUsdRounded(mine.valueMicros) : `${formatSharesShort(account.lpMicros, 4)} USTX-LP`}</td>
          <td>{link("live", account && account.lpMicros > 0n ? "Manage" : "Add liquidity", "gmd-small-button")}</td>
        </tr>
        {v4 && <tr aria-current={selected === "v4" ? "true" : undefined}>
          <th scope="row">{link("v4", <><span className="gmd-pair-mark" aria-hidden="true"><i>U</i><i>$</i></span><span><b>USTX / dUSD</b><small>Uniswap v4 · held at the NAV</small></span></>, "gmd-pool-pair")}</th>
          <td>{v4Pool?.feePips != null ? formatFeePips(v4Pool.feePips) : "0.30–1.00%"}</td>
          <td>{v4Pool ? v4Pool.nav.answer !== null ? formatUsdRounded(v4ValueMicros(v4Pool, v4Pool.nav.answer)) : "—" : loading(70, Boolean(v4.failure))}</td>
          <td>New</td>
          <td>{!owner ? "—" : !v4Mine ? loading(56, Boolean(v4.failure)) : v4Mine.lp === 0n ? (v4Account?.waiting ? "Waiting" : "None") : v4Mine.valueMicros !== null ? formatUsdRounded(v4Mine.valueMicros) : `${formatSharesShort(v4Mine.lp, 4)} USTX-V4LP`}</td>
          <td>{link("v4", v4Mine && v4Mine.lp > 0n ? "Manage" : "Add liquidity", "gmd-small-button")}</td>
        </tr>}
      </tbody>
    </table></div>
  </section>;
}

function PoolOverview({ snapshot, failure, retry, growth }: { snapshot: Snapshot | null; failure: string | null; retry: () => void; growth: { value: PoolYield | null; failed: boolean; loaded: boolean } }) {
  const { day: activity, pending: activityPending } = useActivityDay();
  const pool = snapshot?.pool ?? null;
  const nav = pool?.nav.navMicros ?? null;
  const tvl = pool && nav !== null ? poolValueMicros(pool, nav) : null;
  const price = pool && pool.sharesMicros > 0n ? pool.dollarsMicros * ONE / pool.sharesMicros : null;
  const market: PoolMarket | null = pool && price !== null ? { block: pool.block, sharesMicros: pool.sharesMicros, dollarsMicros: pool.dollarsMicros, priceMicros: price, navMicros: nav, premiumPpm: nav ? (price - nav) * ONE / nav : null } : null;
  const mix = pool && nav !== null && tvl !== null && tvl > 0n ? { pool, percent: Number(pool.sharesMicros * nav / ONE * 10_000n / tvl) / 100 } : null;
  const wait = (width: number | string) => failure && !pool ? "—" : <Skeleton width={width} />;
  return <section id="pool" className="gmd-fund gmd-pool" aria-labelledby="pool-title">
    <header className="gmd-section-heading"><div><h2 id="pool-title">USTX / dUSD pool</h2><p>A constant-product pool next to the fund. Providers earn {FEE_PERCENT} of every trade.</p></div><span className="gmd-badge">Live on X Layer Testnet</span></header>
    {failure && !pool && <p className="gmd-inline-error" role="status">The pool could not be read right now. <button type="button" className="gmd-text-button" onClick={retry}>Try again</button></p>}
    <div className="gmd-fund-grid" aria-busy={!pool && !failure}>
      <article><span>Total value locked</span><strong>{tvl !== null ? formatUsdRounded(tvl) : pool ? "—" : wait(96)}</strong><small>{pool ? `${formatSharesShort(pool.sharesMicros, 4)} USTX and ${formatUsdRounded(pool.dollarsMicros)} dUSD${nav !== null ? ", USTX at the NAV" : ""}` : wait("80%")}</small></article>
      <article><span>Volume, 24h</span><strong>{activity ? formatUsdRounded(activity.poolVolumeMicros) : activityPending ? <Skeleton width={80} /> : "—"}</strong><small>{activity ? `${activity.poolTrades.toLocaleString("en-US")} ${activity.poolTrades === 1 ? "trade" : "trades"}, arbitrage included` : activityPending ? <Skeleton width="70%" /> : "Unavailable"}</small></article>
      <article><span>Fees, 24h</span><strong>{activity ? formatUsdMicros(activity.poolFeesMicros, 2) : activityPending ? <Skeleton width={64} /> : "—"}</strong><small>{FEE_PERCENT} of each trade, kept in the pool for providers</small></article>
      <article><span>Fee APR</span><strong>{growth.value ? formatYield(growth.value.aprWad) : growth.loaded ? "—" : <Skeleton width={64} />}</strong><small>{growth.value ? yieldWindow(growth.value) : growth.failed ? "Unavailable right now" : growth.loaded ? "Not enough history yet" : <Skeleton width="75%" />}</small></article>
    </div>
    {activity && !activity.complete && <p className="gmd-caption">24-hour figures counted since {new Date(activity.since).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC. Earlier activity is still being read from X Layer Testnet.</p>}
    {mix && <div className="gmd-pool-mix">
      <div className="gmd-pool-mix-head"><h3>What the pool holds</h3><span>Valued at the NAV</span></div>
      <div className="gmd-pool-mix-bar" role="img" aria-label={`USTX ${mix.percent.toFixed(1)}%, demo dollars ${(100 - mix.percent).toFixed(1)}% of the pool's value`}><i style={{ width: `${mix.percent}%` }} /><i /></div>
      <div className="gmd-pool-mix-legend"><span><i aria-hidden="true" />USTX {mix.percent.toFixed(1)}% · {formatSharesShort(mix.pool.sharesMicros, 4)}</span><span><i aria-hidden="true" />dUSD {(100 - mix.percent).toFixed(1)}% · {formatUsdRounded(mix.pool.dollarsMicros)}</span></div>
    </div>}
    {market && <PremiumGauge market={market} />}
    <dl className="gmd-fund-facts">
      <div><dt>Pool price</dt><dd>{price !== null ? `${formatUsdMicros(price, 2)} per USTX` : "—"}</dd></div>
      <div><dt>NAV per share</dt><dd>{nav !== null ? formatUsdMicros(nav, 4) : pool?.nav.navMicros === null ? "Waiting for the next record" : "—"}</dd></div>
      <div><dt>Value per LP token</dt><dd>{pool && nav !== null && pool.supply > 0n ? `${formatUsdMicros(lpTokenValueMicros(pool, nav), 4)} at the NAV` : "—"}</dd></div>
      <div><dt>LP tokens issued</dt><dd>{pool ? `${formatSharesShort(pool.supply, 4)} USTX-LP` : "—"}</dd></div>
      <div><dt>Pricing</dt><dd>Constant product: the reserves’ ratio sets the price</dd></div>
      <div><dt>Fee</dt><dd>{FEE_PERCENT} of each trade, to providers</dd></div>
      <div><dt>LP token, {growth.value ? windowLabel(growth.value) : "7 days"}</dt><dd>{performance(growth.value)}</dd></div>
      <div><dt>Opened</dt><dd>{day(POOL_LAUNCHED_AT)}</dd></div>
      <div><dt>Pool contract</dt><dd><a className="gmd-inline-tx" href={fundExplorer.address(FUND_DEPLOYMENT.pool)} target="_blank" rel="noreferrer">X Layer Testnet<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
    </dl>
  </section>;
}

/** How providing liquidity works, with what a NAV move does to a deposit against holding both tokens. */
function PoolGuide({ growth }: { growth: PoolYield | null }) {
  return <section id="how" className="gmd-terms" aria-labelledby="how-title">
    <h2 id="how-title">How providing liquidity works</h2>
    <p>The pool holds USTX and demo dollars. Every trade pays {FEE_PERCENT} into it, and the fee stays in the pool for its providers. When the pool’s price drifts from the NAV by more than the fee, the arbitrage keeper trades it back through the fund.</p>
    <dl>
      <div><dt>Deposit</dt><dd>USTX and demo dollars at the pool’s ratio. Or demo dollars alone: part is invested at the fund at the NAV, with no fee, and the USTX goes in with the rest.</dd></div>
      <div><dt>LP token</dt><dd>USTX-LP, issued by the pool contract to your wallet. It is your share of everything the pool holds.</dd></div>
      <div><dt>Withdraw</dt><dd>At any time, for your share of both tokens, rounded down. While the NAV record is under an hour old, you can also have the USTX redeemed at the fund at the NAV.</dd></div>
      <div><dt>Price risk</dt><dd>As the NAV moves, arbitrage trades with the pool, so a provider ends with more of whichever token fell. Against simply holding both, that costs a little, and only the fees can make up for it.</dd></div>
      <div><dt>Network</dt><dd>X Layer Testnet. Demo dollars and USTX have no value, and network fees are paid in test OKB.</dd></div>
    </dl>
    <PriceMove growth={growth} />
  </section>;
}

const MOVES = [-30, -20, -10, -5, 0, 5, 10, 20, 30, 50];

/** A deposit worth $1,000 at the NAV after the NAV moves and arbitrage brings the pool back to it: √r against (1 + r) / 2. */
function PriceMove({ growth }: { growth: PoolYield | null }) {
  const [move, setMove] = useState(10);
  const ratio = 1 + move / 100;
  const held = 1_000 * (1 + ratio) / 2;
  const pooled = 1_000 * Math.sqrt(ratio);
  const fees30 = growth ? 1_000 * Number(growth.aprWad) / 1e18 * 30 / 365 : null;
  const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const gap = pooled - held;
  return <div className="gmd-price-move">
    <div className="gmd-price-move-head"><h3>If the NAV moves</h3><p>A deposit worth $1,000 in demo dollars at the NAV, half of it in USTX, once arbitrage has brought the pool to the new NAV.</p></div>
    <div className="gmd-order-presets" role="group" aria-label="NAV move">{MOVES.map(value => <button type="button" key={value} aria-pressed={move === value} onClick={() => setMove(value)}>{value > 0 ? "+" : value < 0 ? "−" : ""}{Math.abs(value)}%</button>)}</div>
    <dl className="gmd-facts" aria-live="polite">
      <div><dt>Holding both tokens</dt><dd>{money(held)}</dd></div>
      <div><dt>In the pool, before fees</dt><dd>{money(pooled)}</dd></div>
      <div><dt>Difference</dt><dd className={Math.abs(gap) < 0.005 ? "" : "gmd-negative"}>{Math.abs(gap) < 0.005 ? "None" : `−${money(-gap)} (−${(-gap / held * 100).toFixed(2)}%)`}</dd></div>
      <div><dt>Fees over 30 days</dt><dd>{fees30 === null ? "—" : `+${money(fees30)} at the current fee APR`}</dd></div>
    </dl>
    <p className="gmd-caption">An illustration, not a forecast: fees depend on how much trades in the pool, and arbitrage only follows the NAV when the gap is larger than the fee.</p>
  </div>;
}

type Tab = "add" | "remove";
type Mode = "pair" | "dollars";
type StepKey = "approveFund" | "invest" | "approveDollars" | "approveShares" | "add" | "remove" | "redeem";
type Done =
  | { tab: "add"; added: LiquidityFill; invested: { dollarsMicros: bigint; sharesMicros: bigint } | null; hashes: string[]; block: number }
  | { tab: "remove"; removed: LiquidityFill; redeemed: { sharesMicros: bigint; dollarsMicros: bigint } | null; hashes: string[]; block: number };

function LiquidityPanel({ provider, chain, owner, reader, onBusy }: { provider: Provider | null; chain: string | null; owner: string | null; reader: Reader; onBusy: (busy: boolean) => void }) {
  const { address } = useWalletAccount();
  const { day: activity } = useActivityDay();
  const { now } = useMarket();

  const [tab, setTab] = useState<Tab>("add");
  const [mode, setMode] = useState<Mode>("pair");
  // In a pair, the field last typed in; the other follows the pool's ratio.
  const [pair, setPair] = useState<{ anchor: "shares" | "dollars"; text: string }>({ anchor: "dollars", text: "" });
  const [dollarsText, setDollarsText] = useState("");
  const [removeText, setRemoveText] = useState("");
  const [receive, setReceive] = useState<"both" | "dollars">("both");
  const [phase, setPhase] = useState<"form" | "working" | "done">("form");
  const [steps, setSteps] = useState<TxStep<StepKey>[]>([]);
  const [failure, setFailure] = useState<{ message: string; hash: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [claim, setClaim] = useState<{ state: "wallet" | "chain" | "failed"; message?: string } | null>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const unmounted = useUnmountSignal();
  useEffect(() => { onBusy(phase === "working"); }, [phase, onBusy]);
  useEffect(() => {
    if (phase === "working") stepsRef.current?.focus();
    else if (phase === "done") doneRef.current?.focus();
  }, [phase]);
  useEffect(() => { if (failure) failureRef.current?.focus(); }, [failure]);

  const snapshot = reader.snapshot;
  const pool = snapshot?.pool ?? null;
  const account = snapshot && owner && snapshot.owner === owner ? snapshot.account : null;
  // After a transaction, amounts on screen are from before it until a read at or after its block arrives.
  const fresh = snapshot !== null && snapshot.pool.block >= reader.watermark;
  const nav = pool?.nav.navMicros ?? null;
  const position = account && pool ? liquidityPosition(account.lpMicros, pool, nav) : null;

  // Adding both tokens: the typed amount and its partner at the pool's ratio.
  const anchorAmount = pair.anchor === "shares" ? parseShares(pair.text) : parseUsd(pair.text);
  const partner = pool && anchorAmount !== null ? (pair.anchor === "shares" ? pairedDollars(anchorAmount, pool) : pairedShares(anchorAmount, pool)) : null;
  const sharesDesired = pair.anchor === "shares" ? anchorAmount : partner;
  const dollarsDesired = pair.anchor === "dollars" ? anchorAmount : partner;
  const pairQuote = pool && sharesDesired !== null && dollarsDesired !== null ? quoteAddLiquidity(sharesDesired, dollarsDesired, pool) : null;
  // Adding demo dollars alone: invested in part at the fund, the rest deposited with the USTX.
  const dollarsOnly = parseUsd(dollarsText);
  const split = pool && dollarsOnly !== null ? splitDollarsOnly(dollarsOnly, nav, pool) : null;
  const splitQuote = pool && split ? quoteAddLiquidity(split.sharesMicros, split.dollarsMicros, pool) : null;
  const smallest = pool ? minimumDollarsOnly(nav, pool) : null;
  // Withdrawing: LP tokens, and what they pay now.
  const lpAmount = parseShares(removeText);
  const removal = pool && lpAmount !== null ? quoteRemoveLiquidity(lpAmount, pool) : null;

  const quote = tab === "add" ? (mode === "pair" ? pairQuote : splitQuote) : null;
  const problem = !account || !pool ? null
    : !fresh ? "Updating your balances…"
    : tab === "add" && (pool.supply === 0n || pool.sharesMicros === 0n) ? "The pool is empty right now."
    : tab === "add" && mode === "pair" ? (
      anchorAmount === null || anchorAmount === 0n ? "Enter an amount of USTX or demo dollars."
      : sharesDesired !== null && sharesDesired > account.sharesMicros ? (account.sharesMicros === 0n ? "This wallet holds no USTX. Deposit demo dollars alone, or buy USTX first." : "That needs more USTX than this wallet holds.")
      : dollarsDesired !== null && dollarsDesired > account.dollarsMicros ? "That needs more demo dollars than this wallet holds."
      : !pairQuote ? "That amount is too small for the pool." : null)
    : tab === "add" ? (
      nav === null ? "Deposits of demo dollars alone reopen with the next NAV record."
      : dollarsOnly === null || dollarsOnly === 0n ? "Enter an amount in demo dollars."
      : dollarsOnly > account.dollarsMicros ? "That is more than your demo dollars."
      : !split || !splitQuote ? `The smallest deposit of demo dollars alone is ${smallest !== null ? usd(smallest) : "$20"}.` : null)
    : account.lpMicros === 0n ? "This wallet has no liquidity in the pool."
    : lpAmount === null || lpAmount === 0n ? "Choose how much to withdraw."
    : lpAmount > account.lpMicros ? "That is more than your LP tokens."
    : !removal ? "That amount is too small to withdraw."
    : receive === "dollars" && nav === null ? "Redeeming at the NAV reopens with the next NAV record. Take USTX and demo dollars instead."
    : null;

  const needs = !account ? null : {
    fund: mode === "dollars" && split ? account.fundAllowanceMicros < split.investMicros : false,
    dollars: tab === "add" ? (mode === "pair" ? pairQuote !== null && account.poolDollarAllowanceMicros < pairQuote.dollarsMicros : split !== null && account.poolDollarAllowanceMicros < split.dollarsMicros) : false,
    // A dollars-only deposit's USTX is known once invested; allow 1% for a NAV record in between.
    shares: tab === "add" ? (mode === "pair" ? pairQuote !== null && account.poolShareAllowanceMicros < pairQuote.sharesMicros : split !== null && account.poolShareAllowanceMicros < split.sharesMicros * 101n / 100n) : false,
  };
  const confirmations = !needs ? 0 : tab === "add"
    ? (mode === "dollars" ? 2 + Number(needs.fund) : 1) + Number(needs.dollars) + Number(needs.shares)
    : receive === "dollars" ? 2 : 1;
  const after = account && pool && quote ? { lp: account.lpMicros + quote.liquidity, supply: pool.supply + quote.liquidity } : null;

  function choose(next: Tab) { setTab(next); setFailure(null); if (phase === "done") setPhase("form"); }
  function maxPair() {
    if (!account || !pool) return;
    const needed = pairedDollars(account.sharesMicros, pool);
    setPair(needed !== null && needed <= account.dollarsMicros ? { anchor: "shares", text: plain(account.sharesMicros) } : { anchor: "dollars", text: plain(account.dollarsMicros) });
    setFailure(null);
  }

  async function claimDollars() {
    if (!provider || !account) return;
    setClaim({ state: "wallet" });
    try {
      const hash = await sendFromWallet(provider, address, fundCalls.claim());
      setClaim({ state: "chain" });
      const receipt = await waitForFundReceipt(hash);
      if (receipt.status !== "success") throw new Error("The claim failed on X Layer Testnet.");
      reader.raise(receipt.block);
      setClaim(null);
      window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: receipt.block } }));
    } catch (error) { setClaim({ state: "failed", message: fundErrorMessage(error) }); }
  }

  async function run() {
    if (!provider || !account || !pool || problem || !needs) return;
    const from = address;
    const state = pool;
    const wallet = account;
    const progress: PlanProgress = { block: Math.max(reader.watermark, state.block), hashes: [], lastHash: null };
    // What each step left behind, read from its receipt.
    const result: { invested: { dollarsMicros: bigint; sharesMicros: bigint } | null; added: LiquidityFill | null; removed: LiquidityFill | null; redeemed: { sharesMicros: bigint; dollarsMicros: bigint } | null } = { invested: null, added: null, removed: null, redeemed: null };
    const plan: PlanStep<StepKey>[] = [];
    const addStep = (shares: () => bigint, dollars: bigint, minimums: () => { shares: bigint; dollars: bigint }) => plan.push({
      key: "add", label: "Add liquidity", approval: false,
      request: async () => { const least = minimums(); return liquidityCalls.add(shares(), dollars, least.shares, least.dollars, await orderDeadline()); },
      read: receipt => { const fill = liquidityFill(receipt); if (fill?.side !== "add") throw new Error("The deposit did not go through on X Layer Testnet."); result.added = fill; },
    });
    if (tab === "add" && mode === "pair" && pairQuote) {
      const fixed = pairQuote;
      if (needs.shares) plan.push({ key: "approveShares", label: "Approve USTX for the pool", approval: true, request: async () => poolCalls.approveShares(fixed.sharesMicros) });
      if (needs.dollars) plan.push({ key: "approveDollars", label: "Approve demo dollars for the pool", approval: true, request: async () => poolCalls.approveDollars(fixed.dollarsMicros) });
      addStep(() => fixed.sharesMicros, fixed.dollarsMicros, () => ({ shares: withSlippage(fixed.sharesMicros), dollars: withSlippage(fixed.dollarsMicros) }));
    } else if (tab === "add" && split) {
      const parts = split;
      if (needs.fund) plan.push({ key: "approveFund", label: "Approve demo dollars for the fund", approval: true, request: async () => fundCalls.approve(parts.investMicros) });
      plan.push({
        key: "invest", label: "Invest at the NAV", approval: false,
        request: async () => fundCalls.invest(parts.investMicros, withSlippage(parts.sharesMicros)),
        read: receipt => {
          const fill = fundFill(receipt);
          if (fill?.side !== "invest") throw new Error("The investment did not go through on X Layer Testnet.");
          result.invested = { dollarsMicros: fill.dollarsMicros, sharesMicros: fill.sharesMicros };
        },
      });
      // The USTX the investment bought: known once it is mined, the estimate until then.
      const received = () => result.invested?.sharesMicros ?? parts.sharesMicros;
      if (needs.dollars) plan.push({ key: "approveDollars", label: "Approve demo dollars for the pool", approval: true, request: async () => poolCalls.approveDollars(parts.dollarsMicros) });
      // The NAV can move between the quote and the investment: whether USTX needs approving is
      // known only once it is mined, so this step is always planned and skipped when not needed.
      plan.push({ key: "approveShares", label: "Approve USTX for the pool", approval: true, request: async () => wallet.poolShareAllowanceMicros >= received() ? null : poolCalls.approveShares(received()) });
      addStep(received, parts.dollarsMicros, () => {
        const expected = quoteAddLiquidity(received(), parts.dollarsMicros, state);
        return { shares: withSlippage(expected?.sharesMicros ?? 0n), dollars: withSlippage(expected?.dollarsMicros ?? 0n) };
      });
    } else if (tab === "remove" && removal && lpAmount !== null) {
      const amount = lpAmount;
      const out = removal;
      const navAtForm = nav;
      plan.push({
        key: "remove", label: "Withdraw liquidity", approval: false,
        request: async () => liquidityCalls.remove(amount, withSlippage(out.sharesMicros), withSlippage(out.dollarsMicros), await orderDeadline()),
        read: receipt => { const fill = liquidityFill(receipt); if (fill?.side !== "remove") throw new Error("The withdrawal did not go through on X Layer Testnet."); result.removed = fill; },
      });
      if (receive === "dollars" && navAtForm !== null) plan.push({
        key: "redeem", label: "Redeem USTX at the NAV", approval: false,
        request: async () => {
          const shares = result.removed?.sharesMicros ?? 0n;
          return shares === 0n ? null : fundCalls.redeem(shares, withSlippage(dollarsFor(shares, navAtForm)));
        },
        read: receipt => {
          const fill = fundFill(receipt);
          if (fill?.side !== "redeem") throw new Error("The redemption did not go through on X Layer Testnet.");
          result.redeemed = { sharesMicros: fill.sharesMicros, dollarsMicros: fill.dollarsMicros };
        },
      });
    }
    if (plan.length === 0) return;
    const mark = (key: StepKey, next: StepState, hash?: string) => setSteps(current => current.map(step => step.key === key ? { ...step, state: next, hash: hash ?? step.hash } : step));
    setSteps(plan.map(step => ({ key: step.key, label: step.label, state: "idle" })));
    setPhase("working"); setFailure(null);
    try {
      await runPlan(plan, { provider, from, progress, mark, signal: unmounted() });
      const { hashes, block } = progress;
      const finished: Done | null = result.added ? { tab: "add", added: result.added, invested: result.invested, hashes, block }
        : result.removed ? { tab: "remove", removed: result.removed, redeemed: result.redeemed, hashes, block } : null;
      if (!finished) throw new Error("The transaction did not go through on X Layer Testnet.");
      setDone(finished);
      setPhase("done");
      if (tab === "add") { setPair(current => ({ ...current, text: "" })); setDollarsText(""); } else setRemoveText("");
    } catch (error) {
      // An earlier step may have gone through: say what is in the wallet now.
      const partial = result.invested && !result.added ? `Your investment went through: ${ustx(result.invested.sharesMicros)} are in your wallet, ready to deposit with demo dollars. `
        : result.removed && !result.redeemed && receive === "dollars" ? `Your liquidity was withdrawn: ${ustx(result.removed.sharesMicros)} and ${usd(result.removed.dollarsMicros)} are in your wallet. You can redeem the USTX on the USTX page. `
        : "";
      setFailure({ message: `${partial}${liquidityErrorMessage(error)}`, hash: progress.lastHash });
      // So that trying again does not repeat the step that went through: the bought USTX waits in the
      // pair form, and a withdrawal that came out is not withdrawn again.
      if (result.invested && !result.added) { setMode("pair"); setPair({ anchor: "shares", text: plain(result.invested.sharesMicros) }); setDollarsText(""); }
      if (result.removed) setRemoveText("");
      setPhase("form");
    } finally {
      reader.raise(progress.block);
      if (progress.block > state.block) window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: progress.block } }));
    }
  }

  const head = <div className="gmd-order-heading"><h2 id="provide-title" ref={headingRef} tabIndex={-1}>{phase === "done" ? (done?.tab === "remove" ? "Liquidity withdrawn" : "Liquidity added") : phase === "working" ? "Confirm in your wallet" : "Provide liquidity"}</h2><Icon name="pool" /></div>;
  const tabs = <div className="gmd-segmented gmd-pay-with" role="group" aria-label="Liquidity action">
    <button type="button" aria-pressed={tab === "add"} onClick={() => choose("add")}>Add</button>
    <button type="button" aria-pressed={tab === "remove"} onClick={() => choose("remove")}>Withdraw</button>
  </div>;
  const shell = (body: ReactNode) => <aside className="gmd-order-panel gmd-liquidity-panel" aria-labelledby="provide-title">{head}{body}</aside>;

  const gate = <WalletGate provider={provider} chain={chain} purpose="Provide liquidity" />;
  if (!provider || !owner) return shell(gate);
  if (!account || !pool) return shell(reader.failure && !account
    ? <div className="gmd-inline-error" role="alert">{reader.failure} <button type="button" className="gmd-text-button" onClick={reader.retry}>Try again</button></div>
    : <p className="gmd-caption" role="status">Reading your wallet on X Layer Testnet…</p>);

  if (phase === "working") return shell(<TxSteps steps={steps} listRef={stepsRef} />);

  if (phase === "done" && done) {
    const share = done.tab === "add" && pool.supply > 0n ? account.lpMicros * ONE / pool.supply : null;
    return shell(<div ref={doneRef} tabIndex={-1} className="gmd-order-review gmd-liquidity-done" role="status">
      <span>{done.tab === "add" ? "You received" : "You returned"}</span>
      <strong>{formatShares(done.tab === "add" ? done.added.lpMicros : done.removed.lpMicros)}</strong><span>USTX-LP</span>
      <dl className="gmd-facts">
        {done.tab === "add" ? <>
          {done.invested && <div><dt>Invested at the NAV</dt><dd>{usd(done.invested.dollarsMicros)} for {ustx(done.invested.sharesMicros)}</dd></div>}
          <div><dt>Deposited</dt><dd>{ustx(done.added.sharesMicros)} and {usd(done.added.dollarsMicros)}</dd></div>
          <div><dt>Your share of the pool</dt><dd>{fresh && pool.block >= done.block && share !== null ? formatSharePpm(share, account.lpMicros > 0n) : "Updating…"}</dd></div>
        </> : <>
          <div><dt>Withdrawn</dt><dd>{ustx(done.removed.sharesMicros)} and {usd(done.removed.dollarsMicros)}</dd></div>
          {done.redeemed && <div><dt>Redeemed at the NAV</dt><dd>{ustx(done.redeemed.sharesMicros)} for {usd(done.redeemed.dollarsMicros)}</dd></div>}
          <div><dt>Now in your wallet</dt><dd>{fresh && pool.block >= done.block ? `${ustx(account.sharesMicros)} · ${usd(account.dollarsMicros)}` : "Updating…"}</dd></div>
        </>}
        <div><dt>{done.hashes.length === 1 ? "Transaction" : "Transactions"}</dt><dd className="gmd-liquidity-hashes">{done.hashes.map((hash, index) => <TxLink key={hash} hash={hash}>{done.hashes.length === 1 ? "OKX Explorer" : `Step ${index + 1}`}</TxLink>)}</dd></div>
      </dl>
      <Link prefetch={false} className="gmd-button" href="/portfolio">View portfolio <Icon name="arrow" size={16} /></Link>
      <button type="button" className="gmd-text-button" onClick={() => { setDone(null); setPhase("form"); requestAnimationFrame(() => headingRef.current?.focus()); }}>Done</button>
    </div>);
  }

  const claimable = account.nextClaimAt * 1000 <= now;
  const feeShare = activity && position && pool.supply > 0n ? activity.poolFeesMicros * account.lpMicros / pool.supply : null;
  return shell(<>
    {tabs}
    {!fresh && <p className="gmd-caption" role="status">Updating your balances from X Layer Testnet…</p>}
    {account.lpMicros > 0n && position && <div className="gmd-liquidity-position">
      <span>Your liquidity</span>
      <strong>{position.valueMicros !== null ? formatUsdRounded(position.valueMicros) : `${formatShares(account.lpMicros)} USTX-LP`}</strong>
      <small>{formatSharePpm(position.sharePpm, true)} of the pool · {formatSharesShort(position.sharesMicros, 4)} USTX and {formatUsdRounded(position.dollarsMicros)}{feeShare !== null && feeShare > 0n ? ` · at your share, the last 24 hours’ fees came to about ${formatUsdMicros(feeShare, feeShare < 10_000n ? 4 : 2)}` : ""}</small>
    </div>}
    <div className="gmd-wallet-balances">
      <div><span>Demo dollars</span><b>{usd(account.dollarsMicros)}</b><small>dUSD, no value</small></div>
      <div><span>USTX in wallet</span><b>{formatShares(account.sharesMicros)}</b><small>{nav !== null && account.sharesMicros > 0n ? formatUsdRounded(dollarsFor(account.sharesMicros, nav)) : "X Layer Testnet"}</small></div>
    </div>
    <div className="gmd-wallet-claim">{claim?.state === "wallet" ? <span role="status">Confirm in your wallet…</span>
      : claim?.state === "chain" ? <span role="status">Sending demo dollars on X Layer Testnet…</span>
      : claimable ? <button type="button" className="gmd-small-button" disabled={!fresh} onClick={() => void claimDollars()}>Get {formatUsdRounded(FUND_CLAIM_MICROS)} demo dollars</button>
      : <span>More demo dollars in {waitLabel(account.nextClaimAt, now)}</span>}
      {claim?.state === "failed" && <p className="gmd-inline-error" role="alert">{claim.message}</p>}</div>
    {account.gasWei === 0n && <p className="gmd-wallet-gas" role="status"><Icon name="info" size={16} /><span>You need test OKB to pay network fees. <a href={FUND_DEPLOYMENT.faucetUrl} target="_blank" rel="noreferrer">Get test OKB<span className="gmd-sr-only"> (opens in a new tab)</span></a></span></p>}
    {tab === "add" ? <>
      <div className="gmd-segmented gmd-liquidity-mode" role="group" aria-label="Deposit with">
        <button type="button" aria-pressed={mode === "pair"} onClick={() => { setMode("pair"); setFailure(null); }}>USTX + dUSD</button>
        <button type="button" aria-pressed={mode === "dollars"} onClick={() => { setMode("dollars"); setFailure(null); }}>dUSD only</button>
      </div>
      {mode === "pair" ? <div className="gmd-liquidity-inputs">
        <div className="gmd-order-input">
          <label htmlFor="liquidity-shares">USTX</label>
          <div><input id="liquidity-shares" inputMode="decimal" autoComplete="off" placeholder="0" value={pair.anchor === "shares" ? pair.text : sharesDesired !== null ? plain(sharesDesired) : ""} onChange={event => { setPair({ anchor: "shares", text: event.target.value }); setFailure(null); }} aria-invalid={fresh && Boolean(pair.text) && Boolean(problem)} aria-describedby="liquidity-help" /><span>USTX</span></div>
          <p>In your wallet: {formatShares(account.sharesMicros)}</p>
        </div>
        <div className="gmd-order-input">
          <label htmlFor="liquidity-dollars">Demo dollars</label>
          <div><input id="liquidity-dollars" inputMode="decimal" autoComplete="off" placeholder="0" value={pair.anchor === "dollars" ? pair.text : dollarsDesired !== null ? plain(dollarsDesired) : ""} onChange={event => { setPair({ anchor: "dollars", text: event.target.value }); setFailure(null); }} aria-invalid={fresh && Boolean(pair.text) && Boolean(problem)} aria-describedby="liquidity-help" /><span>dUSD</span></div>
          <p>In your wallet: {usd(account.dollarsMicros)}</p>
        </div>
        <p className="gmd-liquidity-help"><span id="liquidity-help">{pair.text && problem ? problem : "Type either amount; the other follows the pool’s ratio."}</span> {fresh && <button type="button" className="gmd-lending-max" onClick={maxPair}>Max</button>}</p>
      </div> : <div className="gmd-order-input">
        <label htmlFor="liquidity-dollars-only">Demo dollars to deposit</label>
        <div><input id="liquidity-dollars-only" inputMode="decimal" autoComplete="off" placeholder="0" value={dollarsText} onChange={event => { setDollarsText(event.target.value); setFailure(null); }} aria-invalid={fresh && Boolean(dollarsText) && Boolean(problem)} aria-describedby="liquidity-only-help" /><span>dUSD</span></div>
        <p><span id="liquidity-only-help">{dollarsText && problem ? problem : `In your wallet: ${usd(account.dollarsMicros)}`}</span>{fresh && account.dollarsMicros > 0n && <> · <button type="button" className="gmd-lending-max" onClick={() => setDollarsText(plain(account.dollarsMicros))}>Max</button></>}</p>
      </div>}
      <div className="gmd-order-estimate"><span>LP tokens you receive</span><strong>{quote ? formatShares(quote.liquidity) : "—"} <small>USTX-LP</small></strong></div>
      <dl className="gmd-facts">
        {mode === "dollars" && split && <>
          <div><dt>Invested at the NAV</dt><dd>{usd(split.investMicros)} for {ustx(split.sharesMicros)}</dd></div>
          <div><dt>Deposited with it</dt><dd>{usd(split.dollarsMicros)}</dd></div>
        </>}
        {mode === "pair" && pairQuote && <div><dt>You deposit</dt><dd>{ustx(pairQuote.sharesMicros)} and {usd(pairQuote.dollarsMicros)}</dd></div>}
        <div><dt>Value at the NAV</dt><dd>{quote && nav !== null ? formatUsdRounded(quote.sharesMicros * nav / ONE + quote.dollarsMicros) : "—"}</dd></div>
        <div><dt>Your share of the pool</dt><dd>{after ? formatSharePpm(after.lp * ONE / after.supply, after.lp > 0n) : position ? formatSharePpm(position.sharePpm, account.lpMicros > 0n) : "—"}</dd></div>
        <div><dt>Wallet confirmations</dt><dd>{quote ? confirmations : "—"}</dd></div>
      </dl>
    </> : <>
      <div className="gmd-order-input">
        <label htmlFor="liquidity-remove">LP tokens to withdraw</label>
        <div><input id="liquidity-remove" inputMode="decimal" autoComplete="off" placeholder="0" value={removeText} onChange={event => { setRemoveText(event.target.value); setFailure(null); }} aria-invalid={fresh && Boolean(removeText) && Boolean(problem)} aria-describedby="liquidity-remove-help" /><span>USTX-LP</span></div>
        <p id="liquidity-remove-help">{removeText && problem ? problem : `Yours: ${formatShares(account.lpMicros)} USTX-LP`}</p>
      </div>
      <div className="gmd-order-presets" role="group" aria-label="Part of your liquidity">{([25n, 50n, 75n, 100n] as const).map(percent => {
        const value = percent === 100n ? account.lpMicros : account.lpMicros * percent / 100n;
        return <button type="button" key={String(percent)} disabled={account.lpMicros === 0n} aria-pressed={lpAmount === value && value > 0n} onClick={() => { setRemoveText(plain(value)); setFailure(null); }}>{percent === 100n ? "All" : `${percent}%`}</button>;
      })}</div>
      <div className="gmd-segmented gmd-liquidity-mode" role="group" aria-label="Receive">
        <button type="button" aria-pressed={receive === "both"} onClick={() => { setReceive("both"); setFailure(null); }}>USTX + dUSD</button>
        <button type="button" aria-pressed={receive === "dollars"} onClick={() => { setReceive("dollars"); setFailure(null); }}>dUSD only</button>
      </div>
      <div className="gmd-order-estimate"><span>You receive</span><strong>{!removal ? "—" : receive === "dollars" && nav !== null ? usd(removal.dollarsMicros + dollarsFor(removal.sharesMicros, nav)) : `${formatSharesShort(removal.sharesMicros, 4)} USTX`}{removal && receive === "both" && <>{" "}<small>and {usd(removal.dollarsMicros)}</small></>}</strong></div>
      <dl className="gmd-facts">
        {removal && receive === "dollars" && <div><dt>USTX redeemed at the NAV</dt><dd>{ustx(removal.sharesMicros)}</dd></div>}
        <div><dt>Value at the NAV</dt><dd>{removal && nav !== null ? formatUsdRounded(removal.dollarsMicros + dollarsFor(removal.sharesMicros, nav)) : "—"}</dd></div>
        <div><dt>{receive === "dollars" ? "Minimum from the pool" : "Minimum accepted"}</dt><dd>{removal ? `${ustx(withSlippage(removal.sharesMicros))} and ${usd(withSlippage(removal.dollarsMicros))}` : "—"}</dd></div>
        {receive === "dollars" && <div><dt>Minimum for the USTX</dt><dd>{removal && nav !== null ? `99% of its value at the NAV, ${usd(withSlippage(dollarsFor(removal.sharesMicros, nav)))} now` : "—"}</dd></div>}
        <div><dt>Wallet confirmations</dt><dd>{removal ? confirmations : "—"}</dd></div>
      </dl>
    </>}
    {failure && <p ref={failureRef} tabIndex={-1} className="gmd-inline-error" role="alert">{failure.message}{failure.hash && <> <TxLink hash={failure.hash}>See the last transaction</TxLink></>}</p>}
    <button type="button" className="gmd-button" disabled={Boolean(problem) || (tab === "add" ? !quote : !removal)} onClick={() => void run()}>{tab === "add" ? "Add liquidity" : "Withdraw"} <Icon name="arrow" size={17} /></button>
    <p className="gmd-caption">{tab === "add"
      ? mode === "dollars" ? "Part of your demo dollars is invested at the fund at the NAV, then deposited with the rest. If the pool’s price moves more than 1% first, the deposit does not go through and the USTX stays in your wallet."
        : "Deposits go in at the pool’s ratio. If it moves more than 1% before the transaction is mined, or 10 minutes pass, nothing is deposited."
      : receive === "dollars" ? "You receive your share of both tokens, then the fund redeems the USTX at the NAV. If the pool moves more than 1% first, nothing is withdrawn; if the NAV moves more than 1% before the redemption, the USTX stays in your wallet."
        : "You receive your share of both tokens. If the pool moves more than 1% before the transaction is mined, nothing is withdrawn."} Demo dollars and USTX have no value.</p>
  </>);
}
