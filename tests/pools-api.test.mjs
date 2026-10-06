import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { GET, OPTIONS, POOLS_FRESH_MS, POOLS_STALE_MS } from "../app/api/v1/ustx/pools/route.ts";
import { clearReadCache } from "../lib/read-cache.ts";
import { POOLS_CRON, POOLS_SNAPSHOT_FRESH_MS, STATE_POOLS_SNAPSHOT, runPoolsSnapshot } from "../lib/xstocks/pools-api.ts";
import { FUND_DEPLOYMENT, FUND_SELECTORS, POOL_SELECTORS } from "../lib/xstocks/fund.ts";
import { LIQUIDITY_SELECTORS, POOL_LAUNCH_BLOCK } from "../lib/xstocks/liquidity.ts";
import { ACTIVITY_FIRST_BLOCK, ACTIVITY_KEEP, serializeActivityIndex } from "../lib/xstocks/activity.ts";
import { STATE_LP_MARKOUT, STATE_MARKET_ACTIVITY } from "../lib/xstocks/activity-index.ts";
import { MARKOUT_FIRST_BLOCK, serializeLpMarkout } from "../lib/xstocks/lp-markout.ts";
import { RANGE_POOL_DEPLOYMENT, RANGE_SELECTORS } from "../lib/xstocks/range-liquidity.ts";
import { OPENAPI } from "../app/api/v1/openapi.json/route.ts";
import { schemaErrors } from "./openapi-check.mjs";

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

test.beforeEach(() => clearReadCache());

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
  assert.equal(response.headers.get("cache-control"), "public, max-age=30");
  const body = await response.json();
  assert.equal(body.stale, false);
  assert.ok(Date.now() - Date.parse(body.readAt) < 60_000, "readAt is when X Layer was read");
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

test("a read of the pools serves every request for 30 seconds, and requests at the same moment share one read", async (t) => {
  const { db } = database();
  env.DB = db;
  db.readOnly = true;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const mock = t.mock.method(globalThis, "fetch", chain());
  const [first, second] = await Promise.all([GET(), GET()]);
  const calls = mock.mock.callCount();
  assert.deepEqual(await first.json(), await second.json(), "two requests at once wait for the same read");
  t.mock.timers.tick(POOLS_FRESH_MS - 1);
  const cached = await (await GET()).json();
  assert.equal(mock.mock.callCount(), calls, "X Layer is not read again within the fresh period");
  assert.equal(cached.stale, false);
  t.mock.timers.tick(2);
  const again = await (await GET()).json();
  assert.ok(mock.mock.callCount() > calls, "after it X Layer is read again");
  assert.ok(Date.parse(again.readAt) > Date.parse(cached.readAt));
});

test("the pools API keeps the pool when the yield or the index cannot be read, and says when the chain cannot", async (t) => {
  const { db } = database();
  env.DB = db;
  db.readOnly = true;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const mock = t.mock.method(globalThis, "fetch", chain({ oldBlockReverts: true }));
  const partial = await (await GET()).json();
  assert.equal(partial.pools[0].feeApr, null);
  assert.equal(partial.pools[0].last24h, null, "no index yet");
  assert.equal(partial.pools[0].valueMicros, "10005000000");
  mock.mock.mockImplementation(async () => { throw new Error("connect ECONNREFUSED https://testrpc.xlayer.tech/terigon"); });
  t.mock.method(console, "error", () => {});
  // X Layer down after the read went stale: the last read is served, marked, for up to ten minutes.
  t.mock.timers.tick(POOLS_FRESH_MS + 1);
  const stale = await GET();
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("cache-control"), "public, max-age=15");
  const staleBody = await stale.json();
  assert.equal(staleBody.stale, true);
  assert.equal(staleBody.readAt, partial.readAt);
  assert.equal(staleBody.pools[0].valueMicros, "10005000000");
  t.mock.timers.tick(POOLS_STALE_MS);
  const down = await GET();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  const error = await down.json();
  assert.equal(error.code, "pools_unavailable");
  assert.doesNotMatch(JSON.stringify(error), /xlayer\.tech|ECONNREFUSED/, "upstream details stay out of the response");
});

