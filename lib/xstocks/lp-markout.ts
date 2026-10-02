/**
 * What liquidity providers made or lost on each USTX/dUSD pool's trades, valued at the NAV in effect
 * when each trade landed: the constant-product pool (GanymedeUstxPool) and the Uniswap v4 pool held at
 * the NAV (GanymedeRwaLiquidityHook), over the same blocks, from the v4 pool's deployment on.
 *
 * A trade's result for the providers is what the pool took in less what it paid out, USTX counted at
 * that NAV and demo dollars at face value. It holds the fee the trade paid, less whatever the trader
 * gained by trading at a price other than the NAV. A trade at a stale price after a NAV record (the
 * keeper's arbitrage of the constant-product pool) shows as a loss; the hook moves its pool to each
 * record before any trade, so no such trade is open on it. Deposits and withdrawals are not trades.
 *
 * The app's scheduled job keeps the running totals (lib/xstocks/activity-index.ts), reading the
 * pools', the arbitrage contract's, the pool manager's and the registry's events in block order.
 * Topics are pinned; onchain/test/AppFundClient.test.ts and AppV4Client.test.ts tie them to the
 * compiled contracts. Demo dollars and USTX have no value.
 */
import { ACTIVITY_EVENTS } from "./activity";
import { FUND_DEPLOYMENT, POOL_EVENTS, atBlock, hexBlock, quantity, readBlock, readNav, words, type Rpc } from "./fund";
import { V4_EVENTS, V4_POOL_DEPLOYMENT, byToken, type V4Deployment } from "./v4-liquidity";

// The registry and USTX's key in it, as lib/xstocks/proof.ts and onchain.ts pin them, and its
// NavPublished topic (lib/xstocks/evidence.ts); repeated so the contract tests can load this module
// alone. tests/lp-markout.test.mjs checks they agree.
export const MARKOUT_REGISTRY = "0xf320d2a7f280b7ab61e24374986869d7be34289c";
export const MARKOUT_PRODUCT_KEY = "0x7fd4bda948705c478ec63926a4cdececd33422c85c3e35f414251992b48c2a20";
export const MARKOUT_NAV_TOPIC = "0x7473313be7106e5141b2da10837d77c93ad5b7e1fa646edaaafcb7493432298b";

/** keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"): the pool manager's swaps. */
export const V4_SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
/** The block that deployed the v4 pool's hook on X Layer Testnet: both pools are counted from here. */
export const MARKOUT_FIRST_BLOCK = 42_411_426;
/** Requests of 100 blocks one scheduled run may make; the backlog is read over several runs. */
export const MARKOUT_CHUNKS_PER_RUN = 100;
/** Blocks the job stays behind the RPC's latest, as the activity index does. */
export const MARKOUT_MARGIN = 5;
const CHUNK_BLOCKS = 100;
const ATTEMPTS = 3;
const ONE = 1_000_000n;
const TWO_255 = 1n << 255n;
const TWO_256 = 1n << 256n;

export type PoolResult = {
  /** Trades in the pool and the demo dollars they moved. */
  trades: number;
  volumeMicros: bigint;
  /** What the providers made (positive) or lost (negative) on those trades, at the NAV of each. */
  resultMicros: bigint;
  /** The part of the trades that were the arbitrage contract's, and their result for the providers. */
  arbitrages: number;
  arbitrageResultMicros: bigint;
};

export type LpMarkout = {
  fromBlock: number;
  /** Block times, in seconds. */
  fromTime: number;
  toBlock: number;
  toTime: number;
  /** The NAV in effect at `toBlock`, and the USTX records published since `fromBlock`. */
  navMicros: bigint;
  navRecords: number;
  /** The times the hook moved its pool to a new NAV record. */
  repegs: number;
  constantProduct: PoolResult;
  v4: PoolResult;
};

const empty = (): PoolResult => ({ trades: 0, volumeMicros: 0n, resultMicros: 0n, arbitrages: 0, arbitrageResultMicros: 0n });
const invalid = () => new Error("X Layer Testnet returned an invalid pool event.");
const HASH = /^0x[0-9a-f]{64}$/;
const signed = (value: bigint) => (value >= TWO_255 ? value - TWO_256 : value);
/** USTX at the NAV, rounded toward zero. */
const atNav = (sharesMicros: bigint, navMicros: bigint) => sharesMicros * navMicros / ONE;

type Log = { address: string; topics: string[]; data: string; block: number; logIndex: number; hash: string };

