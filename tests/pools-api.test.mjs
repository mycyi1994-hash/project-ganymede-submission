import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { GET, OPTIONS } from "../app/api/v1/ustx/pools/route.ts";
import { FUND_DEPLOYMENT, FUND_SELECTORS, POOL_SELECTORS } from "../lib/xstocks/fund.ts";
import { LIQUIDITY_SELECTORS, POOL_LAUNCH_BLOCK } from "../lib/xstocks/liquidity.ts";
import { ACTIVITY_FIRST_BLOCK, ACTIVITY_KEEP, serializeActivityIndex } from "../lib/xstocks/activity.ts";
import { STATE_LP_MARKOUT, STATE_MARKET_ACTIVITY } from "../lib/xstocks/activity-index.ts";
import { MARKOUT_FIRST_BLOCK, serializeLpMarkout } from "../lib/xstocks/lp-markout.ts";

const USD = 1_000_000n;
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const HEAD = POOL_LAUNCH_BLOCK + 30 * 86_400;
const WEEK_AGO = HEAD - 7 * 86_400;
const TIME = 1_790_000_000;

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

/** X Layer Testnet: the pool a week ago and now, the fund's NAV, block times one a second. */
function chain({ oldBlockReverts = false } = {}) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first, tag] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(HEAD));
      case "eth_getBlockByNumber": return answer({ number: first, timestamp: hex(TIME + Number(first) - HEAD) });
      case "eth_call": {
        const old = Number(tag) === WEEK_AGO;
        if (old && oldBlockReverts) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data: "0x" } });
        const selector = first.data.slice(0, 10);
        if (first.to === FUND_DEPLOYMENT.pool && selector === POOL_SELECTORS.getReserves) return answer(`0x${old ? word(50n * USD) + word(5_000n * USD) : word(50_100_000n) + word(4_995n * USD)}`);
        if (first.to === FUND_DEPLOYMENT.pool && selector === LIQUIDITY_SELECTORS.totalSupply) return answer(`0x${word(500n * USD)}`);
        if (first.to === FUND_DEPLOYMENT.fund && selector === FUND_SELECTORS.currentNav) return answer(`0x${word(100n * USD)}${word(TIME - 120)}`);
        throw new Error(`unexpected call ${first.to} ${selector}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
}

test("the pools API serves the pool's state, fee APR and last day to any origin, and never writes", async (t) => {
  const { db, sql } = database();
  env.DB = db;
  const now = Date.now();
  const row = { kind: "buy", hash: `0x${"1".repeat(64)}`, block: ACTIVITY_FIRST_BLOCK + 10, logIndex: 0, at: new Date(now - 3_600_000).toISOString(), account: `0x${"a".repeat(40)}`, dollarsMicros: 100n * USD, sharesMicros: USD, navMicros: null, dollarsOutMicros: null, boughtInPool: null, borrower: null };
  sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(STATE_MARKET_ACTIVITY, serializeActivityIndex({ fromBlock: ACTIVITY_FIRST_BLOCK, toBlock: ACTIVITY_FIRST_BLOCK + 20, keep: ACTIVITY_KEEP, rows: [row] }));
  db.readOnly = true;
  t.mock.method(globalThis, "fetch", chain());
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  const body = await response.json();
  assert.deepEqual([body.network, body.chainId, body.pools.length], ["X Layer Testnet", 1952, 1], "the v4 pool is not listed until it is deployed");
  const [pool] = body.pools;
  assert.deepEqual({ ...pool, feeApr: undefined, last24h: undefined }, {
    id: "ustx-dusd", type: "constant-product", address: FUND_DEPLOYMENT.pool, block: HEAD,
    tokens: { ustx: FUND_DEPLOYMENT.fund, dusd: FUND_DEPLOYMENT.dollar, decimals: 6 },
    lpToken: { address: FUND_DEPLOYMENT.pool, symbol: "USTX-LP", decimals: 6, supplyMicros: "500000000" },
    feeBps: 30, reserves: { ustxMicros: "50100000", dusdMicros: "4995000000" }, priceMicros: "99700598", navMicros: "100000000",
    valueMicros: "10005000000", lpTokenValueMicros: "20010000",
    feeApr: undefined, last24h: undefined, lpResult: null, openedAt: "2026-09-25T05:08:37.000Z", explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.pool}`,
  });
  // √(50.1 × 4,995) against √(50 × 5,000) per LP token: 0.0499% in a week, 2.60% a year.
  assert.equal(pool.feeApr.fromBlock, WEEK_AGO);
  assert.equal(pool.feeApr.toBlock, HEAD);
  assert.equal(pool.feeApr.percent, "2.60");
  assert.equal(Date.parse(pool.feeApr.to) - Date.parse(pool.feeApr.from), 7 * 86_400_000);
  // An LP token at $100 a share: $20 a week ago, $20.01 now; the same tokens held are still $20.
  assert.deepEqual([pool.feeApr.lpTokenValueFromMicros, pool.feeApr.lpTokenValueToMicros, pool.feeApr.heldValueToMicros], ["20000000", "20010000", "20000000"]);
  assert.deepEqual(pool.last24h, { trades: 1, volumeMicros: "100000000", feesMicros: "300000", complete: true, since: pool.last24h.since, toBlock: ACTIVITY_FIRST_BLOCK + 20 });
  assert.match(body.environment, /no value/);
  assert.equal(body.lpResults, null, "no pool results before the scheduled job's first run");
  assert.equal((await OPTIONS()).status, 204);
});

