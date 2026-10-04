/**
 * The state of USTX's two pools as GET /api/v1/ustx/pools serves it: both pools read from X Layer
 * Testnet, with the last day of trades and the pools' results for their providers from the engine
 * state. A once-a-minute cron (POOLS_CRON) stores a snapshot in the engine state, so the public API
 * serves a recent read from the database instead of reading X Layer for each request; a public GET
 * only reads that snapshot, never writes it.
 */
import { EngineRepository } from "../engine/repository";
import type { EngineEnv } from "../engine/types";
import { activityDay, parseActivityIndex } from "./activity";
import { STATE_LP_MARKOUT, STATE_MARKET_ACTIVITY } from "./activity-index";
import { FUND_DEPLOYMENT, POOL_FEE_BPS, fundExplorer } from "./fund";
import { POOL_LAUNCHED_AT, lpTokenValueMicros, poolValueMicros, readLiquidity, readPoolYield } from "./liquidity";
import { annualizedPer, parseLpMarkout, type LpMarkout, type PoolResult } from "./lp-markout";
import { V4_POOL_DEPLOYMENT, readV4Pool, v4ValueMicros } from "./v4-liquidity";
import { snapshotOrRead, storeSnapshot, type Snapshot } from "./snapshot";

/** Every minute: a snapshot of both pools for the public API. */
export const POOLS_CRON = "* * * * *";
export const STATE_POOLS_SNAPSHOT = "xstocks:pools-snapshot";
/** A snapshot this recent is served as it is; an older one is used only when X Layer cannot be read. */
export const POOLS_SNAPSHOT_FRESH_MS = 90_000;

type Db = EngineEnv["DB"];
export type PoolsBody = Record<string, unknown>;
export type PoolsRead = Snapshot<PoolsBody>;

const WAD = 10n ** 18n;
/** "6.62" from an 18-decimal fraction: percent to two decimals, rounded toward zero. */
const percent = (wad: bigint) => { const bps = wad * 10_000n / WAD; const sign = bps < 0n ? "-" : ""; const size = bps < 0n ? -bps : bps; return `${sign}${size / 100n}.${(size % 100n).toString().padStart(2, "0")}`; };

/** The last 24 hours of the pool's trades, from the index the scheduled job keeps; null before its first run. */
async function lastDay(db: Db) {
  const index = parseActivityIndex((await new EngineRepository(db).getState(STATE_MARKET_ACTIVITY))?.value);
  if (!index) return null;
  const day = activityDay(index, Date.now());
  return { trades: day.poolTrades, volumeMicros: day.poolVolumeMicros.toString(), feesMicros: day.poolFeesMicros.toString(), complete: day.complete, since: day.since, toBlock: index.toBlock };
}

/** The pools' results for their providers, as the scheduled job last stored them; null before its first run. */
async function lpMarkout(db: Db): Promise<LpMarkout | null> {
  return parseLpMarkout((await new EngineRepository(db).getState(STATE_LP_MARKOUT))?.value);
}

/** One pool's result for its providers, with the same scaled to $10,000 of liquidity at its value now and a year. */
function lpResult(pool: PoolResult, markout: LpMarkout, valueMicros: bigint | null) {
  return {
    trades: pool.trades, volumeMicros: pool.volumeMicros.toString(), resultMicros: pool.resultMicros.toString(),
    arbitrages: pool.arbitrages, arbitrageResultMicros: pool.arbitrageResultMicros.toString(),
    per10kYearMicros: annualizedPer(pool.resultMicros, valueMicros, markout.toTime - markout.fromTime)?.toString() ?? null,
  };
}

