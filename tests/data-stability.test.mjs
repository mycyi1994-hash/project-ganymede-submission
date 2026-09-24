import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { EngineRepository } from "../lib/engine/repository.ts";
import { runEngineCycle } from "../lib/engine/runner.ts";
import { jsonError } from "../lib/engine/api-helpers.ts";
import { fetchXStockQuotes } from "../lib/xstocks/prices.ts";
import { runXStocksCycle, STATE_BASKET, STATE_CONFIRMED, STATE_DOCUMENT_PREFIX, STATE_HISTORY, STATE_LATEST } from "../lib/xstocks/cycle.ts";
import { XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { GET as marketGET } from "../app/api/market/route.ts";
import { GET as portfolioGET } from "../app/api/portfolio/route.ts";
import { GET as healthGET } from "../app/api/health/route.ts";
import { GET as xstocksGET } from "../app/api/xstocks/route.ts";

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
  }, async batch(statements) { return Promise.all(statements.map((s) => s.run())); } };
  return { db, sql, changes: () => Number(sql.prepare("SELECT total_changes() n").get().n) };
}

test("seed is retryable and writes nothing once the same catalog is initialized", async () => {
  const { db, sql, changes } = database();
  try {
    const repo = new EngineRepository(db);
    await repo.seed();
    assert.equal((await repo.listProducts()).length, 4);
    const before = changes();
    await repo.seed();
    assert.equal(changes(), before);
  } finally { sql.close(); }
});

test("public market, portfolio and health GETs work with database writes disabled", async (t) => {
  const { db, sql } = database();
  try {
    await new EngineRepository(db).seed();
    db.readOnly = true;
    env.DB = db;
    env.TRADING_MODE = "paper";
    t.mock.method(globalThis, "fetch", async (_url, init) => Response.json({ result: JSON.parse(init.body).method === "eth_chainId" ? "0x7a0" : "0x123" }));
    const market = await marketGET();
    assert.equal(market.status, 200, await market.text());
    const portfolio = await portfolioGET(new Request("https://test/api/portfolio"));
    assert.equal(portfolio.status, 200);
    assert.deepEqual((await portfolio.json()).positions, []);
    assert.equal((await healthGET()).status, 200);
  } finally { delete env.DB; delete env.TRADING_MODE; sql.close(); }
});

test("the public health check reports an RPC failure without its error text", async (t) => {
  const { db, sql } = database();
  try {
    await new EngineRepository(db).seed();
    env.DB = db;
    env.SETTLEMENT_RPC_URL = "https://rpc.example.test/v1/secret-provider-key";
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => { throw new TypeError("request to https://rpc.example.test/v1/secret-provider-key failed"); });
    const response = await healthGET();
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.doesNotMatch(body, /secret-provider-key|rpc\.example/);
    assert.equal(JSON.parse(body).settlement.connected, false);
  } finally { delete env.DB; delete env.SETTLEMENT_RPC_URL; sql.close(); }
});

test("a cycle that is not due performs no writes or outbound requests", async (t) => {
  const { db, sql, changes } = database();
  try {
    await new EngineRepository(db).setState("last_cycle", "{}");
    db.readOnly = true;
    t.mock.method(globalThis, "fetch", () => { throw Error("Unexpected network request"); });
    const before = changes();
    assert.equal((await runEngineCycle({ DB: db }, "request")).skipped, true);
    assert.equal(changes(), before);
  } finally { sql.close(); }
});

test("unchanged candles consume no additional writes", async () => {
  const { db, sql, changes } = database();
  try {
    const repo = new EngineRepository(db);
    await repo.seed();
    const candles = new Map([["BTC", [{ symbol: "BTC", candleDate: "2026-09-23", openKrw: 1, highKrw: 2, lowKrw: 1, closeKrw: 2, volumeKrw: 9, source: "test" }]]]);
    await repo.saveCandles(candles);
    const before = changes();
    await repo.saveCandles(candles);
    assert.equal(changes(), before);
  } finally { sql.close(); }
});

test("proof API recovers the current chain document after rolling history has expired", async (t) => {
  const { db, sql } = database();
  try {
    const hash = "0x" + "a".repeat(64);
    const document = { asOf: "2026-09-23T12:00:00Z", navPerShareMicros: "99999999", holdingsHash: hash, canonical: "{\"preserved\":true}", status: "queued", txHash: null, error: null };
    await new EngineRepository(db).setState(STATE_DOCUMENT_PREFIX + hash, JSON.stringify(document));
    db.readOnly = true;
    env.DB = db;
    env.NAV_REGISTRY_ADDRESS = "0x" + "b".repeat(40);
    const word = (value) => BigInt(value).toString(16).padStart(64, "0");
    t.mock.method(globalThis, "fetch", async () => Response.json({ result: "0x" + word(99999999) + word(0) + hash.slice(2) + word(1790164800) + word(1790164801) }));
    const response = await xstocksGET();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).history[0].canonical, document.canonical);
  } finally { delete env.DB; delete env.NAV_REGISTRY_ADDRESS; sql.close(); }
});

