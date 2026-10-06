import {
  FUND_DEPLOYMENT, FUND_SELECTORS, addressWord, atBlock, call, fundErrorMessage, fundRpc, hexBlock, isRevert, quantity, readBlock, revertData, simulateFundCall, word, words,
  type FundReceipt, type Rpc, type TransactionCall,
} from "./fund";

// The USTX/dUSD pool on Uniswap v4 (contracts/GanymedeRwaLiquidityHook.sol). Its hook holds all of
// the pool's liquidity for depositors, in ranges it moves to each NAV record, charges a swap fee
// that rises from 0.30% to 1.00% as the record ages, and issues its own LP token. A deposit waits
// for the next NAV record, which turns it into LP tokens at that NAV; until then it can be
// cancelled. Withdrawals pay out at once, with any NAV. It runs on X Layer Testnet, deployed and
// seeded by `npm run deploy:v4` with the user's approval; V4_POOL_DEPLOYMENT pins that recorded
// deployment, and onchain/test/AppV4Client.test.ts checks the pin against the record. Selectors are
// pinned and tied to the compiled hook in onchain/test/AppFundClient.test.ts. Demo dollars and USTX
// have no value.

export type V4Deployment = {
  poolManager: string;
  hook: string;
  router: string;
  /** The tokens: USTX (the fund) and demo dollars. The lower address is the pool's currency0. */
  asset: string;
  dollar: string;
  assetIsCurrency0: boolean;
  /** keccak256 of the pool key: the pool manager's Swap events carry it as their first topic. */
  poolId: string;
  /** Where the pool manager keeps this pool's slot0: keccak256(poolId, 6), read with extsload. */
  stateSlot: string;
};

/** The pool on X Layer Testnet, as recorded in onchain/deployments/xlayer-testnet.json. */
export const V4_POOL_DEPLOYMENT: V4Deployment | null = {
  poolManager: "0xe83eee508ce92832488dd9f574ad329a1203641c",
  hook: "0x96a78af00ef351f294f2ccc05adf09b119f968c0",
  router: "0xbd899115e3c6926d109a5bd39bf12646fae3862b",
  asset: "0x77eaeba1366bde7818da12d3cbdbea0a2ee97596",
  dollar: "0xf07535080f74e8b0f571e58dfa600f47e72ea9bf",
  assetIsCurrency0: true,
  poolId: "0x3da5321a25b931eab270ee3b86490e10648ea54f25b2f4011679b4ddc74c498a",
  stateSlot: "0x7549bdeca0ad849329463831768b1ef35511842b1c9ad3f6594c62fe94dce016",
};

export const V4_SELECTORS = {
  deposit: "0x00aeef8a",
  cancelDeposit: "0x3d561602",
  claimShares: "0xf31cb0c6",
  withdraw: "0x674fb1b4",
  repeg: "0xb3b834d3",
  nav: "0xc1590cd7",
  currentFee: "0xda3c300d",
  totalAmounts: "0x0c6ffc29",
  claimableShares: "0x4f5ad9c5",
  pendingOf: "0xf44136a1",
  epoch: "0x900cf0cf",
  peggedAt: "0x96a58c28",
  pending0: "0x4df05285",
  pending1: "0x16df4e41",
  baseRange: "0xe85f0e68",
  limitRange: "0xbc16f237",
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
  extsload: "0x1e2eaeaf",
  // GanymedeV4Router
  swapExactInput: "0x5310efdc",
  quoteExactInput: "0x4ba5bd20",
} as const;

/** The pool key's fixed parts: a dynamic fee the hook sets on each swap, and ticks 10 apart. */
export const V4_DYNAMIC_FEE = 0x800000;
export const V4_TICK_SPACING = 10;
/** keccak256("Swapped(address,bytes32,bool,uint256,uint256)"): the router's record of a swap. */
export const V4_SWAPPED_TOPIC = "0x81e79d9473b5b38652c9c83ded1782fec24ebf89f59305aa8e73dc465101e9ad";

