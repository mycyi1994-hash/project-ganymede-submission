"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { shortTime, waitLabel } from "@/lib/product-market";
import { parseUsd } from "@/lib/xstocks/wallet";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import {
  FUND_CLAIM_MICROS, FUND_DEPLOYMENT, FUND_MIN_INVESTMENT_MICROS, FUND_WALLET_CHAIN, POOL_ORDER_SECONDS, dollarsFor, fundCalls, fundErrorMessage, fundExplorer, fundFill,
  poolCalls, poolFill, pricePerShare, readChainTime, readFundAccount, routeOrder, simulateFundCall, waitForFundReceipt, withSlippage, type FundAccount, type TransactionCall, type Venue,
} from "@/lib/xstocks/fund";
import { V4_POOL_DEPLOYMENT, formatFeePips, readV4Quote, v4ErrorMessage, v4SwapCalls, v4SwapFill, type V4Quote } from "@/lib/xstocks/v4-liquidity";
import { Icon } from "./Icons";
import GasNotice from "./GasNotice";
import { OkxAppLink } from "./OkxApp";
import { useMarket } from "./MarketProvider";
import { BasketList, useRecordComposition } from "./Basket";
import { useWalletAccount } from "./WalletAccount";

// Investing from the visitor's own wallet on X Layer Testnet: demo dollars (no value) buy USTX
// from the fund contract at the NAV recorded on X Layer, on the USTX/dUSD constant-product pool or
// on the Uniswap v4 pool held at the NAV, whichever gives the most, and the shares land in the
// wallet. Selling works the same way: redeem at the fund or sell in either pool.

export type Provider = NonNullable<Window["ethereum"]>;
type Side = "buy" | "sell";
type Phase = "form" | "review" | "working" | "filled";
type Step = { key: "approve" | "order"; label: string; state: "idle" | "wallet" | "chain" | "done"; hash?: string };
/** Where an order can fill: the fund, the constant-product pool, or the v4 pool once it is pinned. */
type Place = Venue | "v4";
type Filled = { venue: Place; bought: boolean; sharesMicros: bigint; dollarsMicros: bigint; navMicros: bigint | null; navEffectiveAt: string | null; hash: string; block: number };

const VENUE_NAMES: Record<Side, Record<Place, string>> = {
  buy: { fund: "Fund at the NAV", pool: "USTX/dUSD pool", v4: "Uniswap v4 pool" },
  sell: { fund: "Redeem at the NAV", pool: "Sell in the pool", v4: "Sell in the v4 pool" },
};
const ORDER_LABELS: Record<Side, Record<Place, string>> = {
  buy: { fund: "Invest in USTX", pool: "Buy USTX in the pool", v4: "Buy USTX in the v4 pool" },
  sell: { fund: "Redeem USTX", pool: "Sell USTX in the pool", v4: "Sell USTX in the v4 pool" },
};
const REVIEW_HEADINGS: Record<Side, Record<Place, string>> = {
  buy: { fund: "Review investment", pool: "Review purchase", v4: "Review purchase" },
  sell: { fund: "Review redemption", pool: "Review sale", v4: "Review sale" },
};
const PLACES: readonly Place[] = V4_POOL_DEPLOYMENT ? ["fund", "pool", "v4"] : ["fund", "pool"];

/**
 * The v4 pool's quote for this order, from the router's dry run at the panel's block, a moment
 * after the amount stops changing. While the panel reads a newer block, the same order keeps its
 * last quote; null while a new order is quoted or when there is no v4 pool.
 */