test("the pools API serves each pool's result for its providers over the same blocks, scaled to $10,000 a year", async (t) => {
  const { db, sql } = database();
  env.DB = db;
  const result = (resultMicros, arbitrages, arbitrageResultMicros) => ({ trades: 3, volumeMicros: 250n * USD, resultMicros, arbitrages, arbitrageResultMicros });
  sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(STATE_LP_MARKOUT, serializeLpMarkout({
    fromBlock: MARKOUT_FIRST_BLOCK, fromTime: TIME - 86_400, toBlock: MARKOUT_FIRST_BLOCK + 86_400, toTime: TIME, navMicros: 100n * USD, navRecords: 288, repegs: 287,
    constantProduct: result(-50_000n, 3, -60_000n), v4: result(9_000n, 0, 0n),
  }));
  db.readOnly = true;
  t.mock.method(globalThis, "fetch", chain());
  const body = await (await GET()).json();
  assert.deepEqual(body.lpResults, { fromBlock: MARKOUT_FIRST_BLOCK, from: new Date((TIME - 86_400) * 1000).toISOString(), toBlock: MARKOUT_FIRST_BLOCK + 86_400, to: new Date(TIME * 1000).toISOString(), navRecords: 288 });
  // −$0.05 in a day on the pool's $10,005: −$18.24 a year per $10,000.
  assert.deepEqual(body.pools[0].lpResult, { trades: 3, volumeMicros: "250000000", resultMicros: "-50000", arbitrages: 3, arbitrageResultMicros: "-60000", per10kYearMicros: "-18240879" });
  assert.match(body.rule, /lpResult compares the pools over the same blocks/);
});

test("the pools API keeps the pool when the yield or the index cannot be read, and says when the chain cannot", async (t) => {
  const { db } = database();
  env.DB = db;
  db.readOnly = true;
  const mock = t.mock.method(globalThis, "fetch", chain({ oldBlockReverts: true }));
  const partial = await (await GET()).json();
  assert.equal(partial.pools[0].feeApr, null);
  assert.equal(partial.pools[0].last24h, null, "no index yet");
  assert.equal(partial.pools[0].valueMicros, "10005000000");
  mock.mock.mockImplementation(async () => { throw new Error("connect ECONNREFUSED https://testrpc.xlayer.tech/terigon"); });
  t.mock.method(console, "error", () => {});
  const down = await GET();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  const error = await down.json();
  assert.equal(error.code, "pools_unavailable");
  assert.doesNotMatch(JSON.stringify(error), /xlayer\.tech|ECONNREFUSED/, "upstream details stay out of the response");
});
