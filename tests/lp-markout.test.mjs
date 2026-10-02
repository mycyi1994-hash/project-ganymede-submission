import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { FUND_DEPLOYMENT, FUND_SELECTORS, POOL_EVENTS, fundRpc } from "../lib/xstocks/fund.ts";
import { ACTIVITY_EVENTS } from "../lib/xstocks/activity.ts";
import { NAV_PUBLISHED_TOPIC } from "../lib/xstocks/evidence.ts";
import { XSTOCKS_PRODUCT_KEY } from "../lib/xstocks/onchain.ts";
import { PROOF_DEPLOYMENT } from "../lib/xstocks/proof.ts";
import { V4_EVENTS, V4_POOL_DEPLOYMENT } from "../lib/xstocks/v4-liquidity.ts";
import {
  MARKOUT_FIRST_BLOCK, MARKOUT_MARGIN, MARKOUT_NAV_TOPIC, MARKOUT_PRODUCT_KEY, MARKOUT_REGISTRY, V4_SWAP_TOPIC, annualizedPer, lpMarkoutJson, parseLpMarkout, serializeLpMarkout, updateLpMarkout,
} from "../lib/xstocks/lp-markout.ts";
import { STATE_LP_MARKOUT, runLpMarkout } from "../lib/xstocks/activity-index.ts";

const F = MARKOUT_FIRST_BLOCK;
const D = V4_POOL_DEPLOYMENT;
const USD = 1_000_000n;
const TIME = 1_790_000_000;
const ALICE = "0x00000000000000000000000000000000000a11ce";
const word = (value) => (BigInt(value) & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const topic = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const OTHER_PRODUCT = `0x${"9".repeat(64)}`;

function log(address, topics, values, { block, index, hash, removed = false }) {
  return { address, topics, data: `0x${values.map(word).join("")}`, blockNumber: hex(block), logIndex: hex(index), transactionHash: hash, removed };
}

/** X Layer Testnet with `logs` on chain and the fund's NAV $100 before counting starts. */
function chain({ head, logs = [], failAt = null }) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first, tag] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(head));
      case "eth_call": {
        assert.equal(first.to, FUND_DEPLOYMENT.fund);
        assert.equal(first.data, FUND_SELECTORS.currentNav);
        assert.equal(Number(tag), F - 1, "the NAV in effect just before counting starts");
        return answer(`0x${word(100n * USD)}${word(TIME - 60)}`);
      }
      case "eth_getLogs": {
        const from = Number(first.fromBlock);
        const to = Number(first.toBlock);
        assert.ok(to - from <= 99, "at most 100 blocks per request");
        if (failAt !== null && from <= failAt && failAt <= to) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "header not found" } });
        return answer(logs.filter(entry => Number(entry.blockNumber) >= from && Number(entry.blockNumber) <= to));
      }
      case "eth_getBlockByNumber": return answer({ number: first, timestamp: hex(TIME + Number(first) - F) });
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), calls };
}

