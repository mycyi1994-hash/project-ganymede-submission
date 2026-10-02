import {
  FUND_DEPLOYMENT, FUND_MIN_INVESTMENT_MICROS, FUND_SELECTORS, POOL_FEE_BPS, POOL_SELECTORS, addressWord, atBlock, call, fundErrorMessage, fundRpc, hexBlock, quantity,
  readBlock, readNav, revertData, word, words, type FundNav, type FundReceipt, type PoolReserves, type Rpc, type TransactionCall,
} from "./fund";

// Liquidity in the USTX/dUSD pool on X Layer Testnet (contracts/GanymedeUstxPool.sol): a provider
// deposits USTX and demo dollars at the pool's ratio, receives its LP token (USTX-LP, six decimals)
// and earns the 0.3% fee on every trade, which stays in the reserves. Withdrawing burns LP tokens
// for their part of both reserves. The app carries no keccak, so selectors are pinned here and tied
// to the compiled pool in onchain/test/AppFundClient.test.ts. Demo dollars and USTX have no value.

const ONE = 1_000_000n;
const WAD = 10n ** 18n;
const BPS = 10_000n;
const YEAR_SECONDS = 365n * 86_400n;

export const LIQUIDITY_SELECTORS = {
  addLiquidity: "0xa360501c",
  removeLiquidity: "0xf88bf15a",
  totalSupply: "0x18160ddd",
} as const;

export const LIQUIDITY_EVENTS = {
  added: "0x64b83944e79c3ce8d4c297411de637c3e102d064677aac0c163976ebdcd6f50e",
  removed: "0x1dc8bb69df2b8e91fbdcbfcf93d951b3f0000f085a95fe3f7946d6161439245d",
} as const;

/** The pool's first deposit locks this much of its LP token, so the pool can never be emptied. */
export const POOL_MINIMUM_LIQUIDITY = 1_000n;
/** The block of the pool's first deposit on X Layer Testnet, and its time. */
export const POOL_LAUNCH_BLOCK = 41_854_080;
export const POOL_LAUNCHED_AT = "2026-09-25T05:08:37.000Z";
/** Fee growth is measured over the last seven days, or since the first deposit when that is later. */
export const POOL_YIELD_WINDOW_SECONDS = 7 * 86_400;

/** The pool's errors where a liquidity provider needs other words than a trader. */
export const LIQUIDITY_ERRORS: Record<string, string> = {
  "0x2c5211c6": "That amount is too small for the pool. Try a larger one.",
  // The pool's and the fund's: the price or the NAV moved more than the 1% allowed.
  "0x8199f5f3": "The price moved before this was confirmed. Review it again.",
  "0xf4d678b8": "Your balance is too low for this.",
};

/** The pool at one block: reserves, LP tokens in existence and the fund's NAV. */
export type PoolLiquidity = PoolReserves & { block: number; supply: bigint; nav: FundNav };

export type LiquidityAccount = {
  gasWei: bigint;
  /** In the wallet. */
  dollarsMicros: bigint;
  sharesMicros: bigint;
  /** LP tokens: the wallet's claim on the reserves. */
  lpMicros: bigint;
  /** Approved to the pool, and demo dollars approved to the fund for a dollars-only deposit. */
  poolDollarAllowanceMicros: bigint;
  poolShareAllowanceMicros: bigint;
  fundAllowanceMicros: bigint;
  /** When the demo-dollar faucet serves this wallet again, in seconds. */
  nextClaimAt: number;
};

const pool = FUND_DEPLOYMENT.pool;

/** The pool, and one wallet's place in it when `account` is given, read at one block. */
export async function readLiquidity(account: string | null, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<{ pool: PoolLiquidity; account: LiquidityAccount | null }> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  const one = (to: string, data: string) => call(rpc, to, data, tag).then(value => words(value, 1)[0]);
  return atBlock(async () => {
    const [[shares, dollars], supply, nav] = await Promise.all([
      call(rpc, pool, POOL_SELECTORS.getReserves, tag).then(value => words(value, 2)),
      one(pool, LIQUIDITY_SELECTORS.totalSupply),
      readNav(rpc, tag),
    ]);
    const state: PoolLiquidity = { block, sharesMicros: shares, dollarsMicros: dollars, supply, nav };
    if (!account) return { pool: state, account: null };
    const owner = addressWord(account);
    const [gas, wallet, walletShares, lp, poolDollars, poolShares, fundDollars, nextClaim] = await Promise.all([
      rpc("eth_getBalance", [account, tag]).then(quantity),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.balanceOf}${owner}`),
      one(FUND_DEPLOYMENT.fund, `${FUND_SELECTORS.balanceOf}${owner}`),
      one(pool, `${FUND_SELECTORS.balanceOf}${owner}`),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.allowance}${owner}${addressWord(pool)}`),
      one(FUND_DEPLOYMENT.fund, `${FUND_SELECTORS.allowance}${owner}${addressWord(pool)}`),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.allowance}${owner}${addressWord(FUND_DEPLOYMENT.fund)}`),
      one(FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.nextClaimAt}${owner}`),
    ]);
    return {
      pool: state,
      account: {
        gasWei: gas, dollarsMicros: wallet, sharesMicros: walletShares, lpMicros: lp, poolDollarAllowanceMicros: poolDollars,
        poolShareAllowanceMicros: poolShares, fundAllowanceMicros: fundDollars, nextClaimAt: Number(nextClaim),
      },
    };
  });
}

