import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { FUND_DEPLOYMENT, FUND_EVENTS, POOL_EVENTS, fundRpc } from "../lib/xstocks/fund.ts";
import { LENDING_EVENTS } from "../lib/xstocks/lending.ts";
import { V4_EVENTS, V4_POOL_DEPLOYMENT, V4_SWAPPED_TOPIC } from "../lib/xstocks/v4-liquidity.ts";
import { RANGE_ARBITRAGES, RANGE_POOL_DEPLOYMENT } from "../lib/xstocks/range-liquidity.ts";
import {
  ACTIVITY_EVENTS, ACTIVITY_FIRST_BLOCK, ACTIVITY_HIGHLIGHTS, ACTIVITY_INDEX_MARGIN, ACTIVITY_KEEP, ACTIVITY_LIMIT, LARGE_ORDER_MICROS, activityDay, activityDayJson, activityFromJson, activityJson, isHighlight, mergeActivity,
  parseActivityDay, parseActivityIndex, parseHighlights, readActivityTail, scanActivity, serializeActivityIndex, updateActivityIndex, withNewerRows,
} from "../lib/xstocks/activity.ts";
import { ACTIVITY_CRON, STATE_MARKET_ACTIVITY, runActivityIndex } from "../lib/xstocks/activity-index.ts";
import { LISTED_LATE, RANGE_ORDERS_MOVED, STATE_USAGE } from "../lib/xstocks/usage.ts";
import { GET, OPTIONS } from "../app/api/v1/ustx/activity/route.ts";

const F = ACTIVITY_FIRST_BLOCK;
const USD = 1_000_000n;
const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";
const CAROL = "0x00000000000000000000000000000000000ca201";
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const topic = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const TIME = 1_790_000_000;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function log(address, topics, values, { block, index, hash, stamped = true, removed = false }) {
  return {
    address, topics, data: `0x${values.map(word).join("")}`, blockNumber: hex(block), logIndex: hex(index), transactionHash: hash, removed,
    ...(stamped ? { blockTimestamp: hex(TIME + block - F) } : {}),
  };
}

/** X Layer Testnet with `logs` on chain. Like a node that ignores the filter, it answers every log in range. */
function chain({ head, logs = [] }) {
  const calls = [];
  const state = { head };
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(state.head));
      case "eth_getLogs": {
        const from = Number(first.fromBlock);
        const to = Number(first.toBlock);
        assert.ok(to - from <= 99, "at most 100 blocks per request");
        return answer(logs.filter(entry => Number(entry.blockNumber) >= from && Number(entry.blockNumber) <= to));
      }
      case "eth_getBlockByNumber": return answer({ number: first, timestamp: hex(TIME + Number(first) - F) });
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), fetcher, calls, state, ranges: () => calls.filter(call => call.method === "eth_getLogs").map(call => [Number(call.params[0].fromBlock), Number(call.params[0].toBlock)]).sort((a, b) => a[0] - b[0]) };
}

const { fund, pool, arbitrage, lending, keeper } = FUND_DEPLOYMENT;
const MARKET = [
  // An investment at the fund.
  log(fund, [FUND_EVENTS.invested, topic(ALICE)], [1_000n * USD, 10n * USD, 100n * USD, TIME], { block: F + 10, index: 1, hash: tx(1) }),
  // A purchase in the pool, beside a transfer that is not market activity.
  log(pool, [TRANSFER, topic(BOB), topic(pool)], [50n * USD], { block: F + 150, index: 1, hash: tx(2) }),
  log(pool, [POOL_EVENTS.bought, topic(BOB)], [50n * USD, 490_000n], { block: F + 150, index: 2, hash: tx(2) }),
  // The keeper's arbitrage: the contract buys in the pool and redeems at the fund, then reports it.
  log(pool, [POOL_EVENTS.bought, topic(arbitrage)], [145_924_920n, 1_504_498n], { block: F + 150, index: 3, hash: tx(3) }),
  log(fund, [FUND_EVENTS.redeemed, topic(arbitrage)], [1_504_498n, 150_300_425n, 99_900_715n, TIME], { block: F + 150, index: 5, hash: tx(3) }),
  log(arbitrage, [ACTIVITY_EVENTS.arbitraged, topic(keeper)], [1n, 145_924_920n, 150_300_425n, 99_900_715n], { block: F + 150, index: 7, hash: tx(3) }),
  // A loan, from a node that leaves out block times; a log the chain reorganised away.
  log(lending, [LENDING_EVENTS.borrowed, topic(ALICE)], [20n * USD], { block: F + 260, index: 0, hash: tx(4), stamped: false }),
  log(lending, [LENDING_EVENTS.repaid, topic(ALICE)], [20n * USD], { block: F + 260, index: 1, hash: tx(5), removed: true }),
  // A liquidation, and the fund's event from a contract that is not the fund.
  log(lending, [ACTIVITY_EVENTS.liquidated, topic(CAROL), topic(ALICE)], [10n * USD, 108_000n, 100n * USD], { block: F + 305, index: 2, hash: tx(6) }),
  log(BOB, [FUND_EVENTS.invested, topic(BOB)], [1n, 1n, 1n, 1n], { block: F + 305, index: 3, hash: tx(7) }),
];