export const V4_EVENTS = {
  deposited: "0x91ede45f04a37a7c170f5c1207df3b6bc748dc1e04ad5e917a241d0f52feada3",
  depositCancelled: "0xc5d19165d7af8783d2c91dffafb7336dadb06d994e0262020ab84e1f4af8919e",
  converted: "0x56697dd4120571b1b07f5b3a8844969636a21111cdd407b2b79662e17ee3a7f2",
  sharesClaimed: "0x0586a8084488e56c320d62207ce241e24ca9e6e09d86c0e0bbbe8d0dc6b98c31",
  withdrawn: "0x75e161b3e824b114fc1a33274bd7091918dd4e639cede50b78b15a4eea956a21",
  repegged: "0x5d810d324c74e967693ab7300aaa3555e975f3656852ccda2bd6f94675d80bd7",
  transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
} as const;

/** The hook's and the router's errors, in the words a liquidity provider needs. */
export const V4_ERRORS: Record<string, string> = {
  "0x860b82a9": "The first deposit must be worth at least $10.",
  "0x80e681ab": "No deposit is waiting to cancel. A NAV record may have just turned it into LP tokens.",
  "0xfad298ff": "The NAV record is over an hour old. Swaps and a first deposit reopen with the next record; withdrawals still work.",
  "0x724cdd8c": "The NAV record is timed ahead of the chain’s clock. Try again in a minute.",
  "0xc3125d77": "The NAV is outside the range this pool can price.",
  "0x4475f9ea": "That trade would move the pool too far from the NAV. Try a smaller amount.",
  "0xc301e07e": "The pool has no liquidity yet.",
  "0x2c5211c6": "That amount is too small for the pool. Try a larger one.",
  "0x8199f5f3": "The pool moved before this was confirmed. Review it again.",
  "0xd964f528": "The pool could not fill all of that trade. Try a smaller amount.",
  "0xf4d678b8": "Your balance is too low for this.",
};
/** The pool manager wraps a hook's revert during a swap: WrappedError(address, bytes4, bytes, bytes). */
const WRAPPED_ERROR = "0x90bfb865";

/** The hook's feed answers have 8 decimals; USTX and demo dollars have 6. */
const NAV_UNIT = 100_000_000n;
const Q192 = 1n << 192n;
const ONE = 1_000_000n;
const MINIMUM_SHARES = 1_000n;
const FIRST_DEPOSIT_MICROS = 10_000_000n;

export type V4Nav = { answer: bigint; navMicros: bigint; updatedAt: number } | { answer: null; reason: string };

/** Amounts by token, USTX and demo dollars, rather than by the pool's currency0 and currency1. */
export type V4Amounts = { sharesMicros: bigint; dollarsMicros: bigint };
export type V4Range = { lower: number; upper: number; liquidity: bigint };

export type V4Pool = V4Amounts & {
  block: number;
  /** LP tokens in existence, the locked 1,000 and those waiting to be claimed included. */
  supply: bigint;
  /** Deposits waiting for the next NAV record, not yet part of what LP tokens own. */
  pending: V4Amounts;
  epoch: bigint;
  /** The updatedAt of the NAV record the pool is centred on, in seconds. */
  peggedAt: number;
  nav: V4Nav;
  /** The swap fee now, in hundredths of a basis point; null while the NAV cannot be used. */
  feePips: number | null;
  /** The pool's price: USTX in demo-dollar micros, from its square root. */
  sqrtPriceX96: bigint;
  priceMicros: bigint;
  base: V4Range;
  limit: V4Range;
};

export type V4Account = {
  gasWei: bigint;
  dollarsMicros: bigint;
  sharesMicros: bigint;
  /** LP tokens in the wallet. */
  lpMicros: bigint;
  /** A deposit still waiting for the next NAV record, and LP tokens an earlier record converted one into. */
  waiting: V4Amounts | null;
  claimableLpMicros: bigint;
  /** USTX and demo dollars approved to the hook. */
  assetAllowanceMicros: bigint;
  dollarAllowanceMicros: bigint;
};

