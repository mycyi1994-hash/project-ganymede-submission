/**
 * Market activity for USTX on X Layer Testnet, read from the contracts' own events: orders at the
 * fund, trades in the USTX/dUSD pool, the keeper's arbitrage and the lending market. X Layer makes
 * a block a second and its public RPC answers at most 100 blocks per log request, so the app's
 * scheduled job keeps the latest rows (lib/xstocks/activity-index.ts) and a page reads only the
 * blocks since. Topics are pinned here because the app bundle carries no keccak;
 * onchain/test/AppFundClient.test.ts ties them to the compiled contracts.
 */
import { FUND_DEPLOYMENT, FUND_EVENTS, POOL_EVENTS, atBlock, hexBlock, quantity, readBlock, words, type Rpc } from "./fund";
import { LENDING_EVENTS } from "./lending";
import { buyFeeMicros, sellFeeMicros } from "./liquidity";
import { RANGE_ARBITRAGES } from "./range-liquidity";
import { V4_EVENTS, V4_POOL_DEPLOYMENT, V4_SWAPPED_TOPIC, byToken } from "./v4-liquidity";

/** GanymedeBasketFund's deployment block on X Layer Testnet: no market event is older. */
export const ACTIVITY_FIRST_BLOCK = 41_844_113;
/** Rows served and shown, newest first. */
export const ACTIVITY_LIMIT = 40;
/** Rows the scheduled job keeps: more than a day of activity, which the 24-hour figures count. */
export const ACTIVITY_KEEP = 1_500;
/** The most blocks a page reads itself past the served rows: ten requests. */
export const ACTIVITY_TAIL_BLOCKS = 1_000;
const CHUNK_BLOCKS = 100;

export const ACTIVITY_EVENTS = {
  arbitraged: "0xd7fe8288874fe9aa932239d68664dba36abc0308c6622ea3e3f37062481548fe",
  liquidityAdded: "0x64b83944e79c3ce8d4c297411de637c3e102d064677aac0c163976ebdcd6f50e",
  liquidityRemoved: "0x1dc8bb69df2b8e91fbdcbfcf93d951b3f0000f085a95fe3f7946d6161439245d",
  liquidated: "0xfcbc974bf3a532baf2bb229db3c37fd58299b62d2d1db6a855dac5b693bb6ff3",
} as const;

/** The events each contract contributes, by lowercase address. The v4 pool's trades are its router's
 *  swaps (a swap sent to the pool manager by another contract is not listed), and its liquidity the hook's. */
const V4 = V4_POOL_DEPLOYMENT;
const SOURCES: Record<string, readonly string[]> = {
  [FUND_DEPLOYMENT.fund]: [FUND_EVENTS.invested, FUND_EVENTS.redeemed],
  [FUND_DEPLOYMENT.pool]: [POOL_EVENTS.bought, POOL_EVENTS.sold, ACTIVITY_EVENTS.liquidityAdded, ACTIVITY_EVENTS.liquidityRemoved],
  [FUND_DEPLOYMENT.arbitrage]: [ACTIVITY_EVENTS.arbitraged],
  [FUND_DEPLOYMENT.lending]: [...Object.values(LENDING_EVENTS), ACTIVITY_EVENTS.liquidated],
  ...(V4 ? { [V4.router]: [V4_SWAPPED_TOPIC], [V4.hook]: [V4_EVENTS.deposited, V4_EVENTS.withdrawn] } : {}),
  // The range pool's arbitrage reports each run with an event of the same signature as the
  // constant-product pool's, which it is told apart from by its address.
  ...Object.fromEntries(RANGE_ARBITRAGES.map(address => [address, [ACTIVITY_EVENTS.arbitraged]])),
};
const RANGE_ARBITRAGE = new Set(RANGE_ARBITRAGES);
const ADDRESSES = Object.keys(SOURCES);
const TOPICS = [...new Set(Object.values(SOURCES).flat())];