test("market events read as rows, newest first, with an arbitrage as one row", async () => {
  const { rpc, calls, ranges } = chain({ head: F + 400, logs: MARKET });
  const rows = await scanActivity(rpc, F, F + 350);
  assert.deepEqual(ranges(), [[F, F + 99], [F + 100, F + 199], [F + 200, F + 299], [F + 300, F + 350]]);
  const request = calls.find(call => call.method === "eth_getLogs").params[0];
  assert.deepEqual(request.address, [fund, pool, arbitrage, lending, V4_POOL_DEPLOYMENT.router, V4_POOL_DEPLOYMENT.hook, ...RANGE_ARBITRAGES]);
  assert.equal(request.topics[0].length, 17, "every market event, one request per range");
  assert.deepEqual(calls.filter(call => call.method === "eth_getBlockByNumber").map(call => Number(call.params[0])), [F + 260], "block times only where the response left them out");

  const at = (block) => new Date((TIME + block - F) * 1000).toISOString();
  const none = { dollarsMicros: null, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  assert.deepEqual(rows, [
    { ...none, kind: "liquidate", hash: tx(6), block: F + 305, logIndex: 2, at: at(F + 305), account: CAROL, borrower: ALICE, dollarsMicros: 10n * USD, sharesMicros: 108_000n, navMicros: 100n * USD },
    { ...none, kind: "borrow", hash: tx(4), block: F + 260, logIndex: 0, at: at(F + 260), account: ALICE, dollarsMicros: 20n * USD },
    { ...none, kind: "arbitrage", hash: tx(3), block: F + 150, logIndex: 7, at: at(F + 150), account: keeper, dollarsMicros: 145_924_920n, dollarsOutMicros: 150_300_425n, navMicros: 99_900_715n, boughtInPool: true, sharesMicros: 1_504_498n },
    { ...none, kind: "buy", hash: tx(2), block: F + 150, logIndex: 2, at: at(F + 150), account: BOB, dollarsMicros: 50n * USD, sharesMicros: 490_000n },
    { ...none, kind: "invest", hash: tx(1), block: F + 10, logIndex: 1, at: at(F + 10), account: ALICE, dollarsMicros: 1_000n * USD, sharesMicros: 10n * USD, navMicros: 100n * USD },
  ]);
  assert.deepEqual(await scanActivity(rpc, F + 20, F + 19), [], "an empty range makes no request");
});

test("the v4 pool's trades through its router and its liquidity are rows of their own, apart from the constant-product pool's figures", async () => {
  const V4 = V4_POOL_DEPLOYMENT;
  // USTX is currency0 of the pool on X Layer Testnet: buying it is not zero for one.
  const swapped = (trader, poolId, zeroForOne, amountIn, amountOut, at) => log(V4.router, [V4_SWAPPED_TOPIC, topic(trader), poolId], [zeroForOne ? 1n : 0n, amountIn, amountOut], at);
  const logs = [
    swapped(ALICE, V4.poolId, false, 25n * USD, 249_877n, { block: F + 20, index: 0, hash: tx(21) }),
    swapped(ALICE, V4.poolId, true, 124_938n, 12_440_000n, { block: F + 21, index: 0, hash: tx(22) }),
    // Another pool's swap through the same router is not this market's.
    swapped(BOB, `0x${"7".repeat(64)}`, false, 9n * USD, 1n, { block: F + 22, index: 0, hash: tx(23) }),
    log(V4.hook, [V4_EVENTS.deposited, topic(ALICE), word(3n)], [124_939n, 12_500_000n], { block: F + 23, index: 0, hash: tx(24) }),
    log(V4.hook, [V4_EVENTS.withdrawn, topic(BOB)], [5n * USD, 50_000n, 5n * USD], { block: F + 24, index: 0, hash: tx(25) }),
  ].map(entry => ({ ...entry, topics: entry.topics.map(item => item.startsWith("0x") ? item : `0x${item}`) }));
  const rows = await scanActivity(chain({ head: F + 100, logs }).rpc, F, F + 50);
  assert.deepEqual(rows.map(row => [row.kind, row.account, row.dollarsMicros, row.sharesMicros]), [
    ["v4Withdraw", BOB, 5n * USD, 50_000n],
    ["v4Deposit", ALICE, 12_500_000n, 124_939n],
    ["v4Sell", ALICE, 12_440_000n, 124_938n],
    ["v4Buy", ALICE, 25n * USD, 249_877n],
  ]);
  // Trades in the v4 pool count as the market's trades, not as the constant-product pool's.
  const day = activityDay({ fromBlock: ACTIVITY_FIRST_BLOCK, toBlock: F + 50, keep: ACTIVITY_KEEP, rows }, (TIME + 100) * 1000);
  assert.deepEqual([day.trades, day.volumeMicros, day.poolTrades, day.poolVolumeMicros], [2, 37_440_000n, 0, 0n]);
  assert.deepEqual(parseActivityIndex(serializeActivityIndex({ fromBlock: F, toBlock: F + 50, keep: ACTIVITY_KEEP, rows })).rows, rows, "the new kinds are stored and read back");
});

test("an invalid response is read again, never stored", async () => {
  const good = chain({ head: F + 50, logs: [MARKET[0]] });
  let first = true;
  const rpc = fundRpc({ fetcher: async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "eth_getLogs" && first) {
      first = false;
      return Response.json({ jsonrpc: "2.0", id: body.id, result: [{ ...MARKET[0], data: "0x1234" }] });
    }
    return good.fetcher(url, init);
  } });
  const rows = await scanActivity(rpc, F, F + 50);
  assert.equal(first, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "invest");
});