/** (amount0, amount1) as USTX and demo dollars. */
export const byToken = (deployment: V4Deployment, amount0: bigint, amount1: bigint): V4Amounts =>
  deployment.assetIsCurrency0 ? { sharesMicros: amount0, dollarsMicros: amount1 } : { sharesMicros: amount1, dollarsMicros: amount0 };
/** USTX and demo dollars as (amount0, amount1). */
export const byCurrency = (deployment: V4Deployment, amounts: V4Amounts): [bigint, bigint] =>
  deployment.assetIsCurrency0 ? [amounts.sharesMicros, amounts.dollarsMicros] : [amounts.dollarsMicros, amounts.sharesMicros];

/** USTX in demo-dollar micros at a pool price given as √(currency1 / currency0) × 2^96. */
export function v4PriceMicros(sqrtPriceX96: bigint, assetIsCurrency0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return assetIsCurrency0 ? squared * ONE / Q192 : Q192 * ONE / squared;
}

/** USTX in dollars at a tick, as a float for display: 1.0001^tick, or its inverse. */
export function tickToUsd(tick: number, assetIsCurrency0: boolean): number {
  const price = Math.pow(1.0001, tick);
  return assetIsCurrency0 ? price : 1 / price;
}

/** Value at the NAV in demo-dollar micros, rounded down as the hook rounds it. */
export const v4ValueMicros = (amounts: V4Amounts, answer: bigint) => amounts.sharesMicros * answer / NAV_UNIT + amounts.dollarsMicros;

