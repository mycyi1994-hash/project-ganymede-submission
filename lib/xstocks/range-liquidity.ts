import { decodeAbiParameters } from "viem";
import {
  FUND_SELECTORS, addressWord, atBlock, call, fundErrorMessage, fundRpc, hexBlock, isRevert, readBlock, word, words,
  type FundReceipt, type Rpc, type TransactionCall,
} from "./fund";
import { hookRevert, tickToUsd, v4PriceMicros, type V4Amounts, type V4Deployment } from "./v4-liquidity";

// The USTX/dUSD pool where every liquidity provider holds positions of their own
// (contracts/GanymedeRangeLiquidityHook.sol), on the same Uniswap v4 PoolManager as the pool held
// at the NAV: a position is a run of bins either side of the price, demo dollars below it and USTX
// above, spread evenly (Spot), heaviest next to the price (Curve) or heaviest at the far ends
// (Bid-Ask). Swaps need a NAV under an hour old, and none may leave the price more than 5% from
// it; GanymedeRangeArbitrage, which the keeper runs, brings the price back to the NAV. Closing a
// position pays its tokens and fees at any NAV. RANGE_POOL_DEPLOYMENT pins the deployment
// `npm run deploy:range` recorded on 4 October 2026 with the user's approval;
// onchain/test/AppRangeClient.test.ts checks the pin against the record. Demo dollars and USTX have no value.

export type RangeDeployment = V4Deployment & { arbitrage: string };

/** The pool on X Layer Testnet, as `npm run deploy:range` recorded it in onchain/deployments/xlayer-testnet.json. */
export const RANGE_POOL_DEPLOYMENT: RangeDeployment | null = {
  poolManager: "0xe83eee508ce92832488dd9f574ad329a1203641c",
  hook: "0x7964c50943c3ea9338d6653b91b872f147fe28c0",
  router: "0xbd899115e3c6926d109a5bd39bf12646fae3862b",
  asset: "0x77eaeba1366bde7818da12d3cbdbea0a2ee97596",
  dollar: "0xf07535080f74e8b0f571e58dfa600f47e72ea9bf",
  assetIsCurrency0: true,
  poolId: "0x2ffd6b32d25902cf1bc6714ae74cb0afb2711e2cab38e265d58b2de78afee7a1",
  stateSlot: "0xc0ae777922c57e236a9da6e9779173cb9f76b12252cdb71b7aaef76b2aca6510",
  arbitrage: "0xbe0624ee3d949352498a767f1edbe235de38ca4d",
};

export const RANGE_SELECTORS = {
  open: "0xa9229268",
  close: "0x37043fda",
  positions: "0x99fbab88",
  positionsOf: "0xf867d46b",
  binsOf: "0xb77b8e5b",
  positionAmounts: "0x44913c53",
  nav: "0xc1590cd7",
  currentFee: "0xda3c300d",
  extsload: "0x1e2eaeaf",
} as const;

export const RANGE_EVENTS = {
  opened: "0x6f21d1c89075fdb10314cef58c6fb0f775fb0912fda2e9562195a5a749228ca8",
  closed: "0x3120c845c5d2c39308641201562a412527c1e7aff294f09c0c936f1c60a1b067",
} as const;

export const RANGE_ERRORS: Record<string, string> = {
  "0xa4fc736e": "The pool’s price is more than 1% from the NAV right now. A position opens once the keeper brings it back, within five minutes.",
  "0x5a9168be": "That shape is not one the pool takes: bins of 0.1% to 5%, up to 20 each side.",
  "0x2c5211c6": "That amount is too small for the bins. Try a larger one.",
  "0x30cd7471": "That position belongs to another wallet.",
  "0x8d39f450": "That position is already closed.",
  "0xfad298ff": "The NAV record is over an hour old. Positions open again with the next record; closing still works.",
  "0x724cdd8c": "The NAV record is timed ahead of the chain’s clock. Try again in a minute.",
  "0xb25c0b55": "That trade would move the pool more than 5% from the NAV. Try a smaller amount.",
  "0x8199f5f3": "The pool moved before this was confirmed. Review it again.",
  "0x203d82d8": "This took too long to confirm. Try again.",
};

