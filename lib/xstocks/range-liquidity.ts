import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import {
  FUND_SELECTORS, addressWord, atBlock, call, fundErrorMessage, fundRpc, hexBlock, isRevert, readBlock, word, words,
  type FundReceipt, type Rpc, type TransactionCall,
} from "./fund";
import { hookRevert, tickToUsd, v4PriceMicros, type V4Amounts, type V4Deployment } from "./v4-liquidity";

// The USTX/dUSD pool where every liquidity provider holds positions of their own
// (contracts/GanymedeRangeLiquidityHook.sol), on the same Uniswap v4 PoolManager as the pool held
// at the NAV: a position is a run of bins either side of the price, demo dollars below it and USTX
// above, spread evenly (Spot), heaviest next to the price (Curve), heaviest at the far ends
// (Bid-Ask), or bin by bin as the provider draws it (Custom, openCustom). Swaps need a NAV under an
// hour old, and none may leave the price more than 5% from it; GanymedeRangeArbitrage, which the
// keeper runs, brings the price back to the NAV. Closing a position pays its tokens and fees at any
// NAV, and opens only within the caller's tick limits. RANGE_POOL_DEPLOYMENT pins the deployment
// `npm run deploy:range` recorded on 6 October 2026 with the user's approval, when it replaced the
// hook of that morning (the first to take those limits) with one that takes drawn shapes;
// onchain/test/AppRangeClient.test.ts checks the pin against the record. Demo dollars and USTX have no value.

export type RangeDeployment = V4Deployment & { arbitrage: string };

/** The pool on X Layer Testnet, as `npm run deploy:range` recorded it in onchain/deployments/xlayer-testnet.json. */
export const RANGE_POOL_DEPLOYMENT: RangeDeployment | null = {
  poolManager: "0xe83eee508ce92832488dd9f574ad329a1203641c",
  hook: "0x8e489d68cf8cbb9199105e3f0c32fc08936e28c0",
  router: "0xbd899115e3c6926d109a5bd39bf12646fae3862b",
  asset: "0x77eaeba1366bde7818da12d3cbdbea0a2ee97596",
  dollar: "0xf07535080f74e8b0f571e58dfa600f47e72ea9bf",
  assetIsCurrency0: true,
  poolId: "0xcdf2037d5744c2bc575bc595e109ac0cb942bcdec8d229c3cf0517edb9bb2942",
  stateSlot: "0x82e0159c7e66a997561511741bdb0118e92b14965af4fd7e84f15ce23d8a0791",
  arbitrage: "0xaee2ffbb9b3c3dbb5bda350d5df7314978b045dc",
};

/**
 * Every GanymedeRangeArbitrage: the one pinned above, for the hook of the afternoon of 6 October; the
 * one for the hook it replaced, of that morning; the third, for the first hook, which the caller
 * topped up to the fund's minimum (6 October); the second, replaced that day; and the first, replaced
 * on 4 October (docs/PRODUCT_RELEASE.md). The fund's events name
 * the contract as the investor in its orders, so the market activity folds each into the arbitrage it
 * was part of (lib/xstocks/activity.ts).
 */
export const RANGE_ARBITRAGES: readonly string[] = [
  ...(RANGE_POOL_DEPLOYMENT ? [RANGE_POOL_DEPLOYMENT.arbitrage] : []),
  "0xf76fa2ff202613556e6f30e3dda130a2fa10c593",
  "0x58571aa0519a82f1d3839cae5392dfb060c5d572",
  "0xa4cc0d50eb9fa78b8615ec264b034006e051cbb4",
  "0xbe0624ee3d949352498a767f1edbe235de38ca4d",
];

export const RANGE_SELECTORS = {
  open: "0x0dd51d63",
  openCustom: "0xa69e99b6",
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
  "0x5a9168be": "That shape is not one the pool takes: bins of 0.1% to 5%, up to 20 each side, with some weight on each side it fills.",
  "0x2c5211c6": "That amount is too small for the bins. Try a larger one.",
  "0x30cd7471": "That position belongs to another wallet.",
  "0x8d39f450": "That position is already closed.",
  "0xfad298ff": "The NAV record is over an hour old. Positions open again with the next record; closing still works.",
  "0x724cdd8c": "The NAV record is timed ahead of the chain’s clock. Try again in a minute.",
  "0xb25c0b55": "That trade would move the pool more than 5% from the NAV. Try a smaller amount.",
  "0x8199f5f3": "The pool moved before this was confirmed. Review it again.",
  "0x2d4627e0": "The pool’s price moved before your position opened. Review it again: the USTX you bought stays in your wallet.",
  "0x203d82d8": "This took too long to confirm. Try again.",
};

