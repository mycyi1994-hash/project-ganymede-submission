"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { parseUsd } from "@/lib/xstocks/wallet";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import {
  FUND_CLAIM_MICROS, FUND_DEPLOYMENT, FUND_MIN_INVESTMENT_MICROS, FUND_WALLET_CHAIN, POOL_ORDER_SECONDS, dollarsFor, fundCalls, fundErrorMessage, fundExplorer, fundFill,
  poolCalls, poolFill, pricePerShare, readChainTime, readFundAccount, routeOrder, simulateFundCall, waitForFundReceipt, withSlippage, type FundAccount, type TransactionCall, type Venue,
} from "@/lib/xstocks/fund";
import { Icon } from "./Icons";
import { useMarket } from "./MarketProvider";
import { BasketList, useRecordComposition } from "./Basket";
import { useWalletAccount } from "./WalletAccount";

// Investing from the visitor's own wallet on X Layer Testnet: demo dollars (no value) buy USTX
// either from the fund contract at the NAV recorded on X Layer or on the USTX/dUSD pool at its
// price, whichever gives more, and the shares land in the wallet. Selling works the same way:
// redeem at the fund or sell in the pool.

export type Provider = NonNullable<Window["ethereum"]>;
type Side = "buy" | "sell";
type Phase = "form" | "review" | "working" | "filled";
type Step = { key: "approve" | "order"; label: string; state: "idle" | "wallet" | "chain" | "done"; hash?: string };
type Filled = { venue: Venue; bought: boolean; sharesMicros: bigint; dollarsMicros: bigint; navMicros: bigint | null; navEffectiveAt: string | null; hash: string; block: number };

const VENUE_NAMES: Record<Side, Record<Venue, string>> = {
  buy: { fund: "Fund at the NAV", pool: "USTX/dUSD pool" },
  sell: { fund: "Redeem at the NAV", pool: "Sell in the pool" },
};
const ORDER_LABELS: Record<Side, Record<Venue, string>> = {
  buy: { fund: "Invest in USTX", pool: "Buy USTX in the pool" },
  sell: { fund: "Redeem USTX", pool: "Sell USTX in the pool" },
};
const REVIEW_HEADINGS: Record<Side, Record<Venue, string>> = {
  buy: { fund: "Review investment", pool: "Review purchase" },
  sell: { fund: "Review redemption", pool: "Review sale" },
};

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