export const SHAPES = ["spot", "curve", "bid-ask"] as const;
export type RangeShape = (typeof SHAPES)[number];
export const SHAPE_NAMES: Record<RangeShape, string> = { spot: "Spot", curve: "Curve", "bid-ask": "Bid-Ask" };

const NAV_UNIT = 100_000_000n;
const ONE = 1_000_000n;

export type RangeBin = { lower: number; upper: number; liquidity: bigint; fromUsd: number; toUsd: number };
export type RangePosition = {
  id: bigint;
  shape: RangeShape;
  binTicks: number;
  binsBelow: number;
  binsAbove: number;
  open: boolean;
  bins: RangeBin[];
  /** What closing pays now, fees included, and the fees alone. */
  amounts: V4Amounts;
  fees: V4Amounts;
};
export type RangePool = {
  block: number;
  sqrtPriceX96: bigint;
  priceMicros: bigint;
  tick: number;
  navMicros: bigint | null;
  navReason: string | null;
  feePips: number | null;
};
export type RangeAccount = {
  dollarsMicros: bigint;
  sharesMicros: bigint;
  assetAllowanceMicros: bigint;
  dollarAllowanceMicros: bigint;
  positions: RangePosition[];
};

const signedTick = (value: bigint) => { const raw = Number(value & 0xffffffn); return raw >= 0x800000 ? raw - 0x1000000 : raw; };
const byToken = (deployment: V4Deployment, amount0: bigint, amount1: bigint): V4Amounts =>
  deployment.assetIsCurrency0 ? { sharesMicros: amount0, dollarsMicros: amount1 } : { sharesMicros: amount1, dollarsMicros: amount0 };

/** The pool and, with `account`, that wallet's open positions, read at one block. */
export async function readRangePool(deployment: RangeDeployment, account: string | null, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<{ pool: RangePool; account: RangeAccount | null }> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  const hook = deployment.hook;
  const read = (to: string, data: string, count = 1) => call(rpc, to, data, tag).then(value => words(value, count));
  const optional = <T>(promise: Promise<T>) => promise.then(value => ({ value }), error => { if (!isRevert(error)) throw error; return { error }; });
  return atBlock(async () => {
    const [slot0, nav, fee] = await Promise.all([
      read(deployment.poolManager, `${RANGE_SELECTORS.extsload}${deployment.stateSlot.slice(2)}`).then(([value]) => value),
      optional(read(hook, RANGE_SELECTORS.nav, 3)),
      optional(read(hook, RANGE_SELECTORS.currentFee).then(([value]) => value)),
    ]);
    const sqrtPriceX96 = slot0 & ((1n << 160n) - 1n);
    const pool: RangePool = {
      block, sqrtPriceX96, priceMicros: v4PriceMicros(sqrtPriceX96, deployment.assetIsCurrency0), tick: signedTick(slot0 >> 160n),
      navMicros: "value" in nav ? nav.value[0] / (NAV_UNIT / ONE) : null,
      navReason: "value" in nav ? null : rangeErrorMessage(nav.error),
      feePips: "value" in fee ? Number(fee.value) : null,
    };
    if (!account) return { pool, account: null };
    const owner = addressWord(account);
    const spender = addressWord(hook);
    const [dollars, shares, assetAllowance, dollarAllowance, idsRaw] = await Promise.all([
      read(deployment.dollar, `${FUND_SELECTORS.balanceOf}${owner}`).then(([value]) => value),
      read(deployment.asset, `${FUND_SELECTORS.balanceOf}${owner}`).then(([value]) => value),
      read(deployment.asset, `${FUND_SELECTORS.allowance}${owner}${spender}`).then(([value]) => value),
      read(deployment.dollar, `${FUND_SELECTORS.allowance}${owner}${spender}`).then(([value]) => value),
      call(rpc, hook, `${RANGE_SELECTORS.positionsOf}${owner}`, tag),
    ]);
    const [ids] = decodeAbiParameters([{ type: "uint256[]" }], idsRaw as `0x${string}`);
    // The latest 20 positions are enough for a wallet's view.
    const positions = (await Promise.all(ids.slice(-20).map(id => readPosition(rpc, deployment, id, tag)))).filter(position => position.open);
    return { pool, account: { dollarsMicros: dollars, sharesMicros: shares, assetAllowanceMicros: assetAllowance, dollarAllowanceMicros: dollarAllowance, positions } };
  });
}