export const SHAPES = ["spot", "curve", "bid-ask", "custom"] as const;
export type RangeShape = (typeof SHAPES)[number];
/** The shapes the hook spreads by its own rule; a custom position's bins are weighed one by one (openCustom). */
export type PresetShape = Exclude<RangeShape, "custom">;
export const SHAPE_NAMES: Record<RangeShape, string> = { spot: "Spot", curve: "Curve", "bid-ask": "Bid-Ask", custom: "Custom" };

const OPEN_CUSTOM_ABI = parseAbi(["function openCustom(int24 binTicks, uint8 binsBelow, uint8 binsAbove, uint16[] weights, uint256 amount0, uint256 amount1, int24 minTick, int24 maxTick, uint256 deadline)"]);
/** The most a custom bin may weigh in openCustom's uint16. */
export const MAX_BIN_WEIGHT = 65_535;

/**
 * A preset shape's weight for every bin, lowest price first, as the hook's _presetWeights gives it:
 * 1 each for Spot, the bin next to the price heaviest for Curve, the farthest heaviest for Bid-Ask.
 */
export function shapeWeights(shape: PresetShape, binsBelow: number, binsAbove: number): number[] {
  return Array.from({ length: binsBelow + binsAbove }, (_, index) => {
    const below = index < binsBelow;
    const count = below ? binsBelow : binsAbove;
    const distance = below ? binsBelow - index : index - binsBelow + 1;
    return shape === "spot" ? 1 : shape === "curve" ? count + 1 - distance : distance;
  });
}

const NAV_UNIT = 100_000_000n;
const ONE = 1_000_000n;

/** A bin, with its dollar prices; a position's bins come lowest price first. */
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

/** Position ids known to be closed, per hook: a closed position never opens again, so later reads skip it. */
const CLOSED_POSITIONS = new Map<string, Set<bigint>>();

/** Multicall3, at its usual address on X Layer Testnet: many reads in one eth_call. */
export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const MULTICALL_ABI = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);
/** Reads per multicall, and per round of single reads where there is no multicall. */
const MULTICALL_READS = 100;
const SINGLE_READS = 10;

/**
 * Each call's return data at `tag`: through Multicall3 a hundred at a time, so a wallet's whole
 * history of positions takes a few requests, or one by one, ten at a time, where it is not deployed
 * (a local chain) or will not run them. A read that reverts throws, as `call` does.
 */
export async function readAll(rpc: Rpc, calls: readonly { to: string; data: string }[], tag: string): Promise<string[]> {
  const results: string[] = [];
  for (let start = 0; start < calls.length; start += MULTICALL_READS) {
    const chunk = calls.slice(start, start + MULTICALL_READS);
    let answers: readonly { success: boolean; returnData: string }[] | null = null;
    try {
      const data = encodeFunctionData({ abi: MULTICALL_ABI, functionName: "aggregate3", args: [chunk.map(item => ({ target: item.to as `0x${string}`, allowFailure: false, callData: item.data as `0x${string}` }))] });
      const raw = await call(rpc, MULTICALL3, data, tag);
      if (typeof raw === "string" && raw !== "0x") answers = decodeFunctionResult({ abi: MULTICALL_ABI, functionName: "aggregate3", data: raw as `0x${string}` });
    } catch (error) {
      if (!isRevert(error)) throw error;
    }
    if (answers && answers.length === chunk.length && answers.every(answer => answer.success)) {
      results.push(...answers.map(answer => answer.returnData));
      continue;
    }
    for (let next = 0; next < chunk.length; next += SINGLE_READS) {
      results.push(...await Promise.all(chunk.slice(next, next + SINGLE_READS).map(item => call(rpc, item.to, item.data, tag).then(value => value as string))));
    }
  }
  return results;
}

/** The pool and, with `account`, every open position of that wallet, read at one block. */
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
    // Every position the wallet ever opened, oldest first; those already seen closed are skipped.
    const closed = CLOSED_POSITIONS.get(hook) ?? new Set<bigint>();
    CLOSED_POSITIONS.set(hook, closed);
    const unseen = ids.filter(id => !closed.has(id));
    const heads = (await readAll(rpc, unseen.map(id => ({ to: hook, data: `${RANGE_SELECTORS.positions}${word(id)}` })), tag)).map((raw, index) => positionHead(unseen[index], raw));
    for (const head of heads) if (!head.open) closed.add(head.id);
    const open = heads.filter(head => head.open);
    const details = await readAll(rpc, open.flatMap(head => [
      { to: hook, data: `${RANGE_SELECTORS.binsOf}${word(head.id)}` },
      { to: hook, data: `${RANGE_SELECTORS.positionAmounts}${word(head.id)}` },
    ]), tag);
    const positions = open.map((head, index) => positionDetail(deployment, head, details[2 * index], details[2 * index + 1]));
    return { pool, account: { dollarsMicros: dollars, sharesMicros: shares, assetAllowanceMicros: assetAllowance, dollarAllowanceMicros: dollarAllowance, positions } };
  });
}

