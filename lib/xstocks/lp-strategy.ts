/**
 * Liquidity strategies on Pools, as Meteora offers shapes, each one a deposit the contracts on X
 * Layer Testnet actually hold. Pooled strategies split demo dollars between the two pools that pool
 * their providers' liquidity: the constant-product pool spreads it over every price (Spot), and the
 * Uniswap v4 pool's hook keeps it within about 2% of the NAV and moves it to each NAV record (Curve).
 * Bid-Ask and Custom open a position of one's own in the range pool
 * (contracts/GanymedeRangeLiquidityHook.sol, lib/xstocks/range-liquidity.ts): bins either side of the
 * price, shaped Spot, Curve or Bid-Ask, over a range and on the sides one chooses.
 */
import { FUND_MIN_INVESTMENT_MICROS } from "./fund";

const ONE = 1_000_000n;

export type StrategyId = "spot" | "curve" | "spot-curve" | "bid-ask" | "custom";
export type Strategy = { id: StrategyId; name: string; label: string; pool: "pooled" | "range"; v4Percent: number; summary: string };
export type RangeSides = "both" | "below" | "above";
/** One's own position: its shape, how far either side of the price it reaches, its bins per side and which sides it fills. */
export type OwnRange = { shape: "spot" | "curve" | "bid-ask"; rangePercent: number; bins: number; sides: RangeSides };

export const LP_STRATEGIES: Strategy[] = [
  { id: "spot", name: "Spot", label: "Even at every price", pool: "pooled", v4Percent: 0, summary: "All of it in the constant-product pool: liquidity at every price, so it earns on any trade and never leaves its range, but little of it works near the NAV." },
  { id: "curve", name: "Curve", label: "Concentrated at the NAV", pool: "pooled", v4Percent: 100, summary: "All of it in the v4 pool: the hook keeps it within about 2% of the NAV and moves it to each NAV record, so far more of each dollar meets trades near the NAV." },
  { id: "spot-curve", name: "Spot + Curve", label: "Half in each", pool: "pooled", v4Percent: 50, summary: "Half in each pool: a peak at the NAV from the v4 pool on a low, even base from the constant-product pool." },
  { id: "bid-ask", name: "Bid-Ask", label: "Heaviest at the ends", pool: "range", v4Percent: 0, summary: "A position of your own: demo dollars below the price and USTX above it, more in each bin the farther it is from the price, out to 3% either side. It buys more as the price falls and sells more as it rises, earning most from large moves that come back." },
  { id: "custom", name: "Custom", label: "Your own range", pool: "range", v4Percent: 0, summary: "A position of your own, set as you like: its shape, how far it reaches either side of the price, how many bins, and whether it fills both sides or only one." },
];

export const BID_ASK_RANGE: OwnRange = { shape: "bid-ask", rangePercent: 3, bins: 10, sides: "both" };

/** The bin width in ticks for `bins` bins reaching `rangePercent` from the price: a whole number of 10-tick spacings, 10 to 500. */
export function binTicksFor(rangePercent: number, bins: number): number {
  const ticks = Math.log(1 + rangePercent / 100) / Math.log(1.0001) / Math.max(1, bins);
  return Math.max(10, Math.min(500, Math.round(ticks / 10) * 10));
}

/**
 * A deposit of demo dollars for a position of one's own: the part invested at the fund for the USTX
 * above the price and the demo dollars kept for the bins below it. Both sides take half each. Null
 * without a NAV, or when the part invested is under the fund's $10 minimum.
 */
export function planRange(dollarsMicros: bigint, navMicros: bigint | null, sides: RangeSides): { investMicros: bigint; sharesMicros: bigint; dollarsMicros: bigint } | null {
  if (navMicros === null || navMicros <= 0n || dollarsMicros <= 0n) return null;
  const investMicros = sides === "below" ? 0n : sides === "above" ? dollarsMicros : dollarsMicros / 2n;
  if (investMicros > 0n && investMicros < FUND_MIN_INVESTMENT_MICROS) return null;
  return { investMicros, sharesMicros: investMicros * ONE / navMicros, dollarsMicros: dollarsMicros - investMicros };
}