/** The logs of one response, checked; others than the ones asked for are dropped. */
function logs(value: unknown, from: number, to: number, sources: Record<string, readonly string[]>): Log[] {
  if (!Array.isArray(value)) throw invalid();
  return value.flatMap((entry): Log[] => {
    const log = entry as Record<string, unknown>;
    if (!log || typeof log !== "object") throw invalid();
    if (log.removed === true) return [];
    const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
    const topics = Array.isArray(log.topics) ? log.topics.map(topic => typeof topic === "string" ? topic.toLowerCase() : "") : [];
    if (!sources[address]?.includes(topics[0])) return [];
    if (!topics.every(topic => HASH.test(topic)) || typeof log.data !== "string" || !/^0x[0-9a-f]*$/i.test(log.data)
      || typeof log.transactionHash !== "string" || !HASH.test(log.transactionHash.toLowerCase())) throw invalid();
    const block = Number(quantity(log.blockNumber));
    if (block < from || block > to) throw invalid();
    return [{ address, topics, data: log.data.toLowerCase(), block, logIndex: Number(quantity(log.logIndex)), hash: log.transactionHash.toLowerCase() }];
  });
}

/** The events counted, by lowercase address. */
function sources(deployment: V4Deployment | null): Record<string, readonly string[]> {
  return {
    [FUND_DEPLOYMENT.pool]: [POOL_EVENTS.bought, POOL_EVENTS.sold],
    [FUND_DEPLOYMENT.arbitrage]: [ACTIVITY_EVENTS.arbitraged],
    [MARKOUT_REGISTRY]: [MARKOUT_NAV_TOPIC],
    ...(deployment ? { [deployment.poolManager]: [V4_SWAP_TOPIC], [deployment.hook]: [V4_EVENTS.repegged] } : {}),
  };
}

/** The tally with the events of `events`, which hold every event of their blocks, applied in block order. */
export function applyEvents(markout: LpMarkout, events: Log[], deployment: V4Deployment | null): LpMarkout {
  const next: LpMarkout = { ...markout, constantProduct: { ...markout.constantProduct }, v4: { ...markout.v4 } };
  const arbitraged = new Set(events.filter(log => log.address === FUND_DEPLOYMENT.arbitrage).map(log => log.hash));
  const count = (pool: PoolResult, hash: string, dollarsMicros: bigint, resultMicros: bigint) => {
    pool.trades += 1;
    pool.volumeMicros += dollarsMicros < 0n ? -dollarsMicros : dollarsMicros;
    pool.resultMicros += resultMicros;
    if (arbitraged.has(hash)) { pool.arbitrages += 1; pool.arbitrageResultMicros += resultMicros; }
  };
  for (const log of [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)) {
    const [topic] = log.topics;
    if (log.address === MARKOUT_REGISTRY) {
      // The registry also records other products; only USTX's NAV prices these pools.
      if (log.topics[1] !== MARKOUT_PRODUCT_KEY) continue;
      const [nav] = words(log.data, 3);
      if (nav === 0n) throw invalid();
      next.navMicros = nav;
      next.navRecords += 1;
    } else if (log.address === FUND_DEPLOYMENT.pool && topic === POOL_EVENTS.bought) {
      const [dollarsIn, sharesOut] = words(log.data, 2);
      count(next.constantProduct, log.hash, dollarsIn, dollarsIn - atNav(sharesOut, next.navMicros));
    } else if (log.address === FUND_DEPLOYMENT.pool && topic === POOL_EVENTS.sold) {
      const [sharesIn, dollarsOut] = words(log.data, 2);
      count(next.constantProduct, log.hash, dollarsOut, atNav(sharesIn, next.navMicros) - dollarsOut);
    } else if (deployment && log.address === deployment.poolManager && topic === V4_SWAP_TOPIC) {
      // Swaps of other pools in the same manager, and the hook's own swap that moves its empty pool
      // to the NAV, are not trades with its providers.
      if (log.topics[1] !== deployment.poolId || log.topics[2] === `0x${deployment.hook.slice(2).padStart(64, "0")}`) continue;
      const [amount0, amount1] = words(log.data, 2).map(signed);
      // The event's amounts are the swapper's: what the pool took in is their negation.
      const taken = byToken(deployment, -amount0, -amount1);
      if (taken.sharesMicros === 0n && taken.dollarsMicros === 0n) continue;
      count(next.v4, log.hash, taken.dollarsMicros, atNav(taken.sharesMicros, next.navMicros) + taken.dollarsMicros);
    } else if (deployment && log.address === deployment.hook && topic === V4_EVENTS.repegged) {
      next.repegs += 1;
    }
  }
  return next;
}

async function blockTime(rpc: Rpc, block: number): Promise<number> {
  const header = await atBlock(() => rpc("eth_getBlockByNumber", [hexBlock(block), false]), ATTEMPTS) as { number?: unknown; timestamp?: unknown } | null;
  if (!header || Number(quantity(header.number)) !== block) throw invalid();
  return Number(quantity(header.timestamp));
}

/**
 * The tally after one scheduled run: the blocks since the last run, oldest first and at most `chunks`
 * requests of them, applied only once every request has answered, so a failed run changes nothing.
 */
