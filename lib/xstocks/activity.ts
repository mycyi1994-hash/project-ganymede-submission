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

/** GanymedeBasketFund's deployment block on X Layer Testnet: no market event is older. */
export const ACTIVITY_FIRST_BLOCK = 41_844_113;
/** Rows kept and served, newest first. */
export const ACTIVITY_LIMIT = 40;
/** The most blocks a page reads itself past the served rows: ten requests. */
export const ACTIVITY_TAIL_BLOCKS = 1_000;
const CHUNK_BLOCKS = 100;

export const ACTIVITY_EVENTS = {
  arbitraged: "0xd7fe8288874fe9aa932239d68664dba36abc0308c6622ea3e3f37062481548fe",
  liquidityAdded: "0x64b83944e79c3ce8d4c297411de637c3e102d064677aac0c163976ebdcd6f50e",
  liquidityRemoved: "0x1dc8bb69df2b8e91fbdcbfcf93d951b3f0000f085a95fe3f7946d6161439245d",
  liquidated: "0xfcbc974bf3a532baf2bb229db3c37fd58299b62d2d1db6a855dac5b693bb6ff3",
} as const;

/** The events each contract contributes, by lowercase address. */
const SOURCES: Record<string, readonly string[]> = {
  [FUND_DEPLOYMENT.fund]: [FUND_EVENTS.invested, FUND_EVENTS.redeemed],
  [FUND_DEPLOYMENT.pool]: [POOL_EVENTS.bought, POOL_EVENTS.sold, ACTIVITY_EVENTS.liquidityAdded, ACTIVITY_EVENTS.liquidityRemoved],
  [FUND_DEPLOYMENT.arbitrage]: [ACTIVITY_EVENTS.arbitraged],
  [FUND_DEPLOYMENT.lending]: [...Object.values(LENDING_EVENTS), ACTIVITY_EVENTS.liquidated],
};
const ADDRESSES = Object.keys(SOURCES);
const TOPICS = [...new Set(Object.values(SOURCES).flat())];

export type ActivityKind =
  // At the fund, at the NAV.
  | "invest" | "redeem"
  // In the USTX/dUSD pool.
  | "buy" | "sell" | "addLiquidity" | "removeLiquidity"
  // Both in one transaction, by GanymedeNavArbitrage.
  | "arbitrage"
  // In the lending market, named as in lib/xstocks/lending.ts.
  | "deposit" | "withdrawCollateral" | "borrow" | "repay" | "lend" | "withdraw" | "liquidate";
const KINDS = new Set<string>(["invest", "redeem", "buy", "sell", "addLiquidity", "removeLiquidity", "arbitrage", "deposit", "withdrawCollateral", "borrow", "repay", "lend", "withdraw", "liquidate"]);

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
  /** Arbitrage only: the demo dollars that came back, and whether it bought in the pool. */
  dollarsOutMicros: bigint | null;
  boughtInPool: boolean | null;
  /** Liquidation only: the borrower whose loan was repaid. */
  borrower: string | null;
};

const invalid = () => new Error("X Layer Testnet returned an invalid market event.");
const HASH = /^0x[0-9a-f]{64}$/;

type ChainLog = { address: string; topics: string[]; data: string; block: number; logIndex: number; hash: string };
/** A decoded event whose block time may still be missing: `row.at` is set once it is known. */
type ChainEvent = { row: MarketActivity; time: number | null };

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
function eventRow(log: ChainLog): MarketActivity {
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
      const [bought, dollarsIn, dollarsOut, nav] = words(log.data, 4);
      if (bought > 1n) throw invalid();
      return { ...row, kind: "arbitrage", dollarsMicros: dollarsIn, dollarsOutMicros: dollarsOut, navMicros: nav, boughtInPool: bought === 1n };
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
/** The arbitrage contract's own trade in the pool and order at the fund: the halves of its row. */
const half = (row: MarketActivity) => row.account === FUND_DEPLOYMENT.arbitrage && ["buy", "sell", "invest", "redeem"].includes(row.kind);

/**
 * Rows from decoded events, newest first. An arbitrage is one row: its pool trade and fund order
 * are folded into the Arbitraged event that follows them, which gains the USTX the pool traded.
 */
function rowsFromEvents(events: ChainEvent[], times: Map<number, number>): MarketActivity[] {
  const byTransaction = new Map<string, MarketActivity[]>();
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

/** What the scheduled job keeps: the rows of blocks `fromBlock` to `toBlock`, all of them read. */
export type ActivityIndex = { fromBlock: number; toBlock: number; rows: MarketActivity[] };
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
  let chunks = options.chunks ?? ACTIVITY_CHUNKS_PER_RUN;
  if (toBlock < head) {
    const end = Math.min(head, toBlock + chunks * CHUNK_BLOCKS);
    rows = mergeActivity(rows, await scanActivity(rpc, toBlock + 1, end, { attempts: INDEX_ATTEMPTS }));
    chunks -= Math.ceil((end - toBlock) / CHUNK_BLOCKS);
    toBlock = end;
  }
  if (chunks > 0 && fromBlock > ACTIVITY_FIRST_BLOCK && rows.length < ACTIVITY_LIMIT) {
    const start = Math.max(ACTIVITY_FIRST_BLOCK, fromBlock - chunks * CHUNK_BLOCKS);
    rows = mergeActivity(rows, await scanActivity(rpc, start, fromBlock - 1, { attempts: INDEX_ATTEMPTS }));
    fromBlock = start;
  }
  return { fromBlock, toBlock, rows };
}

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
  return JSON.stringify({ fromBlock: index.fromBlock, toBlock: index.toBlock, rows: index.rows.map(activityJson) });
}

/** A stored or served index, checked; null when it is missing or not an index. */
export function parseActivityIndex(value: unknown): ActivityIndex | null {
  try {
    const body = (typeof value === "string" ? JSON.parse(value) : value) as { fromBlock?: unknown; toBlock?: unknown; rows?: unknown };
    if (!body || !Array.isArray(body.rows) || body.rows.length > ACTIVITY_LIMIT) return null;
    const fromBlock = count(body.fromBlock);
    const toBlock = count(body.toBlock);
    if (fromBlock > toBlock + 1) return null;
    return { fromBlock, toBlock, rows: body.rows.map(activityFromJson).sort(newestFirst) };
  } catch {
    return null;
  }
}