export const strategyById = (id: StrategyId) => LP_STRATEGIES.find(item => item.id === id) ?? LP_STRATEGIES[0];

type Reserves = { sharesMicros: bigint; dollarsMicros: bigint };
/** One pool's part of a deposit: the dollars invested at the fund, the USTX they buy, and the dollars deposited with it. */
export type StrategyPart = { totalMicros: bigint; investMicros: bigint; sharesMicros: bigint; dollarsMicros: bigint };
export type StrategyPlan = { constantProduct: StrategyPart | null; v4: StrategyPart | null; investMicros: bigint; sharesMicros: bigint };

/** A part of `dollarsMicros`: invested at the NAV in the pool's value ratio, the rest kept to deposit with the USTX. */
function part(dollarsMicros: bigint, navMicros: bigint, pool: Reserves): StrategyPart | null {
  if (dollarsMicros <= 0n || pool.sharesMicros === 0n || pool.dollarsMicros === 0n) return null;
  const investMicros = dollarsMicros * navMicros * pool.sharesMicros / (ONE * pool.dollarsMicros + navMicros * pool.sharesMicros);
  return { totalMicros: dollarsMicros, investMicros, sharesMicros: investMicros * ONE / navMicros, dollarsMicros: dollarsMicros - investMicros };
}

/**
 * Splits a deposit of demo dollars: `v4Percent` to the v4 pool, the rest to the constant-product
 * pool, each part invested at the fund in that pool's ratio so it goes in whole. One investment buys
 * the USTX for both, so the fund's $10 minimum applies to the two together. Null without a NAV, with
 * an empty pool that the split needs, or under that minimum.
 */
export function planStrategy(dollarsMicros: bigint, v4Percent: number, navMicros: bigint | null, constantProduct: Reserves | null, v4: Reserves | null): StrategyPlan | null {
  if (navMicros === null || navMicros <= 0n || dollarsMicros <= 0n) return null;
  const percent = BigInt(Math.max(0, Math.min(100, Math.round(v4Percent))));
  const toV4 = dollarsMicros * percent / 100n;
  const toConstant = dollarsMicros - toV4;
  const cp = toConstant > 0n ? constantProduct && part(toConstant, navMicros, constantProduct) : null;
  const pegged = toV4 > 0n ? v4 && part(toV4, navMicros, v4) : null;
  if ((toConstant > 0n && !cp) || (toV4 > 0n && !pegged)) return null;
  const investMicros = (cp?.investMicros ?? 0n) + (pegged?.investMicros ?? 0n);
  if (investMicros < FUND_MIN_INVESTMENT_MICROS) return null;
  return { constantProduct: cp, v4: pegged, investMicros, sharesMicros: investMicros * ONE / navMicros };
}

/** The USTX one investment bought, shared between the parts in proportion to what each invested; the v4 part takes the rounding. */
export function allocateShares(plan: StrategyPlan, receivedMicros: bigint): { constantProduct: bigint; v4: bigint } {
  if (!plan.constantProduct) return { constantProduct: 0n, v4: plan.v4 ? receivedMicros : 0n };
  if (!plan.v4) return { constantProduct: receivedMicros, v4: 0n };
  const constantProduct = receivedMicros * plan.constantProduct.investMicros / plan.investMicros;
  return { constantProduct, v4: receivedMicros - constantProduct };
}

/** A price range a pool's liquidity sits in, in dollars per USTX, with its liquidity in the pools' 6-decimal units. */
export type PriceRange = { lower: number; upper: number; liquidity: number };
export type ShapeBin = { from: number; to: number; side: "dollars" | "shares"; constantProduct: number; v4: number };

