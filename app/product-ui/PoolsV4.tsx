"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatShares, formatSharesShort, parseShares } from "@/lib/demo/format";
import { formatCountdown, nextRecordAt, shortTime } from "@/lib/product-market";
import { parseUsd } from "@/lib/xstocks/wallet";
import { fundExplorer, withSlippage, type FundReceipt } from "@/lib/xstocks/fund";
import { formatSharePpm } from "@/lib/xstocks/liquidity";
import {
  formatFeePips, readV4Pool, tickToUsd, v4Calls, v4DepositQuote, v4ErrorMessage, v4Fill, v4PairedDollars, v4PairedShares, v4RepegDue, v4ValueMicros, v4WithdrawEstimate,
  type V4Account, type V4Amounts, type V4Deployment, type V4Fill, type V4Pool,
} from "@/lib/xstocks/v4-liquidity";
import { Icon, Skeleton } from "./Icons";
import { useMarket } from "./MarketProvider";
import { plain } from "./Lending";
import { useWalletAccount } from "./WalletAccount";
import { TxLink, type Provider } from "./WalletInvest";
import { TxSteps, WalletGate, orderDeadline, runPlan, useUnmountSignal, type PlanProgress, type PlanStep, type StepState, type TxStep } from "./LiquidityParts";

// The USTX/dUSD pool on Uniswap v4, shown on Pools once lib/xstocks/v4-liquidity.ts pins its
// deployment. Its hook keeps the pool at the NAV recorded on X Layer: liquidity moves to each new
// record, deposits become LP tokens at the next record, and the swap fee rises with the record's age.

const ONE = 1_000_000n;
const usd = (micros: bigint) => formatUsdMicros(micros, 2);
const ustx = (micros: bigint) => `${formatShares(micros)} USTX`;
const both = (amounts: V4Amounts) => `${ustx(amounts.sharesMicros)} and ${usd(amounts.dollarsMicros)}`;
const price = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type V4Snapshot = { owner: string | null; pool: V4Pool; account: V4Account | null };
export type V4Reader = { snapshot: V4Snapshot | null; failure: string | null; watermark: number; raise: (block: number) => void; retry: () => void };