export type ActivityKind =
  // At the fund, at the NAV.
  | "invest" | "redeem"
  // In the USTX/dUSD pool.
  | "buy" | "sell" | "addLiquidity" | "removeLiquidity"
  // Both in one transaction, by GanymedeNavArbitrage.
  | "arbitrage"
  // In the range pool and at the fund in one transaction, by GanymedeRangeArbitrage.
  | "rangeArbitrage"
  // In the Uniswap v4 pool held at the NAV: trades through its router, and its liquidity.
  | "v4Buy" | "v4Sell" | "v4Deposit" | "v4Withdraw"
  // In the lending market, named as in lib/xstocks/lending.ts.
  | "deposit" | "withdrawCollateral" | "borrow" | "repay" | "lend" | "withdraw" | "liquidate";
const KINDS = new Set<string>(["invest", "redeem", "buy", "sell", "addLiquidity", "removeLiquidity", "arbitrage", "rangeArbitrage", "v4Buy", "v4Sell", "v4Deposit", "v4Withdraw", "deposit", "withdrawCollateral", "borrow", "repay", "lend", "withdraw", "liquidate"]);
/** The keeper's arbitrage, in either pool. */
export const isArbitrage = (kind: ActivityKind) => kind === "arbitrage" || kind === "rangeArbitrage";

export type MarketActivity = {
  kind: ActivityKind;
  hash: string;
  block: number;
  /** The row's event within its block: with the block, its place in time. */
  logIndex: number;
  /** Block time, ISO 8601. */
  at: string;
  /** The wallet that sent it: investor, trader, liquidity provider, borrower, lender or liquidator. */
  account: string;
  /** Demo dollars and USTX that moved, in micros; null where the event has none. An arbitrage's
   *  dollars are what went in, its shares what went through the pool. */
  dollarsMicros: bigint | null;
  sharesMicros: bigint | null;
  /** The NAV the fund filled at, or the one an arbitrage or a liquidation used. */
  navMicros: bigint | null;
  /** Arbitrage only, in either pool: the demo dollars that came back, and whether it bought in the pool. */
  dollarsOutMicros: bigint | null;
  boughtInPool: boolean | null;
  /** Liquidation only: the borrower whose loan was repaid. */
  borrower: string | null;
};

const invalid = () => new Error("X Layer Testnet returned an invalid market event.");
const HASH = /^0x[0-9a-f]{64}$/;

type ChainLog = { address: string; topics: string[]; data: string; block: number; logIndex: number; hash: string };
/** A decoded event; a range arbitrage's report keeps what it earned until its fund order is folded in. */
type EventRow = MarketActivity & { earnedMicros?: bigint };
/** A decoded event whose block time may still be missing: `row.at` is set once it is known. */
type ChainEvent = { row: EventRow; time: number | null };

/**
 * The market events in a log response for blocks `from` to `to`, checked and decoded; other logs
 * are dropped. Anything malformed throws, so the read is retried rather than stored.
 */
function chainEvents(value: unknown, from: number, to: number): ChainEvent[] {
  if (!Array.isArray(value)) throw invalid();
  return value.flatMap((entry): ChainEvent[] => {
    if (!entry || typeof entry !== "object") throw invalid();
    const log = entry as Record<string, unknown>;
    if (log.removed === true) return [];
    const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
    const topics = Array.isArray(log.topics) ? log.topics.map(topic => typeof topic === "string" ? topic.toLowerCase() : "") : [];
    if (!SOURCES[address]?.includes(topics[0])) return [];
    // The router serves any pool key: only this pool's swaps are its trades.
    if (V4 && address === V4.router && topics[2] !== V4.poolId) return [];
    if (!topics.every(topic => HASH.test(topic)) || typeof log.data !== "string" || !/^0x[0-9a-f]*$/i.test(log.data)
      || typeof log.transactionHash !== "string" || !HASH.test(log.transactionHash.toLowerCase())) throw invalid();
    const block = Number(quantity(log.blockNumber));
    if (block < from || block > to) throw invalid();
    const row = eventRow({ address, topics, data: log.data.toLowerCase(), block, logIndex: Number(quantity(log.logIndex)), hash: log.transactionHash.toLowerCase() });
    return [{ row, time: log.blockTimestamp === undefined || log.blockTimestamp === null ? null : Number(quantity(log.blockTimestamp)) }];
  });
}

const indexed = (topic: string | undefined) => {
  if (!topic || !/^0x0{24}[0-9a-f]{40}$/.test(topic)) throw invalid();
  return `0x${topic.slice(26)}`;
};