test("quota, transient D1 and missing schema errors stay distinct", async () => {
  const quota = jsonError(new Error("D1_ERROR: daily write limit exceeded"));
  assert.equal(quota.status, 503);
  assert.equal((await quota.json()).code, "DATABASE_CAPACITY");
  assert.equal((await jsonError(new Error("D1_ERROR: database unavailable")).json()).code, "DATABASE_UNAVAILABLE");
  assert.equal((await jsonError(new Error("D1_ERROR: no such table: products")).json()).code, "DATABASE_SCHEMA_MISSING");
});

const credentials = { apiKey: "test", secret: "test", passphrase: "test", baseUrl: "https://prices.example" };
test("a non-JSON rate limit response is not retried and respects Retry-After", async () => {
  let calls = 0;
  const start = Date.now();
  const result = await fetchXStockQuotes(credentials, [{ symbol: "AAPLx", address: "0x" + "1".repeat(40) }], async () => {
    calls += 1;
    return new Response("error code: 1015", { status: 429, headers: { "Retry-After": "3600" } });
  });
  assert.equal(calls, 1);
  assert.match(result.warnings[0], /HTTP 429/);
  assert.ok(Date.parse(result.retryAt) >= start + 3600_000);
});

test("price timeouts and transient retries are bounded", async () => {
  const constituents = [{ symbol: "AAPLx", address: "0x" + "1".repeat(40) }];
  let calls = 0;
  const result = await fetchXStockQuotes(credentials, constituents, async (_url, init) => {
    calls += 1;
    assert.ok(init.signal instanceof AbortSignal);
    return new Response("unavailable", { status: 503 });
  });
  assert.equal(calls, 2);
  assert.equal(result.quotes.size, 0);
  const timeout = await fetchXStockQuotes(credentials, constituents, async () => { throw new DOMException("Timed out", "TimeoutError"); });
  assert.match(timeout.warnings[0], /Timed out/);
});

test("repeated failed publications retain the last confirmed composition", async (t) => {
  const rows = new Map();
  const repo = { async getState(key) { return rows.has(key) ? { value: rows.get(key) } : null; }, async setState(key, value) { rows.set(key, value); }, async saveSettlement() {}, async deleteStatesWithPrefix(prefix, keep) { for (const key of [...rows.keys()]) if (key.startsWith(prefix) && !keep.includes(key)) rows.delete(key); } };
  const addresses = XSTOCKS_CONSTITUENTS.map((item, i) => ({ ...item, address: "0x" + String(i + 1).repeat(40) }));
  const configured = { OKX_API_KEY: "test", OKX_API_SECRET: "test", OKX_API_PASSPHRASE: "test", XSTOCKS_ADDRESSES: addresses.map((item) => item.symbol + "=" + item.address).join(",") };
  const now = new Date().toISOString();
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "0", data: addresses.map((item) => ({ chainIndex: "196", tokenContractAddress: item.address, price: "100", time: now })) }));
  let confirmed = true;
  const settlement = { async settle() { assert.ok(rows.has(STATE_HISTORY), "document must exist before NAV broadcast"); return { status: confirmed ? "confirmed" : "failed", txHash: confirmed ? "0xabc" : null, error: confirmed ? null : "unavailable" }; } };
  const first = await runXStocksCycle(configured, repo, settlement, now);
  assert.equal(first.navsPublished, 1);
  const lastGood = rows.get(STATE_CONFIRMED);
  const basket = rows.get(STATE_BASKET);
  confirmed = false;
  for (let i = 1; i <= 14; i++) {
    const result = await runXStocksCycle(configured, repo, settlement, new Date(Date.parse(now) + i * 1000).toISOString());
    assert.equal(result.navsPublished, 0);
  }
  assert.equal(rows.get(STATE_CONFIRMED), lastGood);
  assert.equal(rows.get(STATE_BASKET), basket);
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
  await runXStocksCycle(configured, repo, settlement, now);
  assert.equal(JSON.parse(rows.get(STATE_LATEST)).status, "awaiting_prices");
  assert.equal(rows.get(STATE_CONFIRMED), lastGood);
  assert.equal(rows.get(STATE_BASKET), basket);
  t.mock.method(globalThis, "fetch", () => { throw Error("Cooldown should prevent requests"); });
  const cooldown = await runXStocksCycle(configured, repo, settlement, now);
  assert.match(cooldown.warnings[0], /cooldown/);
});