/** "0.30%" from hundredths of a basis point, to two decimals, rounded down. */
export function formatFeePips(pips: number): string {
  return `${Math.floor(pips / 10_000)}.${String(Math.floor(pips / 100) % 100).padStart(2, "0")}%`;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const signedTick = (value: bigint) => { const raw = Number(value & 0xffffffn); return raw >= 0x800000 ? raw - 0x1000000 : raw; };
const range = (value: unknown): V4Range => { const [lower, upper, liquidity] = words(value, 3); return { lower: signedTick(lower), upper: signedTick(upper), liquidity }; };

/** The pool and, when `account` is given, one wallet's place in it, read at one block. */
export async function readV4Pool(deployment: V4Deployment, account: string | null, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<{ pool: V4Pool; account: V4Account | null }> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  const hook = deployment.hook;
  const read = (to: string, data: string, count = 1) => call(rpc, to, data, tag).then(value => words(value, count));
  // nav() and currentFee() revert while the record is missing, stale or ahead of the chain's clock.
  const optional = <T>(promise: Promise<T>) => promise.then(value => ({ value }), error => { if (!isRevert(error)) throw error; return { error }; });
  return atBlock(async () => {
    const [supply, [amount0, amount1], epoch, pending0, pending1, peggedAt, nav, fee, slot0, base, limit] = await Promise.all([
      read(hook, V4_SELECTORS.totalSupply).then(([value]) => value),
      read(hook, V4_SELECTORS.totalAmounts, 2),
      read(hook, V4_SELECTORS.epoch).then(([value]) => value),
      read(hook, V4_SELECTORS.pending0).then(([value]) => value),
      read(hook, V4_SELECTORS.pending1).then(([value]) => value),
      read(hook, V4_SELECTORS.peggedAt).then(([value]) => value),
      optional(read(hook, V4_SELECTORS.nav, 3)),
      optional(read(hook, V4_SELECTORS.currentFee).then(([value]) => value)),
      read(deployment.poolManager, `${V4_SELECTORS.extsload}${deployment.stateSlot.slice(2)}`).then(([value]) => value),
      call(rpc, hook, V4_SELECTORS.baseRange, tag).then(range),
      call(rpc, hook, V4_SELECTORS.limitRange, tag).then(range),
    ]);
    const sqrtPriceX96 = slot0 & ((1n << 160n) - 1n);
    const state: V4Pool = {
      block, supply, ...byToken(deployment, amount0, amount1), pending: byToken(deployment, pending0, pending1), epoch, peggedAt: Number(peggedAt),
      nav: "value" in nav ? { answer: nav.value[0], navMicros: nav.value[0] / (NAV_UNIT / ONE), updatedAt: Number(nav.value[1]) } : { answer: null, reason: v4ErrorMessage(nav.error) },
      feePips: "value" in fee ? Number(fee.value) : null,
      sqrtPriceX96, priceMicros: v4PriceMicros(sqrtPriceX96, deployment.assetIsCurrency0), base, limit,
    };
    if (!account) return { pool: state, account: null };
    const owner = addressWord(account);
    const spender = addressWord(hook);
    const [gas, dollars, shares, lp, [waiting0, waiting1, waitingEpoch], claimable, assetAllowance, dollarAllowance] = await Promise.all([
      rpc("eth_getBalance", [account, tag]).then(quantity),
      read(deployment.dollar, `${FUND_SELECTORS.balanceOf}${owner}`).then(([value]) => value),
      read(deployment.asset, `${FUND_SELECTORS.balanceOf}${owner}`).then(([value]) => value),
      read(hook, `${V4_SELECTORS.balanceOf}${owner}`).then(([value]) => value),
      read(hook, `${V4_SELECTORS.pendingOf}${owner}`, 3),
      read(hook, `${V4_SELECTORS.claimableShares}${owner}`).then(([value]) => value),
      read(deployment.asset, `${FUND_SELECTORS.allowance}${owner}${spender}`).then(([value]) => value),
      read(deployment.dollar, `${FUND_SELECTORS.allowance}${owner}${spender}`).then(([value]) => value),
    ]);
    // A deposit in the current epoch still waits; one from an earlier epoch was converted and is claimable.
    const stillWaiting = (waiting0 > 0n || waiting1 > 0n) && waitingEpoch === epoch;
    return {
      pool: state,
      account: {
        gasWei: gas, dollarsMicros: dollars, sharesMicros: shares, lpMicros: lp, waiting: stillWaiting ? byToken(deployment, waiting0, waiting1) : null,
        claimableLpMicros: claimable, assetAllowanceMicros: assetAllowance, dollarAllowanceMicros: dollarAllowance,
      },
    };
  });
}

export function v4Calls(deployment: V4Deployment) {
  const approve = (token: string, micros: bigint): TransactionCall => ({ to: token, data: `${FUND_SELECTORS.approve}${addressWord(deployment.hook)}${word(micros)}` });
  return {
    approveShares: (micros: bigint) => approve(deployment.asset, micros),
    approveDollars: (micros: bigint) => approve(deployment.dollar, micros),
    /** Takes at most these amounts, at the ratio of what the LP tokens own. */
    deposit: (maxima: V4Amounts, deadline: number): TransactionCall => {
      const [amount0, amount1] = byCurrency(deployment, maxima);
      return { to: deployment.hook, data: `${V4_SELECTORS.deposit}${word(amount0)}${word(amount1)}${word(BigInt(deadline))}` };
    },
    cancelDeposit: (): TransactionCall => ({ to: deployment.hook, data: V4_SELECTORS.cancelDeposit }),
    claimShares: (account: string): TransactionCall => ({ to: deployment.hook, data: `${V4_SELECTORS.claimShares}${addressWord(account)}` }),
    /** Moves the pool to a NAV record it has not used yet, converting the waiting deposits. Anyone can send it. */
    repeg: (): TransactionCall => ({ to: deployment.hook, data: V4_SELECTORS.repeg }),
    withdraw: (lpMicros: bigint, minima: V4Amounts, deadline: number): TransactionCall => {
      const [amount0, amount1] = byCurrency(deployment, minima);
      return { to: deployment.hook, data: `${V4_SELECTORS.withdraw}${word(lpMicros)}${word(amount0)}${word(amount1)}${word(BigInt(deadline))}` };
    },
  };
}

/**
 * Whether `repeg()` would move the pool to a newer NAV record now: a dry run from `from` at a block
 * no older than `minBlock`. False once a trade, a deposit or the keeper has moved it; throws the
 * hook's reason when the record cannot be used.
 */
export async function v4RepegDue(deployment: V4Deployment, from: string, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<boolean> {
  return words(await simulateFundCall(from, v4Calls(deployment).repeg(), options), 1)[0] !== 0n;
}

/**
 * What `deposit` takes for these maxima now, with the hook's own arithmetic: the ratio of what the
 * LP tokens own, each amount rounded up; both in full for the first deposit. Null where it would
 * revert. The LP tokens are set at the next NAV record, so `lpEstimateMicros` values the deposit and
 * the holdings at the current NAV; null without one.
 */
export function v4DepositQuote(maxima: V4Amounts, pool: Pick<V4Pool, "supply" | "sharesMicros" | "dollarsMicros" | "nav">): (V4Amounts & { lpEstimateMicros: bigint | null }) | null {
  const answer = pool.nav.answer;
  if (pool.supply === 0n) {
    if (answer === null) return null;
    const value = v4ValueMicros(maxima, answer);
    return value >= FIRST_DEPOSIT_MICROS ? { ...maxima, lpEstimateMicros: value - MINIMUM_SHARES } : null;
  }
  let units = -1n;
  if (pool.sharesMicros > 0n) units = maxima.sharesMicros * pool.supply / pool.sharesMicros;
  if (pool.dollarsMicros > 0n) {
    const byDollars = maxima.dollarsMicros * pool.supply / pool.dollarsMicros;
    if (units < 0n || byDollars < units) units = byDollars;
  }
  if (units <= 0n) return null;
  const amounts = { sharesMicros: ceilDiv(pool.sharesMicros * units, pool.supply), dollarsMicros: ceilDiv(pool.dollarsMicros * units, pool.supply) };
  const held = answer === null ? 0n : v4ValueMicros(pool, answer);
  // As the hook's conversion divides: by 1 when the holdings are worth nothing.
  const lpEstimateMicros = answer === null ? null : v4ValueMicros(amounts, answer) * pool.supply / (held === 0n ? 1n : held);
  return { ...amounts, lpEstimateMicros };
}

/** The demo dollars a deposit of `sharesMicros` USTX takes at the holdings' ratio, rounded up so USTX sets the size; and the reverse. */
export const v4PairedDollars = (sharesMicros: bigint, pool: V4Amounts) => pool.sharesMicros > 0n ? ceilDiv(sharesMicros * pool.dollarsMicros, pool.sharesMicros) : null;
export const v4PairedShares = (dollarsMicros: bigint, pool: V4Amounts) => pool.dollarsMicros > 0n ? ceilDiv(dollarsMicros * pool.sharesMicros, pool.dollarsMicros) : null;

/**
 * What `withdraw` pays for `lpMicros` now: their part of everything the LP tokens own, rounded down.
 * The hook rounds each range's part on its own, so this can exceed the payment by a few micros;
 * minimums set from it leave room for that.
 */
export function v4WithdrawEstimate(lpMicros: bigint, pool: Pick<V4Pool, "supply" | "sharesMicros" | "dollarsMicros">): V4Amounts | null {
  if (lpMicros <= 0n || pool.supply === 0n || lpMicros > pool.supply) return null;
  const amounts = { sharesMicros: lpMicros * pool.sharesMicros / pool.supply, dollarsMicros: lpMicros * pool.dollarsMicros / pool.supply };
  // The hook would burn LP tokens that pay out nothing; the app does not send that.
  return amounts.sharesMicros === 0n && amounts.dollarsMicros === 0n ? null : amounts;
}

export type V4Fill = {
  deposited: V4Amounts & { epoch: bigint } | null;
  cancelled: V4Amounts | null;
  /** LP tokens a converted deposit paid out to `account`. */
  claimedLpMicros: bigint | null;
  withdrawn: V4Amounts & { lpMicros: bigint } | null;
  /** A NAV record applied in this transaction, and the LP tokens it minted for the waiting deposits. */
  converted: { epoch: bigint; navAnswer: bigint; valueMicros: bigint; lpMicros: bigint } | null;
  /** LP tokens minted to `account` in this transaction: a first deposit's. */
  mintedLpMicros: bigint;
};

const topicAccount = (topic: string | undefined) => `0x${String(topic).slice(-40)}`.toLowerCase();

/** The hook's events in a receipt that concern `account`. */
export function v4Fill(receipt: FundReceipt, deployment: V4Deployment, account: string): V4Fill {
  const fill: V4Fill = { deposited: null, cancelled: null, claimedLpMicros: null, withdrawn: null, converted: null, mintedLpMicros: 0n };
  const who = account.toLowerCase();
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== deployment.hook.toLowerCase()) continue;
    const topic = log.topics?.[0]?.toLowerCase();
    if (topic === V4_EVENTS.converted) {
      const [navAnswer, valueMicros, lpMicros] = words(log.data, 3);
      fill.converted = { epoch: BigInt(String(log.topics[1])), navAnswer, valueMicros, lpMicros };
      continue;
    }
    if (topic === V4_EVENTS.transfer) {
      if (topicAccount(log.topics[1]) === "0x0000000000000000000000000000000000000000" && topicAccount(log.topics[2]) === who) fill.mintedLpMicros += words(log.data, 1)[0];
      continue;
    }
    if (topicAccount(log.topics?.[1]) !== who) continue;
    if (topic === V4_EVENTS.deposited) { const [a0, a1] = words(log.data, 2); fill.deposited = { ...byToken(deployment, a0, a1), epoch: BigInt(String(log.topics[2])) }; }
    else if (topic === V4_EVENTS.depositCancelled) { const [a0, a1] = words(log.data, 2); fill.cancelled = byToken(deployment, a0, a1); }
    else if (topic === V4_EVENTS.sharesClaimed) fill.claimedLpMicros = (fill.claimedLpMicros ?? 0n) + words(log.data, 1)[0];
    else if (topic === V4_EVENTS.withdrawn) { const [lp, a0, a1] = words(log.data, 3); fill.withdrawn = { ...byToken(deployment, a0, a1), lpMicros: lp }; }
  }
  return fill;
}