export const liquidityCalls = {
  add: (sharesMicros: bigint, dollarsMicros: bigint, minSharesMicros: bigint, minDollarsMicros: bigint, deadline: number): TransactionCall => ({
    to: pool, data: `${LIQUIDITY_SELECTORS.addLiquidity}${word(sharesMicros)}${word(dollarsMicros)}${word(minSharesMicros)}${word(minDollarsMicros)}${word(BigInt(deadline))}`,
  }),
  remove: (lpMicros: bigint, minSharesMicros: bigint, minDollarsMicros: bigint, deadline: number): TransactionCall => ({
    to: pool, data: `${LIQUIDITY_SELECTORS.removeLiquidity}${word(lpMicros)}${word(minSharesMicros)}${word(minDollarsMicros)}${word(BigInt(deadline))}`,
  }),
};

type PoolState = PoolReserves & { supply: bigint };

/** Integer square root, rounded down, as the pool computes it. */
export function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("Negative square root.");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + value / x) / 2n; }
  return x;
}

export type AddQuote = { sharesMicros: bigint; dollarsMicros: bigint; liquidity: bigint };

/**
 * What addLiquidity takes and mints for these maxima, with the pool's own arithmetic: the first
 * deposit takes both and mints their geometric mean less the locked 1,000; a later one takes the
 * desired USTX and the demo dollars at the ratio, or the desired dollars and the USTX at the ratio,
 * whichever fits. Null where the pool would refuse it.
 */
export function quoteAddLiquidity(sharesDesired: bigint, dollarsDesired: bigint, state: PoolState): AddQuote | null {
  if (sharesDesired <= 0n || dollarsDesired <= 0n) return null;
  if (state.supply === 0n) {
    const root = sqrt(sharesDesired * dollarsDesired);
    return root > POOL_MINIMUM_LIQUIDITY ? { sharesMicros: sharesDesired, dollarsMicros: dollarsDesired, liquidity: root - POOL_MINIMUM_LIQUIDITY } : null;
  }
  if (state.sharesMicros === 0n || state.dollarsMicros === 0n) return null;
  const dollarsAtRatio = sharesDesired * state.dollarsMicros / state.sharesMicros;
  const [shares, dollars] = dollarsAtRatio <= dollarsDesired ? [sharesDesired, dollarsAtRatio] : [dollarsDesired * state.sharesMicros / state.dollarsMicros, dollarsDesired];
  const bySharesSide = shares * state.supply / state.sharesMicros;
  const byDollarsSide = dollars * state.supply / state.dollarsMicros;
  const liquidity = bySharesSide < byDollarsSide ? bySharesSide : byDollarsSide;
  return liquidity > 0n ? { sharesMicros: shares, dollarsMicros: dollars, liquidity } : null;
}

/** What removeLiquidity pays for `lpMicros`: its part of each reserve, rounded down. Null where the pool would refuse it. */
export function quoteRemoveLiquidity(lpMicros: bigint, state: PoolState): PoolReserves | null {
  if (lpMicros <= 0n || state.supply === 0n || lpMicros > state.supply) return null;
  const shares = lpMicros * state.sharesMicros / state.supply;
  const dollars = lpMicros * state.dollarsMicros / state.supply;
  return shares === 0n && dollars === 0n ? null : { sharesMicros: shares, dollarsMicros: dollars };
}

/** The demo dollars that go with `sharesMicros` USTX at the pool's ratio, and the reverse; null while the pool is empty. */
export const pairedDollars = (sharesMicros: bigint, state: PoolReserves) => state.sharesMicros > 0n && state.dollarsMicros > 0n ? sharesMicros * state.dollarsMicros / state.sharesMicros : null;
export const pairedShares = (dollarsMicros: bigint, state: PoolReserves) => state.sharesMicros > 0n && state.dollarsMicros > 0n ? dollarsMicros * state.sharesMicros / state.dollarsMicros : null;

/** Both reserves valued at the NAV: USTX at the NAV, demo dollars at face value. */
export const poolValueMicros = (state: PoolReserves, navMicros: bigint) => state.sharesMicros * navMicros / ONE + state.dollarsMicros;

