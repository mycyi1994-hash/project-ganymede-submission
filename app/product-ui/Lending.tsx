"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import { parseUsd } from "@/lib/xstocks/wallet";
import { FUND_DEPLOYMENT, FUND_WALLET_CHAIN, fundExplorer, simulateFundCall, waitForFundReceipt, type TransactionCall } from "@/lib/xstocks/fund";
import {
  LENDING_ALL, LENDING_TERMS, formatWadPercent, lendingCalls, lendingErrorMessage, lendingFill, lendingPosition, readLending,
  type LendingAccount, type LendingAction, type LendingMarket,
} from "@/lib/xstocks/lending";
import { OkxAppLink } from "./OkxApp";
import { Icon, Skeleton } from "./Icons";
import GasNotice from "./GasNotice";
import { useWalletAccount } from "./WalletAccount";
import { useNavDelay } from "./NavDelay";
import { PageGuide } from "./ProductShell";
import { TxLink, sendFromWallet, switchToTestnet, useInjectedWallet, useWalletChain } from "./WalletInvest";

// Borrowing against USTX on X Layer Testnet: post USTX as collateral in GanymedeLendingMarket and
// borrow demo dollars (no value) up to half of its value at the NAV recorded on X Layer, or lend
// demo dollars and earn what borrowers pay.

type Step = { key: "approve" | "action"; label: string; state: "idle" | "wallet" | "chain" | "done"; hash?: string };

const ACTIONS: Array<{ key: LendingAction; label: string; verb: string }> = [
  { key: "deposit", label: "Deposit USTX", verb: "Deposit USTX as collateral" },
  { key: "borrow", label: "Borrow", verb: "Borrow demo dollars" },
  { key: "repay", label: "Repay", verb: "Repay the loan" },
  { key: "withdrawCollateral", label: "Withdraw USTX", verb: "Withdraw USTX to your wallet" },
  { key: "lend", label: "Lend dUSD", verb: "Lend demo dollars" },
  { key: "withdraw", label: "Withdraw dUSD", verb: "Withdraw lent demo dollars" },
];
const inShares = (action: LendingAction) => action === "deposit" || action === "withdrawCollateral";
const TITLES: Record<LendingAction, string> = { deposit: "Deposit USTX", withdrawCollateral: "Withdraw USTX", borrow: "Borrow dUSD", repay: "Repay dUSD", lend: "Lend dUSD", withdraw: "Withdraw dUSD" };
const PAIRS: Record<LendingAction, [LendingAction, LendingAction]> = {
  deposit: ["deposit", "withdrawCollateral"], withdrawCollateral: ["deposit", "withdrawCollateral"],
  borrow: ["borrow", "repay"], repay: ["borrow", "repay"], lend: ["lend", "withdraw"], withdraw: ["lend", "withdraw"],
};
const TABS: Record<LendingAction, string> = { deposit: "Deposit", withdrawCollateral: "Withdraw", borrow: "Borrow", repay: "Repay", lend: "Lend", withdraw: "Withdraw" };
const MAX_LABELS: Record<LendingAction, string> = { deposit: "Wallet balance", withdrawCollateral: "Available to withdraw", borrow: "Available to borrow", repay: "Up to", lend: "Wallet balance", withdraw: "Available to withdraw" };
const WAD = 10n ** 18n;
const DONE: Record<LendingAction, string> = {
  deposit: "You deposited", borrow: "You borrowed", repay: "You repaid", withdrawCollateral: "You withdrew", lend: "You lent", withdraw: "You withdrew",
};

const min = (a: bigint, b: bigint) => (a < b ? a : b);

const LIMIT = Number(LENDING_TERMS.borrowFactorWad * 100n / 10n ** 18n);
const LIQUIDATION = Number(LENDING_TERMS.liquidationThresholdWad * 100n / 10n ** 18n);
/** The health bar runs to 80%, past the 65% liquidation line. */
const HEALTH_SCALE = 80;