test("each run reads the new blocks first, then history back to the fund's deployment", async () => {
  const head = F + 10_000;
  const network = chain({ head });
  const safe = head - ACTIVITY_INDEX_MARGIN;
  // The first run has no history yet: it spends its requests on the blocks before now.
  let index = await updateActivityIndex(null, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), [[safe - 299, safe - 200], [safe - 199, safe - 100], [safe - 99, safe]]);
  assert.deepEqual([index.fromBlock, index.toBlock], [safe - 299, safe]);
  // 150 new blocks take two requests; the third goes back 100 blocks.
  network.calls.length = 0;
  network.state.head = head + 150;
  index = await updateActivityIndex(index, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), [[safe - 399, safe - 300], [safe + 1, safe + 100], [safe + 101, safe + 150]]);
  assert.deepEqual([index.fromBlock, index.toBlock], [safe - 399, safe + 150]);
  // A node behind the last run neither goes back nor skips; history stops at the deployment block.
  network.calls.length = 0;
  network.state.head = head;
  index = await updateActivityIndex({ ...index, fromBlock: F + 50 }, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), [[F, F + 49]]);
  assert.deepEqual([index.fromBlock, index.toBlock], [F, safe + 150]);
  network.calls.length = 0;
  await updateActivityIndex(index, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), []);
  // With the rows full, history is no longer read.
  const row = { kind: "borrow", hash: tx(9), block: F + 1, logIndex: 0, at: new Date(TIME * 1000).toISOString(), account: ALICE, dollarsMicros: USD, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  const full = Array.from({ length: ACTIVITY_KEEP }, (_, n) => ({ ...row, hash: tx(100 + n), block: safe - n }));
  network.calls.length = 0;
  await updateActivityIndex({ fromBlock: safe - 500, toBlock: safe, keep: ACTIVITY_KEEP, rows: full }, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), []);
});