async function readPosition(rpc: Rpc, deployment: RangeDeployment, id: bigint, tag: string): Promise<RangePosition> {
  const hook = deployment.hook;
  const [owner, shape, , binTicks, below, above, open] = words(await call(rpc, hook, `${RANGE_SELECTORS.positions}${word(id)}`, tag), 7);
  void owner;
  const base = { id, shape: SHAPES[Number(shape)] ?? "spot", binTicks: signedTick(binTicks), binsBelow: Number(below), binsAbove: Number(above), open: open === 1n };
  if (!base.open) return { ...base, bins: [], amounts: { sharesMicros: 0n, dollarsMicros: 0n }, fees: { sharesMicros: 0n, dollarsMicros: 0n } };
  const [binsRaw, amountsRaw] = await Promise.all([
    call(rpc, hook, `${RANGE_SELECTORS.binsOf}${word(id)}`, tag),
    call(rpc, hook, `${RANGE_SELECTORS.positionAmounts}${word(id)}`, tag),
  ]);
  const [lowers, uppers, liquidity] = decodeAbiParameters([{ type: "int24[]" }, { type: "int24[]" }, { type: "uint128[]" }], binsRaw as `0x${string}`);
  const [a0, a1, f0, f1] = words(amountsRaw, 4);
  const bins = lowers.map((lower, index) => {
    const a = tickToUsd(lower, deployment.assetIsCurrency0), b = tickToUsd(uppers[index], deployment.assetIsCurrency0);
    return { lower, upper: uppers[index], liquidity: liquidity[index], fromUsd: Math.min(a, b), toUsd: Math.max(a, b) };
  });
  return { ...base, bins, amounts: byToken(deployment, a0, a1), fees: byToken(deployment, f0, f1) };
}

/** Calls to open and close positions; approvals go to the hook, which takes what the bins use. */
export function rangeCalls(deployment: RangeDeployment) {
  const approve = (token: string, micros: bigint): TransactionCall => ({ to: token, data: `${FUND_SELECTORS.approve}${addressWord(deployment.hook)}${word(micros)}` });
  return {
    approveShares: (micros: bigint) => approve(deployment.asset, micros),
    approveDollars: (micros: bigint) => approve(deployment.dollar, micros),
    /** `dollars` go in the bins below the price, `shares` in the bins above. */
    open: (shape: RangeShape, binTicks: number, binsBelow: number, binsAbove: number, amounts: V4Amounts, deadline: number): TransactionCall => {
      // Bins below the price hold currency1 and bins above it currency0.
      const [amount0, amount1] = deployment.assetIsCurrency0 ? [amounts.sharesMicros, amounts.dollarsMicros] : [amounts.dollarsMicros, amounts.sharesMicros];
      return {
        to: deployment.hook,
        data: `${RANGE_SELECTORS.open}${word(BigInt(SHAPES.indexOf(shape)))}${word(BigInt(binTicks))}${word(BigInt(binsBelow))}${word(BigInt(binsAbove))}${word(amount0)}${word(amount1)}${word(BigInt(deadline))}`,
      };
    },
    close: (id: bigint, minima: V4Amounts, deadline: number): TransactionCall => {
      const [min0, min1] = deployment.assetIsCurrency0 ? [minima.sharesMicros, minima.dollarsMicros] : [minima.dollarsMicros, minima.sharesMicros];
      return { to: deployment.hook, data: `${RANGE_SELECTORS.close}${word(id)}${word(min0)}${word(min1)}${word(BigInt(deadline))}` };
    },
  };
}