/** One LP token's part of the reserves valued at the NAV, in micros; 0 while there are none. */
export const lpTokenValueMicros = (state: PoolState, navMicros: bigint) => state.supply > 0n ? poolValueMicros(state, navMicros) * ONE / state.supply : 0n;

export type LiquidityPosition = PoolReserves & {
  /** The position at the NAV; null without one. */
  valueMicros: bigint | null;
  /** The position's part of all LP tokens, in parts per million. */
  sharePpm: bigint;
};

/** `lpMicros` LP tokens as their part of each reserve, as removeLiquidity would pay them now. */
export function liquidityPosition(lpMicros: bigint, state: PoolState, navMicros: bigint | null): LiquidityPosition {
  const out = quoteRemoveLiquidity(lpMicros, state) ?? { sharesMicros: 0n, dollarsMicros: 0n };
  return {
    ...out,
    valueMicros: navMicros === null ? null : out.sharesMicros * navMicros / ONE + out.dollarsMicros,
    sharePpm: state.supply > 0n ? lpMicros * ONE / state.supply : 0n,
  };
}

export type DollarsOnlySplit = {
  /** Invested at the fund at the NAV, and the USTX that buys at the fund's own rounding. */
  investMicros: bigint;
  sharesMicros: bigint;
  /** Demo dollars deposited with that USTX. */
  dollarsMicros: bigint;
};

/**
 * Splits `dollarsMicros` for a deposit of demo dollars alone: part invests at the fund at the NAV,
 * with no fee, and the USTX it buys goes into the pool with the rest at the pool's ratio. With the
 * pool at the NAV that is half each. Null where the pool is empty, there is no usable NAV, or the
 * part to invest is under the fund's $10 minimum.
 */
export function splitDollarsOnly(dollarsMicros: bigint, navMicros: bigint | null, state: PoolReserves): DollarsOnlySplit | null {
  if (navMicros === null || navMicros <= 0n || dollarsMicros <= 0n || state.sharesMicros === 0n || state.dollarsMicros === 0n) return null;
  // invest × 10^6 / NAV USTX, at the ratio, needs (dollars − invest) demo dollars.
  const investMicros = dollarsMicros * navMicros * state.sharesMicros / (ONE * state.dollarsMicros + navMicros * state.sharesMicros);
  if (investMicros < FUND_MIN_INVESTMENT_MICROS) return null;
  return { investMicros, sharesMicros: investMicros * ONE / navMicros, dollarsMicros: dollarsMicros - investMicros };
}

/** The smallest dollars-only deposit: enough that the part invested at the fund reaches its $10 minimum. */
export function minimumDollarsOnly(navMicros: bigint | null, state: PoolReserves): bigint | null {
  if (navMicros === null || navMicros <= 0n || state.sharesMicros === 0n || state.dollarsMicros === 0n) return null;
  const total = ONE * state.dollarsMicros + navMicros * state.sharesMicros;
  const part = navMicros * state.sharesMicros;
  // The smallest whole-micro amount whose invested part rounds down to at least $10.
  return (FUND_MIN_INVESTMENT_MICROS * total + part - 1n) / part;
}

export type PoolYield = {
  fromBlock: number;
  toBlock: number;
  /** Block times, in seconds. */
  fromTime: number;
  toTime: number;
  /** Growth of the reserves' geometric mean per LP token: what the fees added, as an 18-decimal fraction. */
  growthWad: bigint;
  /** That growth over a year, simple: growth × year ÷ window. */
  aprWad: bigint;
  /**
   * One LP token's part of the reserves valued at the NAV, at the start and at the end; and the same
   * USTX and demo dollars held outside the pool, at the end's NAV. Null where a NAV was not usable.
   */
  lpValueFromMicros: bigint | null;
  lpValueToMicros: bigint | null;
  heldValueToMicros: bigint | null;
};

/**
 * √(USTX × dollars) per LP token, 18 decimals. Deposits and withdrawals leave it unchanged (up to
 * rounding in the pool's favour); prices move it not at all; only the fee on each trade raises it.
 */
export function invariantPerLp(state: PoolState): bigint {
  return state.supply > 0n ? sqrt(state.sharesMicros * state.dollarsMicros * WAD * WAD) / state.supply : 0n;
}

/** Fee growth between two states of the pool, `seconds` apart; null without liquidity at both. */
export function poolYield(from: PoolState, to: PoolState, seconds: number): Pick<PoolYield, "growthWad" | "aprWad"> | null {
  const before = invariantPerLp(from);
  const after = invariantPerLp(to);
  if (before === 0n || after === 0n || seconds <= 0) return null;
  const growthWad = after * WAD / before - WAD;
  return { growthWad, aprWad: growthWad * YEAR_SECONDS / BigInt(seconds) };
}

