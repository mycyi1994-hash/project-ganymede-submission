"use client";

import { useEffect, useRef, useState } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import { parseUsd } from "@/lib/xstocks/wallet";
import { FUND_DEPLOYMENT, FUND_WALLET_CHAIN, fundExplorer, simulateFundCall, waitForFundReceipt, type TransactionCall } from "@/lib/xstocks/fund";
import {
  LENDING_ALL, LENDING_TERMS, formatWadPercent, lendingCalls, lendingErrorMessage, lendingFill, lendingPosition, readLending,
  type LendingAccount, type LendingAction, type LendingMarket,
} from "@/lib/xstocks/lending";
import { Icon } from "./Icons";
import { useWalletAccount } from "./WalletAccount";
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
const DONE: Record<LendingAction, string> = {
  deposit: "You deposited", borrow: "You borrowed", repay: "You repaid", withdrawCollateral: "You withdrew", lend: "You lent", withdraw: "You withdrew",
};

const min = (a: bigint, b: bigint) => (a < b ? a : b);
/** Six-decimal micros as plain input text: 1250.5, never 1,250.500000. */
const plain = (micros: bigint) => {
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${micros / 1_000_000n}.${fraction}` : `${micros / 1_000_000n}`;
};

export function LendingSection() {
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
    : action === "deposit" && size > account.sharesMicros ? (account.sharesMicros === 0n ? "This wallet holds no USTX yet. Buy some in the order panel first." : "That is more USTX than this wallet holds.")
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
  const status = !market ? "Loading…" : market.paused ? "Paused" : "Live on X Layer Testnet";

  let wallet;
  if (!provider) {
    wallet = <p>Borrow from your own wallet on X Layer Testnet. Install the OKX Wallet extension, or open this page in the OKX app’s browser. <a className="gmd-inline-link" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">Get OKX Wallet <Icon name="external" size={14} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></p>;
  } else if (!connected) {
    wallet = <><p>Connect OKX Wallet to deposit USTX, borrow against it, or lend demo dollars.</p>
      <button type="button" className="gmd-button" disabled={connecting} onClick={() => void connect()}><Icon name="wallet" size={17} />{connecting ? "Connecting…" : "Connect OKX Wallet"}</button>
      {message && <p className="gmd-caption" role="status">{message}</p>}</>;
  } else if (!onTestnet) {
    wallet = <><p>{chain ? "Your wallet is on another network. The market is on X Layer Testnet." : "Checking your wallet’s network…"}</p>
      <button type="button" className="gmd-button" disabled={switching || !chain} onClick={() => { setSwitching(true); switchToTestnet(provider).catch(() => {}).finally(() => setSwitching(false)); }}>{switching ? "Switching…" : "Switch to X Layer Testnet"}</button></>;
  } else if (!account) {
    wallet = <p className="gmd-caption" role="status">{readFailure ?? "Reading your wallet on X Layer Testnet…"}</p>;
  } else if (phase === "working") {
    wallet = <><ol ref={stepsRef} tabIndex={-1} className="gmd-tx-steps" aria-live="polite">{steps.map((step, index) => <li key={step.key} className={`is-${step.state}`}>
      <span aria-hidden="true">{step.state === "done" ? <Icon name="check" size={14} /> : index + 1}</span>
      <div><b>{step.label}</b><small>{({ idle: "Next", wallet: "Confirm in your wallet", chain: "Confirming on X Layer Testnet…", done: "Done" })[step.state]}</small>{step.hash && <TxLink hash={step.hash}>View transaction</TxLink>}</div>
    </li>)}</ol><p className="gmd-caption">Keep this page open. Each step takes a few seconds on X Layer Testnet.</p></>;
  } else {
    const unit = shares ? "USTX" : "dUSD";
    wallet = <>
      {!fresh && <p className="gmd-caption" role="status">Updating your position from X Layer Testnet…</p>}
      <dl className={`gmd-facts${fresh ? "" : " is-stale"}`}>
        <div><dt>USTX deposited</dt><dd>{formatShares(account.collateralMicros)}{position && account.collateralMicros > 0n ? ` · ${usd(position.valueMicros)}` : ""}</dd></div>
        <div><dt>Borrowed</dt><dd>{usd(account.debtMicros)}</dd></div>
        <div><dt>Borrow limit</dt><dd>{position ? `${usd(position.borrowLimitMicros)} · ${usd(position.borrowableMicros)} available` : "—"}</dd></div>
        <div><dt>Loan to value</dt><dd>{position && account.debtMicros > 0n ? `${formatWadPercent(position.loanToValueWad)}, liquidated above 65%${position.liquidationNavMicros !== null ? ` (NAV ${formatUsdMicros(position.liquidationNavMicros, 2)})` : ""}` : "No loan"}</dd></div>
        <div><dt>Lent</dt><dd>{usd(account.suppliedMicros)}{account.suppliedMicros > 0n && market ? ` at ${formatWadPercent(market.supplyRateWad)} a year` : ""}</dd></div>
        <div><dt>In your wallet</dt><dd>{formatShares(account.sharesMicros)} USTX · {usd(account.dollarsMicros)}</dd></div>
      </dl>
      {phase === "done" && done && <p ref={doneRef} tabIndex={-1} className="gmd-lending-done" role="status"><Icon name="check" size={16} /><span>{DONE[done.action]} {inShares(done.action) ? `${formatShares(done.micros)} USTX` : usd(done.micros)}. <TxLink hash={done.hash} /></span></p>}
      {account.gasWei === 0n && <p className="gmd-wallet-gas" role="status"><Icon name="info" size={16} /><span>You need test OKB to pay network fees. <a href={FUND_DEPLOYMENT.faucetUrl} target="_blank" rel="noreferrer">Get test OKB<span className="gmd-sr-only"> (opens in a new tab)</span></a></span></p>}
      <div className="gmd-lending-actions" role="group" aria-label="Lending action">
        {ACTIONS.map(item => <button type="button" key={item.key} aria-pressed={action === item.key} onClick={() => choose(item.key)}>{item.label}</button>)}
      </div>
      <div className="gmd-order-input">
        <label htmlFor="lending-amount">{ACTIONS.find(item => item.key === action)!.verb}</label>
        <div><input id="lending-amount" inputMode="decimal" autoComplete="off" value={amount} placeholder="0" onChange={event => { setAmount(event.target.value); setFailure(null); if (phase === "done") setPhase("form"); }} aria-invalid={Boolean(amount) && Boolean(problem)} aria-describedby="lending-help" /><span>{unit}</span></div>
        <p id="lending-help">{amount && problem ? problem : !fresh ? "Updating…" : max === null ? "—" : `Up to ${shares ? `${formatShares(max)} USTX` : usd(max)}`}{fresh && max !== null && max > 0n && <> · <button type="button" className="gmd-lending-max" onClick={() => setAmount(plain(max))}>Max</button></>}</p>
      </div>
      {after && <p className="gmd-caption">After this: {action === "lend" || action === "withdraw" ? `${usd(after.lent)} lent` : `${formatShares(after.collateral)} USTX deposited, ${usd(after.debt)} borrowed${after.next && after.debt > 0n ? `, loan to value ${formatWadPercent(after.next.loanToValueWad)}` : ""}`}{needsApproval ? ". Two wallet confirmations: approve, then send." : "."}</p>}
      {failure && <p ref={failureRef} tabIndex={-1} className="gmd-inline-error" role="alert">{failure}</p>}
      <button type="button" className="gmd-button" disabled={Boolean(problem)} onClick={() => void run()}>{ACTIONS.find(item => item.key === action)!.verb} <Icon name="arrow" size={17} /></button>
    </>;
  }

  return <section id="borrow" className="gmd-fund gmd-lending" aria-labelledby="lending-title">
    <header className="gmd-section-heading"><div><h2 id="lending-title">Borrow against USTX</h2><p>Post USTX as collateral and borrow demo dollars, or lend them and earn what borrowers pay.</p></div><span className="gmd-badge">{status}</span></header>
    {readFailure && !market && <p className="gmd-inline-error" role="status">The lending market could not be read right now. <button type="button" className="gmd-text-button" onClick={() => setReload(value => value + 1)}>Try again</button></p>}
    <div className="gmd-fund-grid">
      <article><span>Available to borrow</span><strong>{market ? usd(market.cashMicros) : "—"}</strong><small>Demo dollars in the market</small></article>
      <article><span>Borrowed</span><strong>{market ? usd(market.borrowedMicros) : "—"}</strong><small>{market ? `${formatWadPercent(market.utilizationWad)} of ${usd(market.suppliedMicros)} lent` : "Loading…"}</small></article>
      <article><span>Borrow rate</span><strong>{market ? formatWadPercent(market.borrowRateWad) : "—"}</strong><small>A year, rising with use</small></article>
      <article><span>Lending rate</span><strong>{market ? formatWadPercent(market.supplyRateWad) : "—"}</strong><small>A year, paid by borrowers</small></article>
    </div>
    <div className="gmd-lending-body">
      <dl className="gmd-fund-facts gmd-lending-terms">
        <div><dt>Borrow up to</dt><dd>50% of the USTX value</dd></div>
        <div><dt>Collateral priced at</dt><dd>The NAV recorded on X Layer</dd></div>
        <div><dt>Liquidation</dt><dd>When the loan passes 65%</dd></div>
        <div><dt>Liquidator bonus</dt><dd>8%, paid in USTX</dd></div>
        <div><dt>Smallest loan</dt><dd>$10</dd></div>
        <div><dt>Market contract</dt><dd><a className="gmd-inline-tx" href={fundExplorer.address(FUND_DEPLOYMENT.lending)} target="_blank" rel="noreferrer">X Layer Testnet<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
      </dl>
      <div className="gmd-lending-panel"><h3>Your position</h3>{wallet}</div>
    </div>
    <p className="gmd-caption">If the NAV falls far enough that a loan passes 65% of its collateral, anyone can repay up to half of it and take USTX worth 8% more, which the fund redeems at the NAV. Demo dollars and USTX have no value.</p>
  </section>;
}