function useV4Quote(owner: string, side: Side, amountIn: bigint | null, block: number): { quote: V4Quote | null; pending: boolean } {
  const order = amountIn !== null && amountIn > 0n && owner ? `${owner}:${side}:${amountIn}` : null;
  const key = order === null ? null : `${order}:${block}`;
  const [state, setState] = useState<{ key: string; quote: V4Quote | null } | null>(null);
  useEffect(() => {
    const deployment = V4_POOL_DEPLOYMENT;
    if (!deployment || key === null || amountIn === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      readV4Quote(deployment, side, amountIn, owner, { minBlock: block })
        .then(quote => { if (!cancelled) setState({ key, quote }); })
        .catch(() => { if (!cancelled) setState({ key, quote: null }); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key, owner, side, amountIn, block]);
  const current = state !== null && order !== null && state.key.startsWith(`${order}:`) ? state : null;
  return { quote: current?.quote ?? null, pending: V4_POOL_DEPLOYMENT !== null && key !== null && current === null };
}

const noSubscription = () => () => {};
/** The injected wallet, OKX Wallet first; null on the server and in browsers without one. */
export function useInjectedWallet(): Provider | null {
  return useSyncExternalStore(noSubscription, () => window.okxwallet ?? window.ethereum ?? null, () => null);
}

/** The chain the connected wallet is on, as lower-case hex; null until it is known. */
export function useWalletChain(provider: Provider | null, address: string): string | null {
  const [chain, setChain] = useState<{ owner: string; id: string } | null>(null);
  useEffect(() => {
    if (!provider || !address) return;
    let alive = true;
    const apply = (value: unknown) => { if (alive && typeof value === "string") setChain({ owner: address, id: value.toLowerCase() }); };
    provider.request({ method: "eth_chainId" }).then(apply).catch(() => {});
    provider.on?.("chainChanged", apply);
    return () => { alive = false; provider.removeListener?.("chainChanged", apply); };
  }, [provider, address]);
  return chain?.owner === address ? chain.id : null;
}

export async function switchToTestnet(provider: Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUND_WALLET_CHAIN.chainId }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    const message = String((error as { message?: unknown }).message ?? "");
    if (code !== 4902 && !/unrecognized|not been added|not added|unknown chain/i.test(message)) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [FUND_WALLET_CHAIN] });
  }
}

/** Sends one call from the connected wallet, only while it is on X Layer Testnet. */
export async function sendFromWallet(provider: Provider, from: string, request: TransactionCall): Promise<string> {
  // Checked right before signing, so a network switch between steps cannot send it elsewhere.
  const chain = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (chain !== FUND_WALLET_CHAIN.chainId) throw new Error("Switch your wallet to X Layer Testnet, then try again.");
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from, to: request.to, data: request.data }] });
  if (typeof hash !== "string") throw new Error("The wallet did not return a transaction.");
  return hash;
}

/** Asks the wallet to list a token; wallets that do not support it simply decline. */
function watchToken(provider: Provider, address: string, symbol: string) {
  void provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address, symbol, decimals: 6 } } } as unknown as { method: string; params?: unknown[] }).catch(() => {});
}

export function TxLink({ hash, children = "OKX Explorer" }: { hash: string; children?: ReactNode }) {
  return <a className="gmd-inline-tx" href={fundExplorer.tx(hash)} target="_blank" rel="noreferrer">{children}<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>;
}