// USTX is currency0 of the v4 pool on X Layer Testnet: a swap's amount0 is USTX, amount1 demo dollars,
// both the swapper's: negative is what they paid in.
const swap = (sender, ustx, dusd, at, poolId = D.poolId) => log(D.poolManager, [V4_SWAP_TOPIC, poolId, topic(sender)], [ustx, dusd, 0, 0, 0, 3_000], at);
const MARKET = [
  // A purchase at $100: $100 in for 0.997 USTX, worth $99.70. The providers keep the $0.30 fee.
  log(FUND_DEPLOYMENT.pool, [POOL_EVENTS.bought, topic(ALICE)], [100n * USD, 997_000n], { block: F + 10, index: 0, hash: tx(1) }),
  // A record at $101, and another product's record in the same registry that does not price USTX.
  log(MARKOUT_REGISTRY, [MARKOUT_NAV_TOPIC, MARKOUT_PRODUCT_KEY, `0x${"1".repeat(64)}`], [101n * USD, 0, TIME], { block: F + 20, index: 0, hash: tx(2) }),
  log(MARKOUT_REGISTRY, [MARKOUT_NAV_TOPIC, OTHER_PRODUCT, `0x${"1".repeat(64)}`], [5n * USD, 0, TIME], { block: F + 20, index: 1, hash: tx(3) }),
  // The keeper's arbitrage buys 0.5 USTX for $50 at the old price: worth $50.50 at the new NAV.
  log(FUND_DEPLOYMENT.pool, [POOL_EVENTS.bought, topic(FUND_DEPLOYMENT.arbitrage)], [50n * USD, 500_000n], { block: F + 23, index: 4, hash: tx(4) }),
  log(FUND_DEPLOYMENT.arbitrage, [ACTIVITY_EVENTS.arbitraged, topic(FUND_DEPLOYMENT.keeper)], [1, 50n * USD, 50_490_000n, 101n * USD], { block: F + 23, index: 7, hash: tx(4) }),
  // A sale of 1 USTX for $100.70: worth $101 at the NAV, the providers keep $0.30.
  log(FUND_DEPLOYMENT.pool, [POOL_EVENTS.sold, topic(ALICE)], [USD, 100_700_000n], { block: F + 24, index: 0, hash: tx(5) }),
  // The hook moves its empty pool to $101 with a swap of its own, and says so; then someone buys
  // 0.99 USTX for $100 in the v4 pool: worth $99.99, so the providers keep a cent.
  swap(D.hook, 0, 0, { block: F + 30, index: 0, hash: tx(6) }),
  log(D.hook, [V4_EVENTS.repegged, `0x${word(TIME)}`], [101n * 100_000_000n, 0, 0, 0, 0, 0, 0, 0], { block: F + 30, index: 1, hash: tx(6) }),
  swap(D.router, 990_000n, -100n * USD, { block: F + 31, index: 0, hash: tx(7) }),
  // Another pool in the same manager is not this one.
  swap(D.router, -5n * USD, 5n * USD, { block: F + 31, index: 1, hash: tx(8) }, `0x${"7".repeat(64)}`),
  // A log the node later dropped.
  log(FUND_DEPLOYMENT.pool, [POOL_EVENTS.bought, topic(ALICE)], [1_000n * USD, 0], { block: F + 32, index: 0, hash: tx(9), removed: true }),
];

test("the registry, product key and record topic repeated here are the app's own", () => {
  assert.equal(MARKOUT_REGISTRY, PROOF_DEPLOYMENT.registry);
  assert.equal(MARKOUT_PRODUCT_KEY, XSTOCKS_PRODUCT_KEY);
  assert.equal(MARKOUT_NAV_TOPIC, NAV_PUBLISHED_TOPIC);
});

test("each pool's trades count for its providers at the NAV in effect, the keeper's arbitrage apart", async () => {
  const { rpc, calls } = chain({ head: F + 300, logs: MARKET });
  const markout = await updateLpMarkout(null, rpc);
  assert.deepEqual(lpMarkoutJson(markout), {
    fromBlock: F, from: new Date(TIME * 1000).toISOString(), toBlock: F + 300 - MARKOUT_MARGIN, to: new Date((TIME + 300 - MARKOUT_MARGIN) * 1000).toISOString(),
    navMicros: "101000000", navRecords: 1, repegs: 1,
    // +$0.30, −$0.50 and +$0.30: the arbitrage is the only loss.
    constantProduct: { trades: 3, volumeMicros: "250700000", resultMicros: "100000", arbitrages: 1, arbitrageResultMicros: "-500000" },
    v4: { trades: 1, volumeMicros: "100000000", resultMicros: "10000", arbitrages: 0, arbitrageResultMicros: "0" },
  });
  // One filter for every source, never the other pool's manager events by address alone.
  const request = calls.find(call => call.method === "eth_getLogs").params[0];
  assert.deepEqual(new Set(request.address), new Set([FUND_DEPLOYMENT.pool, FUND_DEPLOYMENT.arbitrage, MARKOUT_REGISTRY, D.poolManager, D.hook]));
  // Nothing new: the same totals, without reading logs again.
  const again = chain({ head: F + 300, logs: MARKET });
  assert.deepEqual(await updateLpMarkout(markout, again.rpc), markout);
  assert.equal(again.calls.filter(call => call.method === "eth_getLogs").length, 0);
});