test("an index never claims blocks whose rows it dropped", async () => {
  const row = { kind: "borrow", hash: tx(9), block: F + 1, logIndex: 0, at: new Date(TIME * 1000).toISOString(), account: ALICE, dollarsMicros: USD, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  const stored = (count) => JSON.stringify({ fromBlock: F + 100, toBlock: F + 2_000, rows: Array.from({ length: count }, (_, n) => activityJson({ ...row, hash: tx(100 + n), block: F + 1_039 - n })) });
  // Stored before rows were kept by the day, with the 40 it kept then: its oldest may have been
  // dropped, so it reads again from its oldest kept block down.
  let network = chain({ head: F + 2_000 + ACTIVITY_INDEX_MARGIN });
  const truncated = parseActivityIndex(stored(ACTIVITY_LIMIT));
  assert.equal(truncated.keep, ACTIVITY_LIMIT);
  let index = await updateActivityIndex(truncated, network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), [[F + 701, F + 800], [F + 801, F + 900], [F + 901, F + 1_000]]);
  assert.deepEqual([index.fromBlock, index.keep, index.rows.length], [F + 701, ACTIVITY_KEEP, ACTIVITY_LIMIT]);
  // One that never filled dropped nothing and carries on from where it was.
  network = chain({ head: F + 2_000 + ACTIVITY_INDEX_MARGIN });
  index = await updateActivityIndex(parseActivityIndex(stored(ACTIVITY_LIMIT - 1)), network.rpc, { chunks: 3 });
  assert.deepEqual(network.ranges(), [[F, F + 99]]);
  assert.equal(index.fromBlock, F);
  // A new event past a full index drops the oldest row, and the range starts after the new oldest.
  const full = Array.from({ length: ACTIVITY_KEEP }, (_, n) => ({ ...row, hash: tx(100 + n), block: F + 5_000 - n }));
  network = chain({ head: F + 5_001 + ACTIVITY_INDEX_MARGIN, logs: [log(fund, [FUND_EVENTS.invested, topic(BOB)], [20n * USD, 200_000n, 100n * USD, TIME], { block: F + 5_001, index: 0, hash: tx(90_000) })] });
  index = await updateActivityIndex({ fromBlock: F + 5_000 - ACTIVITY_KEEP, toBlock: F + 5_000, keep: ACTIVITY_KEEP, rows: full }, network.rpc, { chunks: 3 });
  const oldest = F + 5_001 - (ACTIVITY_KEEP - 1);
  assert.deepEqual([index.rows.length, index.rows[0].block, index.rows.at(-1).block, index.fromBlock], [ACTIVITY_KEEP, F + 5_001, oldest, oldest + 1]);
  assert.deepEqual(network.ranges(), [[F + 5_001, F + 5_001]], "a full index reads no history");
});

test("the last 24 hours count trades, their volume, arbitrage, loans and the pool's own trades and fees", async () => {
  const rows = await scanActivity(chain({ head: F + 400, logs: MARKET }).rpc, F, F + 350);
  const at = (block) => (TIME + block - F) * 1000;
  // Every event since the deployment is held, so the day is complete: an investment, a pool buy and
  // an arbitrage are trades; the loan and the liquidation are loan actions. The pool traded twice: the
  // purchase and the arbitrage's purchase, each paying 0.3% of the demo dollars it put in.
  const day = activityDay({ fromBlock: F, toBlock: F + 350, keep: ACTIVITY_KEEP, rows }, at(F + 400));
  assert.deepEqual(day, {
    complete: true, since: new Date(at(F + 400) - 86_400_000).toISOString(),
    trades: 3, volumeMicros: 1_000n * USD + 50n * USD + 145_924_920n, arbitrages: 1, earnedMicros: 150_300_425n - 145_924_920n, loans: 2,
    poolTrades: 2, poolVolumeMicros: 50n * USD + 145_924_920n, poolFeesMicros: 150_000n + 437_774n,
  });
  // A day later only what happened since counts.
  const later = activityDay({ fromBlock: F, toBlock: F + 350, keep: ACTIVITY_KEEP, rows }, at(F + 150) + 86_400_000);
  assert.deepEqual([later.complete, later.trades, later.loans], [true, 2, 2]);
  // Still reading history, and no row a day old: the count starts at the oldest row and says so.
  const partial = activityDay({ fromBlock: F + 5, toBlock: F + 350, keep: ACTIVITY_KEEP, rows }, at(F + 400));
  assert.deepEqual([partial.complete, partial.since, partial.trades], [false, new Date(at(F + 10)).toISOString(), 3]);
  // Full, with its oldest row over a day old: complete.
  assert.equal(activityDay({ fromBlock: F + 5, toBlock: F + 350, keep: rows.length, rows }, at(F + 150) + 86_400_000).complete, true);
  // Rows a page read after the served block are added.
  const sale = { ...rows[3], kind: "sell", hash: tx(50), block: F + 500, at: new Date(at(F + 500)).toISOString(), dollarsMicros: 20n * USD };
  const more = withNewerRows(day, [sale]);
  assert.deepEqual([more.trades, more.volumeMicros, more.loans], [4, day.volumeMicros + 20n * USD, 2]);
  // A sale pays its fee in USTX: 0.3% of what went in, worth $20 ÷ 0.997 × 0.003 of what came out.
  assert.deepEqual([more.poolTrades, more.poolVolumeMicros, more.poolFeesMicros], [3, day.poolVolumeMicros + 20n * USD, day.poolFeesMicros + 60_180n]);
  // Served figures are checked before they are used.
  assert.deepEqual(parseActivityDay(JSON.parse(JSON.stringify(activityDayJson(day)))), day);
  const withoutPoolFees = activityDayJson(day);
  delete withoutPoolFees.poolFeesMicros;
  for (const broken of [
    null, {}, { ...activityDayJson(day), trades: -1 }, { ...activityDayJson(day), volumeMicros: 5 }, { ...activityDayJson(day), since: "soon" }, { ...activityDayJson(day), complete: "yes" },
    { ...activityDayJson(day), poolTrades: 1.5 }, { ...activityDayJson(day), poolVolumeMicros: "-1" }, withoutPoolFees,
  ]) {
    assert.equal(parseActivityDay(broken), null, JSON.stringify(broken));
  }
});