type PositionHead = Pick<RangePosition, "id" | "shape" | "binTicks" | "binsBelow" | "binsAbove" | "open">;

/** A position's shape and whether it is open, from the hook's `positions(id)`. */
function positionHead(id: bigint, raw: string): PositionHead {
  const [, shape, , binTicks, below, above, open] = words(raw, 7);
  return { id, shape: SHAPES[Number(shape)] ?? "spot", binTicks: signedTick(binTicks), binsBelow: Number(below), binsAbove: Number(above), open: open === 1n };
}

/** An open position's bins, tokens and fees, from the hook's `binsOf(id)` and `positionAmounts(id)`. */
function positionDetail(deployment: RangeDeployment, base: PositionHead, binsRaw: string, amountsRaw: string): RangePosition {
  const [lowers, uppers, liquidity] = decodeAbiParameters([{ type: "int24[]" }, { type: "int24[]" }, { type: "uint128[]" }], binsRaw as `0x${string}`);
  const [a0, a1, f0, f1] = words(amountsRaw, 4);
  const bins = lowers.map((lower, index) => {
    const a = tickToUsd(lower, deployment.assetIsCurrency0), b = tickToUsd(uppers[index], deployment.assetIsCurrency0);
    return { lower, upper: uppers[index], liquidity: liquidity[index], fromUsd: Math.min(a, b), toUsd: Math.max(a, b) };
  }).sort((one, other) => one.fromUsd - other.fromUsd); // by dollar price, whichever token is currency0
  return { ...base, bins, amounts: byToken(deployment, a0, a1), fees: byToken(deployment, f0, f1) };
}

/**
 * How far the pool's tick may move, from the one a provider saw, before their position opens: about
 * 0.3%. The bins go around the price when the position opens, so the hook refuses it outside these
 * limits rather than placing the bins around a price someone moved in the meantime; Pools also reads
 * the price again just before the wallet opens (assertRangePriceNear), so a moved price stops the open
 * before the provider signs.
 */
export const RANGE_OPEN_SLIPPAGE_TICKS = 30;
export const openLimits = (tick: number) => ({ minTick: tick - RANGE_OPEN_SLIPPAGE_TICKS, maxTick: tick + RANGE_OPEN_SLIPPAGE_TICKS });
/** An int24 tick as an ABI word, in two's complement. */
const tickWord = (tick: number) => word(BigInt.asUintN(256, BigInt(tick)));

/** The pool's price moved, from the tick the provider saw, by more than RANGE_OPEN_SLIPPAGE_TICKS. */
export class RangePriceMoved extends Error {
  readonly seenTick: number;
  readonly tick: number;
  constructor(seenTick: number, tick: number) {
    super("The pool’s price moved before your position opened. Review it again: the USTX you bought stays in your wallet.");
    this.name = "RangePriceMoved";
    this.seenTick = seenTick;
    this.tick = tick;
  }
}