/** A loan against its collateral: the 50% borrow limit and the 65% liquidation line, marked on one bar. */
export function LoanHealth({ loanToValueWad, compact = false }: { loanToValueWad: bigint; compact?: boolean }) {
  const ltv = Number(loanToValueWad * 10_000n / 10n ** 18n) / 100;
  const state = ltv >= LIQUIDATION ? "is-danger" : ltv > LIMIT ? "is-caution" : "is-safe";
  const label = ltv >= LIQUIDATION ? "Can be liquidated" : ltv > LIMIT ? "Above the borrow limit" : "Healthy";
  const at = (percent: number) => `${percent / HEALTH_SCALE * 100}%`;
  return <div className={`gmd-loan-health ${state}${compact ? " is-compact" : ""}`}>
    {!compact && <div className="gmd-loan-health-head"><span><Icon name={state === "is-safe" ? "check" : "info"} size={15} />{label}</span><b>{formatWadPercent(loanToValueWad)} loan to value</b></div>}
    <div className="gmd-loan-health-track" role="meter" aria-label="Loan to value" aria-valuemin={0} aria-valuemax={HEALTH_SCALE} aria-valuenow={Math.min(HEALTH_SCALE, ltv)} aria-valuetext={`${formatWadPercent(loanToValueWad)}, ${label.toLowerCase()}. Borrow limit ${LIMIT}%, liquidation above ${LIQUIDATION}%.`}>
      <i style={{ width: at(Math.min(HEALTH_SCALE, ltv)) }} />
      <em style={{ left: at(LIMIT) }} />
      <em className="is-liquidation" style={{ left: at(LIQUIDATION) }} />
    </div>
    <div className="gmd-loan-health-scale" aria-hidden="true"><span>0%</span><span style={{ left: at(LIMIT) }}>{LIMIT}%{compact ? "" : " limit"}</span><span style={{ left: at(LIQUIDATION) }}>{LIQUIDATION}%{compact ? "" : " liquidation"}</span></div>
  </div>;
}
/** Six-decimal micros as plain input text: 1250.5, never 1,250.500000. */
export const plain = (micros: bigint) => {
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${micros / 1_000_000n}.${fraction}` : `${micros / 1_000_000n}`;
};

type Token = "USTX" | "dUSD";

function TokenMark({ token }: { token: Token }) {
  return <span className={`gmd-token-mark is-${token === "USTX" ? "ustx" : "dusd"}`} aria-hidden="true">{token === "USTX" ? "U" : "$"}</span>;
}

/** An asset in a table row: its mark, its ticker and what it is. */
function TokenCell({ token }: { token: Token }) {
  return <span className="gmd-token"><TokenMark token={token} /><span><b>{token}</b><small>{token === "USTX" ? "US Tech Basket share" : "Demo dollar"}</small></span></span>;
}

export function LendingSection() {
  const delay = useNavDelay();
  const provider = useInjectedWallet();
  const { address, source, busy: connecting, message, connect } = useWalletAccount();
  const connected = source === "wallet" && Boolean(address);
  const chain = useWalletChain(provider, connected ? address : "");
  const onTestnet = chain === FUND_WALLET_CHAIN.chainId;
  const ready = Boolean(provider) && connected && onTestnet;
  const owner = ready ? address : null;

  const [snapshot, setSnapshot] = useState<{ owner: string | null; market: LendingMarket; account: LendingAccount | null } | null>(null);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [watermark, setWatermark] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [action, setAction] = useState<LendingAction>("deposit");
  // Each action opens in a dialog over the page, as Aave's and Venus's do.
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"form" | "working" | "done">("form");
  const [steps, setSteps] = useState<Step[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ action: LendingAction; micros: bigint; hash: string } | null>(null);
  // The button that started a transaction goes away while it runs; keep keyboard focus in the panel.
  const stepsRef = useRef<HTMLOListElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (phase === "working") stepsRef.current?.focus();
    else if (phase === "done") doneRef.current?.focus();
  }, [phase]);
  useEffect(() => { if (failure) failureRef.current?.focus(); }, [failure]);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => { if (inputRef.current) inputRef.current.focus(); else dialogRef.current?.focus(); });
    return () => window.cancelAnimationFrame(frame);
  }, [open, action]);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    readLending(owner, { minBlock: watermark })
      .then(result => { if (!cancelled) { setSnapshot({ owner, ...result }); setReadFailure(null); } })
      .catch(error => { if (!cancelled) setReadFailure(lendingErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [owner, watermark, reload]);
  // An order in the panel changed this wallet's balances: read again from the order's block.
  useEffect(() => {
    const onOrder = (event: Event) => { const block = (event as CustomEvent<{ block?: number }>).detail?.block; if (typeof block === "number") setWatermark(current => Math.max(current, block)); };
    window.addEventListener(DEMO_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(DEMO_ORDER_EVENT, onOrder);
  }, []);
  useEffect(() => {
    if (phase === "working") return;
    const timer = window.setInterval(() => { if (!document.hidden) setReload(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const market = snapshot?.market ?? null;
  const account = snapshot && snapshot.owner === owner ? snapshot.account : null;
  // After a transaction, until a read at or after its block arrives, amounts on screen are from before it.
  const fresh = snapshot !== null && snapshot.market.block >= watermark;
  const nav = market?.nav.navMicros ?? null;
  const position = account && market && nav !== null ? lendingPosition(account.collateralMicros, account.debtMicros, nav, market.cashMicros) : null;

  const shares = inShares(action);
  const size = shares ? parseShares(amount) : parseUsd(amount);
  const maxFor = (key: LendingAction): bigint | null => {
    if (!account || !market) return null;
    switch (key) {
      case "deposit": return account.sharesMicros;
      case "borrow": return position ? position.borrowableMicros : null;
      case "repay": return min(account.debtMicros, account.dollarsMicros);
      case "withdrawCollateral": return account.debtMicros === 0n ? account.collateralMicros : position ? position.withdrawableMicros : null;
      case "lend": return account.dollarsMicros;
      case "withdraw": return min(account.suppliedMicros, market.cashMicros);
    }
  };
  const max = maxFor(action);
  const paused = Boolean(market?.paused) && (action === "deposit" || action === "borrow" || action === "lend");
  const problem = !account || !market ? null
    : !fresh ? "Updating your position…"
    : paused ? "Lending is paused right now."
    : size === null || size === 0n ? `Enter an amount in ${shares ? "USTX" : "demo dollars"}.`
    : action === "deposit" && size > account.sharesMicros ? (account.sharesMicros === 0n ? "This wallet holds no USTX yet. Buy some on the USTX page first." : "That is more USTX than this wallet holds.")
    : action === "borrow" && nav === null ? "Borrowing reopens with the next NAV record, which values the collateral."
    : action === "borrow" && account.collateralMicros === 0n ? "Deposit USTX first. You can borrow up to 50% of its value."
    : action === "borrow" && account.debtMicros + size < LENDING_TERMS.minBorrowMicros ? "A loan starts at $10."
    : action === "borrow" && max !== null && size > max ? `You can borrow up to ${formatUsdMicros(max, 2)} now.`
    : action === "repay" && account.debtMicros === 0n ? "This wallet has no loan to repay."
    : action === "repay" && size > account.dollarsMicros ? "That is more than your demo dollars."
    : action === "repay" && size > account.debtMicros ? `The loan is ${formatUsdMicros(account.debtMicros, 2)}. Use Max to repay all of it.`
    : action === "withdrawCollateral" && account.collateralMicros === 0n ? "This wallet has no USTX deposited."
    : action === "withdrawCollateral" && max !== null && size > max ? `You can withdraw up to ${formatShares(max)} USTX while the loan is open.`
    : action === "lend" && size > account.dollarsMicros ? "That is more than your demo dollars."
    : action === "withdraw" && account.suppliedMicros === 0n ? "This wallet has nothing lent."
    : action === "withdraw" && max !== null && size > max ? `You can withdraw up to ${formatUsdMicros(max, 2)} now.`
    : null;

  // Everything, rather than the amount read a moment ago, where the market allows it: the loan and
  // the lent balance grow with interest every second.
  const repayAll = action === "repay" && account !== null && size !== null && size >= account.debtMicros;
  const withdrawAll = action === "withdraw" && account !== null && size !== null && size === account.suppliedMicros && account.suppliedMicros <= (market?.cashMicros ?? 0n);
  const takeAllCollateral = action === "withdrawCollateral" && account !== null && account.debtMicros === 0n && size === account.collateralMicros;
  // A full repayment approves a little over the debt, for the interest until it is mined.
  const approveFor = action === "deposit" || action === "lend" ? size : repayAll && account ? account.debtMicros + account.debtMicros / 1_000n + 1n : action === "repay" ? size : null;
  const allowance = !account ? 0n : action === "deposit" ? account.shareAllowanceMicros : account.dollarAllowanceMicros;
  const needsApproval = approveFor !== null && allowance < approveFor;

  const after = !account || !market || size === null || problem ? null : (() => {
    const collateral = action === "deposit" ? account.collateralMicros + size : action === "withdrawCollateral" ? account.collateralMicros - size : account.collateralMicros;
    const debt = action === "borrow" ? account.debtMicros + size : action === "repay" ? (repayAll ? 0n : account.debtMicros - size) : account.debtMicros;
    const lent = action === "lend" ? account.suppliedMicros + size : action === "withdraw" ? account.suppliedMicros - size : account.suppliedMicros;
    return { collateral, debt, lent, next: nav !== null ? lendingPosition(collateral, debt, nav, market.cashMicros) : null };
  })();

  function choose(next: LendingAction) { setAction(next); setAmount(""); setFailure(null); setPhase("form"); }
  function openAction(next: LendingAction, event: MouseEvent<HTMLButtonElement>) { trigger.current = event.currentTarget; choose(next); setOpen(true); }
  // A transaction under way keeps the dialog open, so its steps stay in view.
  function close() {
    if (phase === "working") return;
    setOpen(false);
    if (phase === "done") setPhase("form");
    window.setTimeout(() => trigger.current?.focus(), 0);
  }
  function onDialogKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href], [tabindex='0']")];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function run() {
    if (!provider || !account || size === null || problem) return;
    const from = address;
    const request: TransactionCall = action === "deposit" ? lendingCalls.supplyCollateral(size)
      : action === "borrow" ? lendingCalls.borrow(size)
      : action === "repay" ? lendingCalls.repay(repayAll ? LENDING_ALL : size)
      : action === "withdrawCollateral" ? lendingCalls.withdrawCollateral(takeAllCollateral ? LENDING_ALL : size)
      : action === "lend" ? lendingCalls.supply(size)
      : lendingCalls.withdraw(withdrawAll ? LENDING_ALL : size);
    const approval = needsApproval && approveFor !== null ? (action === "deposit" ? lendingCalls.approveShares(approveFor) : lendingCalls.approveDollars(approveFor)) : null;
    const taken = action;
    const mark = (key: Step["key"], state: Step["state"], hash?: string) => setSteps(current => current.map(step => step.key === key ? { ...step, state, hash: hash ?? step.hash } : step));
    setSteps([...(approval ? [{ key: "approve", label: taken === "deposit" ? "Approve USTX" : "Approve demo dollars", state: "idle" } as Step] : []), { key: "action", label: ACTIONS.find(item => item.key === taken)!.verb, state: "idle" }]);
    setPhase("working"); setFailure(null);
    let block = Math.max(watermark, market?.block ?? 0);
    try {
      if (approval) {
        mark("approve", "wallet");
        const hash = await sendFromWallet(provider, from, approval);
        mark("approve", "chain", hash);
        const receipt = await waitForFundReceipt(hash);
        if (receipt.status !== "success") throw new Error("The approval failed on X Layer Testnet.");
        block = Math.max(block, receipt.block);
        mark("approve", "done");
      }
      await simulateFundCall(from, request, { minBlock: block });
      mark("action", "wallet");
      const hash = await sendFromWallet(provider, from, request);
      mark("action", "chain", hash);
      const receipt = await waitForFundReceipt(hash);
      const fill = receipt.status === "success" ? lendingFill(receipt, taken) : null;
      if (!fill) throw new Error("The transaction did not go through on X Layer Testnet. See it on the OKX explorer.");
      mark("action", "done");
      setDone({ action: taken, micros: fill.micros, hash });
      setPhase("done");
      setAmount("");
      setWatermark(current => Math.max(current, receipt.block));
      window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: receipt.block } }));
    } catch (error) {
      setFailure(lendingErrorMessage(error));
      setPhase("form");
      setWatermark(current => Math.max(current, block));
      setReload(value => value + 1);
    }
  }

  const usd = (micros: bigint) => formatUsdMicros(micros, 2);
  const wait = (width: number) => readFailure ? "—" : <Skeleton width={width} />;
  const status = !market ? "Loading…" : market.paused ? "Paused" : delay ? "New loans wait for the next NAV record" : "Live on X Layer Testnet";
  const borrowRate = market ? formatWadPercent(market.borrowRateWad) : wait(48);
  const supplyRate = market ? formatWadPercent(market.supplyRateWad) : wait(48);

  // What to do first without a wallet on X Layer Testnet: on the page, and in the dialog.
  let gate: ReactNode = null;
  if (!provider) {
    gate = <p>Borrow from your own wallet on X Layer Testnet. Install the OKX Wallet extension, or open this page in the OKX app’s browser. <a className="gmd-inline-link" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">Get OKX Wallet <Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> · <OkxAppLink className="gmd-inline-link" /></p>;
  } else if (!connected) {
    gate = <><p>Connect OKX Wallet to deposit USTX, borrow against it, or lend demo dollars.</p>
      <button type="button" className="gmd-button" disabled={connecting} onClick={() => void connect()}><Icon name="wallet" size={17} />{connecting ? "Connecting…" : "Connect OKX Wallet"}</button>
      {message && <p className="gmd-caption" role="status">{message}</p>}</>;
  } else if (!onTestnet) {
    gate = <><p>{chain ? "Your wallet is on another network. The market is on X Layer Testnet." : "Checking your wallet’s network…"}</p>
      <button type="button" className="gmd-button" disabled={switching || !chain} onClick={() => { setSwitching(true); switchToTestnet(provider).catch(() => {}).finally(() => setSwitching(false)); }}>{switching ? "Switching…" : "Switch to X Layer Testnet"}</button></>;
  } else if (!account) {
    gate = <p className="gmd-caption" role="status">{readFailure ?? "Reading your wallet on X Layer Testnet…"}</p>;
  }

  // The wallet's figures, as Aave's dashboard heads them: what it is worth, the limit it uses and its health.
  const collateralValue = position?.valueMicros ?? 0n;
  const supplied = account ? collateralValue + account.suppliedMicros : null;
  const net = account && supplied !== null ? supplied - account.debtMicros : null;
  const used = !account || account.debtMicros === 0n ? 0 : position && position.borrowLimitMicros > 0n ? Number(account.debtMicros * 10_000n / position.borrowLimitMicros) / 100 : 100;
  const ltv = position && account && account.debtMicros > 0n ? Number(position.loanToValueWad * 10_000n / WAD) / 100 : null;
  const health = ltv === null ? "is-none" : ltv >= LIQUIDATION ? "is-danger" : ltv > LIMIT ? "is-caution" : "is-safe";
  const healthLabel = ltv === null ? "" : ltv >= LIQUIDATION ? "Can be liquidated" : ltv > LIMIT ? "Above the borrow limit" : "Healthy";

  const unit: Token = shares ? "USTX" : "dUSD";
  const amountOf = (micros: bigint, inUstx: boolean) => inUstx ? `${formatShares(micros)} USTX` : usd(micros);
  // The figures an action changes, before and after it, as a transaction overview.
  const overview: Array<[string, string, string | null]> = [];
  if (account) {
    if (action === "deposit" || action === "withdrawCollateral") {
      overview.push(["Collateral", `${formatShares(account.collateralMicros)} USTX`, after ? `${formatShares(after.collateral)} USTX` : null]);
      overview.push(["Borrow limit", position ? usd(position.borrowLimitMicros) : "—", after?.next ? usd(after.next.borrowLimitMicros) : null]);
    } else if (action === "borrow" || action === "repay") {
      overview.push(["Borrowed", usd(account.debtMicros), after ? usd(after.debt) : null]);
      if (market) overview.push(["Borrow APY", formatWadPercent(market.borrowRateWad), null]);
    } else {
      overview.push(["Lent", usd(account.suppliedMicros), after ? usd(after.lent) : null]);
      if (market) overview.push(["Supply APY", formatWadPercent(market.supplyRateWad), null]);
    }
    if ((action === "deposit" || action === "withdrawCollateral" || action === "borrow" || action === "repay") && (account.debtMicros > 0n || (after !== null && after.debt > 0n))) {
      overview.push(["Loan to value", position && account.debtMicros > 0n ? formatWadPercent(position.loanToValueWad) : "0.00%", after?.next ? formatWadPercent(after.next.loanToValueWad) : null]);
    }
  }

  let body: ReactNode;
  if (gate) body = <div className="gmd-lending-gate">{gate}</div>;
  else if (phase === "working") body = <><ol ref={stepsRef} tabIndex={-1} className="gmd-tx-steps" aria-live="polite">{steps.map((step, index) => <li key={step.key} className={`is-${step.state}`}>
      <span aria-hidden="true">{step.state === "done" ? <Icon name="check" size={14} /> : index + 1}</span>
      <div><b>{step.label}</b><small>{({ idle: "Next", wallet: "Confirm in your wallet", chain: "Confirming on X Layer Testnet…", done: "Done" })[step.state]}</small>{step.hash && <TxLink hash={step.hash}>View transaction</TxLink>}</div>
    </li>)}</ol><p className="gmd-caption">Keep this page open. Each step takes a few seconds on X Layer Testnet.</p></>;
  else if (phase === "done" && done) body = <>
    <p ref={doneRef} tabIndex={-1} className="gmd-lending-done" role="status"><Icon name="check" size={18} /><span>{DONE[done.action]} {amountOf(done.micros, inShares(done.action))}. <TxLink hash={done.hash} /></span></p>
    <button type="button" className="gmd-button gmd-lending-submit" onClick={close}>Done</button>
  </>;
  else if (account) body = <>
    {!fresh && <p className="gmd-caption" role="status">Updating your position from X Layer Testnet…</p>}
    <div className="gmd-lending-amount">
      <label htmlFor="lending-amount">Amount</label>
      <div className="gmd-lending-amount-box"><input ref={inputRef} id="lending-amount" inputMode="decimal" autoComplete="off" value={amount} placeholder="0.00" onChange={event => { setAmount(event.target.value); setFailure(null); }} aria-invalid={Boolean(amount) && Boolean(problem)} aria-describedby="lending-help" /><span className="gmd-token-chip"><TokenMark token={unit} />{unit}</span></div>
      <p id="lending-help" className={amount && problem ? "is-problem" : undefined}>{amount && problem ? problem : !fresh ? "Updating…" : max === null ? "—" : <>{MAX_LABELS[action]} <b>{amountOf(max, shares)}</b></>}{fresh && max !== null && max > 0n && <button type="button" className="gmd-lending-max" onClick={() => setAmount(plain(max))}>Max</button>}</p>
    </div>
    {overview.length > 0 && <div className="gmd-lending-overview"><h3>Transaction overview</h3><dl>{overview.map(([label, before, next]) => <div key={label}><dt>{label}</dt><dd>{before}{next !== null && next !== before && <><Icon name="arrow" size={13} /><b>{next}</b></>}</dd></div>)}</dl>
      {after?.next && after.debt > 0n && <LoanHealth loanToValueWad={after.next.loanToValueWad} />}</div>}
    <GasNotice address={address} gasWei={account.gasWei} onFunded={() => setReload(value => value + 1)} />
    {needsApproval && !problem && <p className="gmd-caption">Two wallet confirmations: approve, then send.</p>}
    {failure && <p ref={failureRef} tabIndex={-1} className="gmd-inline-error" role="alert">{failure}</p>}
    <button type="button" className="gmd-button gmd-lending-submit" disabled={Boolean(problem)} onClick={() => void run()}>{ACTIONS.find(item => item.key === action)!.verb} <Icon name="arrow" size={17} /></button>
  </>;

  const actionButton = (key: LendingAction, label: string, name: string, primary = false) =>
    <button type="button" className={`gmd-small-button${primary ? " is-primary" : ""}`} aria-label={name} aria-haspopup="dialog" onClick={event => openAction(key, event)}>{label}</button>;
  const empty = (text: string) => <p className="gmd-lending-empty">{account ? text : gate ? "Connect a wallet to see yours." : "Reading…"}</p>;
  const yes = <span className="gmd-lending-yes"><Icon name="check" size={14} />Yes</span>;

  return <div id="borrow" className="gmd-lending">
    <section className="gmd-lending-summary" aria-labelledby="lending-you">
      <h2 id="lending-you">Your position</h2>
      <dl>
        <div><dt>Net worth</dt><dd><strong>{net === null ? "—" : usd(net)}</strong><small>{account && supplied !== null ? `${usd(supplied)} supplied · ${usd(account.debtMicros)} borrowed` : "Supplied less borrowed"}</small></dd></div>
        <div><dt>Borrow limit used</dt><dd><strong>{account ? `${used.toFixed(2)}%` : "—"}</strong><span className="gmd-lending-meter" role="meter" aria-label="Borrow limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, used)}><i style={{ width: `${Math.min(100, used)}%` }} /></span><small>{position ? `of ${usd(position.borrowLimitMicros)} · ${usd(position.borrowableMicros)} available` : `Up to ${LIMIT}% of your USTX’s value`}</small></dd></div>
        <div className={`gmd-lending-health ${health}`}><dt>Loan to value</dt><dd><strong>{ltv === null ? (account ? "No loan" : "—") : `${ltv.toFixed(2)}%`}</strong><small>{ltv === null ? `Liquidation above ${LIQUIDATION}%` : `${healthLabel}${position?.liquidationNavMicros ? ` · liquidated if the NAV falls to ${usd(position.liquidationNavMicros)}` : ""}`}</small></dd></div>
        <div><dt>Borrow APY</dt><dd><strong>{borrowRate}</strong><small>Rising with use</small></dd></div>
        <div><dt>Supply APY</dt><dd><strong>{supplyRate}</strong><small>Paid by borrowers</small></dd></div>
      </dl>
    </section>
    {gate && <div className="gmd-lending-gate is-page">{gate}</div>}
    <div className="gmd-lending-grid">
      <section className="gmd-lending-card" aria-labelledby="lending-supplies">
        <header><h3 id="lending-supplies">Your supplies</h3>{account && supplied !== null && supplied > 0n && <span>Balance <b>{usd(supplied)}</b></span>}</header>
        {!account || (account.collateralMicros === 0n && account.suppliedMicros === 0n) ? empty("Nothing supplied yet.") : <div className="gmd-data-table-scroll"><table className="gmd-table gmd-lending-table">
          <thead><tr><th scope="col">Asset</th><th scope="col">Balance</th><th scope="col">APY</th><th scope="col">Collateral</th><th scope="col"><span className="gmd-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {account.collateralMicros > 0n && <tr><th scope="row"><TokenCell token="USTX" /></th><td><b>{formatShares(account.collateralMicros)}</b><small>{usd(collateralValue)}</small></td><td>—</td><td>{yes}</td><td>{actionButton("withdrawCollateral", "Withdraw", "Withdraw USTX")}</td></tr>}
            {account.suppliedMicros > 0n && <tr><th scope="row"><TokenCell token="dUSD" /></th><td><b>{usd(account.suppliedMicros)}</b><small>Lent</small></td><td>{supplyRate}</td><td>No</td><td>{actionButton("withdraw", "Withdraw", "Withdraw dUSD")}</td></tr>}
          </tbody></table></div>}
      </section>
      <section className="gmd-lending-card" aria-labelledby="lending-borrows">
        <header><h3 id="lending-borrows">Your borrows</h3>{account && account.debtMicros > 0n && <span>Balance <b>{usd(account.debtMicros)}</b></span>}</header>
        {!account || account.debtMicros === 0n ? empty("Nothing borrowed yet.") : <div className="gmd-data-table-scroll"><table className="gmd-table gmd-lending-table">
          <thead><tr><th scope="col">Asset</th><th scope="col">Debt</th><th scope="col">APY</th><th scope="col"><span className="gmd-sr-only">Actions</span></th></tr></thead>
          <tbody><tr><th scope="row"><TokenCell token="dUSD" /></th><td><b>{usd(account.debtMicros)}</b><small>{ltv !== null ? `${ltv.toFixed(2)}% of the collateral` : ""}</small></td><td>{borrowRate}</td><td className="gmd-lending-row-actions">{actionButton("borrow", "Borrow", "Borrow more dUSD")}{actionButton("repay", "Repay", "Repay dUSD", true)}</td></tr></tbody>
        </table></div>}
      </section>
      <section className="gmd-lending-card" aria-labelledby="lending-to-supply">
        <header><h3 id="lending-to-supply">Assets to supply</h3></header>
        <div className="gmd-data-table-scroll"><table className="gmd-table gmd-lending-table">
          <thead><tr><th scope="col">Asset</th><th scope="col">Wallet balance</th><th scope="col">APY</th><th scope="col">Can be collateral</th><th scope="col"><span className="gmd-sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr><th scope="row"><TokenCell token="USTX" /></th><td>{account ? <b>{formatShares(account.sharesMicros)}</b> : "—"}</td><td>—</td><td>{yes}</td><td>{actionButton("deposit", "Deposit", "Deposit USTX", true)}</td></tr>
            <tr><th scope="row"><TokenCell token="dUSD" /></th><td>{account ? <b>{usd(account.dollarsMicros)}</b> : "—"}</td><td>{supplyRate}</td><td>No</td><td>{actionButton("lend", "Lend", "Lend dUSD")}</td></tr>
          </tbody></table></div>
      </section>
      <section className="gmd-lending-card" aria-labelledby="lending-to-borrow">
        <header><h3 id="lending-to-borrow">Assets to borrow</h3></header>
        <div className="gmd-data-table-scroll"><table className="gmd-table gmd-lending-table">
          <thead><tr><th scope="col">Asset</th><th scope="col">Available</th><th scope="col">APY</th><th scope="col"><span className="gmd-sr-only">Actions</span></th></tr></thead>
          <tbody><tr><th scope="row"><TokenCell token="dUSD" /></th><td><b>{market ? usd(market.cashMicros) : wait(80)}</b><small>{position ? `You can borrow ${usd(position.borrowableMicros)}` : "In the market"}</small></td><td>{borrowRate}</td><td>{actionButton("borrow", "Borrow", "Borrow dUSD", true)}</td></tr></tbody>
        </table></div>
      </section>
    </div>
    <section className="gmd-lending-market" aria-labelledby="lending-title">
      <header className="gmd-section-heading"><div><h2 id="lending-title">USTX lending market</h2><p>Loans of demo dollars against USTX, valued at the NAV recorded on X Layer.</p></div><span className="gmd-badge">{status}</span></header>
      {readFailure && !market && <p className="gmd-inline-error" role="status">The lending market could not be read right now. <button type="button" className="gmd-text-button" onClick={() => setReload(value => value + 1)}>Try again</button></p>}
      <div className="gmd-fund-grid" aria-busy={!market && !readFailure}>
        <article><span>Available to borrow</span><strong>{market ? usd(market.cashMicros) : wait(92)}</strong><small>Demo dollars in the market</small></article>
        <article><span>Borrowed</span><strong>{market ? usd(market.borrowedMicros) : wait(80)}</strong><small>{market ? `${formatWadPercent(market.utilizationWad)} of ${usd(market.suppliedMicros)} lent` : readFailure ? "Unavailable" : <Skeleton width="70%" />}</small></article>
        <article><span>Borrow rate</span><strong>{market ? formatWadPercent(market.borrowRateWad) : wait(56)}</strong><small>A year, rising with use</small></article>
        <article><span>Lending rate</span><strong>{market ? formatWadPercent(market.supplyRateWad) : wait(56)}</strong><small>A year, paid by borrowers</small></article>
      </div>
      <dl className="gmd-fund-facts gmd-lending-terms">
        <div><dt>Borrow up to</dt><dd>50% of the USTX value</dd></div>
        <div><dt>Collateral priced at</dt><dd>The NAV recorded on X Layer</dd></div>
        <div><dt>Liquidation</dt><dd>When the loan passes 65%</dd></div>
        <div><dt>Liquidator bonus</dt><dd>8%, paid in USTX</dd></div>
        <div><dt>Smallest loan</dt><dd>$10</dd></div>
        <div><dt>View lending market</dt><dd><a className="gmd-inline-tx" href={fundExplorer.address(FUND_DEPLOYMENT.lending)} target="_blank" rel="noreferrer">X Layer Testnet<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
      </dl>
      <p className="gmd-caption">If the NAV falls far enough that a loan passes 65% of its collateral, anyone can repay up to half of it and take USTX worth 8% more, which the fund redeems at the NAV. Demo dollars and USTX have no value.</p>
    </section>
    {open && <div className="gmd-lending-overlay" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className="gmd-lending-dialog" role="dialog" aria-modal="true" aria-labelledby="lending-dialog-title" tabIndex={-1} onKeyDown={onDialogKey}>
        <header><h2 id="lending-dialog-title"><TokenMark token={unit} />{TITLES[action]}</h2><button type="button" className="gmd-lending-close" aria-label="Close" disabled={phase === "working"} onClick={close}><Icon name="close" size={18} /></button></header>
        {phase !== "working" && phase !== "done" && <div className="gmd-segmented gmd-lending-tabs" role="group" aria-label="Action">{PAIRS[action].map(key => <button type="button" key={key} aria-pressed={action === key} onClick={() => choose(key)}>{TABS[key]}</button>)}</div>}
        {body}
      </div>
    </div>}
  </div>;
}

/** Borrow, a page of its own, laid out as Aave's and Venus's dashboards: the wallet's position, what it supplied and borrowed, what it can supply and borrow, then the market's terms. */
export function BorrowScreen() {
  return <>
    <div className="gmd-page-heading"><div><h1>Borrow</h1><p>Post USTX as collateral and borrow demo dollars, or lend them and earn what borrowers pay.</p></div><div className="gmd-page-actions"><Link prefetch={false} className="gmd-pill" href="/products/ustx#investment"><Icon name="wallet" size={15} />Get USTX</Link></div></div>
    <PageGuide />
    <LendingSection />
  </>;
}
