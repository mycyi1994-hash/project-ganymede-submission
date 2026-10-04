import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { keccak256, stringToBytes } from "viem";
import { FUNDS, USTX_FUND, XSTOCK_UNIVERSE, fundConstituents, otherFund } from "../lib/funds/catalog.ts";
import { FundDemoLedger, ensureFundDemoTables } from "../lib/funds/demo.ts";
import { addSeriesPoint, fundPoolCheck, fundStateKey, runFundsCycle } from "../lib/funds/cycle.ts";
import { EngineRepository } from "../lib/engine/repository.ts";
import { DEMO_START_CASH_MICROS } from "../lib/demo/ledger.ts";
import { verifyFundComposition, parseFundComposition } from "../lib/xstocks/proof.ts";
import { FUND_POOLS } from "../lib/xstocks/pool-prices.ts";
import { STATE_LATEST } from "../lib/xstocks/cycle.ts";
import { GET as fundsGET } from "../app/api/v1/funds/route.ts";
import { POST as fundOrdersPOST } from "../app/api/funds/orders/route.ts";
import { GET as fundAccountGET } from "../app/api/funds/account/route.ts";
import { GET as demoAccountGET } from "../app/api/demo/account/route.ts";
import { POST as resetPOST } from "../app/api/demo/reset/route.ts";

const schema = ["0000_giant_speedball.sql", "0001_demo_ledger.sql"].map((file) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).join("\n");