/** One event as a row of its own, before its block time is known. */
function eventRow(log: ChainLog): EventRow {
  const row = { hash: log.hash, block: log.block, logIndex: log.logIndex, at: "", account: indexed(log.topics[1]), dollarsMicros: null, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  const [topic] = log.topics;
  switch (topic) {
    case FUND_EVENTS.invested: { const [dollars, shares, nav] = words(log.data, 4); return { ...row, kind: "invest", dollarsMicros: dollars, sharesMicros: shares, navMicros: nav }; }
    case FUND_EVENTS.redeemed: { const [shares, dollars, nav] = words(log.data, 4); return { ...row, kind: "redeem", dollarsMicros: dollars, sharesMicros: shares, navMicros: nav }; }
    case POOL_EVENTS.bought: { const [dollars, shares] = words(log.data, 2); return { ...row, kind: "buy", dollarsMicros: dollars, sharesMicros: shares }; }
    case POOL_EVENTS.sold: { const [shares, dollars] = words(log.data, 2); return { ...row, kind: "sell", dollarsMicros: dollars, sharesMicros: shares }; }
    case ACTIVITY_EVENTS.liquidityAdded: { const [shares, dollars] = words(log.data, 3); return { ...row, kind: "addLiquidity", dollarsMicros: dollars, sharesMicros: shares }; }
    case ACTIVITY_EVENTS.liquidityRemoved: { const [shares, dollars] = words(log.data, 3); return { ...row, kind: "removeLiquidity", dollarsMicros: dollars, sharesMicros: shares }; }
    case ACTIVITY_EVENTS.arbitraged: {
      if (RANGE_ARBITRAGE.has(log.address)) {
        // The USTX it moved through the range pool and what it earned; the dollars come from its fund order.
        const [bought, shares, earned, nav] = words(log.data, 4);
        if (bought > 1n) throw invalid();
        return { ...row, kind: "rangeArbitrage", sharesMicros: shares, navMicros: nav, boughtInPool: bought === 1n, earnedMicros: earned };
      }
      const [bought, dollarsIn, dollarsOut, nav] = words(log.data, 4);
      if (bought > 1n) throw invalid();
      return { ...row, kind: "arbitrage", dollarsMicros: dollarsIn, dollarsOutMicros: dollarsOut, navMicros: nav, boughtInPool: bought === 1n };
    }
    case V4_SWAPPED_TOPIC: {
      if (!V4) throw invalid();
      const [direction, amountIn, amountOut] = words(log.data, 3);
      if (direction > 1n) throw invalid();
      // Buying USTX pays demo dollars: currency1 to currency0 when USTX is currency0.
      const bought = (direction === 1n) !== V4.assetIsCurrency0;
      return bought ? { ...row, kind: "v4Buy", dollarsMicros: amountIn, sharesMicros: amountOut } : { ...row, kind: "v4Sell", sharesMicros: amountIn, dollarsMicros: amountOut };
    }
    case V4_EVENTS.deposited: {
      if (!V4) throw invalid();
      const amounts = byToken(V4, ...(words(log.data, 2) as [bigint, bigint]));
      return { ...row, kind: "v4Deposit", ...amounts };
    }
    case V4_EVENTS.withdrawn: {
      if (!V4) throw invalid();
      const [, amount0, amount1] = words(log.data, 3);
      return { ...row, kind: "v4Withdraw", ...byToken(V4, amount0, amount1) };
    }
    case LENDING_EVENTS.collateralSupplied: return { ...row, kind: "deposit", sharesMicros: words(log.data, 1)[0] };
    case LENDING_EVENTS.collateralWithdrawn: return { ...row, kind: "withdrawCollateral", sharesMicros: words(log.data, 1)[0] };
    case LENDING_EVENTS.borrowed: return { ...row, kind: "borrow", dollarsMicros: words(log.data, 1)[0] };
    case LENDING_EVENTS.repaid: return { ...row, kind: "repay", dollarsMicros: words(log.data, 1)[0] };
    case LENDING_EVENTS.supplied: return { ...row, kind: "lend", dollarsMicros: words(log.data, 1)[0] };
    case LENDING_EVENTS.withdrawn: return { ...row, kind: "withdraw", dollarsMicros: words(log.data, 1)[0] };
    case ACTIVITY_EVENTS.liquidated: {
      const [repaid, seized, nav] = words(log.data, 3);
      return { ...row, kind: "liquidate", borrower: indexed(log.topics[2]), dollarsMicros: repaid, sharesMicros: seized, navMicros: nav };
    }
    default: throw invalid();
  }
}

const newestFirst = (a: MarketActivity, b: MarketActivity) => b.block - a.block || b.logIndex - a.logIndex;
/**
 * The arbitrage contracts' own trades in the pool and orders at the fund: the halves of their rows.
 * The range pool's arbitrage leaves only its fund order, as its swap is the pool manager's event.
 */
const half = (row: MarketActivity) => (row.account === FUND_DEPLOYMENT.arbitrage && ["buy", "sell", "invest", "redeem"].includes(row.kind))
  || (RANGE_ARBITRAGE.has(row.account) && (row.kind === "invest" || row.kind === "redeem"));

/**
 * A range arbitrage as one row: it bought USTX in the range pool and redeemed it at the fund, or
 * invested at the fund and sold the USTX there. Its fund order gives the dollars, and what it earned
 * the other side. A run that moved the price across a stretch with no liquidity traded nothing.
 */
function rangeArbitrageRow({ earnedMicros = 0n, ...report }: EventRow, order: MarketActivity | undefined): MarketActivity[] {
  if (report.sharesMicros === 0n) return [];
  const dollars = order?.dollarsMicros ?? null;
  if (dollars === null) return [report];
  // It earns what the fund paid less what the pool took: never more than the fund paid.
  if (report.boughtInPool && earnedMicros > dollars) throw invalid();
  return [report.boughtInPool
    ? { ...report, dollarsMicros: dollars - earnedMicros, dollarsOutMicros: dollars }
    : { ...report, dollarsMicros: dollars, dollarsOutMicros: dollars + earnedMicros }];
}

/**
 * Rows from decoded events, newest first. An arbitrage is one row: its pool trade and fund order
 * are folded into the Arbitraged event that follows them, which gains the USTX the pool traded.
 */
function rowsFromEvents(events: ChainEvent[], times: Map<number, number>): MarketActivity[] {
  const byTransaction = new Map<string, EventRow[]>();
  for (const { row, time } of [...events].sort((a, b) => a.row.block - b.row.block || a.row.logIndex - b.row.logIndex)) {
    const seconds = time ?? times.get(row.block);
    if (seconds === undefined) throw invalid();
    byTransaction.set(row.hash, [...(byTransaction.get(row.hash) ?? []), { ...row, at: new Date(seconds * 1000).toISOString() }]);
  }
  const rows: MarketActivity[] = [];
  for (const transaction of byTransaction.values()) {
    let halves: MarketActivity[] = [];
    for (const row of transaction) {
      if (half(row)) halves.push(row);
      else if (row.kind === "arbitrage") {
        const pool = halves.find(item => item.kind === "buy" || item.kind === "sell");
        rows.push({ ...row, sharesMicros: pool?.sharesMicros ?? null });
        halves = [];
      } else if (row.kind === "rangeArbitrage") {
        rows.push(...rangeArbitrageRow(row, halves.find(item => RANGE_ARBITRAGE.has(item.account))));
        halves = [];
      } else rows.push(row);
    }
    // Never expected: the arbitrage contract always emits Arbitraged after both halves.
    rows.push(...halves);
  }
  return rows.sort(newestFirst);
}

/** Block times for events whose response left them out. */
async function blockTimes(rpc: Rpc, events: ChainEvent[], attempts?: number): Promise<Map<number, number>> {
  const blocks = [...new Set(events.filter(event => event.time === null).map(event => event.row.block))];
  const times = new Map<number, number>();
  for (const block of blocks) {
    const header = await atBlock(() => rpc("eth_getBlockByNumber", [hexBlock(block), false]), attempts) as { number?: unknown; timestamp?: unknown } | null;
    if (!header || Number(quantity(header.number)) !== block) throw invalid();
    times.set(block, Number(quantity(header.timestamp)));
  }
  return times;
}

/**
 * Every market event in blocks `from` to `to`, as rows, read 100 blocks per request. Each request
 * is tried up to `attempts` times.
 */
export async function scanActivity(rpc: Rpc, from: number, to: number, options: { concurrency?: number; attempts?: number } = {}): Promise<MarketActivity[]> {
  if (to < from) return [];
  const ranges: Array<[number, number]> = [];
  for (let start = from; start <= to; start += CHUNK_BLOCKS) ranges.push([start, Math.min(to, start + CHUNK_BLOCKS - 1)]);
  const events: ChainEvent[] = [];
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, ranges.length) }, async () => {
    while (next < ranges.length && !failed) {
      const [start, end] = ranges[next++];
      try {
        // A node that has not reached `end` answers with an error, so a retry never skips blocks.
        events.push(...await atBlock(async () => chainEvents(await rpc("eth_getLogs", [{ address: ADDRESSES, fromBlock: hexBlock(start), toBlock: hexBlock(end), topics: [TOPICS] }]), start, end), options.attempts));
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  return rowsFromEvents(events, await blockTimes(rpc, events, options.attempts));
}

/** `rows` and `more` as one list, newest first, each event once, at most `limit` rows. */
export function mergeActivity(rows: MarketActivity[], more: MarketActivity[], limit = ACTIVITY_LIMIT): MarketActivity[] {
  const byEvent = new Map<string, MarketActivity>();
  for (const row of [...rows, ...more]) byEvent.set(`${row.hash}:${row.logIndex}`, row);
  return [...byEvent.values()].sort(newestFirst).slice(0, limit);
}

/**
 * What the scheduled job keeps: every event of blocks `fromBlock` to `toBlock`, newest first, at most
 * `keep` of them. When rows are dropped for room, `fromBlock` moves up past the oldest kept.
 */
export type ActivityIndex = { fromBlock: number; toBlock: number; keep: number; rows: MarketActivity[] };
/** Blocks the job stays behind the RPC's latest, so a node still indexing it cannot be read short. */
export const ACTIVITY_INDEX_MARGIN = 5;
/** Requests of 100 blocks one scheduled run may make: new blocks first, then history. */
export const ACTIVITY_CHUNKS_PER_RUN = 30;
/** Tries per request in a scheduled run: few, so a flaky RPC ends the run early and the next retries. */
const INDEX_ATTEMPTS = 3;

/**
 * The index after one scheduled run: blocks since the last run, oldest first so the range stays
 * whole; then, with the requests left, blocks before the first run, back to the fund's deployment,
 * until the rows are full.
 */
export async function updateActivityIndex(index: ActivityIndex | null, rpc: Rpc, options: { chunks?: number } = {}): Promise<ActivityIndex> {
  const head = (await readBlock(rpc)) - ACTIVITY_INDEX_MARGIN;
  let { fromBlock, toBlock, rows } = index ?? { fromBlock: head + 1, toBlock: head, rows: [] };
  // An index kept with fewer rows may have dropped its oldest: read again below the oldest kept.
  if (index && index.keep < ACTIVITY_KEEP && rows.length >= index.keep && rows.length > 0) fromBlock = Math.max(fromBlock, rows[rows.length - 1].block + 1);
  const add = (more: MarketActivity[]) => {
    const merged = mergeActivity(rows, more, Infinity);
    rows = merged.slice(0, ACTIVITY_KEEP);
    if (merged.length > ACTIVITY_KEEP) fromBlock = Math.max(fromBlock, rows[rows.length - 1].block + 1);
  };
  let chunks = options.chunks ?? ACTIVITY_CHUNKS_PER_RUN;
  // Rows kept from before the range pool's arbitrage was folded in are its fund orders, under the
  // contract's address. Their blocks are read again, so each becomes the arbitrage it was part of.
  const stale = [...new Set(rows.filter(row => RANGE_ARBITRAGE.has(row.account)).map(row => row.block))].slice(0, chunks);
  for (const block of stale) {
    const again = await scanActivity(rpc, block, block, { attempts: INDEX_ATTEMPTS });
    const replaced = new Set(rows.filter(row => row.block === block && RANGE_ARBITRAGE.has(row.account)).map(row => row.hash));
    rows = mergeActivity(rows.filter(row => !replaced.has(row.hash)), again.filter(row => replaced.has(row.hash)), Infinity);
    chunks -= 1;
  }
  if (toBlock < head) {
    const end = Math.min(head, toBlock + chunks * CHUNK_BLOCKS);
    const more = await scanActivity(rpc, toBlock + 1, end, { attempts: INDEX_ATTEMPTS });
    chunks -= Math.ceil((end - toBlock) / CHUNK_BLOCKS);
    toBlock = end;
    add(more);
  }
  if (chunks > 0 && fromBlock > ACTIVITY_FIRST_BLOCK && rows.length < ACTIVITY_KEEP) {
    const start = Math.max(ACTIVITY_FIRST_BLOCK, fromBlock - chunks * CHUNK_BLOCKS);
    const more = await scanActivity(rpc, start, fromBlock - 1, { attempts: INDEX_ATTEMPTS });
    fromBlock = start;
    add(more);
  }
  return { fromBlock, toBlock, keep: ACTIVITY_KEEP, rows };
}

export type ActivityDay = {
  /** Whether every event of the last 24 hours is counted; if not, the count starts at `since`. */
  complete: boolean;
  since: string;
  /** Orders at the fund and in the pool, and arbitrage: how many, and the demo dollars they moved. */
  trades: number;
  volumeMicros: bigint;
  /** Arbitrage runs and the demo dollars they earned. */
  arbitrages: number;
  earnedMicros: bigint;
  /** Lending steps: deposits and withdrawals of collateral, loans, repayments, lending and liquidations. */
  loans: number;
  /** Trades in the USTX/dUSD pool, an arbitrage's included: how many, the demo dollars that went in
   *  or came out, and the 0.3% fee they left with the pool's liquidity providers. */
  poolTrades: number;
  poolVolumeMicros: bigint;
  poolFeesMicros: bigint;
};

const TRADE_KINDS = new Set<ActivityKind>(["invest", "redeem", "buy", "sell", "arbitrage", "rangeArbitrage", "v4Buy", "v4Sell"]);
const LOAN_KINDS = new Set<ActivityKind>(["deposit", "withdrawCollateral", "borrow", "repay", "lend", "withdraw", "liquidate"]);

/**
 * A row's trade in the pool: the demo dollars paid in (a purchase) or out (a sale), and the fee in
 * demo dollars. An arbitrage bought in the pool with all it put in, or sold there for all it took out.
 */
export function poolTrade(row: MarketActivity): { volumeMicros: bigint; feeMicros: bigint } | null {
  const bought = row.kind === "buy" || (row.kind === "arbitrage" && row.boughtInPool === true);
  const sold = row.kind === "sell" || (row.kind === "arbitrage" && row.boughtInPool === false);
  const dollars = row.kind === "arbitrage" && sold ? row.dollarsOutMicros : row.dollarsMicros;
  if (dollars === null || (!bought && !sold)) return null;
  return { volumeMicros: dollars, feeMicros: bought ? buyFeeMicros(dollars) : sellFeeMicros(dollars) };
}

/** The figures of `rows` at or after `sinceMs`. */
export function activityCounts(rows: MarketActivity[], sinceMs: number): Omit<ActivityDay, "complete" | "since"> {
  const day = { trades: 0, volumeMicros: 0n, arbitrages: 0, earnedMicros: 0n, loans: 0, poolTrades: 0, poolVolumeMicros: 0n, poolFeesMicros: 0n };
  for (const row of rows) {
    if (Date.parse(row.at) < sinceMs) continue;
    if (TRADE_KINDS.has(row.kind)) { day.trades += 1; day.volumeMicros += row.dollarsMicros ?? 0n; }
    if (isArbitrage(row.kind)) {
      day.arbitrages += 1;
      if (row.dollarsOutMicros !== null && row.dollarsMicros !== null && row.dollarsOutMicros > row.dollarsMicros) day.earnedMicros += row.dollarsOutMicros - row.dollarsMicros;
    }
    if (LOAN_KINDS.has(row.kind)) day.loans += 1;
    const trade = poolTrade(row);
    if (trade) { day.poolTrades += 1; day.poolVolumeMicros += trade.volumeMicros; day.poolFeesMicros += trade.feeMicros; }
  }
  return day;
}

/**
 * The last 24 hours of the index at `nowMs`. They are complete when the index holds every event
 * since the fund's deployment, or its oldest kept row is older than a day; otherwise the count
 * starts at the oldest kept row.
 */
export function activityDay(index: ActivityIndex, nowMs: number): ActivityDay {
  const dayStart = nowMs - 86_400_000;
  const oldest = index.rows.at(-1);
  const complete = (index.fromBlock <= ACTIVITY_FIRST_BLOCK && index.rows.length < index.keep) || (oldest !== undefined && Date.parse(oldest.at) <= dayStart);
  const sinceMs = complete || !oldest ? dayStart : Date.parse(oldest.at);
  return { complete, since: new Date(sinceMs).toISOString(), ...activityCounts(index.rows, sinceMs) };
}

/** The figures with rows read after them added: a page's own reads of the newest blocks. */
export function withNewerRows(day: ActivityDay, newer: MarketActivity[]): ActivityDay {
  const more = activityCounts(newer, Date.parse(day.since));
  return {
    ...day, trades: day.trades + more.trades, volumeMicros: day.volumeMicros + more.volumeMicros,
    arbitrages: day.arbitrages + more.arbitrages, earnedMicros: day.earnedMicros + more.earnedMicros, loans: day.loans + more.loans,
    poolTrades: day.poolTrades + more.poolTrades, poolVolumeMicros: day.poolVolumeMicros + more.poolVolumeMicros, poolFeesMicros: day.poolFeesMicros + more.poolFeesMicros,
  };
}

/** Orders of this size or more are marked on the NAV chart, as is every arbitrage. */
export const LARGE_ORDER_MICROS = 1_000_000_000n;
/** At most this many marked rows are served. */
export const ACTIVITY_HIGHLIGHTS = 60;
const ORDER_KINDS = new Set<ActivityKind>(["invest", "redeem", "buy", "sell", "v4Buy", "v4Sell"]);

/** A row worth marking on the NAV chart: the keeper's arbitrage, or an order of $1,000 or more. */
export function isHighlight(row: MarketActivity): boolean {
  return isArbitrage(row.kind) || (ORDER_KINDS.has(row.kind) && row.dollarsMicros !== null && row.dollarsMicros >= LARGE_ORDER_MICROS);
}

/** Served marked rows, checked and newest first; empty when missing or malformed. */
export function parseHighlights(value: unknown): MarketActivity[] {
  try {
    if (!Array.isArray(value) || value.length > ACTIVITY_HIGHLIGHTS) return [];
    return value.map(activityFromJson).filter(isHighlight).sort(newestFirst);
  } catch {
    return [];
  }
}

export type ActivityDayJson = {
  complete: boolean; since: string; trades: number; volumeMicros: string; arbitrages: number; earnedMicros: string; loans: number;
  poolTrades: number; poolVolumeMicros: string; poolFeesMicros: string;
};
export const activityDayJson = (day: ActivityDay): ActivityDayJson => ({
  ...day, volumeMicros: day.volumeMicros.toString(), earnedMicros: day.earnedMicros.toString(), poolVolumeMicros: day.poolVolumeMicros.toString(), poolFeesMicros: day.poolFeesMicros.toString(),
});

/**
 * The served rows with the blocks since read directly, newest first. Reads at most
 * ACTIVITY_TAIL_BLOCKS, from `after` (the last block this page read) when that is later.
 */
export async function readActivityTail(served: ActivityIndex | null, rpc: Rpc, options: { after?: number; minBlock?: number } = {}): Promise<{ rows: MarketActivity[]; head: number }> {
  const head = await readBlock(rpc, options.minBlock);
  const from = Math.max((served?.toBlock ?? 0) + 1, (options.after ?? 0) + 1, head - ACTIVITY_TAIL_BLOCKS + 1);
  return { rows: mergeActivity(served?.rows ?? [], await scanActivity(rpc, from, head)), head };
}

export type ActivityJson = {
  kind: ActivityKind; hash: string; block: number; logIndex: number; at: string; account: string;
  dollarsMicros: string | null; sharesMicros: string | null; navMicros: string | null; dollarsOutMicros: string | null; boughtInPool: boolean | null; borrower: string | null;
};

const micros = (value: bigint | null) => value === null ? null : value.toString();
export function activityJson(row: MarketActivity): ActivityJson {
  return {
    kind: row.kind, hash: row.hash, block: row.block, logIndex: row.logIndex, at: row.at, account: row.account,
    dollarsMicros: micros(row.dollarsMicros), sharesMicros: micros(row.sharesMicros), navMicros: micros(row.navMicros),
    dollarsOutMicros: micros(row.dollarsOutMicros), boughtInPool: row.boughtInPool, borrower: row.borrower,
  };
}

const ADDRESS = /^0x[0-9a-f]{40}$/;
const amount = (value: unknown): bigint | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw invalid();
  return BigInt(value);
};
const count = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
};