test("rows merge by event, newest first, and stop at the limit", () => {
  const row = { kind: "lend", hash: tx(1), block: 5, logIndex: 0, at: new Date(TIME * 1000).toISOString(), account: ALICE, dollarsMicros: USD, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  // The same event read twice counts once; a later block comes first.
  const rows = mergeActivity([row, { ...row, logIndex: 3 }], [{ ...row, hash: tx(2), block: 7 }, { ...row }], 2);
  assert.deepEqual(rows.map(item => [item.block, item.logIndex]), [[7, 0], [5, 3]]);
  assert.equal(mergeActivity(Array.from({ length: 50 }, (_, n) => ({ ...row, hash: tx(n) })), []).length, ACTIVITY_LIMIT);
});

test("a page reads only the blocks after the served rows, at most a thousand", async () => {
  const served = { fromBlock: F, toBlock: F + 1_000, rows: [] };
  let network = chain({ head: F + 1_500, logs: MARKET });
  let tail = await readActivityTail(served, network.rpc);
  assert.equal(tail.head, F + 1_500);
  assert.deepEqual(network.ranges()[0], [F + 1_001, F + 1_100]);
  assert.equal(network.ranges().length, 5);
  network = chain({ head: F + 1_500 });
  await readActivityTail(served, network.rpc, { after: F + 1_450 });
  assert.deepEqual(network.ranges(), [[F + 1_451, F + 1_500]]);
  // Without served rows, or far behind, the latest thousand blocks.
  network = chain({ head: F + 5_000 });
  await readActivityTail(null, network.rpc);
  assert.deepEqual(network.ranges()[0], [F + 4_001, F + 4_100]);
  assert.equal(network.ranges().length, 10);
  // After this page's own transaction, never below its block.
  network = chain({ head: F + 5_000, logs: MARKET });
  tail = await readActivityTail({ ...served, rows: (await scanActivity(chain({ head: F + 400, logs: MARKET }).rpc, F, F + 20)) }, network.rpc, { minBlock: F + 5_010 });
  assert.equal(tail.head, F + 5_010);
  assert.equal(tail.rows.at(-1).kind, "invest", "the served rows stay");
});

test("a stored or served index is checked before it is used", async () => {
  const rows = await scanActivity(chain({ head: F + 400, logs: MARKET }).rpc, F, F + 350);
  const index = { fromBlock: F, toBlock: F + 350, keep: ACTIVITY_KEEP, rows };
  const text = serializeActivityIndex(index);
  assert.deepEqual(parseActivityIndex(text), index);
  assert.deepEqual(parseActivityIndex(JSON.parse(text)), index, "a served body parses the same way");
  const body = JSON.parse(text);
  for (const broken of [null, undefined, "", "{", "[]", { ...body, rows: undefined }, { ...body, fromBlock: F + 400 }, { ...body, toBlock: -1 },
    { ...body, rows: [{ ...body.rows[0], kind: "mint" }] }, { ...body, rows: [{ ...body.rows[0], hash: "0x12" }] },
    { ...body, rows: [{ ...body.rows[0], dollarsMicros: 10 }] }, { ...body, rows: [{ ...body.rows[0], borrower: undefined }] },
    { ...body, keep: 0 }, { ...body, rows: Array.from({ length: ACTIVITY_KEEP + 1 }, () => body.rows[0]) }]) {
    assert.equal(parseActivityIndex(typeof broken === "object" && broken !== null ? JSON.stringify(broken) : broken), null, JSON.stringify(broken)?.slice(0, 80));
  }
  assert.deepEqual(parseActivityIndex({ fromBlock: 10, toBlock: 9, rows: [] }), { fromBlock: 10, toBlock: 9, keep: ACTIVITY_LIMIT, rows: [] }, "an index stored before rows were kept by the day, before its first read");
  assert.equal(activityJson(rows[2]).dollarsOutMicros, "150300425");
});

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8"));
  const db = { readOnly: false, prepare(query) {
    if (this.readOnly && !/^\s*SELECT/i.test(query)) throw Error("Unexpected write on a read-only request");
    const prepared = sql.prepare(query);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return prepared.get(...args) ?? null; },
      async all() { return { results: prepared.all(...args) }; },
      async run() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
    };
  } };
  return { db, sql };
}