async function readPoolAt(rpc: Rpc, block: number): Promise<{ state: PoolState; time: number; navMicros: bigint | null }> {
  const tag = hexBlock(block);
  const [[shares, dollars], supply, header, nav] = await Promise.all([
    call(rpc, pool, POOL_SELECTORS.getReserves, tag).then(value => words(value, 2)),
    call(rpc, pool, LIQUIDITY_SELECTORS.totalSupply, tag).then(value => words(value, 1)[0]),
    rpc("eth_getBlockByNumber", [tag, false]) as Promise<{ number?: unknown; timestamp?: unknown } | null>,
    readNav(rpc, tag),
  ]);
  if (!header || Number(quantity(header.number)) !== block) throw new Error("X Layer Testnet returned an invalid block.");
  return { state: { sharesMicros: shares, dollarsMicros: dollars, supply }, time: Number(quantity(header.timestamp)), navMicros: nav.navMicros };
}

/**
 * The fees liquidity providers earned over the last seven days (or since the first deposit), read
 * from the pool's state at both ends. X Layer Testnet makes a block a second.
 */
export async function readPoolYield(options: { rpc?: Rpc; windowSeconds?: number } = {}): Promise<PoolYield | null> {
  const rpc = options.rpc ?? fundRpc();
  const toBlock = await readBlock(rpc);
  const fromBlock = Math.max(POOL_LAUNCH_BLOCK, toBlock - (options.windowSeconds ?? POOL_YIELD_WINDOW_SECONDS));
  if (fromBlock >= toBlock) return null;
  const [from, to] = await atBlock(() => Promise.all([readPoolAt(rpc, fromBlock), readPoolAt(rpc, toBlock)]));
  const growth = poolYield(from.state, to.state, to.time - from.time);
  return growth && {
    fromBlock, toBlock, fromTime: from.time, toTime: to.time, ...growth,
    lpValueFromMicros: from.navMicros !== null ? lpTokenValueMicros(from.state, from.navMicros) : null,
    lpValueToMicros: to.navMicros !== null ? lpTokenValueMicros(to.state, to.navMicros) : null,
    heldValueToMicros: to.navMicros !== null ? lpTokenValueMicros(from.state, to.navMicros) : null,
  };
}

/** Change from `from` to `to` as an 18-decimal fraction; null without both. */
export const changeWad = (from: bigint | null, to: bigint | null) => from === null || to === null || from === 0n ? null : (to - from) * WAD / from;

/** The 0.3% fee on a trade into the pool, in demo dollars: on the dollars paid in, or on the USTX paid in valued at what it sold for. */
export const buyFeeMicros = (dollarsInMicros: bigint) => dollarsInMicros * POOL_FEE_BPS / BPS;
export const sellFeeMicros = (dollarsOutMicros: bigint) => dollarsOutMicros * POOL_FEE_BPS / (BPS - POOL_FEE_BPS);

export type LiquidityFill = { side: "add" | "remove"; provider: string; sharesMicros: bigint; dollarsMicros: bigint; lpMicros: bigint };

/** The LiquidityAdded or LiquidityRemoved event the pool emitted in a receipt. */
export function liquidityFill(receipt: FundReceipt): LiquidityFill | null {
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== pool) continue;
    const topic = log.topics?.[0]?.toLowerCase();
    if (topic !== LIQUIDITY_EVENTS.added && topic !== LIQUIDITY_EVENTS.removed) continue;
    const [shares, dollars, lp] = words(log.data, 3);
    return { side: topic === LIQUIDITY_EVENTS.added ? "add" : "remove", provider: `0x${String(log.topics[1]).slice(-40)}`.toLowerCase(), sharesMicros: shares, dollarsMicros: dollars, lpMicros: lp };
  }
  return null;
}

/** A customer-facing reason for a failed liquidity request, in the pool's words where they differ. */
export function liquidityErrorMessage(error: unknown): string {
  const data = revertData(error);
  return (data && LIQUIDITY_ERRORS[data.slice(0, 10).toLowerCase()]) ?? fundErrorMessage(error);
}

/** "6.62%" from an 18-decimal fraction, to two decimals, rounded down; "under 0.01%" for less above zero. */
export function formatYield(wad: bigint): string {
  if (wad < 0n) return `−${formatYield(-wad)}`;
  const basisPoints = wad * BPS / WAD;
  if (wad > 0n && basisPoints === 0n) return "under 0.01%";
  return `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}%`;
}

/** "0.0123%" from parts per million: a share of the pool, to four decimals, rounded down; "under 0.0001%" for a holding smaller than that. */
export function formatSharePpm(ppm: bigint, holds = ppm > 0n): string {
  if (holds && ppm === 0n) return "under 0.0001%";
  return `${ppm / 10_000n}.${(ppm % 10_000n).toString().padStart(4, "0")}%`;
}