/** Dollars a range holds between two prices, at the current price: demo dollars below it, USTX (valued at the bin's middle) above. */
function inBin(range: PriceRange, price: number, from: number, to: number): number {
  const low = Math.max(from, range.lower), high = Math.min(to, range.upper);
  if (!(high > low) || range.liquidity <= 0) return 0;
  const l = range.liquidity / 1e6;
  let value = 0;
  // Below the price the range holds demo dollars, above it USTX.
  const below = Math.min(high, price);
  if (below > low) value += l * (Math.sqrt(below) - Math.sqrt(low));
  const above = Math.max(low, price);
  if (high > above) value += l * (1 / Math.sqrt(above) - 1 / Math.sqrt(high)) * (above + high) / 2;
  return value;
}

/** What a range holds in all, at the current price, in dollars. */
function rangeValue(range: PriceRange, price: number): number {
  return inBin(range, price, range.lower, range.upper);
}

/**
 * Where a deposit's dollars sit by price, in bins of `step` (a fraction of the NAV) out to `span`
 * either side: its share of each pool's ranges. The constant-product pool is one range over every
 * price; the v4 pool's ranges are its base and limit ranges as read from the hook.
 */
export function strategyShape(input: {
  navMicros: bigint; constantProductMicros: bigint; v4Micros: bigint;
  constantProduct: { ranges: PriceRange[]; price: number; valueMicros: bigint } | null;
  v4: { ranges: PriceRange[]; price: number; valueMicros: bigint } | null;
  span?: number; step?: number;
}): ShapeBin[] {
  const nav = Number(input.navMicros) / 1e6;
  const span = input.span ?? 0.06, step = input.step ?? 0.005;
  const count = Math.round(span / step);
  const scale = (pool: typeof input.v4, micros: bigint) => pool && pool.valueMicros > 0n ? Number(micros) / Number(pool.valueMicros) : 0;
  const cpScale = scale(input.constantProduct, input.constantProductMicros), v4Scale = scale(input.v4, input.v4Micros);
  const bins: ShapeBin[] = [];
  for (let k = -count; k < count; k += 1) {
    const from = nav * (1 + k * step), to = nav * (1 + (k + 1) * step);
    const sum = (pool: typeof input.v4, factor: number) => !pool || factor === 0 ? 0 : pool.ranges.reduce((total, range) => total + inBin(range, pool.price, from, to), 0) * factor;
    bins.push({ from, to, side: k < 0 ? "dollars" : "shares", constantProduct: sum(input.constantProduct, cpScale), v4: sum(input.v4, v4Scale) });
  }
  return bins;
}

/** The share of a deposit within `within` of the NAV, by pool: how much of it meets the trades that happen there. */
export function workingNearNav(bins: ShapeBin[], navMicros: bigint, within = 0.02): { constantProduct: number; v4: number } {
  const nav = Number(navMicros) / 1e6;
  return bins.filter(bin => bin.from >= nav * (1 - within) - 1e-9 && bin.to <= nav * (1 + within) + 1e-9)
    .reduce((total, bin) => ({ constantProduct: total.constantProduct + bin.constantProduct, v4: total.v4 + bin.v4 }), { constantProduct: 0, v4: 0 });
}

/** The constant-product pool as one range over every price, with its liquidity √(x·y). */
export function constantProductRange(pool: Reserves): PriceRange[] {
  if (pool.sharesMicros === 0n || pool.dollarsMicros === 0n) return [];
  return [{ lower: 1e-9, upper: 1e12, liquidity: Math.sqrt(Number(pool.sharesMicros) * Number(pool.dollarsMicros)) }];
}

/** What a year at each pool's measured result per $10,000 would come to for these parts; null where a pool has none yet. */
export function strategyYear(constantProductMicros: bigint, v4Micros: bigint, per10k: { constantProduct: bigint | null; v4: bigint | null }): bigint | null {
  const at = (micros: bigint, rate: bigint | null) => micros === 0n ? 0n : rate === null ? null : micros * rate / (10_000n * ONE);
  const cp = at(constantProductMicros, per10k.constantProduct), pegged = at(v4Micros, per10k.v4);
  return cp === null || pegged === null ? null : cp + pegged;
}

export { rangeValue };