function waitLabel(seconds: number, now: number) {
  const left = Math.max(60, seconds - Math.floor(now / 1000));
  const hours = Math.floor(left / 3600);
  const minutes = Math.ceil((left % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  // The venue the visitor picked; null follows the better price.
  const [venueChoice, setVenueChoice] = useState<Venue | null>(null);
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
  // Both venues priced for this order; the pool still trades while the fund waits for a NAV record.
  const route = account && !problem && amountIn ? routeOrder(side, amountIn, nav, account.pool) : null;
  const venue: Venue | null = !route ? null : venueChoice && route[venueChoice] !== null ? venueChoice : route.best;
  const quote = route && venue ? route[venue] : null;
  const approved = !account || !venue ? null : side === "buy" ? (venue === "fund" ? account.allowanceMicros : account.poolDollarAllowanceMicros) : venue === "pool" ? account.poolShareAllowanceMicros : null;
  const needsApproval = amountIn !== null && approved !== null && approved < amountIn;
  const claimable = account !== null && account.nextClaimAt * 1000 <= now;
  const choose = (next: Side) => { setSide(next); setAmount(next === "buy" ? "1,000" : ""); setVenueChoice(null); setPhase("form"); setFailure(null); };
  /** The price per share an order gets: the NAV at the fund, the average price after the fee and its impact in the pool. */
  const priceOf = (at: Venue, out: bigint) => at === "fund" ? nav ?? 0n : side === "buy" ? pricePerShare(amountIn ?? 0n, out) : pricePerShare(out, amountIn ?? 0n);
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
    // A pool order carries a deadline, set when it is signed rather than when it was reviewed, and
    // counted from the chain's clock as well as this device's, so a slow device clock cannot expire it.
    const order = async () => {
      if (at === "fund") return side === "buy" ? fundCalls.invest(size, minimum) : fundCalls.redeem(size, minimum);
      const deadline = Math.max(Math.floor(Date.now() / 1000), await readChainTime().catch(() => 0)) + POOL_ORDER_SECONDS;
      return side === "buy" ? poolCalls.buy(size, minimum, deadline) : poolCalls.sell(size, minimum, deadline);
    };
    const approval = side === "buy" ? (at === "fund" ? fundCalls.approve(size) : poolCalls.approveDollars(size)) : poolCalls.approveShares(size);
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
      const fill: Filled | null = fundFilled
        ? { venue: "fund", bought: fundFilled.side === "invest", sharesMicros: fundFilled.sharesMicros, dollarsMicros: fundFilled.dollarsMicros, navMicros: fundFilled.navMicros, navEffectiveAt: fundFilled.navEffectiveAt, hash, block: receipt.block }
        : poolFilled
          ? { venue: "pool", bought: poolFilled.side === "buy", sharesMicros: poolFilled.sharesMicros, dollarsMicros: poolFilled.dollarsMicros, navMicros: null, navEffectiveAt: null, hash, block: receipt.block }
          : null;
      if (!fill) throw new Error("The order did not fill on X Layer Testnet. See the transaction on the OKX explorer.");
      mark("order", "done");
      setFilled(fill);
      setPhase("filled");
      setAmount(side === "buy" ? "1,000" : "");
      setWatermark(current => Math.max(current, receipt.block));
      window.dispatchEvent(new CustomEvent(DEMO_ORDER_EVENT, { detail: { block: receipt.block } }));
    } catch (error) {
      setFailure(fundErrorMessage(error));
      setPhase("review");
      setWatermark(current => Math.max(current, block));
      setReload(value => value + 1);
    }
  }

  const heading = phase === "filled" ? "Order filled" : phase === "working" ? "Confirm in your wallet" : phase === "review" && venue ? REVIEW_HEADINGS[side][venue] : "Invest in USTX";
  const head = <div className="gmd-order-heading"><h2 id="invest-title">{heading}</h2><Icon name="wallet" /></div>;

  if (!provider) return <>{head}{tabs}<div className="gmd-wallet-gate">
    <p>Invest from your own wallet on X Layer Testnet. Install the OKX Wallet extension, or open this page in the OKX app’s browser.</p>
    <a className="gmd-button" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">Get OKX Wallet <Icon name="external" size={16} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>
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
          <div><dt>Traded on</dt><dd>USTX/dUSD pool, 0.3% fee</dd></div>
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
      <div><dt>Venue</dt><dd>{VENUE_NAMES[side][venue]}{route?.best === venue && route.fund !== null && route.pool !== null ? " · best price" : ""}</dd></div>
      {venue === "fund" && nav !== null ? <>
        <div><dt>NAV per share</dt><dd>{formatUsdMicros(nav, 4)}{navAt ? ` · ${shortTime(navAt)}` : ""}</dd></div>
        <div><dt>Priced by</dt><dd>OKX OnchainOS</dd></div>
      </> : <div><dt>Price per share</dt><dd>{formatUsdMicros(priceOf("pool", quote), 4)} with the 0.3% fee</dd></div>}
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
      : claimable ? <button type="button" className="gmd-small-button" onClick={() => void claimDollars()}>Get {formatUsdRounded(FUND_CLAIM_MICROS)} demo dollars</button>
      : <span>More demo dollars in {waitLabel(account.nextClaimAt, now)}</span>}
      {claim?.state === "failed" && <p className="gmd-inline-error" role="alert">{claim.message}</p>}</div>
    {account.gasWei === 0n && <p className="gmd-wallet-gas" role="status"><Icon name="info" size={16} /><span>You need test OKB to pay network fees. <a href={FUND_DEPLOYMENT.faucetUrl} target="_blank" rel="noreferrer">Get test OKB<span className="gmd-sr-only"> (opens in a new tab)</span></a></span></p>}
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
      {(["fund", "pool"] as const).map(at => {
        const out = route[at];
        return <label key={at} className={venue === at ? "is-selected" : undefined}>
          <input type="radio" name="wallet-venue" value={at} checked={venue === at} disabled={out === null} onChange={() => setVenueChoice(at)} />
          <span className="gmd-route-name"><b>{VENUE_NAMES[side][at]}</b><small>{out === null
            ? (at === "fund" ? (account.nav.navMicros === null ? "Waiting for the next NAV record" : "Unavailable") : "No liquidity")
            : `${formatUsdMicros(priceOf(at, out), 2)} per share${at === "pool" ? ", 0.3% fee" : ", no fee"}`}</small></span>
          <span className="gmd-route-out">{out === null ? "—" : outText(out)}{route.best === at && route.fund !== null && route.pool !== null && <em>Best price</em>}</span>
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