test("a run reads at most its share of the backlog, oldest first, and a failed request changes nothing", async () => {
  const first = await updateLpMarkout(null, chain({ head: F + 10_000, logs: MARKET }).rpc, { chunks: 2 });
  assert.equal(first.toBlock, F + 199);
  assert.equal(first.constantProduct.trades, 3, "the blocks read so far");
  const before = serializeLpMarkout(first);
  await assert.rejects(updateLpMarkout(first, chain({ head: F + 10_000, logs: MARKET, failAt: F + 450 }).rpc, { chunks: 5 }));
  assert.equal(serializeLpMarkout(first), before, "the stored totals stay as they were");
  const later = await updateLpMarkout(first, chain({ head: F + 10_000, logs: MARKET }).rpc, { chunks: 5 });
  assert.equal(later.toBlock, F + 699);
  assert.deepEqual(later.constantProduct, first.constantProduct, "blocks already counted are not counted again");
});

test("without a pinned v4 pool only the constant-product pool counts", async () => {
  const markout = await updateLpMarkout(null, chain({ head: F + 300, logs: MARKET }).rpc, { deployment: null });
  assert.deepEqual([markout.constantProduct.trades, markout.v4.trades, markout.repegs], [3, 0, 0]);
});

test("the stored totals read back exactly, losses included, and anything else is refused", async () => {
  const markout = await updateLpMarkout(null, chain({ head: F + 300, logs: MARKET }).rpc);
  const lost = { ...markout, constantProduct: { ...markout.constantProduct, resultMicros: -123n } };
  assert.deepEqual(parseLpMarkout(serializeLpMarkout(lost)), lost);
  assert.equal(parseLpMarkout(null), null);
  assert.equal(parseLpMarkout("{"), null);
  assert.equal(parseLpMarkout({ ...lpMarkoutJson(markout), navMicros: "0" }), null);
  assert.equal(parseLpMarkout({ ...lpMarkoutJson(markout), v4: { ...lpMarkoutJson(markout).v4, trades: -1 } }), null);
  assert.equal(parseLpMarkout({ ...lpMarkoutJson(markout), constantProduct: { ...lpMarkoutJson(markout).constantProduct, volumeMicros: "-1" } }), null);
});

test("a result scales to $10,000 of liquidity and a year", () => {
  // −$0.05 in a day on a $10,000 pool is −$18.25 a year; on $5,000, twice that per $10,000.
  assert.equal(annualizedPer(-50_000n, 10_000n * USD, 86_400), -18_250_000n);
  assert.equal(annualizedPer(-50_000n, 5_000n * USD, 86_400), -36_500_000n);
  assert.equal(annualizedPer(0n, 10_000n * USD, 86_400), 0n);
  assert.equal(annualizedPer(1n, null, 86_400), null);
  assert.equal(annualizedPer(1n, 0n, 86_400), null);
  assert.equal(annualizedPer(1n, 10_000n * USD, 600), null, "under an hour says nothing about a year");
});

test("the scheduled job keeps the totals in the engine state", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8"));
  env.DB = { prepare(query) {
    const prepared = sql.prepare(query);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return prepared.get(...args) ?? null; },
      async all() { return { results: prepared.all(...args) }; },
      async run() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
    };
  } };
  const { rpc } = chain({ head: F + 300, logs: MARKET });
  assert.deepEqual(await runLpMarkout(env, { rpc }), { toBlock: F + 300 - MARKOUT_MARGIN, navRecords: 1 });
  const stored = parseLpMarkout(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(STATE_LP_MARKOUT).value);
  assert.equal(stored.constantProduct.arbitrageResultMicros, -500_000n);
});