export async function updateLpMarkout(markout: LpMarkout | null, rpc: Rpc, options: { chunks?: number; deployment?: V4Deployment | null; concurrency?: number } = {}): Promise<LpMarkout> {
  const deployment = options.deployment === undefined ? V4_POOL_DEPLOYMENT : options.deployment;
  const head = (await readBlock(rpc)) - MARKOUT_MARGIN;
  let current = markout;
  if (!current) {
    // The NAV in effect when counting starts: the fund's, read at the block before.
    const nav = await atBlock(() => readNav(rpc, hexBlock(MARKOUT_FIRST_BLOCK - 1)), ATTEMPTS);
    if (nav.navMicros === null) throw new Error("No USTX NAV was in effect where the pool results start.");
    const fromTime = await blockTime(rpc, MARKOUT_FIRST_BLOCK);
    current = { fromBlock: MARKOUT_FIRST_BLOCK, fromTime, toBlock: MARKOUT_FIRST_BLOCK - 1, toTime: fromTime, navMicros: nav.navMicros, navRecords: 0, repegs: 0, constantProduct: empty(), v4: empty() };
  }
  if (current.toBlock >= head) return current;
  const end = Math.min(head, current.toBlock + (options.chunks ?? MARKOUT_CHUNKS_PER_RUN) * CHUNK_BLOCKS);
  const ranges: Array<[number, number]> = [];
  for (let start = current.toBlock + 1; start <= end; start += CHUNK_BLOCKS) ranges.push([start, Math.min(end, start + CHUNK_BLOCKS - 1)]);
  const counted = sources(deployment);
  const request = { address: Object.keys(counted), topics: [[...new Set(Object.values(counted).flat())]] };
  const found: Log[] = [];
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, ranges.length) }, async () => {
    while (next < ranges.length && !failed) {
      const [start, stop] = ranges[next++];
      try {
        found.push(...await atBlock(async () => logs(await rpc("eth_getLogs", [{ ...request, fromBlock: hexBlock(start), toBlock: hexBlock(stop) }]), start, stop, counted), ATTEMPTS));
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  return { ...applyEvents(current, found, deployment), toBlock: end, toTime: await blockTime(rpc, end) };
}

export type PoolResultJson = { trades: number; volumeMicros: string; resultMicros: string; arbitrages: number; arbitrageResultMicros: string };
export type LpMarkoutJson = {
  fromBlock: number; from: string; toBlock: number; to: string; navMicros: string; navRecords: number; repegs: number;
  constantProduct: PoolResultJson; v4: PoolResultJson;
};

const resultJson = (pool: PoolResult): PoolResultJson => ({
  trades: pool.trades, volumeMicros: pool.volumeMicros.toString(), resultMicros: pool.resultMicros.toString(), arbitrages: pool.arbitrages, arbitrageResultMicros: pool.arbitrageResultMicros.toString(),
});

export function lpMarkoutJson(markout: LpMarkout): LpMarkoutJson {
  return {
    fromBlock: markout.fromBlock, from: new Date(markout.fromTime * 1000).toISOString(), toBlock: markout.toBlock, to: new Date(markout.toTime * 1000).toISOString(),
    navMicros: markout.navMicros.toString(), navRecords: markout.navRecords, repegs: markout.repegs,
    constantProduct: resultJson(markout.constantProduct), v4: resultJson(markout.v4),
  };
}

export const serializeLpMarkout = (markout: LpMarkout) => JSON.stringify(lpMarkoutJson(markout));

const count = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
};
const amount = (value: unknown, allowNegative = false) => {
  if (typeof value !== "string" || !(allowNegative ? /^-?\d{1,78}$/ : /^\d{1,78}$/).test(value)) throw invalid();
  return BigInt(value);
};
const time = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw invalid();
  return Math.floor(ms / 1000);
};
const result = (value: unknown): PoolResult => {
  const pool = value as Record<string, unknown>;
  if (!pool || typeof pool !== "object") throw invalid();
  return { trades: count(pool.trades), volumeMicros: amount(pool.volumeMicros), resultMicros: amount(pool.resultMicros, true), arbitrages: count(pool.arbitrages), arbitrageResultMicros: amount(pool.arbitrageResultMicros, true) };
};

/** A stored or served tally, checked; null when it is missing or malformed. */
export function parseLpMarkout(value: unknown): LpMarkout | null {
  try {
    const body = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
    if (!body || typeof body !== "object") return null;
    const markout = {
      fromBlock: count(body.fromBlock), fromTime: time(body.from), toBlock: count(body.toBlock), toTime: time(body.to),
      navMicros: amount(body.navMicros), navRecords: count(body.navRecords), repegs: count(body.repegs),
      constantProduct: result(body.constantProduct), v4: result(body.v4),
    };
    if (markout.toBlock < markout.fromBlock - 1 || markout.navMicros === 0n) return null;
    return markout;
  } catch {
    return null;
  }
}

/**
 * A result scaled to `perMicros` of liquidity and a year, from the pool's value now and the window's
 * length; null while the window is under an hour or the pool holds nothing.
 */
export function annualizedPer(resultMicros: bigint, poolValueMicros: bigint | null, seconds: number, perMicros = 10_000n * ONE): bigint | null {
  if (poolValueMicros === null || poolValueMicros <= 0n || seconds < 3_600) return null;
  return resultMicros * perMicros * 31_536_000n / (poolValueMicros * BigInt(Math.floor(seconds)));
}