/** The v4 pool and the connected wallet's place in it, read at one block, as the live pool is read. */
export function useV4Pool(deployment: V4Deployment | null, owner: string | null, paused: boolean): V4Reader {
  const [snapshot, setSnapshot] = useState<V4Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [watermark, setWatermark] = useState(0);
  useEffect(() => {
    if (!deployment) return;
    let cancelled = false;
    readV4Pool(deployment, owner, { minBlock: watermark })
      .then(result => { if (!cancelled) { setSnapshot({ owner, ...result }); setFailure(null); } })
      .catch(error => { if (!cancelled) setFailure(v4ErrorMessage(error)); });
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

/** Everything the wallet's LP tokens claim, including any a record converted and it has not claimed, at the NAV. */
export function v4Position(pool: V4Pool, account: V4Account) {
  const lp = account.lpMicros + account.claimableLpMicros;
  const amounts = v4WithdrawEstimate(lp, pool);
  return { lp, amounts, valueMicros: amounts && pool.nav.answer !== null ? v4ValueMicros(amounts, pool.nav.answer) : null, sharePpm: pool.supply > 0n ? lp * ONE / pool.supply : 0n };
}

/** Whether a NAV record newer than the one the pool is centred on is out: the next trade, deposit or re-peg applies it. */
const newerRecord = (pool: V4Pool) => pool.nav.answer !== null && pool.nav.updatedAt > pool.peggedAt;

/** ", due in about 3:20" before the next five-minute record; ", due any moment" once it is late. */
function dueIn(pool: V4Pool, now: number) {
  if (pool.nav.answer === null || !now) return "";
  const wait = nextRecordAt(new Date(pool.nav.updatedAt * 1000).toISOString()) - now;
  return wait > 0 ? `, due in about ${formatCountdown(wait)}` : ", due any moment";
}

export function V4PoolOverview({ deployment, reader }: { deployment: V4Deployment; reader: V4Reader }) {
  const { now } = useMarket();
  const pool = reader.snapshot?.pool ?? null;
  const answer = pool?.nav.answer ?? null;
  const tvl = pool && answer !== null ? v4ValueMicros(pool, answer) : null;
  const waiting = pool && answer !== null ? v4ValueMicros(pool.pending, answer) : null;
  const age = pool && pool.nav.answer !== null && now ? Math.max(0, Math.floor(now / 1000) - pool.nav.updatedAt) : null;
  const gap = pool && pool.nav.answer !== null && pool.nav.navMicros > 0n ? Number((pool.priceMicros - pool.nav.navMicros) * 1_000_000n / pool.nav.navMicros) / 10_000 : null;
  const rangeText = (lower: number, upper: number) => {
    const [a, b] = [tickToUsd(lower, deployment.assetIsCurrency0), tickToUsd(upper, deployment.assetIsCurrency0)].sort((x, y) => x - y);
    return `${price(a)} – ${price(b)}`;
  };
  const wait = (width: number | string) => reader.failure && !pool ? "—" : <Skeleton width={width} />;
  return <section id="pool-v4" className="gmd-fund gmd-pool" aria-labelledby="pool-v4-title">
    <header className="gmd-section-heading"><div><h2 id="pool-v4-title">USTX / dUSD on Uniswap v4</h2><p>A pool held at the NAV recorded on X Layer. Its liquidity moves to each new record, and providers earn a fee that rises as the record ages.</p></div><span className="gmd-badge">Live on X Layer Testnet</span></header>
    {reader.failure && !pool && <p className="gmd-inline-error" role="status">The pool could not be read right now. <button type="button" className="gmd-text-button" onClick={reader.retry}>Try again</button></p>}
    <div className="gmd-fund-grid" aria-busy={!pool && !reader.failure}>
      <article><span>Total value locked</span><strong>{tvl !== null ? formatUsdRounded(tvl) : pool ? "—" : wait(96)}</strong><small>{pool ? `${formatSharesShort(pool.sharesMicros, 4)} USTX and ${formatUsdRounded(pool.dollarsMicros)} dUSD, USTX at the NAV` : wait("80%")}</small></article>
      <article><span>Swap fee now</span><strong>{pool ? pool.feePips !== null ? formatFeePips(pool.feePips) : "Paused" : wait(64)}</strong><small>0.30% after each NAV record, rising to 1.00% over its hour</small></article>
      <article><span>NAV record</span><strong>{pool ? pool.nav.answer !== null ? formatUsdMicros(pool.nav.navMicros, 2) : "Unavailable" : wait(80)}</strong><small>{!pool ? wait("70%") : pool.nav.answer === null ? pool.nav.reason : `${age !== null ? `${Math.floor(age / 60)} min old` : "Recorded"}${newerRecord(pool) ? " · the next trade moves the pool to it" : " · the pool is centred on it"}`}</small></article>
      <article><span>Deposits waiting</span><strong>{waiting !== null ? formatUsdRounded(waiting) : pool ? "—" : wait(64)}</strong><small>Become LP tokens when the pool moves to the next NAV record</small></article>
    </div>
    {pool && pool.base.liquidity > 0n && <div className="gmd-pool-mix">
      <div className="gmd-pool-mix-head"><h3>Where the liquidity sits</h3><span>Pool price {formatUsdMicros(pool.priceMicros, 2)}{gap !== null ? ` · ${Math.abs(gap) < 0.005 ? "at the NAV" : `${Math.abs(gap).toFixed(2)}% ${gap > 0 ? "above" : "below"} the NAV`}` : ""}</span></div>
      <dl className="gmd-fund-facts">
        <div><dt>Main range</dt><dd>{rangeText(pool.base.lower, pool.base.upper)}</dd></div>
        <div><dt>One-sided range</dt><dd>{pool.limit.liquidity > 0n ? rangeText(pool.limit.lower, pool.limit.upper) : "None"}</dd></div>
      </dl>
    </div>}
    <dl className="gmd-fund-facts">
      <div><dt>Value per LP token</dt><dd>{pool && answer !== null && pool.supply > 0n ? `${formatUsdMicros(v4ValueMicros(pool, answer) * ONE / pool.supply, 4)} at the NAV` : "—"}</dd></div>
      <div><dt>LP tokens issued</dt><dd>{pool ? `${formatSharesShort(pool.supply, 4)} USTX-V4LP` : "—"}</dd></div>
      <div><dt>Centred on</dt><dd>{pool && pool.peggedAt > 0 ? `The record of ${shortTime(new Date(pool.peggedAt * 1000).toISOString())}` : "—"}</dd></div>
      <div><dt>Deposits</dt><dd>Become LP tokens when the pool moves to the next NAV record</dd></div>
      <div><dt>View pool</dt><dd><a className="gmd-inline-tx" href={fundExplorer.address(deployment.hook)} target="_blank" rel="noreferrer">X Layer Testnet<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
    </dl>
  </section>;
}

type Tab = "add" | "remove";
type StepKey = "approveShares" | "approveDollars" | "deposit" | "cancel" | "repeg" | "claim" | "withdraw";
type Done = { kind: "deposit" | "cancel" | "convert" | "claim" | "withdraw"; fill: V4Fill; hashes: string[]; block: number };
const HEADINGS: Record<Done["kind"], string> = { deposit: "Deposit waiting", cancel: "Deposit cancelled", convert: "Deposit converted", claim: "LP tokens claimed", withdraw: "Liquidity withdrawn" };

export function V4LiquidityPanel({ deployment, provider, chain, owner, reader, onBusy }: { deployment: V4Deployment; provider: Provider | null; chain: string | null; owner: string | null; reader: V4Reader; onBusy: (busy: boolean) => void }) {
  const { address } = useWalletAccount();
  const { now } = useMarket();
  const [tab, setTab] = useState<Tab>("add");
  const [pair, setPair] = useState<{ anchor: "shares" | "dollars"; text: string }>({ anchor: "dollars", text: "" });
  const [removeText, setRemoveText] = useState("");
  const [phase, setPhase] = useState<"form" | "working" | "done">("form");
  const [steps, setSteps] = useState<TxStep<StepKey>[]>([]);
  const [failure, setFailure] = useState<{ message: string; hash: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
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

  const calls = v4Calls(deployment);
  const snapshot = reader.snapshot;
  const pool = snapshot?.pool ?? null;
  const account = snapshot && owner && snapshot.owner === owner ? snapshot.account : null;
  const fresh = snapshot !== null && snapshot.pool.block >= reader.watermark;
  const position = pool && account ? v4Position(pool, account) : null;

  const anchorAmount = pair.anchor === "shares" ? parseShares(pair.text) : parseUsd(pair.text);
  const partner = pool && anchorAmount !== null ? (pair.anchor === "shares" ? v4PairedDollars(anchorAmount, pool) : v4PairedShares(anchorAmount, pool)) : null;
  const maxima = anchorAmount === null || partner === null ? null : pair.anchor === "shares" ? { sharesMicros: anchorAmount, dollarsMicros: partner } : { sharesMicros: partner, dollarsMicros: anchorAmount };
  const quote = pool && maxima ? v4DepositQuote(maxima, pool) : null;
  const lpAmount = parseShares(removeText);
  const withdrawable = position?.lp ?? 0n;
  const estimate = pool && lpAmount !== null ? v4WithdrawEstimate(lpAmount, pool) : null;

  const problem = !account || !pool ? null
    : !fresh ? "Updating your balances…"
    : tab === "add" ? (
      pool.supply === 0n ? "The pool has not opened yet."
      : anchorAmount === null || anchorAmount === 0n ? "Enter an amount of USTX or demo dollars."
      : !maxima || !quote ? "That amount is too small for the pool."
      : maxima.sharesMicros > account.sharesMicros ? (account.sharesMicros === 0n ? "This wallet holds no USTX. Buy some on the USTX page first." : "That needs more USTX than this wallet holds.")
      : maxima.dollarsMicros > account.dollarsMicros ? "That needs more demo dollars than this wallet holds." : null)
    : withdrawable === 0n ? "This wallet has no liquidity in the pool."
    : lpAmount === null || lpAmount === 0n ? "Choose how much to withdraw."
    : lpAmount > withdrawable ? "That is more than your LP tokens."
    : !estimate ? "That amount is too small to withdraw." : null;

  /** Runs `plan` and shows its steps; on success, what it did. */
  async function execute(kind: Done["kind"], plan: PlanStep<StepKey>[]) {
    if (!provider || !account || !pool) return;
    const progress: PlanProgress = { block: Math.max(reader.watermark, pool.block), hashes: [], lastHash: null };
    const fills: V4Fill[] = [];
    const tracked = plan.map(step => ({ ...step, read: (receipt: FundReceipt) => { fills.push(v4Fill(receipt, deployment, address)); step.read?.(receipt); } }));
    const mark = (key: StepKey, next: StepState, hash?: string) => setSteps(current => current.map(step => step.key === key ? { ...step, state: next, hash: hash ?? step.hash } : step));
    setSteps(plan.map(step => ({ key: step.key, label: step.label, state: "idle" })));
    setPhase("working"); setFailure(null);
    try {
      await runPlan(tracked, { provider, from: address, progress, mark, signal: unmounted() });
      // One fill for the whole plan: the steps' events together.
      const fill = fills.reduce<V4Fill>((all, next) => ({
        deposited: next.deposited ?? all.deposited, cancelled: next.cancelled ?? all.cancelled, withdrawn: next.withdrawn ?? all.withdrawn, converted: next.converted ?? all.converted,
        claimedLpMicros: next.claimedLpMicros !== null ? (all.claimedLpMicros ?? 0n) + next.claimedLpMicros : all.claimedLpMicros, mintedLpMicros: all.mintedLpMicros + next.mintedLpMicros,
      }), { deposited: null, cancelled: null, claimedLpMicros: null, withdrawn: null, converted: null, mintedLpMicros: 0n });
      setDone({ kind, fill, hashes: progress.hashes, block: progress.block });
      setPhase("done");
      if (kind === "deposit") setPair(current => ({ ...current, text: "" }));
      if (kind === "withdraw") setRemoveText("");
    } catch (error) {
      setFailure({ message: v4ErrorMessage(error), hash: progress.lastHash });
      setPhase("form");
    } finally {
      reader.raise(progress.block);
      if (progress.block > pool.block) window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: progress.block } }));
    }
  }

  function deposit() {
    if (!account || !maxima || problem) return;
    const amounts = maxima;
    void execute("deposit", [
      ...(account.assetAllowanceMicros < amounts.sharesMicros ? [{ key: "approveShares", label: "Approve USTX for the pool", approval: true, request: async () => calls.approveShares(amounts.sharesMicros) } as PlanStep<StepKey>] : []),
      ...(account.dollarAllowanceMicros < amounts.dollarsMicros ? [{ key: "approveDollars", label: "Approve demo dollars for the pool", approval: true, request: async () => calls.approveDollars(amounts.dollarsMicros) } as PlanStep<StepKey>] : []),
      { key: "deposit", label: "Deposit for the next NAV record", approval: false, request: async () => calls.deposit(amounts, await orderDeadline()) },
    ]);
  }
  function withdraw() {
    if (!estimate || lpAmount === null || problem) return;
    const amount = lpAmount;
    const minima = { sharesMicros: withSlippage(estimate.sharesMicros), dollarsMicros: withSlippage(estimate.dollarsMicros) };
    void execute("withdraw", [{ key: "withdraw", label: "Withdraw liquidity", approval: false, request: async () => calls.withdraw(amount, minima, await orderDeadline()) }]);
  }

  const head = <div className="gmd-order-heading"><h2 id="provide-v4-title" ref={headingRef} tabIndex={-1}>{phase === "done" && done ? HEADINGS[done.kind] : phase === "working" ? "Confirm in your wallet" : "Provide liquidity"}</h2><Icon name="pool" /></div>;
  const shell = (body: ReactNode) => <aside className="gmd-order-panel gmd-liquidity-panel" aria-labelledby="provide-v4-title">{head}{body}</aside>;
  if (!provider || !owner) return shell(<WalletGate provider={provider} chain={chain} purpose="Provide liquidity" />);
  if (!account || !pool) return shell(reader.failure && !account
    ? <div className="gmd-inline-error" role="alert">{reader.failure} <button type="button" className="gmd-text-button" onClick={reader.retry}>Try again</button></div>
    : <p className="gmd-caption" role="status">Reading your wallet on X Layer Testnet…</p>);
  if (phase === "working") return shell(<TxSteps steps={steps} listRef={stepsRef} />);

  if (phase === "done" && done) {
    const { fill } = done;
    const updated = fresh && pool.block >= done.block;
    return shell(<div ref={doneRef} tabIndex={-1} className="gmd-order-review gmd-liquidity-done" role="status">
      <dl className="gmd-facts">
        {fill.deposited && <div><dt>Deposited</dt><dd>{both(fill.deposited)}</dd></div>}
        {fill.deposited && fill.mintedLpMicros === 0n && <div><dt>LP tokens</dt><dd>At the next NAV record{dueIn(pool, now)}</dd></div>}
        {fill.mintedLpMicros > 0n && <div><dt>LP tokens received</dt><dd>{formatShares(fill.mintedLpMicros)} USTX-V4LP</dd></div>}
        {fill.cancelled && <div><dt>Returned to your wallet</dt><dd>{both(fill.cancelled)}</dd></div>}
        {done.kind === "convert" && fill.converted && <div><dt>Converted at the NAV</dt><dd>{formatUsdMicros(fill.converted.navAnswer / 100n, 4)}</dd></div>}
        {fill.claimedLpMicros !== null && fill.claimedLpMicros > 0n && <div><dt>LP tokens claimed</dt><dd>{formatShares(fill.claimedLpMicros)} USTX-V4LP</dd></div>}
        {fill.withdrawn && <div><dt>Withdrawn</dt><dd>{both(fill.withdrawn)}</dd></div>}
        <div><dt>Your liquidity</dt><dd>{updated && position ? position.valueMicros !== null ? formatUsdRounded(position.valueMicros) : `${formatShares(position.lp)} USTX-V4LP` : "Updating…"}</dd></div>
        <div><dt>{done.hashes.length === 1 ? "Transaction" : "Transactions"}</dt><dd className="gmd-liquidity-hashes">{done.hashes.map((hash, index) => <TxLink key={hash} hash={hash}>{done.hashes.length === 1 ? "OKX Explorer" : `Step ${index + 1}`}</TxLink>)}</dd></div>
      </dl>
      {done.kind === "deposit" && <p className="gmd-caption">Your deposit becomes LP tokens when the pool moves to the next NAV record (at the next trade or deposit, or when you choose Convert now), valued with everything in the pool at that NAV. Until then you can cancel it here.</p>}
      <Link prefetch={false} className="gmd-button" href="/portfolio">View portfolio <Icon name="arrow" size={16} /></Link>
      <button type="button" className="gmd-text-button" onClick={() => { setDone(null); setPhase("form"); requestAnimationFrame(() => headingRef.current?.focus()); }}>Done</button>
    </div>);
  }

  return shell(<>
    <div className="gmd-segmented gmd-pay-with" role="group" aria-label="Liquidity action">
      <button type="button" aria-pressed={tab === "add"} onClick={() => { setTab("add"); setFailure(null); }}>Add</button>
      <button type="button" aria-pressed={tab === "remove"} onClick={() => { setTab("remove"); setFailure(null); }}>Withdraw</button>
    </div>
    {!fresh && <p className="gmd-caption" role="status">Updating your balances from X Layer Testnet…</p>}
    {position && position.lp > 0n && <div className="gmd-liquidity-position">
      <span>Your liquidity</span>
      <strong>{position.valueMicros !== null ? formatUsdRounded(position.valueMicros) : `${formatShares(position.lp)} USTX-V4LP`}</strong>
      <small>{formatSharePpm(position.sharePpm, true)} of the pool{position.amounts ? ` · ${formatSharesShort(position.amounts.sharesMicros, 4)} USTX and ${formatUsdRounded(position.amounts.dollarsMicros)}` : ""}</small>
    </div>}
    {account.waiting && <div className="gmd-liquidity-waiting">
      <span>Waiting for the next NAV record</span>
      <b>{both(account.waiting)}</b>
      <small>{newerRecord(pool) ? "A new NAV record is out: convert your deposit at it now, or cancel." : `It becomes LP tokens when the pool moves to the next NAV record${dueIn(pool, now)}. Until then, you can cancel.`}</small>
      <div className="gmd-position-actions">
        {fresh && newerRecord(pool) && <button type="button" className="gmd-small-button" onClick={() => void execute("convert", [
          {
            key: "repeg", label: "Move the pool to the new NAV", approval: false,
            // A trade, a deposit or the keeper may have moved the pool since this page read it: then only the claim is left.
            request: async ({ block }) => await v4RepegDue(deployment, address, { minBlock: block }) ? calls.repeg() : null,
          },
          { key: "claim", label: "Claim your LP tokens", approval: false, request: async () => calls.claimShares(address) },
        ])}>Convert now</button>}
        {fresh && <button type="button" className="gmd-small-button" onClick={() => void execute("cancel", [{ key: "cancel", label: "Cancel the deposit", approval: false, request: async () => calls.cancelDeposit() }])}>Cancel deposit</button>}
      </div>
    </div>}
    {account.claimableLpMicros > 0n && <div className="gmd-liquidity-waiting is-ready">
      <span>Converted at a NAV record</span>
      <b>{formatShares(account.claimableLpMicros)} USTX-V4LP to claim</b>
      <small>Withdrawing or depositing claims them too.</small>
      {fresh && <div className="gmd-position-actions"><button type="button" className="gmd-small-button" onClick={() => void execute("claim", [{ key: "claim", label: "Claim your LP tokens", approval: false, request: async () => calls.claimShares(address) }])}>Claim</button></div>}
    </div>}
    <div className="gmd-wallet-balances">
      <div><span>Demo dollars</span><b>{usd(account.dollarsMicros)}</b><small>dUSD, no value</small></div>
      <div><span>USTX in wallet</span><b>{formatShares(account.sharesMicros)}</b><small>{pool.nav.answer !== null && account.sharesMicros > 0n ? formatUsdRounded(account.sharesMicros * pool.nav.navMicros / ONE) : "X Layer Testnet"}</small></div>
    </div>
    {tab === "add" ? <>
      <div className="gmd-liquidity-inputs">
        <div className="gmd-order-input">
          <label htmlFor="v4-shares">USTX</label>
          <div><input id="v4-shares" inputMode="decimal" autoComplete="off" placeholder="0" value={pair.anchor === "shares" ? pair.text : maxima ? plain(maxima.sharesMicros) : ""} onChange={event => { setPair({ anchor: "shares", text: event.target.value }); setFailure(null); }} aria-invalid={fresh && Boolean(pair.text) && Boolean(problem)} aria-describedby="v4-help" /><span>USTX</span></div>
          <p>In your wallet: {formatShares(account.sharesMicros)}</p>
        </div>
        <div className="gmd-order-input">
          <label htmlFor="v4-dollars">Demo dollars</label>
          <div><input id="v4-dollars" inputMode="decimal" autoComplete="off" placeholder="0" value={pair.anchor === "dollars" ? pair.text : maxima ? plain(maxima.dollarsMicros) : ""} onChange={event => { setPair({ anchor: "dollars", text: event.target.value }); setFailure(null); }} aria-invalid={fresh && Boolean(pair.text) && Boolean(problem)} aria-describedby="v4-help" /><span>dUSD</span></div>
          <p>In your wallet: {usd(account.dollarsMicros)}</p>
        </div>
        <p id="v4-help" className="gmd-liquidity-help">{pair.text && problem ? problem : "Type either amount; the other follows what the pool holds."}</p>
      </div>
      <div className="gmd-order-estimate"><span>LP tokens, at the current NAV</span><strong>{quote && quote.lpEstimateMicros !== null ? `≈ ${formatShares(quote.lpEstimateMicros)}` : "—"} <small>USTX-V4LP</small></strong></div>
      <dl className="gmd-facts">
        {quote && <div><dt>You deposit</dt><dd>{both(quote)}</dd></div>}
        <div><dt>Value at the NAV</dt><dd>{quote && pool.nav.answer !== null ? formatUsdRounded(v4ValueMicros(quote, pool.nav.answer)) : "—"}</dd></div>
        <div><dt>Becomes LP tokens</dt><dd>When the pool moves to the next NAV record</dd></div>
        <div><dt>Wallet confirmations</dt><dd>{maxima ? 1 + Number(account.assetAllowanceMicros < maxima.sharesMicros) + Number(account.dollarAllowanceMicros < maxima.dollarsMicros) : "—"}</dd></div>
      </dl>
    </> : <>
      <div className="gmd-order-input">
        <label htmlFor="v4-remove">LP tokens to withdraw</label>
        <div><input id="v4-remove" inputMode="decimal" autoComplete="off" placeholder="0" value={removeText} onChange={event => { setRemoveText(event.target.value); setFailure(null); }} aria-invalid={fresh && Boolean(removeText) && Boolean(problem)} aria-describedby="v4-remove-help" /><span>USTX-V4LP</span></div>
        <p id="v4-remove-help">{removeText && problem ? problem : `Yours: ${formatShares(withdrawable)} USTX-V4LP${account.claimableLpMicros > 0n ? ", claimed as you withdraw" : ""}`}</p>
      </div>
      <div className="gmd-order-presets" role="group" aria-label="Part of your liquidity">{([25n, 50n, 75n, 100n] as const).map(percent => {
        const value = percent === 100n ? withdrawable : withdrawable * percent / 100n;
        return <button type="button" key={String(percent)} disabled={withdrawable === 0n} aria-pressed={lpAmount === value && value > 0n} onClick={() => { setRemoveText(plain(value)); setFailure(null); }}>{percent === 100n ? "All" : `${percent}%`}</button>;
      })}</div>
      <div className="gmd-order-estimate"><span>You receive about</span><strong>{estimate ? `${formatSharesShort(estimate.sharesMicros, 4)} USTX` : "—"}{estimate && <>{" "}<small>and {usd(estimate.dollarsMicros)}</small></>}</strong></div>
      <dl className="gmd-facts">
        <div><dt>Value at the NAV</dt><dd>{estimate && pool.nav.answer !== null ? formatUsdRounded(v4ValueMicros(estimate, pool.nav.answer)) : "—"}</dd></div>
        <div><dt>Minimum accepted</dt><dd>{estimate ? both({ sharesMicros: withSlippage(estimate.sharesMicros), dollarsMicros: withSlippage(estimate.dollarsMicros) }) : "—"}</dd></div>
      </dl>
    </>}
    {failure && <p ref={failureRef} tabIndex={-1} className="gmd-inline-error" role="alert">{failure.message}{failure.hash && <> <TxLink hash={failure.hash}>See the last transaction</TxLink></>}</p>}
    <button type="button" className="gmd-button" disabled={Boolean(problem) || (tab === "add" ? !quote : !estimate)} onClick={tab === "add" ? deposit : withdraw}>{tab === "add" ? "Deposit" : "Withdraw"} <Icon name="arrow" size={17} /></button>
    <p className="gmd-caption">{tab === "add"
      ? "Deposits go in at the ratio of what the pool holds and become LP tokens when the pool moves to the next NAV record, valued with everything in the pool at that NAV. Until then you can cancel."
      : "You receive your share of both tokens at once, whatever the NAV record's age. If the pool moves more than 1% before the transaction is mined, nothing is withdrawn."} Demo dollars and USTX have no value.</p>
  </>);
}

