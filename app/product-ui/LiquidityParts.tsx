"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { FUND_WALLET_CHAIN, POOL_ORDER_SECONDS, fundErrorMessage, readChainTime, simulateFundCall, waitForFundReceipt, type FundReceipt, type TransactionCall } from "@/lib/xstocks/fund";
import { Icon } from "./Icons";
import { OkxAppLink } from "./OkxApp";
import { useWalletAccount } from "./WalletAccount";
import { TxLink, sendFromWallet, switchToTestnet, type Provider } from "./WalletInvest";

// What the liquidity panels on Pools share: the wallet gate, the plan of transactions a deposit or a
// withdrawal takes, and the steps list that follows it.

export type StepState = "idle" | "wallet" | "chain" | "done" | "skipped";
export type TxStep<K extends string> = { key: K; label: string; state: StepState; hash?: string };
/**
 * One transaction of a plan: the call (null when it turns out not to be needed), worked out when its
 * turn comes, with the plan's progress so far; and what to read from its receipt.
 */
export type PlanStep<K extends string> = { key: K; label: string; approval: boolean; request: (progress: PlanProgress) => Promise<TransactionCall | null>; read?: (receipt: FundReceipt) => void };
/** How far a plan got: the newest block it saw, the transactions that went through and the last one sent. */
export type PlanProgress = { block: number; hashes: string[]; lastHash: string | null };

const STEP_STATE: Record<StepState, string> = { idle: "Next", wallet: "Confirm in your wallet", chain: "Confirming on X Layer Testnet…", done: "Done", skipped: "Not needed" };

/** A pool order's deadline: ten minutes from the chain's clock or this device's, whichever is later. */
export async function orderDeadline() {
  return Math.max(Math.floor(Date.now() / 1000), await readChainTime().catch(() => 0)) + POOL_ORDER_SECONDS;
}

/**
 * Sends a plan's transactions one after another from the wallet. Each call other than an approval
 * is dry-run first, so a revert shows its reason before the wallet opens. `progress` keeps the
 * newest block and the hashes even when a step fails. Once `signal` aborts (the panel has gone),
 * the wallet is not asked for another step.
 */
export async function runPlan<K extends string>(plan: PlanStep<K>[], options: { provider: Provider; from: string; progress: PlanProgress; mark: (key: K, state: StepState, hash?: string) => void; signal?: AbortSignal }) {
  const { provider, from, progress, mark, signal } = options;
  for (const step of plan) {
    signal?.throwIfAborted();
    const request = await step.request(progress);
    if (!request) { mark(step.key, "skipped"); continue; }
    if (!step.approval) await simulateFundCall(from, request, { minBlock: progress.block });
    signal?.throwIfAborted();
    mark(step.key, "wallet");
    const hash = await sendFromWallet(provider, from, request);
    progress.lastHash = hash;
    mark(step.key, "chain", hash);
    const receipt = await waitForFundReceipt(hash);
    if (receipt.status !== "success") throw new Error(step.approval ? "The approval failed on X Layer Testnet." : "The transaction did not go through on X Layer Testnet.");
    progress.block = Math.max(progress.block, receipt.block);
    progress.hashes.push(hash);
    step.read?.(receipt);
    mark(step.key, "done");
  }
}

/** A signal that aborts when the panel unmounts, for `runPlan`: a plan stops at the next step once its page has gone. */
export function useUnmountSignal() {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return () => controller.current?.signal;
}

export function TxSteps<K extends string>({ steps, listRef }: { steps: TxStep<K>[]; listRef?: Ref<HTMLOListElement> }) {
  return <><ol ref={listRef} tabIndex={-1} className="gmd-tx-steps" aria-live="polite">{steps.map((step, index) => <li key={step.key} className={`is-${step.state === "skipped" ? "done" : step.state}`}>
    <span aria-hidden="true">{step.state === "done" || step.state === "skipped" ? <Icon name="check" size={14} /> : index + 1}</span>
    <div><b>{step.label}</b><small>{STEP_STATE[step.state]}</small>{step.hash && <TxLink hash={step.hash}>View transaction</TxLink>}</div>
  </li>)}</ol><p className="gmd-caption">Keep this page open. Each step takes a few seconds on X Layer Testnet.</p></>;
}

/** What a panel shows until the wallet is installed, connected and on X Layer Testnet; null once it is. */
export function WalletGate({ provider, chain, purpose }: { provider: Provider | null; chain: string | null; purpose: string }) {
  const { address, source, busy, message, connect } = useWalletAccount();
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const connected = source === "wallet" && Boolean(address);
  if (!provider) return <div className="gmd-wallet-gate">
    <p>{purpose} from your own wallet on X Layer Testnet. Install the OKX Wallet extension, or open this page in the OKX app’s browser.</p>
    <div className="gmd-wallet-gate-actions"><OkxAppLink className="gmd-button" /><a className="gmd-button is-secondary" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">Get OKX Wallet <Icon name="external" size={16} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></div>
  </div>;
  if (!connected) return <div className="gmd-wallet-gate">
    <p>Connect OKX Wallet to provide liquidity with USTX and demo dollars, which have no value, and earn the pool’s fees.</p>
    <button type="button" className="gmd-button" disabled={busy} onClick={() => void connect()}><Icon name="wallet" size={17} />{busy ? "Connecting…" : "Connect OKX Wallet"}</button>
    {message && <p className="gmd-caption" role="status">{message}</p>}
  </div>;
  if (chain !== FUND_WALLET_CHAIN.chainId) return <div className="gmd-wallet-gate">
    <p>{chain ? "Your wallet is on another network. The pool is on X Layer Testnet." : "Checking your wallet’s network…"}</p>
    <button type="button" className="gmd-button" disabled={switching || !chain} onClick={() => {
      setSwitching(true); setFailure(null);
      switchToTestnet(provider).catch(error => setFailure(fundErrorMessage(error))).finally(() => setSwitching(false));
    }}>{switching ? "Switching…" : "Switch to X Layer Testnet"}</button>
    {failure && <p className="gmd-inline-error" role="alert">{failure}</p>}
  </div>;
  return null;
}