/** The hook's events for `account` in a receipt: the position it opened, with what it took, or what a close paid. */
export function rangeFill(receipt: FundReceipt, deployment: RangeDeployment, account: string): { opened: { id: bigint; amounts: V4Amounts } | null; closed: { id: bigint; amounts: V4Amounts } | null } {
  const who = `0x${addressWord(account)}`.toLowerCase();
  const result: ReturnType<typeof rangeFill> = { opened: null, closed: null };
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== deployment.hook.toLowerCase()) continue;
    const topic = log.topics?.[0]?.toLowerCase();
    if (log.topics?.[2]?.toLowerCase() !== who) continue;
    const id = BigInt(String(log.topics[1]));
    if (topic === RANGE_EVENTS.opened) {
      // (shape, center, binTicks, binsBelow, binsAbove, amount0, amount1)
      const data = words(log.data, 7);
      result.opened = { id, amounts: byToken(deployment, data[5], data[6]) };
    } else if (topic === RANGE_EVENTS.closed) {
      const [a0, a1] = words(log.data, 2);
      result.closed = { id, amounts: byToken(deployment, a0, a1) };
    }
  }
  return result;
}

/** A customer-facing reason for a failed request to the range pool, unwrapped from the pool manager's WrappedError when a swap carried it. */
export function rangeErrorMessage(error: unknown): string {
  const data = hookRevert(error);
  const known = data ? RANGE_ERRORS[data.slice(0, 10).toLowerCase()] : undefined;
  return known ?? fundErrorMessage(data ? { data } : error);
}

/** A position's value at the NAV, in demo-dollar micros. */
export const rangeValueMicros = (amounts: V4Amounts, navMicros: bigint) => amounts.sharesMicros * navMicros / ONE + amounts.dollarsMicros;

/**
 * Where a position's dollars would sit by price before it opens, as the hook spreads them: each
 * side's amount shared by the shape's weights (1 each for Spot; nearest heaviest for Curve; farthest
 * heaviest for Bid-Ask), in bins of `binTicks` ticks either side of the price, skipping the interval
 * the price is in. Prices in dollars per USTX; values in dollars.
 */
export function previewShape(shape: RangeShape, binTicks: number, binsBelow: number, binsAbove: number, dollars: number, sharesValue: number, priceUsd: number): { fromUsd: number; toUsd: number; side: "dollars" | "shares"; value: number }[] {
  const weight = (distance: number, count: number) => shape === "spot" ? 1 : shape === "curve" ? count + 1 - distance : distance;
  const total = (count: number) => shape === "spot" ? count : count * (count + 1) / 2;
  const step = Math.pow(1.0001, binTicks);
  const gap = Math.pow(1.0001, 10);
  const bins: { fromUsd: number; toUsd: number; side: "dollars" | "shares"; value: number }[] = [];
  for (let distance = binsBelow; distance >= 1; distance -= 1) {
    const upper = priceUsd / Math.pow(step, distance - 1), lower = upper / step;
    bins.push({ fromUsd: lower, toUsd: upper, side: "dollars", value: dollars * weight(distance, binsBelow) / total(binsBelow) });
  }
  for (let distance = 1; distance <= binsAbove; distance += 1) {
    const lower = priceUsd * gap * Math.pow(step, distance - 1), upper = lower * step;
    bins.push({ fromUsd: lower, toUsd: upper, side: "shares", value: sharesValue * weight(distance, binsAbove) / total(binsAbove) });
  }
  return bins;
}