test("the scheduled run keeps the index, and the public API serves it to any origin without writing", async (t) => {
  const { db, sql } = database();
  env.DB = db;
  db.readOnly = true;
  const before = await GET();
  assert.equal(before.status, 503);
  assert.equal(before.headers.get("cache-control"), "no-store");
  assert.equal((await before.json()).code, "activity_unavailable");

  db.readOnly = false;
  const network = chain({ head: F + 400 + ACTIVITY_INDEX_MARGIN, logs: MARKET });
  assert.deepEqual(await runActivityIndex({ DB: db }, { rpc: network.rpc }), { fromBlock: F, toBlock: F + 400, rows: 5 });
  // Usage since launch follows the index (lib/xstocks/usage.ts).
  assert.deepEqual(sql.prepare("SELECT key FROM engine_state ORDER BY key").all().map(row => row.key), [STATE_MARKET_ACTIVITY, STATE_USAGE]);

  db.readOnly = true;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("the API reads only the stored index"); });
  t.mock.timers.enable({ apis: ["Date"], now: (TIME + 400) * 1000 });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=30");
  const served = await response.json();
  assert.deepEqual([served.chainId, served.fromBlock, served.toBlock], [1952, F, F + 400]);
  assert.deepEqual(served.contracts, { fund, pool, arbitrage, lending, v4Router: V4_POOL_DEPLOYMENT.router, v4Hook: V4_POOL_DEPLOYMENT.hook, rangeArbitrage: RANGE_POOL_DEPLOYMENT.arbitrage });
  assert.equal(served.rows.length, 5);
  assert.deepEqual(served.rows[2], { ...activityJson((await scanActivity(chain({ head: F + 400, logs: MARKET }).rpc, F, F + 400))[2]), explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/tx/${tx(3)}` });
  assert.match(served.environment, /no value/);
  assert.deepEqual(served.day, {
    complete: true, since: new Date((TIME + 400 - 86_400) * 1000).toISOString(), trades: 3, volumeMicros: "1195924920", arbitrages: 1, earnedMicros: "4375505", loans: 2,
    poolTrades: 2, poolVolumeMicros: "195924920", poolFeesMicros: "587774",
  });
  assert.deepEqual(parseActivityIndex(served)?.rows.map(row => row.kind), ["liquidate", "borrow", "arbitrage", "buy", "invest"]);
  // Marked on the NAV chart: the arbitrage and orders of $1,000 or more, with their explorer links.
  assert.deepEqual(served.highlights, served.rows.filter(row => isHighlight(activityFromJson(row))));
  assert.ok(served.highlights.some(row => row.kind === "arbitrage"));
  assert.ok(served.highlights.every(row => row.kind === "arbitrage" || BigInt(row.dollarsMicros) >= LARGE_ORDER_MICROS));
  assert.deepEqual(parseHighlights(served.highlights).map(row => row.hash), served.highlights.map(row => row.hash));
  assert.equal((await OPTIONS()).status, 204);
});

test("the Worker runs market activity on its own cron, apart from the NAV cycle", async (t) => {
  const config = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *", ACTIVITY_CRON, "* * * * *"]);
  const { db, sql } = database();
  const network = chain({ head: F + 400 + ACTIVITY_INDEX_MARGIN, logs: MARKET });
  t.mock.method(globalThis, "fetch", network.fetcher);
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-activity`);
  const { default: worker } = await import(workerUrl.href);
  const pending = [];
  const errors = t.mock.method(console, "error", () => {});
  await worker.scheduled({ cron: ACTIVITY_CRON, scheduledTime: Date.now(), noRetry() {} }, { DB: db }, { waitUntil: promise => pending.push(promise), passThroughOnException() {} });
  // Three jobs: the activity index, the pools' results and the hourly OKX DEX quotes. This chain
  // cannot answer the fund's NAV, so the second fails, alone, and says so; without OnchainOS
  // credentials the third does nothing.
  const [activity, results, quotes] = await Promise.allSettled(pending);
  assert.equal(activity.status, "fulfilled");
  assert.equal(results.status, "rejected");
  assert.equal(quotes.status, "fulfilled");
  assert.match(String(errors.mock.calls[0].arguments[0]), /pool results run failed/);
  assert.deepEqual(sql.prepare("SELECT key FROM engine_state ORDER BY key").all().map(row => row.key), [STATE_MARKET_ACTIVITY, STATE_USAGE], "only the activity index and usage; no engine cycle ran");
  assert.equal(parseActivityIndex(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(STATE_MARKET_ACTIVITY).value)?.rows.length, 5);
});