/** The revert a hook raised, unwrapped from the pool manager's WrappedError when a swap carried it. */
export function hookRevert(error: unknown): string | null {
  const data = revertData(error);
  if (!data || data.slice(0, 10).toLowerCase() !== WRAPPED_ERROR) return data;
  try {
    // WrappedError(address target, bytes4 selector, bytes reason, bytes details): the reason's offset is the third word.
    const body = data.slice(10);
    const offset = Number(BigInt(`0x${body.slice(128, 192)}`)) * 2;
    const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)) * 2;
    const reason = body.slice(offset + 64, offset + 64 + length);
    return reason.length >= 8 ? `0x${reason}` : data;
  } catch { return data; }
}

/** A customer-facing reason for a failed request to the v4 pool, in the hook's words where they differ. */
export function v4ErrorMessage(error: unknown): string {
  const data = hookRevert(error);
  const known = data ? V4_ERRORS[data.slice(0, 10).toLowerCase()] : undefined;
  return known ?? fundErrorMessage(data ? { data } : error);
}

/** The hook is pinned with the tokens the app already uses. */
export const isPinnedToFund = (deployment: V4Deployment) => deployment.asset === FUND_DEPLOYMENT.fund && deployment.dollar === FUND_DEPLOYMENT.dollar;

/** The pool key as the router takes it: (currency0, currency1, fee, tickSpacing, hooks), five words. */
function poolKeyWords(deployment: V4Deployment): string {
  const [currency0, currency1] = deployment.assetIsCurrency0 ? [deployment.asset, deployment.dollar] : [deployment.dollar, deployment.asset];
  return `${addressWord(currency0)}${addressWord(currency1)}${word(BigInt(V4_DYNAMIC_FEE))}${word(BigInt(V4_TICK_SPACING))}${addressWord(deployment.hook)}`;
}