/** A D1 stand-in whose batch is one transaction; `readOnly` refuses anything but a SELECT. */
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
  const db = {
    readOnly: false,
    prepare(query) {
      if (this.readOnly && !/^\s*SELECT/i.test(query)) throw Error("Unexpected write on a read-only request");
      const prepared = sql.prepare(query);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return prepared.get(...args) ?? null; },
        async all() { return { results: prepared.all(...args) }; },
        async run() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
        runNow() { return prepared.run(...args); },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try { const results = statements.map((statement) => statement.runNow()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, sql };
}

test("six funds over eighteen pinned xStocks, each recorded under keccak256 of its id", () => {
  assert.equal(FUNDS.length, 6);
  assert.equal(FUNDS[0], USTX_FUND);
  assert.equal(XSTOCK_UNIVERSE.length, 18);
  assert.equal(new Set(XSTOCK_UNIVERSE.map((token) => token.address)).size, 18);
  for (const token of XSTOCK_UNIVERSE) assert.match(token.address, /^0x[0-9a-f]{40}$/);
  // Every token in the universe is held by at least one fund, and every holding is in the universe.
  const held = new Set(FUNDS.flatMap((fund) => fund.constituents));
  assert.deepEqual([...held].sort(), XSTOCK_UNIVERSE.map((token) => token.symbol).sort());
  for (const fund of FUNDS) {
    assert.equal(fund.productKey, keccak256(stringToBytes(fund.id)), fund.id);
    assert.equal(new Set(fund.constituents).size, fund.constituents.length);
  }
  assert.equal(otherFund("us-tech-x"), null);
  assert.equal(fundConstituents(otherFund("us-core")).map((item) => item.address).join(), "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48,0xa753a7395cae905cd615da0b82a53e0560f250af");
});

const NAV = 100_000_000n;
const nav = { navMicros: NAV, effectiveAt: "2026-10-04T03:00:00.000Z", holdingsHash: "0x" + "a".repeat(64) };

test("a fund order moves the shared demo cash and the fund's own holding in one transaction", async () => {
  const { db, sql } = database();
  await ensureFundDemoTables(db);
  const demo = new FundDemoLedger(db);
  const now = new Date("2026-10-04T03:01:00.000Z");
  const bought = await demo.place("alice", "ai-chips", { id: "ord_1", side: "subscribe", usdMicros: 2_500_000_000n }, nav, now);
  assert.equal(bought.order.sharesMicros, "25000000");
  assert.equal(await demo.cash("alice"), DEMO_START_CASH_MICROS - 2_500_000_000n);
  assert.deepEqual(await demo.positions("alice"), [{ fundId: "ai-chips", sharesMicros: "25000000", costMicros: "2500000000" }]);
  // A retry replays; the same id in another fund is refused.
  assert.equal((await demo.place("alice", "ai-chips", { id: "ord_1", side: "subscribe", usdMicros: 2_500_000_000n }, nav, now)).replayed, true);
  await assert.rejects(demo.place("alice", "us-core", { id: "ord_1", side: "subscribe", usdMicros: 10_000_000n }, nav, now), (error) => error.code === "order_id_taken");
  await assert.rejects(demo.place("alice", "us-core", { id: "ord_2", side: "subscribe", usdMicros: 9_000_000_000n }, nav, now), (error) => error.code === "insufficient_cash");
  await assert.rejects(demo.place("alice", "us-core", { id: "ord_3", side: "redeem", sharesMicros: 1n }, nav, now), (error) => error.code === "insufficient_shares");
  // Redeeming half at a higher NAV pays more and removes half the cost.
  const sold = await demo.place("alice", "ai-chips", { id: "ord_4", side: "redeem", sharesMicros: 12_500_000n }, { ...nav, navMicros: 110_000_000n }, now);
  assert.equal(sold.order.usdMicros, "1375000000");
  assert.equal(await demo.cash("alice"), DEMO_START_CASH_MICROS - 2_500_000_000n + 1_375_000_000n);
  assert.deepEqual(await demo.positions("alice"), [{ fundId: "ai-chips", sharesMicros: "12500000", costMicros: "1250000000" }]);
  assert.equal(await demo.sharesOutstanding("ai-chips"), "12500000");
  assert.deepEqual(await demo.totals("ai-chips"), { sharesMicros: "12500000", investors: 1 });
  assert.deepEqual((await demo.orders("alice")).map((order) => order.id), ["ord_4", "ord_1"]);
  assert.deepEqual((await demo.orders("alice", "us-core")), []);
  // The USTX ledger's own shares are untouched.
  assert.equal(sql.prepare("SELECT shares_micros FROM demo_accounts WHERE subject = 'alice'").get().shares_micros, 0);
  await demo.reset("alice");
  assert.deepEqual(await demo.positions("alice"), []);
  sql.close();
});

test("before the tables exist, fund reads are empty rather than errors", async () => {
  const { db, sql } = database();
  const demo = new FundDemoLedger(db);
  assert.deepEqual(await demo.positions("bob"), []);
  assert.deepEqual(await demo.orders("bob"), []);
  assert.equal(await demo.sharesOutstanding("us-core"), "0");
  await demo.reset("bob");
  sql.close();
});

// OnchainOS prices for every token the five funds hold, and the pools at the same prices.
const PRICES = { AAPLx: "333.53", MSFTx: "518.03", NVDAx: "234.8", AMZNx: "252.06", METAx: "729.8", TSLAx: "371.34", GOOGLx: "343.51", ORCLx: "142.38", PLTRx: "189.35", AMDx: "160.12", INTCx: "24.5", COINx: "310.4", MSTRx: "380.2", CRCLx: "120.7", HOODx: "105.3", GMEx: "26.1", SPYx: "668.9", QQQx: "601.2" };
const priceFetch = (at, missing = []) => async () => Response.json({ code: "0", data: XSTOCK_UNIVERSE.filter((token) => !missing.includes(token.symbol)).map((token) => ({ chainIndex: "196", tokenContractAddress: token.address, price: PRICES[token.symbol], time: String(Date.parse(at)) })) });
const pools = (factor = 1) => async () => ({ blockNumber: 1, blockTime: "", prices: FUND_POOLS.map((pool) => ({ symbol: pool.symbol, token: pool.token, pool: pool.pool, stable: pool.stable.symbol, priceMicros: String(Math.round(Number(PRICES[pool.symbol]) * 1e6 * factor)) })) });
const credentials = { OKX_API_KEY: "k", OKX_API_SECRET: "s", OKX_API_PASSPHRASE: "p" };
function settlement() {
  const requests = [];
  return { requests, rpcUrl: "https://rpc.test", async settle(request) { requests.push(request); return { id: `stl_${requests.length}`, payloadHash: "0x", blockNumber: 1, status: "confirmed", txHash: "0x" + requests.length.toString(16).padStart(64, "0"), error: null }; } };
}

test("each fund is priced, checked and recorded under its own product, and a fund without prices waits", async () => {
  const { db, sql } = database();
  const repo = new EngineRepository(db);
  const relayer = settlement();
  const at = "2026-10-04T03:05:00.000Z";
  // CRCLx has no OnchainOS price yet: Crypto Economy waits, the others are recorded.
  const first = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, at, { fetcher: priceFetch(at, ["CRCLx"]), poolPrices: pools() });
  assert.equal(first.navsPublished, 4);
  assert.deepEqual(relayer.requests.map((request) => request.productId).sort(), ["ai-chips", "magnificent-7", "retail-favorites", "us-core"]);
  assert.ok(relayer.requests.every((request) => request.action === "publish_nav" && request.effectiveAt === at));
  assert.match(first.warnings.join(" "), /CRYX not published: No live price for CRCLx/);
  const core = JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(fundStateKey("us-core", "confirmed")).value);
  assert.ok(BigInt(core.navPerShareMicros) <= 100_000_000n && BigInt(core.navPerShareMicros) > 99_999_990n, "a new fund starts at US$100");
  // The stored document is exactly what the registry record fingerprints, and it verifies.
  const record = { navPerShareMicros: core.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: core.holdingsHash, effectiveAt: at, publishedAt: null };
  const checks = await verifyFundComposition(core.canonical, record, "us-core");
  assert.deepEqual([checks.hash.state, checks.nav.state], ["pass", "pass"]);
  assert.throws(() => parseFundComposition(core.canonical, "ai-chips"), /another basket/);
  // Funds whose every holding has a deep pool are compared; the others say why not.
  const latest = (id) => JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(fundStateKey(id, "latest")).value);
  assert.equal(latest("magnificent-7").poolCheck.state, "agrees");
  assert.equal(latest("ai-chips").poolCheck.state, "not_compared");
  assert.match(latest("ai-chips").poolCheck.detail, /AMDx, INTCx have no X Layer pool deep enough/);
  // Nothing of USTX's is written.
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM engine_state WHERE key = ?").get(STATE_LATEST).n, 0);

  // Five minutes later every price is there: all five are recorded, and a series grows.
  const later = "2026-10-04T03:10:00.000Z";
  const second = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, later, { fetcher: priceFetch(later), poolPrices: pools() });
  assert.equal(second.navsPublished, 5);
  assert.equal(JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(fundStateKey("magnificent-7", "series")).value).length, 2);
  // Pools 5% away from OnchainOS stop a fund they fully cover, and only that kind.
  const third = "2026-10-04T03:15:00.000Z";
  const moved = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, third, { fetcher: priceFetch(third), poolPrices: pools(1.05) });
  assert.match(moved.warnings.join(" "), /M7X not published: The NAV at the X Layer pools is \+5\.00%/);
  assert.match(moved.warnings.join(" "), /CORX not published/);
  assert.equal(moved.navsPublished, 3);
  sql.close();
});