/** The pool's tick now, at the newest block and not before `minBlock`. */
export async function readRangeTick(deployment: RangeDeployment, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<number> {
  const rpc = options.rpc ?? fundRpc();
  return atBlock(async () => {
    const block = await readBlock(rpc, options.minBlock);
    const [slot0] = words(await call(rpc, deployment.poolManager, `${RANGE_SELECTORS.extsload}${deployment.stateSlot.slice(2)}`, hexBlock(block)), 1);
    return signedTick(slot0 >> 160n);
  });
}

/** Throws RangePriceMoved unless the pool's tick is still within RANGE_OPEN_SLIPPAGE_TICKS of `seenTick`. */
export async function assertRangePriceNear(deployment: RangeDeployment, seenTick: number, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<void> {
  const tick = await readRangeTick(deployment, options);
  if (Math.abs(tick - seenTick) > RANGE_OPEN_SLIPPAGE_TICKS) throw new RangePriceMoved(seenTick, tick);
}

/** Calls to open and close positions; approvals go to the hook, which takes what the bins use. */
export function rangeCalls(deployment: RangeDeployment) {
  const approve = (token: string, micros: bigint): TransactionCall => ({ to: token, data: `${FUND_SELECTORS.approve}${addressWord(deployment.hook)}${word(micros)}` });
  return {
    approveShares: (micros: bigint) => approve(deployment.asset, micros),
    approveDollars: (micros: bigint) => approve(deployment.dollar, micros),
    /** `dollars` go in the bins below the price, `shares` in the bins above, if the pool's tick is within `limits`. */
    open: (shape: PresetShape, binTicks: number, binsBelow: number, binsAbove: number, amounts: V4Amounts, deadline: number, limits: { minTick: number; maxTick: number }): TransactionCall => {
      // Bins below the price hold currency1 and bins above it currency0.
      const [amount0, amount1] = deployment.assetIsCurrency0 ? [amounts.sharesMicros, amounts.dollarsMicros] : [amounts.dollarsMicros, amounts.sharesMicros];
      return {
        to: deployment.hook,
        data: `${RANGE_SELECTORS.open}${word(BigInt(SHAPES.indexOf(shape)))}${word(BigInt(binTicks))}${word(BigInt(binsBelow))}${word(BigInt(binsAbove))}${word(amount0)}${word(amount1)}${tickWord(limits.minTick)}${tickWord(limits.maxTick)}${word(BigInt(deadline))}`,
      };
    },
    /**
     * A position whose bins are weighed one by one: `weights` has one entry per bin, lowest price
     * first (the bins below, then the bins above), and each side's amount is shared by them.
     */
    openCustom: (binTicks: number, binsBelow: number, binsAbove: number, weights: readonly number[], amounts: V4Amounts, deadline: number, limits: { minTick: number; maxTick: number }): TransactionCall => {
      if (weights.length !== binsBelow + binsAbove || weights.some(weight => !Number.isInteger(weight) || weight < 0 || weight > MAX_BIN_WEIGHT)) throw new Error("Each bin needs a whole weight from 0 to 65,535.");
      const [amount0, amount1] = deployment.assetIsCurrency0 ? [amounts.sharesMicros, amounts.dollarsMicros] : [amounts.dollarsMicros, amounts.sharesMicros];
      return {
        to: deployment.hook,
        data: encodeFunctionData({ abi: OPEN_CUSTOM_ABI, functionName: "openCustom", args: [binTicks, binsBelow, binsAbove, weights, amount0, amount1, limits.minTick, limits.maxTick, BigInt(deadline)] }),
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
  if (error instanceof RangePriceMoved) return error.message;
  const data = hookRevert(error);
  const known = data ? RANGE_ERRORS[data.slice(0, 10).toLowerCase()] : undefined;
  return known ?? fundErrorMessage(data ? { data } : error);
}

/** A position's value at the NAV, in demo-dollar micros. */
export const rangeValueMicros = (amounts: V4Amounts, navMicros: bigint) => amounts.sharesMicros * navMicros / ONE + amounts.dollarsMicros;

export type PreviewBin = { fromUsd: number; toUsd: number; side: "dollars" | "shares"; value: number };

/**
 * Where a position's dollars would sit by price before it opens, as the hook spreads them: each
 * side's amount shared by its bins' weights (lowest price first, as openCustom takes them), in bins
 * of `binTicks` ticks either side of the price, skipping the interval the price is in. Prices in
 * dollars per USTX; values in dollars.
 */
export function previewWeights(weights: readonly number[], binTicks: number, binsBelow: number, binsAbove: number, dollars: number, sharesValue: number, priceUsd: number): PreviewBin[] {
  const below = weights.slice(0, binsBelow), above = weights.slice(binsBelow, binsBelow + binsAbove);
  const sum = (side: readonly number[]) => side.reduce((total, weight) => total + weight, 0);
  const step = Math.pow(1.0001, binTicks);
  const gap = Math.pow(1.0001, 10);
  const bins: PreviewBin[] = [];
  for (let distance = binsBelow; distance >= 1; distance -= 1) {
    const upper = priceUsd / Math.pow(step, distance - 1), lower = upper / step;
    bins.push({ fromUsd: lower, toUsd: upper, side: "dollars", value: sum(below) > 0 ? dollars * below[binsBelow - distance] / sum(below) : 0 });
  }
  for (let distance = 1; distance <= binsAbove; distance += 1) {
    const lower = priceUsd * gap * Math.pow(step, distance - 1), upper = lower * step;
    bins.push({ fromUsd: lower, toUsd: upper, side: "shares", value: sum(above) > 0 ? sharesValue * above[distance - 1] / sum(above) : 0 });
  }
  return bins;
}

/** previewWeights for a preset shape. */
export const previewShape = (shape: PresetShape, binTicks: number, binsBelow: number, binsAbove: number, dollars: number, sharesValue: number, priceUsd: number) =>
  previewWeights(shapeWeights(shape, binsBelow, binsAbove), binTicks, binsBelow, binsAbove, dollars, sharesValue, priceUsd);