/** Whether a purchase of USTX with demo dollars swaps currency0 for currency1: only when the dollar is currency0. */
const zeroForOne = (deployment: V4Deployment, side: "buy" | "sell") => (side === "buy") !== deployment.assetIsCurrency0;

/**
 * Trading on the pool through GanymedeV4Router: approvals go to the router, which takes the input
 * with transferFrom. Buying, the amount is demo dollars; selling, USTX.
 */
export function v4SwapCalls(deployment: V4Deployment) {
  const approve = (token: string, micros: bigint): TransactionCall => ({ to: token, data: `${FUND_SELECTORS.approve}${addressWord(deployment.router)}${word(micros)}` });
  return {
    approveDollars: (micros: bigint) => approve(deployment.dollar, micros),
    approveShares: (micros: bigint) => approve(deployment.asset, micros),
    swap: (side: "buy" | "sell", amountIn: bigint, minAmountOut: bigint, deadline: number): TransactionCall => ({
      to: deployment.router,
      data: `${V4_SELECTORS.swapExactInput}${poolKeyWords(deployment)}${word(zeroForOne(deployment, side) ? 1n : 0n)}${word(amountIn)}${word(minAmountOut)}${word(BigInt(deadline))}`,
    }),
  };
}

export type V4Quote = {
  block: number;
  /** What the order gets, or null where the pool cannot fill it now, with the reason. */
  amountOut: bigint | null;
  reason: string | null;
  /** The swap fee now, in hundredths of a basis point, and what the router may take from `owner`. */
  feePips: number | null;
  allowanceMicros: bigint;
};