export function WalletInvest({ tabs, onUseDemo }: { tabs: ReactNode; onUseDemo: () => void }) {
  const provider = useInjectedWallet();
  const { address, source, busy: connecting, message, connect } = useWalletAccount();
  const connected = source === "wallet" && Boolean(address);
  const chain = useWalletChain(provider, connected ? address : "");
  const onTestnet = chain === FUND_WALLET_CHAIN.chainId;
  const ready = Boolean(provider) && connected && onTestnet;
  const { composition, holdingsHash } = useRecordComposition();
  const { now } = useMarket();

  const [snapshot, setSnapshot] = useState<{ owner: string; account: FundAccount } | null>(null);
  const [readFailure, setReadFailure] = useState<{ owner: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [watermark, setWatermark] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [switchFailure, setSwitchFailure] = useState<string | null>(null);
  const [claim, setClaim] = useState<{ state: "wallet" | "chain" | "failed"; message?: string } | null>(null);
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("1,000");
  // The venue the visitor picked; null follows the best price.
  const [venueChoice, setVenueChoice] = useState<Place | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<Step[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [filled, setFilled] = useState<Filled | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const owner = address;
    readFundAccount(owner, { minBlock: watermark })
      .then(account => { if (!cancelled) { setSnapshot({ owner, account }); setReadFailure(null); } })
      .catch(error => { if (!cancelled) setReadFailure({ owner, message: fundErrorMessage(error) }); });
    return () => { cancelled = true; };
  }, [ready, address, watermark, reload]);
  // Another panel's transaction (a loan, say) changed this wallet: read again from its block.
  useEffect(() => {
    const onOrder = (event: Event) => { const block = (event as CustomEvent<{ block?: number }>).detail?.block; if (typeof block === "number") setWatermark(current => Math.max(current, block)); };
    window.addEventListener(DEMO_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(DEMO_ORDER_EVENT, onOrder);
  }, []);
  // While an order is being chosen, refresh each minute so the NAV and balances stay current.
  useEffect(() => {
    if (!ready || phase !== "form") return;
    const timer = window.setInterval(() => { if (!document.hidden) setReload(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [ready, phase]);

  const account = snapshot?.owner === address ? snapshot.account : null;
  const nav = account?.nav.navMicros ?? null;
  const navAt = account && account.nav.navMicros !== null ? account.nav.effectiveAt : null;
  const dollars = account?.dollarsMicros ?? 0n;
  const held = account?.sharesMicros ?? 0n;
  const usd = side === "buy" ? parseUsd(amount) : null;
  const shares = side === "sell" ? parseShares(amount) : null;
  const problem = !account ? null
    : side === "buy" ? (usd === null ? "Enter an amount in dollars, such as 1,000." : usd < FUND_MIN_INVESTMENT_MICROS ? "The minimum order is $10." : usd > dollars ? "That is more than your demo dollars." : null)
    : (held === 0n ? "This wallet holds no USTX yet." : shares === null || shares === 0n ? "Enter a number of shares, up to six decimals." : shares > held ? "That is more than this wallet holds." : null);
  const amountIn = side === "buy" ? usd : shares;
  // Every venue priced for this order; the pools still trade while the fund waits for a NAV record.
  const priced = account && !problem && amountIn ? routeOrder(side, amountIn, nav, account.pool) : null;
  const v4 = useV4Quote(address, side, priced ? amountIn : null, account?.block ?? 0);
  const route: (Record<Place, bigint | null> & { best: Place | null; count: number }) | null = priced && (() => {
    const outs: Record<Place, bigint | null> = { fund: priced.fund, pool: priced.pool, v4: v4.quote?.amountOut ?? null };
    // The most for the order; a tie goes to the fund, then to the constant-product pool.
    const best = PLACES.reduce<Place | null>((top, at) => outs[at] !== null && (top === null || outs[at]! > outs[top]!) ? at : top, null);
    return { ...outs, best, count: PLACES.filter(at => outs[at] !== null).length };
  })();
  const venue: Place | null = !route ? null : venueChoice && route[venueChoice] !== null ? venueChoice : route.best;
  const quote = route && venue ? route[venue] : null;
  const approved = !account || !venue ? null
    : venue === "v4" ? v4.quote?.allowanceMicros ?? null
    : side === "buy" ? (venue === "fund" ? account.allowanceMicros : account.poolDollarAllowanceMicros) : venue === "pool" ? account.poolShareAllowanceMicros : null;
  const v4Fee = v4.quote?.feePips ?? null;
  const feeText = (at: Place) => at === "pool" ? "0.3% fee" : at === "v4" ? (v4Fee === null ? "fee set by the pool" : `${formatFeePips(v4Fee)} fee`) : "no fee";
  const needsApproval = amountIn !== null && approved !== null && approved < amountIn;
  const claimable = account !== null && account.nextClaimAt * 1000 <= now;
  // Until the read after a transaction lands, the claim it may have made is not shown yet.
  const fresh = account !== null && account.block >= watermark;
  const choose = (next: Side) => { setSide(next); setAmount(next === "buy" ? "1,000" : ""); setVenueChoice(null); setPhase("form"); setFailure(null); };
  /** The price per share an order gets: the NAV at the fund, the average price after the fee and its impact in the pool. */
  const priceOf = (at: Place, out: bigint) => at === "fund" ? nav ?? 0n : side === "buy" ? pricePerShare(amountIn ?? 0n, out) : pricePerShare(out, amountIn ?? 0n);
  const outText = (out: bigint) => side === "buy" ? `${formatShares(out)} USTX` : `${formatUsdMicros(out, 2)} dUSD`;

  async function switchNetwork() {
    if (!provider) return;
    setSwitching(true); setSwitchFailure(null);
    try { await switchToTestnet(provider); } catch (error) { setSwitchFailure(fundErrorMessage(error)); } finally { setSwitching(false); }
  }

  async function claimDollars() {
    if (!provider || !account) return;
    setClaim({ state: "wallet" });
    try {
      const hash = await sendFromWallet(provider, address, fundCalls.claim());
      setClaim({ state: "chain" });
      const receipt = await waitForFundReceipt(hash);
      if (receipt.status !== "success") throw new Error("The claim failed on X Layer Testnet.");
      setWatermark(block => Math.max(block, receipt.block));
      setClaim(null);
    } catch (error) { setClaim({ state: "failed", message: fundErrorMessage(error) }); }
  }

  async function run() {
    if (!provider || !account || quote === null || venue === null || amountIn === null) return;
    const from = address;
    const at = venue;
    const size = amountIn;
    const minimum = withSlippage(quote);
    const v4Calls = V4_POOL_DEPLOYMENT ? v4SwapCalls(V4_POOL_DEPLOYMENT) : null;
    // A pool order carries a deadline, set when it is signed rather than when it was reviewed, and
    // counted from the chain's clock as well as this device's, so a slow device clock cannot expire it.
    const order = async () => {
      if (at === "fund") return side === "buy" ? fundCalls.invest(size, minimum) : fundCalls.redeem(size, minimum);
      const deadline = Math.max(Math.floor(Date.now() / 1000), await readChainTime().catch(() => 0)) + POOL_ORDER_SECONDS;
      if (at === "v4" && v4Calls) return v4Calls.swap(side, size, minimum, deadline);
      return side === "buy" ? poolCalls.buy(size, minimum, deadline) : poolCalls.sell(size, minimum, deadline);
    };
    const approval = at === "v4" && v4Calls ? (side === "buy" ? v4Calls.approveDollars(size) : v4Calls.approveShares(size))
      : side === "buy" ? (at === "fund" ? fundCalls.approve(size) : poolCalls.approveDollars(size)) : poolCalls.approveShares(size);
    const mark = (key: Step["key"], state: Step["state"], hash?: string) => setSteps(current => current.map(step => step.key === key ? { ...step, state, hash: hash ?? step.hash } : step));
    setSteps([...(needsApproval ? [{ key: "approve", label: side === "buy" ? "Approve demo dollars" : "Approve USTX", state: "idle" } as Step] : []), { key: "order", label: ORDER_LABELS[side][at], state: "idle" }]);
    setPhase("working"); setFailure(null);
    let block = Math.max(watermark, account.block);
    try {
      if (needsApproval) {
        mark("approve", "wallet");
        const hash = await sendFromWallet(provider, from, approval);
        mark("approve", "chain", hash);
        const receipt = await waitForFundReceipt(hash);
        if (receipt.status !== "success") throw new Error("The approval failed on X Layer Testnet.");
        block = Math.max(block, receipt.block);
        mark("approve", "done");
      }
      const request = await order();
      await simulateFundCall(from, request, { minBlock: block });
      mark("order", "wallet");
      const hash = await sendFromWallet(provider, from, request);
      mark("order", "chain", hash);
      const receipt = await waitForFundReceipt(hash);
      const fundFilled = receipt.status === "success" && at === "fund" ? fundFill(receipt) : null;
      const poolFilled = receipt.status === "success" && at === "pool" ? poolFill(receipt) : null;
      const v4Filled = receipt.status === "success" && at === "v4" && V4_POOL_DEPLOYMENT ? v4SwapFill(receipt, V4_POOL_DEPLOYMENT, from) : null;
      const traded = poolFilled ?? v4Filled;
      const fill: Filled | null = fundFilled
        ? { venue: "fund", bought: fundFilled.side === "invest", sharesMicros: fundFilled.sharesMicros, dollarsMicros: fundFilled.dollarsMicros, navMicros: fundFilled.navMicros, navEffectiveAt: fundFilled.navEffectiveAt, hash, block: receipt.block }
        : traded
          ? { venue: at, bought: traded.side === "buy", sharesMicros: traded.sharesMicros, dollarsMicros: traded.dollarsMicros, navMicros: null, navEffectiveAt: null, hash, block: receipt.block }
          : null;
      if (!fill) throw new Error("The order did not fill on X Layer Testnet. See the transaction on the OKX explorer.");
      mark("order", "done");
      setFilled(fill);
      setPhase("filled");
      setAmount(side === "buy" ? "1,000" : "");
      setWatermark(current => Math.max(current, receipt.block));
      window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: receipt.block } }));
    } catch (error) {
      setFailure(at === "v4" ? v4ErrorMessage(error) : fundErrorMessage(error));
      setPhase("review");
      setWatermark(current => Math.max(current, block));
      setReload(value => value + 1);
    }
  }

  const heading = phase === "filled" ? "Order filled" : phase === "working" ? "Confirm in your wallet" : phase === "review" && venue ? REVIEW_HEADINGS[side][venue] : "Invest in USTX";
  const head = <div className="gmd-order-heading"><h2 id="invest-title">{heading}</h2><Icon name="wallet" /></div>;

  if (!provider) return <>{head}{tabs}<div className="gmd-wallet-gate">
    <p>Invest from your own wallet on X Layer Testnet. Install the OKX Wallet extension, or open this page in the OKX app’s browser.</p>
    <div className="gmd-wallet-gate-actions"><OkxAppLink className="gmd-button" /><a className="gmd-button is-secondary" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">Get OKX Wallet <Icon name="external" size={16} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></div>
    <button type="button" className="gmd-text-button" onClick={onUseDemo}>Try it with a demo balance instead</button>
  </div></>;
  if (!connected) return <>{head}{tabs}<div className="gmd-wallet-gate">
    <p>Connect OKX Wallet to invest on X Layer Testnet. You pay with demo dollars, which have no value, and your USTX goes straight to your wallet.</p>
    <button type="button" className="gmd-button" disabled={connecting} onClick={() => void connect()}><Icon name="wallet" size={17} />{connecting ? "Connecting…" : "Connect OKX Wallet"}</button>
    {message && <p className="gmd-caption" role="status">{message}</p>}
  </div></>;
  if (!onTestnet) return <>{head}{tabs}<div className="gmd-wallet-gate">
    <p>{chain ? "Your wallet is on another network. USTX lives on X Layer Testnet." : "Checking your wallet’s network…"}</p>
    <button type="button" className="gmd-button" disabled={switching || !chain} onClick={() => void switchNetwork()}>{switching ? "Switching…" : "Switch to X Layer Testnet"}</button>
    {switchFailure && <p className="gmd-inline-error" role="alert">{switchFailure}</p>}
  </div></>;
  if (!account) return <>{head}{tabs}{readFailure?.owner === address
    ? <div className="gmd-inline-error" role="alert">{readFailure.message} <button type="button" className="gmd-text-button" onClick={() => setReload(value => value + 1)}>Try again</button></div>
    : <p className="gmd-caption" role="status">Reading your wallet on X Layer Testnet…</p>}</>;

  if (phase === "filled" && filled) {
    const fill = filled;
    const { bought, hash, block } = fill;
    return <>{head}<div className="gmd-order-review" role="status">
      <span>{bought ? "You bought" : fill.venue === "fund" ? "You redeemed" : "You sold"}</span>
      <strong>{formatShares(fill.sharesMicros)}</strong><span>USTX</span>
      <dl className="gmd-facts">
        <div><dt>{bought ? "Paid" : "Received"}</dt><dd>{formatUsdMicros(fill.dollarsMicros, 2)} dUSD</dd></div>
        {fill.navMicros !== null && fill.navEffectiveAt !== null ? <>
          <div><dt>NAV per share</dt><dd>{formatUsdMicros(fill.navMicros, 4)}</dd></div>
          <div><dt>Priced by</dt><dd>OKX OnchainOS</dd></div>
          <div><dt>Recorded on X Layer</dt><dd>{shortTime(fill.navEffectiveAt)}</dd></div>
        </> : <>
          <div><dt>Price per share</dt><dd>{formatUsdMicros(pricePerShare(fill.dollarsMicros, fill.sharesMicros), 4)}</dd></div>
          <div><dt>Traded on</dt><dd>{fill.venue === "v4" ? "Uniswap v4 pool, held at the NAV" : "USTX/dUSD pool, 0.3% fee"}</dd></div>
        </>}
        <div><dt>USTX in your wallet</dt><dd>{account.block >= block ? formatShares(account.sharesMicros) : "Updating…"}</dd></div>
        <div><dt>Transaction</dt><dd><TxLink hash={hash} /></dd></div>
      </dl>
      {composition && <div className="gmd-order-basket">
        <h3>{bought ? "Added to your basket" : "Taken out of your basket"}</h3>
        <BasketList composition={composition} sharesMicros={fill.sharesMicros} label={bought ? "Tokens this order added" : "Tokens this order removed"} />
        <p className="gmd-caption">{holdingsHash && fill.navMicros !== null && composition.navPerShareMicros === fill.navMicros.toString() ? "At the OKX OnchainOS prices in the record your order filled at." : "Token amounts per share are fixed until the next rebalance; values use the latest OKX OnchainOS prices."}</p>
      </div>}
      {bought && <button type="button" className="gmd-text-button" onClick={() => watchToken(provider, FUND_DEPLOYMENT.fund, "USTX")}>Show USTX in my wallet</button>}
      <Link prefetch={false} className="gmd-button" href="/portfolio">View portfolio <Icon name="arrow" size={16} /></Link>
      {bought && <Link prefetch={false} className="gmd-text-button" href="/pools#provide">Earn the pool’s fees with your USTX</Link>}
      <button type="button" className="gmd-text-button" onClick={() => { setFilled(null); setPhase("form"); }}>Place another order</button>
    </div></>;
  }

  if (phase === "working") return <>{head}<ol className="gmd-tx-steps" aria-live="polite">{steps.map((step, index) => <li key={step.key} className={`is-${step.state}`}>
    <span aria-hidden="true">{step.state === "done" ? <Icon name="check" size={14} /> : index + 1}</span>
    <div><b>{step.label}</b><small>{({ idle: "Next", wallet: "Confirm in your wallet", chain: "Confirming on X Layer Testnet…", done: "Done" })[step.state]}</small>{step.hash && <TxLink hash={step.hash}>View transaction</TxLink>}</div>
  </li>)}</ol><p className="gmd-caption">Keep this page open. Each step takes a few seconds on X Layer Testnet.</p></>;

  if (phase === "review" && quote !== null && venue !== null && amountIn !== null) return <>{head}<div className="gmd-order-review">
    <span>{side === "buy" ? "You pay" : venue === "fund" ? "You redeem" : "You sell"}</span>
    <strong>{side === "buy" ? formatUsdMicros(amountIn, 2) : formatShares(amountIn)}</strong><span>{side === "buy" ? "demo dollars (dUSD)" : "USTX"}</span>
    <dl className="gmd-facts">
      <div><dt>Venue</dt><dd>{VENUE_NAMES[side][venue]}{route?.best === venue && route.count > 1 ? " · best price" : ""}</dd></div>
      {venue === "fund" && nav !== null ? <>
        <div><dt>NAV per share</dt><dd>{formatUsdMicros(nav, 4)}{navAt ? ` · ${shortTime(navAt)}` : ""}</dd></div>
        <div><dt>Priced by</dt><dd>OKX OnchainOS</dd></div>
      </> : <div><dt>Price per share</dt><dd>{formatUsdMicros(priceOf(venue, quote), 4)} with the {feeText(venue)}</dd></div>}
      <div><dt>You receive</dt><dd>{outText(quote)}</dd></div>
      <div><dt>Minimum accepted</dt><dd>{outText(withSlippage(quote))}</dd></div>
      <div><dt>Network</dt><dd>X Layer Testnet, fee in test OKB</dd></div>
      <div><dt>Wallet confirmations</dt><dd>{needsApproval ? `2: approve, then ${side === "buy" ? (venue === "fund" ? "invest" : "buy") : "sell"}` : "1"}</dd></div>
    </dl>
    {failure && <p className="gmd-inline-error" role="alert">{failure}</p>}
    <button type="button" className="gmd-button" onClick={() => void run()}>Confirm in wallet <Icon name="arrow" size={17} /></button>
    <button type="button" className="gmd-text-button" onClick={() => { setPhase("form"); setFailure(null); }}>Edit order</button>
    <p className="gmd-caption">{venue === "fund"
      ? "The order fills at the NAV recorded on X Layer when it is mined. If the NAV moves more than 1% first, it does not fill."
      : venue === "v4"
        ? "The order fills in the v4 pool when it is mined; the pool moves to a new NAV record before trading. If the price moves more than 1% first, or 10 minutes pass, it does not fill."
        : "The order fills at the pool price when it is mined. If the price moves more than 1% first, or 10 minutes pass, it does not fill."}</p>
  </div></>;

  const unavailable = account.nav.navMicros === null ? account.nav.reason : null;
  return <>{head}{tabs}
    <div className="gmd-wallet-balances">
      <div><span>Demo dollars</span><b>{formatUsdMicros(dollars, 2)}</b><small>dUSD, no value</small></div>
      <div><span>USTX in wallet</span><b>{formatShares(held)}</b><small>{nav !== null && held > 0n ? formatUsdRounded(dollarsFor(held, nav)) : "X Layer Testnet"}</small></div>
    </div>
    <div className="gmd-wallet-claim">{claim?.state === "wallet" ? <span role="status">Confirm in your wallet…</span>
      : claim?.state === "chain" ? <span role="status">Sending demo dollars on X Layer Testnet…</span>
      : claimable ? <button type="button" className="gmd-small-button" disabled={!fresh} onClick={() => void claimDollars()}>Get {formatUsdRounded(FUND_CLAIM_MICROS)} demo dollars</button>
      : <span>More demo dollars in {waitLabel(account.nextClaimAt, now)}</span>}
      {claim?.state === "failed" && <p className="gmd-inline-error" role="alert">{claim.message}</p>}</div>
    <GasNotice address={address} gasWei={account.gasWei} onFunded={() => setReload(value => value + 1)} />
    {unavailable && <p className="gmd-inline-error" role="status">{unavailable}</p>}
    <div className="gmd-segmented" role="group" aria-label="Order type">
      <button type="button" aria-pressed={side === "buy"} onClick={() => choose("buy")}>Buy</button>
      <button type="button" aria-pressed={side === "sell"} onClick={() => choose("sell")}>Sell</button>
    </div>
    <div className="gmd-order-input">
      <label htmlFor="wallet-amount">{side === "buy" ? "You pay" : "Shares to sell"}</label>
      <div><input id="wallet-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={event => { setAmount(event.target.value); setFailure(null); }} aria-invalid={Boolean(problem)} aria-describedby="wallet-help" /><span>{side === "buy" ? "dUSD" : "USTX"}</span></div>
      <p id="wallet-help">{problem ?? (side === "buy" ? `In your wallet: ${formatUsdMicros(dollars, 2)} dUSD` : `In your wallet: ${formatShares(held)} USTX`)}</p>
    </div>
    <div className="gmd-order-presets" aria-label={side === "buy" ? "Investment amounts" : "Amounts to sell"}>
      {side === "buy"
        ? [["$250", "250"], ["$1,000", "1,000"], ["Max", (dollars / 1_000_000n).toLocaleString("en-US")]].map(([label, value]) => <button type="button" key={label} aria-pressed={amount === value} onClick={() => setAmount(value)}>{label}</button>)
        : [["Half", held / 2n], ["All", held]].map(([label, value]) => <button type="button" key={String(label)} disabled={held === 0n} aria-pressed={amount === formatShares(value as bigint).replace(/,/g, "")} onClick={() => setAmount(formatShares(value as bigint).replace(/,/g, ""))}>{String(label)}</button>)}
    </div>
    <div className="gmd-order-estimate"><span>{side === "buy" ? "Estimated shares" : "Estimated proceeds"}</span><strong>{quote === null ? "—" : outText(quote)}</strong></div>
    {route && <fieldset className="gmd-route">
      <legend>Where the order fills</legend>
      {PLACES.map(at => {
        const out = route[at];
        return <label key={at} className={venue === at ? "is-selected" : undefined}>
          <input type="radio" name="wallet-venue" value={at} checked={venue === at} disabled={out === null} onChange={() => setVenueChoice(at)} />
          <span className="gmd-route-name"><b>{VENUE_NAMES[side][at]}</b><small>{out === null
            ? (at === "fund" ? (account.nav.navMicros === null ? "Waiting for the next NAV record" : "Unavailable") : at === "v4" ? (v4.pending ? "Getting a quote…" : v4.quote?.reason ?? "Unavailable") : "No liquidity")
            : `${formatUsdMicros(priceOf(at, out), 2)} per share, ${feeText(at)}`}</small></span>
          <span className="gmd-route-out">{out === null ? "—" : outText(out)}{route.best === at && route.count > 1 && <em>Best price</em>}</span>
        </label>;
      })}
    </fieldset>}
    <dl className="gmd-facts">
      <div><dt>NAV per share</dt><dd>{nav === null ? "—" : formatUsdMicros(nav, 4)}</dd></div>
      <div><dt>Recorded on X Layer</dt><dd>{navAt ? shortTime(navAt) : "—"}</dd></div>
      <div><dt>Shares issued by</dt><dd><a className="gmd-inline-tx" href={fundExplorer.address(FUND_DEPLOYMENT.fund)} target="_blank" rel="noreferrer">USTX contract<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></dd></div>
    </dl>
    <button type="button" className="gmd-button" disabled={Boolean(problem) || quote === null} onClick={() => { setFailure(null); setPhase("review"); }}>Review order <Icon name="arrow" size={17} /></button>
    <p className="gmd-caption">On X Layer Testnet with demo dollars, which have no value. Network fees are paid in test OKB.</p>
  </>;
}
