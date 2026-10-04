/**
 * A second price for each xStock, read straight from X Layer mainnet (196): the Uniswap V3 pool
 * where the xStock's ERC-4626 wrapper trades against a dollar stablecoin. The recorded prices come
 * from OKX OnchainOS; this comparison needs no API key, no account and nothing from Ganymede's
 * server, so the browser and the publisher can each run it on their own.
 */
import type { Composition } from "./basket";
import { batch, chainCheck, hex, quantity, type Call } from "./mainnet";

/** The Uniswap V3 factory on X Layer; each pool below is its pool for the pair at the 0.05% fee. */
export const POOL_FACTORY = "0x4b2ab38dbf28d31d467aa8993f6c2585981d6804";
export const POOL_FEE = 500;
const USDG = { symbol: "USDG", address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8" } as const;
const USDC = { symbol: "USDC", address: "0xb6ceceab302e2e4948951ee7843fc24e92933061" } as const;

/**
 * Pinned in code, not read from any response, and checked on chain at every read: the factory must
 * name the same pool for the wrapper and the stablecoin, and the wrapper must hold the xStock.
 */
export const XSTOCK_POOLS = [
  { symbol: "AAPLx", token: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a", wrapper: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f", pool: "0xc44bd9c8589026d28d1632d7b86b2efb6cdc8fd2", stable: USDG },
  { symbol: "MSFTx", token: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35", wrapper: "0x166fbe68274b6a47e025f4ba17388c539f1fa1d0", pool: "0x66187278490a70a8ac26a6e159eb045f82dbfb57", stable: USDG },
  { symbol: "NVDAx", token: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d", wrapper: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5", pool: "0x2a2b11730c2b6d99a58034a869dd810d7300a7b2", stable: USDG },
  { symbol: "AMZNx", token: "0x3557ba345b01efa20a1bddc61f573bfd87195081", wrapper: "0x910cabde3eba7fc1ce64fd14bd680b9f60fa0f90", pool: "0x8c1c0d559d1c7ae6ed921cc77abd0f26ac2fe59a", stable: USDG },
  { symbol: "METAx", token: "0x96702be57cd9777f835117a809c7124fe4ec989a", wrapper: "0xe840946ffebcd66b7c4e95095effafadfa0d0e56", pool: "0xfad9e3c7550768fd4f34bc9cefd365cc193c0fb0", stable: USDG },
  { symbol: "TSLAx", token: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0", wrapper: "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171", pool: "0x6a58944eed3d2074e137eb4e94b302fe4af247a6", stable: USDC },
  { symbol: "GOOGLx", token: "0xe92f673ca36c5e2efd2de7628f815f84807e803f", wrapper: "0xf8c5308f80e459bb53d9ebe689854d9cbb2caa6f", pool: "0x9f6273e2669cd812e76788b698374c43637c87c2", stable: USDC },
  { symbol: "ORCLx", token: "0x548308e91ec9f285c7bff05295badbd56a6e4971", wrapper: "0x1349456830ddc3d8599e4d6a63698883eca67ada", pool: "0x7132a1fe8f48e5ed07161ba7ce4c678c18b5757c", stable: USDC },
  { symbol: "PLTRx", token: "0x6d482cec5f9dd1f05ccee9fd3ff79b246170f8e2", wrapper: "0x4a2df09536f62341c9f946427d16414c04e21342", pool: "0x6e45d19cba0ac02e17f5ea7d5f0f0ea9dbc01e0d", stable: USDC },
] as const;

export type PoolEntry = { symbol: string; token: string; wrapper: string; pool: string; stable: { symbol: string; address: string } };

/**
 * Pools of the other xStocks the Ganymede funds hold (lib/funds/catalog.ts), each its token's
 * deepest pool on X Layer, checked on 4 October 2026. USTX reads only XSTOCK_POOLS.
 */
export const FUND_POOLS: readonly PoolEntry[] = [
  ...XSTOCK_POOLS,
  { symbol: "COINx", token: "0x364f210f430ec2448fc68a49203040f6124096f0", wrapper: "0x44c7ed7ffdf8465c9d27f60aec845eed3d49d56e", pool: "0x91db1a80bd51fcbd30c6bfa398eee0de24ee2663", stable: USDC },
  { symbol: "GMEx", token: "0xe5f6d3b2405abdfe6f660e63202b25d23763160d", wrapper: "0x459d3ae62b86cc6125e06260dddfd3afed24a877", pool: "0xb666c6572e0a76d0f0739f375be3c8a6dc02f84f", stable: USDC },
  { symbol: "SPYx", token: "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48", wrapper: "0xe7e553cd128f0011777323a0b44a7b96ea1cb540", pool: "0x07c40850d14064d20eb0afdef9574675392f2c11", stable: USDG },
  { symbol: "QQQx", token: "0xa753a7395cae905cd615da0b82a53e0560f250af", wrapper: "0x4c1ae29c159838fc1b224636e28e086eb69101f7", pool: "0x2bd90724ffc80ba22ec7af8cfd2b4b51ff395b04", stable: USDC },
];

/**
 * The pools and OnchainOS normally agree within a few tenths of a percent. A NAV more than 1% apart
 * means a price is wrong or a pool was moved. With nine equal weights, one xStock more than about 9%
 * off moves the NAV that far; a single thin pool moved by one trade usually does not.
 */
export const POOL_TOLERANCE = { navBps: 100 } as const;

const GET_POOL = "0x1698ee82";
const ASSET = "0x38d52e0f";
const TOKEN0 = "0x0dfe1681";
const SLOT0 = "0x3850c7bd";
const CONVERT_TO_ASSETS = "0x07a2d13a";
const DECIMALS = "0x313ce567";
const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const word = (value: string | bigint | number) => (typeof value === "string" ? value.toLowerCase().replace(/^0x/, "") : value.toString(16)).padStart(64, "0");
const addressOf = (value: unknown) => `0x${hex(value).slice(-40)}`.toLowerCase();

/**
 * Dollars (6 decimals) per whole xStock from a pool's sqrtPriceX96, for an 18-decimal wrapper and a
 * 6-decimal stablecoin, converted at the wrapper's rate (xStock units per 10^18 wrapper units).
 */
export function poolPriceMicros(sqrtPriceX96: bigint, stableIsToken0: boolean, assetsPerWrapperWad: bigint): bigint {
  if (sqrtPriceX96 <= 0n || assetsPerWrapperWad <= 0n) throw new Error("The pool returned no price.");
  const square = sqrtPriceX96 * sqrtPriceX96;
  // Uniswap quotes token1 per token0 in base units as (sqrtPriceX96 / 2^96)^2.
  const perWrapper = stableIsToken0 ? (WAD * Q192) / square : (square * WAD) / Q192;
  return (perWrapper * WAD) / assetsPerWrapperWad;
}

export type PoolPrice = { symbol: string; token: string; pool: string; stable: string; priceMicros: string };
export type PoolPrices = { blockNumber: number; blockTime: string; prices: PoolPrice[] };

/** Reads every pool at one block, after confirming each pool and wrapper on chain. */
export async function readPoolPrices(fetcher: typeof fetch = fetch, entries: readonly PoolEntry[] = XSTOCK_POOLS): Promise<PoolPrices> {
  const head = await batch([{ method: "eth_chainId", params: [] }, { method: "eth_blockNumber", params: [] }], fetcher);
  chainCheck(head);
  const block = `0x${quantity(head[1]).toString(16)}`;
  const call = (to: string, data: string): Call => ({ method: "eth_call", params: [{ to, data }, block] });
  const calls: Call[] = [{ method: "eth_getBlockByNumber", params: [block, false] }, call(USDG.address, DECIMALS), call(USDC.address, DECIMALS)];
  for (const entry of entries) {
    calls.push(
      call(POOL_FACTORY, `${GET_POOL}${word(entry.wrapper)}${word(entry.stable.address)}${word(POOL_FEE)}`),
      call(entry.wrapper, ASSET),
      call(entry.wrapper, DECIMALS),
      call(entry.wrapper, `${CONVERT_TO_ASSETS}${word(WAD)}`),
      call(entry.pool, TOKEN0),
      call(entry.pool, SLOT0),
    );
  }
  const results = await batch(calls, fetcher);
  const header = results[0] as { timestamp?: unknown } | null;
  if (!header || header.timestamp === undefined) throw new Error("X Layer RPC did not return the block.");
  if (quantity(results[1]) !== 6n || quantity(results[2]) !== 6n) throw new Error("A stablecoin no longer has 6 decimals.");
  const prices = entries.map((entry, index) => {
    const [pool, asset, decimals, assetsPerWrapper, token0, slot0] = results.slice(3 + index * 6, 9 + index * 6);
    if (addressOf(pool) !== entry.pool) throw new Error(`The factory names a different ${entry.symbol} pool.`);
    if (addressOf(asset) !== entry.token) throw new Error(`The ${entry.symbol} wrapper no longer holds ${entry.symbol}.`);
    if (quantity(decimals) !== 18n) throw new Error(`The ${entry.symbol} wrapper no longer has 18 decimals.`);
    const first = addressOf(token0);
    if (first !== entry.stable.address && first !== entry.wrapper) throw new Error(`The ${entry.symbol} pool holds other tokens.`);
    const sqrtPriceX96 = BigInt(`0x${hex(slot0).slice(2, 66) || "0"}`);
    return { symbol: entry.symbol, token: entry.token, pool: entry.pool, stable: entry.stable.symbol, priceMicros: poolPriceMicros(sqrtPriceX96, first === entry.stable.address, quantity(assetsPerWrapper)).toString() };
  });
  return { blockNumber: Number(quantity(head[1])), blockTime: new Date(Number(quantity(header.timestamp)) * 1000).toISOString(), prices };
}

export type PriceComparison = {
  rows: { symbol: string; recordedMicros: string; poolMicros: string; differenceBps: number }[];
  recordedNavMicros: string;
  /** The recorded units valued at the pool prices, with the same integer rounding as the NAV. */
  poolNavMicros: string;
  navDifferenceBps: number;
  agrees: boolean;
};

/** Hundredths of a percent, signed: positive when the pool is above the record. */
const bps = (pool: bigint, recorded: bigint) => Number(((pool - recorded) * 1_000_000n) / recorded) / 100;

/**
 * Compares a composition with pool prices. Returns null unless every holding is one of the pinned
 * xStocks at its pinned address, so a document for other tokens is never compared with these pools.
 */
export function comparePrices(composition: Pick<Composition, "holdings" | "navPerShareMicros">, pools: Pick<PoolPrices, "prices">): PriceComparison | null {
  if (!composition.holdings.length) return null;
  const rows = [];
  let poolNav = 0n;
  for (const holding of composition.holdings) {
    const pool = pools.prices.find(price => price.symbol === holding.symbol && price.token === holding.address.toLowerCase());
    const recorded = BigInt(holding.priceMicros);
    if (!pool || recorded <= 0n) return null;
    const poolMicros = BigInt(pool.priceMicros);
    poolNav += (BigInt(holding.unitsWad) * poolMicros) / WAD;
    rows.push({ symbol: holding.symbol, recordedMicros: holding.priceMicros, poolMicros: pool.priceMicros, differenceBps: bps(poolMicros, recorded) });
  }
  const recordedNav = BigInt(composition.navPerShareMicros);
  if (recordedNav <= 0n) return null;
  const navDifferenceBps = bps(poolNav, recordedNav);
  const agrees = Math.abs(navDifferenceBps) <= POOL_TOLERANCE.navBps;
  return { rows, recordedNavMicros: recordedNav.toString(), poolNavMicros: poolNav.toString(), navDifferenceBps, agrees };
}

/** "+0.12%" / "−0.40%" from hundredths of a percent. */
export function formatDifference(bpsValue: number): string {
  const percent = Math.abs(bpsValue) / 100;
  const text = `${percent.toFixed(2)}%`;
  return text === "0.00%" ? text : `${bpsValue < 0 ? "−" : "+"}${text}`;
}