test("the NAV chart marks every arbitrage and orders of $1,000 or more, and nothing from a malformed list", () => {
  const row = (kind, dollars, block) => ({ kind, hash: tx(block), block: F + block, logIndex: 0, at: new Date((TIME + block) * 1000).toISOString(), account: ALICE, dollarsMicros: dollars, sharesMicros: 1_000_000n, navMicros: 100_000_000n, dollarsOutMicros: null, boughtInPool: kind === "arbitrage" ? true : null, borrower: null });
  assert.equal(isHighlight(row("arbitrage", 1_030_000n, 1)), true, "an arbitrage of any size");
  assert.equal(isHighlight(row("invest", LARGE_ORDER_MICROS, 2)), true);
  assert.equal(isHighlight(row("sell", LARGE_ORDER_MICROS - 1n, 3)), false);
  assert.equal(isHighlight(row("borrow", 5_000_000_000n, 4)), false, "loans are not orders");
  const served = [row("buy", 2_000_000_000n, 5), row("arbitrage", 145_924_920n, 6)].map(activityJson);
  assert.deepEqual(parseHighlights(served).map(item => item.kind), ["arbitrage", "buy"], "newest first");
  assert.deepEqual(parseHighlights([...served, { kind: "buy" }]), []);
  assert.deepEqual(parseHighlights(Array.from({ length: ACTIVITY_HIGHLIGHTS + 1 }, (_, i) => activityJson(row("arbitrage", 1n, i + 10)))), []);
  assert.deepEqual(parseHighlights(undefined), []);
  assert.deepEqual(parseHighlights([activityJson(row("repay", 5_000_000_000n, 7))]), [], "a served row that is not marked is dropped");
});