/** A row from its JSON form, checked; throws on anything else. */
export function activityFromJson(value: unknown): MarketActivity {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || typeof row.kind !== "string" || !KINDS.has(row.kind) || typeof row.hash !== "string" || !HASH.test(row.hash)
    || typeof row.account !== "string" || !ADDRESS.test(row.account) || typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at))
    || (row.borrower !== null && (typeof row.borrower !== "string" || !ADDRESS.test(row.borrower)))
    || (row.boughtInPool !== null && typeof row.boughtInPool !== "boolean")) throw invalid();
  return {
    kind: row.kind as ActivityKind, hash: row.hash, block: count(row.block), logIndex: count(row.logIndex), at: new Date(row.at).toISOString(), account: row.account,
    dollarsMicros: amount(row.dollarsMicros), sharesMicros: amount(row.sharesMicros), navMicros: amount(row.navMicros),
    dollarsOutMicros: amount(row.dollarsOutMicros), boughtInPool: row.boughtInPool as boolean | null, borrower: row.borrower as string | null,
  };
}

export function serializeActivityIndex(index: ActivityIndex): string {
  return JSON.stringify({ fromBlock: index.fromBlock, toBlock: index.toBlock, keep: index.keep, rows: index.rows.map(activityJson) });
}

/**
 * A stored or served index, checked; null when it is missing or not an index. An index stored
 * before rows were kept by the day has no `keep`: it kept ACTIVITY_LIMIT.
 */