/** How the v4 pool works, in a provider's terms. */
export function V4PoolGuide() {
  return <section id="how-v4" className="gmd-terms" aria-labelledby="how-v4-title">
    <h2 id="how-v4-title">How this pool works</h2>
    <p>This pool adjusts its trading range to each new NAV before accepting trades. It aims to reduce losses from trading at an outdated price; returns still depend on trading activity and fees.</p>
    <dl>
      <div><dt>Deposit</dt><dd>USTX and demo dollars at the ratio of what the pool holds. Your deposit waits for the pool to move to the next NAV record (at the next trade or deposit, or when you choose Convert now) and becomes LP tokens at that NAV, valued with everything in the pool. Until then you can cancel it.</dd></div>
      <div><dt>Fee</dt><dd>0.30% just after a NAV record, rising to 1.00% as the record ages over an hour. Without a record under an hour old, the pool stops trading.</dd></div>
      <div><dt>Liquidity</dt><dd>A main range about 2% either side of the NAV, and a one-sided range with what the main range cannot use.</dd></div>
      <div><dt>Withdraw</dt><dd>At any time, for your share of both tokens, whatever the record’s age.</dd></div>
      <div><dt>Network</dt><dd>X Layer Testnet, on Uniswap v4. Demo dollars and USTX have no value, and network fees are paid in test OKB.</dd></div>
    </dl>
  </section>;
}