test("the API serves the cron's snapshot without reading X Layer while it is under 90 seconds old", async (t) => {
  const { db, sql } = database();
  env.DB = db;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const mock = t.mock.method(globalThis, "fetch", chain());
  const stored = await runPoolsSnapshot({ DB: db });
  assert.equal(JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(STATE_POOLS_SNAPSHOT).value).readAt, stored.readAt);
  db.readOnly = true;
  const calls = mock.mock.callCount();
  t.mock.timers.tick(POOLS_SNAPSHOT_FRESH_MS - 1_000);
  const served = await (await GET()).json();
  assert.equal(mock.mock.callCount(), calls, "no read of X Layer");
  assert.equal(served.readAt, new Date(stored.readAt).toISOString(), "readAt is when the cron read X Layer");
  assert.equal(served.stale, false);
  assert.equal(served.pools[0].valueMicros, "10005000000");
  // Past 90 seconds (and past this isolate's 30), X Layer is read again.
  t.mock.timers.tick(POOLS_FRESH_MS + 2_000);
  const fresh = await (await GET()).json();
  assert.ok(mock.mock.callCount() > calls);
  assert.ok(Date.parse(fresh.readAt) > stored.readAt);
});

test("the Worker stores the pools and NAV snapshots on its own once-a-minute cron and runs no NAV record", async (t) => {
  const config = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.ok(config.triggers.crons.includes(POOLS_CRON));
  const { db, sql } = database();
  t.mock.method(globalThis, "fetch", chain());
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-pools`);
  const { default: worker } = await import(workerUrl.href);
  const pending = [];
  await worker.scheduled({ cron: POOLS_CRON, scheduledTime: Date.now(), noRetry() {} }, { DB: db }, { waitUntil: promise => pending.push(promise), passThroughOnException() {} });
  // Two jobs: the pools snapshot and the NAV snapshot. No registry is configured here, so the second
  // fails, alone, and says so.
  assert.equal(pending.length, 2);
  const errors = t.mock.method(console, "error", () => {});
  const [pools, nav] = await Promise.allSettled(pending);
  assert.equal(pools.status, "fulfilled");
  assert.equal(nav.status, "rejected");
  assert.match(String(errors.mock.calls[0].arguments[0]), /NAV snapshot failed/);
  assert.deepEqual(sql.prepare("SELECT key FROM engine_state").all().map(row => row.key), [STATE_POOLS_SNAPSHOT], "only the pools snapshot; no NAV cycle ran");
});


test("the range pool is listed with its own price, fee and the NAV its hook guards it with", async (t) => {
  const { db, sql } = database();
  env.DB = db;
  db.readOnly = true;
  const base = chain();
  // $100 a USTX: USTX is currency0 with six decimals, as dUSD.
  const sqrtPrice = 10n << 96n;
  const tick = 46_054n;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    const [first] = body.params ?? [];
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "eth_call" && first.to === RANGE_POOL_DEPLOYMENT.poolManager && first.data.startsWith(RANGE_SELECTORS.extsload)) return answer(`0x${word((tick << 160n) | sqrtPrice)}`);
    if (body.method === "eth_call" && first.to === RANGE_POOL_DEPLOYMENT.hook && first.data === RANGE_SELECTORS.nav) return answer(`0x${word(100n * 10n ** 8n)}${word(TIME - 120)}${word(sqrtPrice)}`);
    if (body.method === "eth_call" && first.to === RANGE_POOL_DEPLOYMENT.hook && first.data === RANGE_SELECTORS.currentFee) return answer(`0x${word(3_000n)}`);
    return base(url, init);
  });
  const body = await (await GET()).json();
  const range = body.pools.find((pool) => pool.id === "ustx-dusd-range");
  assert.deepEqual(range, {
    id: "ustx-dusd-range", type: "uniswap-v4-range",
    hook: RANGE_POOL_DEPLOYMENT.hook, poolManager: RANGE_POOL_DEPLOYMENT.poolManager, router: RANGE_POOL_DEPLOYMENT.router, poolId: RANGE_POOL_DEPLOYMENT.poolId,
    block: HEAD, tokens: { ustx: RANGE_POOL_DEPLOYMENT.asset, dusd: RANGE_POOL_DEPLOYMENT.dollar, decimals: 6 },
    feePips: 3_000, priceMicros: "100000000", tick: 46_054, navMicros: "100000000", navUnavailable: null,
    explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/address/${RANGE_POOL_DEPLOYMENT.hook}`,
  });
  assert.match(body.rule, /range pool appears once it is deployed/);
  // The response matches its OpenAPI schema, the range pool included.
  assert.deepEqual(schemaErrors(body, OPENAPI.paths["/api/v1/ustx/pools"].get.responses[200].content["application/json"].schema), []);
  sql.close();
});