test("the series keeps one point per record, oldest first", () => {
  const publication = (asOf, nav) => ({ asOf, navPerShareMicros: nav });
  const series = addSeriesPoint(addSeriesPoint([], publication("2026-10-04T03:10:00.000Z", "2")), publication("2026-10-04T03:05:00.000Z", "1"));
  assert.deepEqual(series.map(([, nav]) => nav), ["1", "2"]);
  assert.equal(addSeriesPoint(series, publication("2026-10-04T03:10:00.000Z", "9")).length, 2);
  assert.equal(fundPoolCheck({ holdings: [{ symbol: "CRCLx", address: "0xfebded1b0986a8ee107f5ab1a1c5a813491deceb" }] }, null).check.state, "not_compared");
});

const REGISTRY = "0x" + "b".repeat(40);
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const request = (path, init = {}, cookie) => new Request(`https://demo.test${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });

test("the fund API reads only, and a demo order fills at the fund's record on X Layer", async (t) => {
  const { db, sql } = database();
  try {
    env.DB = db;
    env.NAV_REGISTRY_ADDRESS = REGISTRY;
    db.readOnly = true;
    const list = await fundsGET(request("/api/v1/funds"));
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("access-control-allow-origin"), "*");
    const body = await list.json();
    assert.deepEqual(body.funds.map((fund) => fund.ticker), ["USTX", "M7X", "AIX", "CRYX", "CORX", "RTLX"]);
    assert.equal(body.funds[1].nav, null);
    assert.equal((await fundsGET(request("/api/v1/funds?id=nope"))).status, 404);
    const detail = await (await fundsGET(request("/api/v1/funds?id=us-core"))).json();
    assert.deepEqual(detail.fund.holdings.map((holding) => holding.symbol), ["SPYx", "QQQx"]);
    assert.deepEqual(detail.fund.demo, { sharesMicros: "0", investors: 0 });
    db.readOnly = false;

    const view = await demoAccountGET(request("/api/demo/account"));
    const cookie = view.headers.get("set-cookie").split(";")[0];
    // The chain answers the fund's product key with a record two minutes old.
    const keys = [];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      const { method, params } = JSON.parse(init.body);
      if (method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 2, result: "0x7a0" });
      keys.push(params[0].data.slice(10, 74));
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + word(NAV) + word(0) + "a".repeat(64) + word(Math.floor((Date.now() - 120_000) / 1000)) + word(0) });
    });
    const order = (fundId, extra) => fundOrdersPOST(request("/api/funds/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fundId, clientOrderId: "abcd-1234", ...extra }) }, cookie));
    assert.equal((await order("us-tech-x", { side: "subscribe", usdMicros: "1000000000" })).status, 400);
    const placed = await order("us-core", { side: "subscribe", usdMicros: "1000000000" });
    assert.equal(placed.status, 201);
    assert.equal(keys[0], otherFund("us-core").productKey.slice(2));
    const filled = await placed.json();
    assert.equal(filled.order.sharesMicros, "10000000");
    assert.equal(filled.cashMicros, (DEMO_START_CASH_MICROS - 1_000_000_000n).toString());
    // The same client id in another fund is a different order.
    assert.equal((await order("ai-chips", { side: "subscribe", usdMicros: "1000000000" })).status, 201);
    const account = await (await fundAccountGET(request("/api/funds/account", {}, cookie))).json();
    assert.deepEqual(account.positions.map((position) => position.fundId), ["ai-chips", "us-core"]);
    // The USTX account shows the same cash.
    const ustx = await (await demoAccountGET(request("/api/demo/account", {}, cookie))).json();
    assert.equal(ustx.account.cashMicros, (DEMO_START_CASH_MICROS - 2_000_000_000n).toString());
    // Starting again clears the fund holdings too.
    assert.equal((await resetPOST(request("/api/demo/reset", { method: "POST" }, cookie))).status, 200);
    assert.deepEqual((await (await fundAccountGET(request("/api/funds/account", {}, cookie))).json()).positions, []);
  } finally { delete env.DB; delete env.NAV_REGISTRY_ADDRESS; sql.close(); }
});