/** Both pools, their last day and their results for providers, read from X Layer and the engine state. */
export async function readPools(db: Db): Promise<PoolsBody> {
  const [{ pool }, growth, day, v4, markout] = await Promise.all([
    readLiquidity(null),
    readPoolYield().catch(() => null),
    lastDay(db).catch(() => null),
    V4_POOL_DEPLOYMENT ? readV4Pool(V4_POOL_DEPLOYMENT, null).catch(() => null) : Promise.resolve(null),
    lpMarkout(db).catch(() => null),
  ]);
  const nav = pool.nav.navMicros;
  const priceMicros = pool.sharesMicros > 0n ? pool.dollarsMicros * 1_000_000n / pool.sharesMicros : null;
  const value = nav !== null ? poolValueMicros(pool, nav) : null;
  const pools: unknown[] = [{
    id: "ustx-dusd",
    type: "constant-product",
    address: FUND_DEPLOYMENT.pool,
    block: pool.block,
    tokens: { ustx: FUND_DEPLOYMENT.fund, dusd: FUND_DEPLOYMENT.dollar, decimals: 6 },
    lpToken: { address: FUND_DEPLOYMENT.pool, symbol: "USTX-LP", decimals: 6, supplyMicros: pool.supply.toString() },
    feeBps: Number(POOL_FEE_BPS),
    reserves: { ustxMicros: pool.sharesMicros.toString(), dusdMicros: pool.dollarsMicros.toString() },
    priceMicros: priceMicros?.toString() ?? null,
    navMicros: nav?.toString() ?? null,
    valueMicros: value?.toString() ?? null,
    lpTokenValueMicros: nav !== null && pool.supply > 0n ? lpTokenValueMicros(pool, nav).toString() : null,
    feeApr: growth && {
      percent: percent(growth.aprWad), wad: growth.aprWad.toString(), growthWad: growth.growthWad.toString(),
      fromBlock: growth.fromBlock, toBlock: growth.toBlock, from: new Date(growth.fromTime * 1000).toISOString(), to: new Date(growth.toTime * 1000).toISOString(),
      lpTokenValueFromMicros: growth.lpValueFromMicros?.toString() ?? null, lpTokenValueToMicros: growth.lpValueToMicros?.toString() ?? null,
      heldValueToMicros: growth.heldValueToMicros?.toString() ?? null,
    },
    last24h: day,
    lpResult: markout && lpResult(markout.constantProduct, markout, value),
    openedAt: POOL_LAUNCHED_AT,
    explorerUrl: fundExplorer.address(FUND_DEPLOYMENT.pool),
  }];
  if (V4_POOL_DEPLOYMENT && v4) {
    const { pool: hooked } = v4;
    const hookedValue = hooked.nav.answer !== null ? v4ValueMicros(hooked, hooked.nav.answer) : null;
    pools.push({
      id: "ustx-dusd-v4",
      type: "uniswap-v4-nav-pegged",
      hook: V4_POOL_DEPLOYMENT.hook, poolManager: V4_POOL_DEPLOYMENT.poolManager, router: V4_POOL_DEPLOYMENT.router,
      block: hooked.block,
      tokens: { ustx: V4_POOL_DEPLOYMENT.asset, dusd: V4_POOL_DEPLOYMENT.dollar, decimals: 6 },
      lpToken: { address: V4_POOL_DEPLOYMENT.hook, symbol: "USTX-V4LP", decimals: 6, supplyMicros: hooked.supply.toString() },
      feePips: hooked.feePips,
      holdings: { ustxMicros: hooked.sharesMicros.toString(), dusdMicros: hooked.dollarsMicros.toString() },
      waiting: { ustxMicros: hooked.pending.sharesMicros.toString(), dusdMicros: hooked.pending.dollarsMicros.toString() },
      priceMicros: hooked.priceMicros.toString(),
      navMicros: hooked.nav.answer !== null ? hooked.nav.navMicros.toString() : null,
      valueMicros: hookedValue?.toString() ?? null,
      peggedAt: hooked.peggedAt ? new Date(hooked.peggedAt * 1000).toISOString() : null,
      lpResult: markout && { ...lpResult(markout.v4, markout, hookedValue), repegs: markout.repegs },
      explorerUrl: fundExplorer.address(V4_POOL_DEPLOYMENT.hook),
    });
  }
  return {
    network: FUND_DEPLOYMENT.name,
    chainId: FUND_DEPLOYMENT.chainId,
    pools,
    lpResults: markout && {
      fromBlock: markout.fromBlock, from: new Date(markout.fromTime * 1000).toISOString(),
      toBlock: markout.toBlock, to: new Date(markout.toTime * 1000).toISOString(), navRecords: markout.navRecords,
    },
    rule: "readAt is when X Layer Testnet was read: a scheduled job reads both pools every minute and this API serves that read while it is under 90 seconds old (each server instance keeps what it served for up to 30 seconds), reading X Layer itself only when it is older; when X Layer cannot be read, a read up to 10 minutes old is served with stale set to true. Amounts are micros (6 decimals). valueMicros counts USTX at the fund's current NAV and dUSD at face value. feeApr is the growth of √(USTX × dUSD) per LP token between fromBlock and toBlock (the last seven days, or since the pool opened), which only the 0.3% fee raises, annualised without compounding; null when it cannot be read. Over the same blocks, lpTokenValueFromMicros and lpTokenValueToMicros value one LP token's part of the reserves at the NAV of each block, and heldValueToMicros values the same USTX and dUSD held outside the pool at the later NAV. last24h counts the pool's trades in the market activity index, an arbitrage's included, with the fee they paid in demo dollars; null before the index is built. A v4 pool appears once it is deployed: feePips is its swap fee now in hundredths of a basis point, and waiting holds deposits that become LP tokens at the next NAV record. lpResult compares the pools over the same blocks (lpResults: from the v4 pool's deployment to toBlock, with the USTX NAV records published between): each trade's result for the liquidity providers is what the pool took in less what it paid out, USTX at the NAV in effect at that trade and dUSD at face value, so it holds the fee less what the trader gained by trading away from the NAV; arbitrageResultMicros is the part from GanymedeNavArbitrage's trades, repegs counts the times the v4 hook moved its pool to a new record, and per10kYearMicros scales resultMicros to $10,000 of liquidity at the pool's value now and to a year. null before the scheduled job's first run.",
    environment: "X Layer Testnet. Demo dollars and USTX have no value; not an offer.",
  };
}

/** The cron's job: read both pools and store them for the public API. */
export async function runPoolsSnapshot(env: Pick<EngineEnv, "DB">, now: () => number = Date.now): Promise<PoolsRead> {
  return storeSnapshot(env.DB, STATE_POOLS_SNAPSHOT, await readPools(env.DB), now());
}

/** The pools for a public request: see snapshotOrRead. Reads only. */
export function poolsForRequest(db: Db, staleMs: number, now: () => number = Date.now) {
  return snapshotOrRead(db, STATE_POOLS_SNAPSHOT, () => readPools(db), { freshMs: POOLS_SNAPSHOT_FRESH_MS, staleMs, now });
}