/** Two runs of the range pool's arbitrage and one that moved the price across an empty stretch. */
const [RANGE] = RANGE_ARBITRAGES;
const RANGE_RUNS = [
  // Bought 1.771892 USTX in the range pool and redeemed it at the fund for $178.730444, keeping $0.026.
  log(fund, [FUND_EVENTS.redeemed, topic(RANGE)], [1_771_892n, 178_730_444n, 100_870_000n, TIME], { block: F + 30, index: 4, hash: tx(31) }),
  log(RANGE, [ACTIVITY_EVENTS.arbitraged, topic(keeper)], [1n, 1_771_892n, 26_000n, 100_870_000n], { block: F + 30, index: 6, hash: tx(31) }),
  // Invested $10 at the fund and sold 0.099 USTX in the range pool for $10.05.
  log(fund, [FUND_EVENTS.invested, topic(RANGE)], [10n * USD, 99_000n, 101_000_000n, TIME], { block: F + 40, index: 2, hash: tx(32) }),
  log(RANGE, [ACTIVITY_EVENTS.arbitraged, topic(keeper)], [0n, 99_000n, 50_000n, 101_000_000n], { block: F + 40, index: 5, hash: tx(32) }),
  log(RANGE, [ACTIVITY_EVENTS.arbitraged, topic(keeper)], [1n, 0n, 0n, 101_000_000n], { block: F + 50, index: 0, hash: tx(33) }),
];
const at = (block) => new Date((TIME + block - F) * 1000).toISOString();
const none = { dollarsMicros: null, sharesMicros: null, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
const RANGE_ROWS = [
  { ...none, kind: "rangeArbitrage", hash: tx(32), block: F + 40, logIndex: 5, at: at(F + 40), account: keeper, dollarsMicros: 10n * USD, dollarsOutMicros: 10_050_000n, sharesMicros: 99_000n, navMicros: 101_000_000n, boughtInPool: false },
  { ...none, kind: "rangeArbitrage", hash: tx(31), block: F + 30, logIndex: 6, at: at(F + 30), account: keeper, dollarsMicros: 178_704_444n, dollarsOutMicros: 178_730_444n, sharesMicros: 1_771_892n, navMicros: 100_870_000n, boughtInPool: true },
];

test("the range pool's arbitrage is one row, the keeper's, from its fund order and its report, apart from the constant-product pool", async () => {
  const rows = await scanActivity(chain({ head: F + 100, logs: RANGE_RUNS }).rpc, F, F + 60);
  assert.deepEqual(rows, RANGE_ROWS, "a run that traded nothing is no row");
  // Trades and arbitrage of the market, and marked on the NAV chart, but not trades in the constant-product pool.
  const day = activityDay({ fromBlock: ACTIVITY_FIRST_BLOCK, toBlock: F + 60, keep: ACTIVITY_KEEP, rows }, (TIME + 100) * 1000);
  assert.deepEqual([day.trades, day.volumeMicros, day.arbitrages, day.earnedMicros, day.poolTrades], [2, 188_704_444n, 2, 76_000n, 0]);
  assert.ok(rows.every(isHighlight));
  assert.deepEqual(parseActivityIndex(serializeActivityIndex({ fromBlock: F, toBlock: F + 60, keep: ACTIVITY_KEEP, rows })).rows, rows, "the new kind is stored and read back");
});

test("rows kept from before the range arbitrage was folded are read again, and its orders move to the team's usage once", async () => {
  const { db, sql } = database();
  const keep = (key, value) => sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, "2026-10-06T00:00:00.000Z");
  const stored = (key) => sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(key).value;
  // What the earlier index kept: the contract's fund orders as an investor's, beside Alice's own order.
  const alice = { ...none, kind: "invest", hash: tx(30), block: F + 20, logIndex: 1, at: at(F + 20), account: ALICE, dollarsMicros: 1_000n * USD, sharesMicros: 10n * USD, navMicros: 100n * USD };
  const old = [
    { ...none, kind: "invest", hash: tx(32), block: F + 40, logIndex: 2, at: at(F + 40), account: RANGE, dollarsMicros: 10n * USD, sharesMicros: 99_000n, navMicros: 101_000_000n },
    { ...none, kind: "redeem", hash: tx(31), block: F + 30, logIndex: 4, at: at(F + 30), account: RANGE, dollarsMicros: 178_730_444n, sharesMicros: 1_771_892n, navMicros: 100_870_000n },
    alice,
  ];
  keep(STATE_MARKET_ACTIVITY, serializeActivityIndex({ fromBlock: F, toBlock: F + 100, keep: ACTIVITY_KEEP, rows: old }));
  // And the usage it counted: the contract as a wallet outside the team's.
  const wallet = (actions, volumeMicros) => ({ firstAt: at(F + 20), lastAt: at(F + 40), actions, volumeMicros });
  keep(STATE_USAGE, JSON.stringify({
    fromBlock: F, toBlock: F + 100, wallets: { [ALICE]: wallet(1, "1000000000"), [RANGE]: wallet(2, "188730444") },
    kinds: { invest: { all: 2, outside: 2 }, redeem: { all: 1, outside: 1 } }, team: { actions: 5, volumeMicros: "7" }, migrations: [LISTED_LATE.id],
  }));

  const network = chain({ head: F + 100 + ACTIVITY_INDEX_MARGIN, logs: [log(fund, [FUND_EVENTS.invested, topic(ALICE)], [1_000n * USD, 10n * USD, 100n * USD, TIME], { block: F + 20, index: 1, hash: tx(30) }), ...RANGE_RUNS] });
  await runActivityIndex({ DB: db }, { rpc: network.rpc });
  assert.deepEqual(network.ranges(), [[F + 30, F + 30], [F + 40, F + 40]], "only the blocks of the kept orders");
  assert.deepEqual(parseActivityIndex(stored(STATE_MARKET_ACTIVITY)).rows, [...RANGE_ROWS, alice]);
  const usage = JSON.parse(stored(STATE_USAGE));
  assert.deepEqual(Object.keys(usage.wallets), [ALICE]);
  // Counted as the keeper's arbitrages, with what each put in: $10 invested, and $178.704444 that
  // bought the USTX it redeemed for $178.730444.
  assert.deepEqual(usage.team, { actions: 7, volumeMicros: (7n + 10n * USD + 178_704_444n).toString() });
  assert.deepEqual(usage.kinds, { invest: { all: 1, outside: 1 }, redeem: { all: 0, outside: 0 }, rangeArbitrage: { all: 2, outside: 0 } });
  assert.deepEqual(usage.migrations, [LISTED_LATE.id, RANGE_ORDERS_MOVED]);

  // The next run finds nothing to read again or move.
  await runActivityIndex({ DB: db }, { rpc: network.rpc });
  assert.equal(network.ranges().length, 2);
  assert.deepEqual(JSON.parse(stored(STATE_USAGE)), usage);
});