/**
 * The pool's quote for an order of `amountIn`, from the router's own dry run of the swap, with the
 * fee and `owner`'s allowance to the router, read at one block. A swap the hook or the pool would
 * refuse (a stale NAV, too little liquidity) quotes nothing and says why, in `describe`'s words: the
 * hook's errors are its own, so the range pool's are not this pool's.
 */
export async function readV4Quote(deployment: V4Deployment, side: "buy" | "sell", amountIn: bigint, owner: string, options: { rpc?: Rpc; minBlock?: number; describe?: (error: unknown) => string } = {}): Promise<V4Quote> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  return atBlock(async () => {
    const token = side === "buy" ? deployment.dollar : deployment.asset;
    const quote = call(rpc, deployment.router, `${V4_SELECTORS.quoteExactInput}${poolKeyWords(deployment)}${word(zeroForOne(deployment, side) ? 1n : 0n)}${word(amountIn)}`, tag)
      .then(value => ({ amountOut: words(value, 1)[0], reason: null }), error => { if (!isRevert(error)) throw error; return { amountOut: null, reason: (options.describe ?? v4ErrorMessage)(error) }; });
    const fee = call(rpc, deployment.hook, V4_SELECTORS.currentFee, tag)
      .then(value => Number(words(value, 1)[0]), error => { if (!isRevert(error)) throw error; return null; });
    const allowance = call(rpc, token, `${FUND_SELECTORS.allowance}${addressWord(owner)}${addressWord(deployment.router)}`, tag).then(value => words(value, 1)[0]);
    const [{ amountOut, reason }, feePips, allowanceMicros] = await Promise.all([quote, fee, allowance]);
    return { block, amountOut: amountOut !== null && amountOut > 0n ? amountOut : null, reason: amountOut === 0n ? "The pool cannot fill an order this small." : reason, feePips, allowanceMicros };
  });
}

/** The router's swap for `trader` in a receipt, as USTX and demo dollars; null when there is none. */
export function v4SwapFill(receipt: FundReceipt, deployment: V4Deployment, trader: string): { side: "buy" | "sell"; sharesMicros: bigint; dollarsMicros: bigint } | null {
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== deployment.router) continue;
    if (log.topics?.[0]?.toLowerCase() !== V4_SWAPPED_TOPIC || log.topics[1]?.toLowerCase() !== `0x${addressWord(trader)}` || log.topics[2]?.toLowerCase() !== deployment.poolId) continue;
    const [direction, amountIn, amountOut] = words(log.data, 3);
    const side = (direction === 1n) === zeroForOne(deployment, "buy") ? "buy" : "sell";
    return side === "buy" ? { side, dollarsMicros: amountIn, sharesMicros: amountOut } : { side, sharesMicros: amountIn, dollarsMicros: amountOut };
  }
  return null;
}