export function parseActivityIndex(value: unknown): ActivityIndex | null {
  try {
    const body = (typeof value === "string" ? JSON.parse(value) : value) as { fromBlock?: unknown; toBlock?: unknown; keep?: unknown; rows?: unknown };
    if (!body || !Array.isArray(body.rows) || body.rows.length > ACTIVITY_KEEP) return null;
    const fromBlock = count(body.fromBlock);
    const toBlock = count(body.toBlock);
    const keep = body.keep === undefined ? ACTIVITY_LIMIT : count(body.keep);
    if (fromBlock > toBlock + 1 || keep === 0) return null;
    return { fromBlock, toBlock, keep, rows: body.rows.map(activityFromJson).sort(newestFirst) };
  } catch {
    return null;
  }
}

/** Served 24-hour figures, checked; null when they are missing or malformed. */
export function parseActivityDay(value: unknown): ActivityDay | null {
  try {
    const day = value as Record<string, unknown>;
    if (!day || typeof day !== "object" || typeof day.complete !== "boolean" || typeof day.since !== "string" || !Number.isFinite(Date.parse(day.since))) return null;
    const volumeMicros = amount(day.volumeMicros);
    const earnedMicros = amount(day.earnedMicros);
    const poolVolumeMicros = amount(day.poolVolumeMicros);
    const poolFeesMicros = amount(day.poolFeesMicros);
    if (volumeMicros === null || earnedMicros === null || poolVolumeMicros === null || poolFeesMicros === null) return null;
    return {
      complete: day.complete, since: new Date(day.since).toISOString(), trades: count(day.trades), volumeMicros, arbitrages: count(day.arbitrages), earnedMicros, loans: count(day.loans),
      poolTrades: count(day.poolTrades), poolVolumeMicros, poolFeesMicros,
    };
  } catch {
    return null;
  }
}
