import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { GET, OPTIONS } from "../app/api/v1/ustx/route.ts";
import { STATE_HISTORY } from "../lib/xstocks/cycle.ts";
import { lookThrough, fundValueMicros } from "../lib/demo/basket.ts";
import { formatUsdRounded } from "../lib/nav-display.ts";
import { relativeTime, signedPercent, sinceFirstRecord } from "../lib/product-market.ts";

const schema = readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8");
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
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

const REGISTRY = "0x" + "b".repeat(40);
const HASH = "0x" + "c".repeat(64);
const TX = "0x" + "d".repeat(64);
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);
function chain(chainId = "0x7a0") {
  return async (_url, init) => {
    const { method } = JSON.parse(init.body);
    if (method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 2, result: chainId });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + word(99_449_929) + word(152_083_351) + HASH.slice(2) + word(seconds("2026-09-24T18:05:17Z")) + word(seconds("2026-09-24T18:05:25Z")) });
  };
}

test("the public NAV API serves the X Layer record to any origin and never writes", async (t) => {
  const { db, sql } = database();
  try {
    sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(STATE_HISTORY, JSON.stringify([{ asOf: "2026-09-24T18:05:17.000Z", navPerShareMicros: "99449929", holdingsHash: HASH, canonical: "{}", status: "confirmed", txHash: TX, error: null }]));
    env.DB = db;
    env.NAV_REGISTRY_ADDRESS = REGISTRY;
    db.readOnly = true;
    t.mock.method(globalThis, "fetch", chain());
    const response = await GET(new Request("https://ganymede.test/api/v1/ustx", { headers: { origin: "https://partner.example" } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cache-control"), "public, max-age=30");
    const body = await response.json();
    assert.equal(body.nav.perShareUsd, "99.449929");
    assert.equal(body.nav.sharesOutstandingMicros, "152083351");
    assert.equal(body.nav.holdingsHash, HASH);
    assert.equal(body.record.chainId, 1952);
    assert.equal(body.record.transactionHash, TX);
    assert.equal(body.verify.page, "https://ganymede.test/products/ustx/transparency");
    assert.equal(body.shares.token, "0x77eaeba1366bde7818da12d3cbdbea0a2ee97596");
    assert.equal(body.shares.paidWith.symbol, "dUSD");
    assert.equal(body.feed.address, "0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8");
    assert.equal(body.feed.decimals, 8);
    assert.equal(body.market.pool, "0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1");
    assert.equal(body.market.keeper, "0xccf372068496d9bef0f7cf83d697183d358dec1b");
    assert.equal(body.lending.market, "0xae2f54ae3d0370295de18510d56de92afb8843c7");
    const preflight = OPTIONS();
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-methods"), /GET/);
    // A wrong network or an unreachable RPC is a clean 503 that names no upstream URL.
    t.mock.method(globalThis, "fetch", chain("0x1"));
    t.mock.method(console, "error", () => {});
    assert.equal((await GET(new Request("https://ganymede.test/api/v1/ustx"))).status, 503);
    t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed https://rpc.secret.example/key"); });
    const down = await GET(new Request("https://ganymede.test/api/v1/ustx"));
    assert.equal(down.status, 503);
    assert.equal(down.headers.get("access-control-allow-origin"), "*");
    assert.doesNotMatch(await down.text(), /secret/);
  } finally { delete env.DB; delete env.NAV_REGISTRY_ADDRESS; sql.close(); }
});

test("look-through holdings scale each row by the shares and keep the weights", () => {
  const composition = { productId: "us-tech-x", asOf: "2026-09-24T18:05:17.000Z", pricingChainIndex: "196", basketFixedAt: "2026-09-23T11:15:53.000Z", navPerShareMicros: "30000000", holdings: [
    { symbol: "AAPLx", address: "0x1", weightBps: 5000, unitsWad: "50000000000000000", priceMicros: "200000000", valueMicros: "10000000", priceTime: "", priceSource: "" },
    { symbol: "MSFTx", address: "0x2", weightBps: 5000, unitsWad: "40000000000000000", priceMicros: "500000000", valueMicros: "20000000", priceTime: "", priceSource: "" },
  ] };
  const view = lookThrough(composition, 2_500_000n); // 2.5 shares
  assert.deepEqual(view.rows.map((row) => row.units), ["125000000000000000", "100000000000000000"]);
  assert.deepEqual(view.rows.map((row) => row.valueMicros), ["25000000", "50000000"]);
  assert.deepEqual(view.rows.map((row) => row.weightBps), [3333, 6666]);
  assert.equal(view.totalMicros, fundValueMicros(2_500_000n, 30_000_000n).toString());
  assert.equal(lookThrough(composition, -1n).totalMicros, "0");
});

test("account figures round to the cent while returns and times read naturally", () => {
  assert.equal(formatUsdRounded(999_999_997n), "$1,000.00");
  assert.equal(formatUsdRounded(1_004_999n), "$1.00");
  assert.equal(formatUsdRounded(1_005_000n), "$1.01");
  assert.equal(formatUsdRounded(-2_345_678n), "−$2.35");
  const points = [{ at: "2026-09-23T11:15:53.000Z", micros: "99999994", hash: "" }, { at: "2026-09-24T18:05:17.000Z", micros: "99449929", hash: "" }];
  assert.equal(signedPercent(sinceFirstRecord(points).percent), "−0.55%");
  assert.equal(sinceFirstRecord(points.slice(0, 1)), null);
  assert.equal(signedPercent(0.004), "0.00%");
  const now = Date.parse("2026-09-24T18:10:00Z");
  assert.equal(relativeTime("2026-09-24T18:09:30Z", now), "just now");
  assert.equal(relativeTime("2026-09-24T17:58:00Z", now), "12 min ago");
  assert.equal(relativeTime("2026-09-24T15:00:00Z", now), "3 h ago");
  assert.match(relativeTime("2026-09-22T15:00:00Z", now), /22 Sept?/);
});
