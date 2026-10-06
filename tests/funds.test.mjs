import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { keccak256, stringToBytes } from "viem";
import { FUNDS, USTX_FUND, XSTOCK_UNIVERSE, fundConstituents, otherFund } from "../lib/funds/catalog.ts";
import { addSeriesPoint, fundPoolCheck, fundStateKey, runFundsCycle } from "../lib/funds/cycle.ts";
import { EngineRepository } from "../lib/engine/repository.ts";
import { verifyFundComposition, parseFundComposition } from "../lib/xstocks/proof.ts";
import { FUND_POOLS } from "../lib/xstocks/pool-prices.ts";
import { STATE_LATEST } from "../lib/xstocks/cycle.ts";
import { GET as fundsGET } from "../app/api/v1/funds/route.ts";
import { ustxTools } from "../app/mcp/tools.ts";

const schema = ["0000_giant_speedball.sql", "0001_demo_ledger.sql"].map((file) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).join("\n");

/** A D1 stand-in whose batch is one transaction; `readOnly` refuses anything but a SELECT. */
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
  const db = {
    readOnly: false,
    beforeBatch: null,
    afterBatch: null,
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
      if (this.beforeBatch) { const hook = this.beforeBatch; this.beforeBatch = null; await hook(); }
      sql.exec("BEGIN");
      let results;
      try { results = statements.map((statement) => statement.runNow()); sql.exec("COMMIT"); } catch (error) { sql.exec("ROLLBACK"); throw error; }
      if (this.afterBatch) { const hook = this.afterBatch; this.afterBatch = null; await hook(); }
      return results;
    },
  };
  return { db, sql };
}

test("six funds and three income products over eighteen pinned xStocks, each recorded under keccak256 of its id", () => {
  assert.equal(FUNDS.length, 9);
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
  // CRCLx has no OnchainOS price yet: Crypto Economy waits, the others are recorded, and so are the
  // three income products (lib/income/), from the same prices of SPYx and QQQx.
  const first = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, at, { fetcher: priceFetch(at, ["CRCLx"]), poolPrices: pools() });
  assert.equal(first.navsPublished, 7);
  assert.deepEqual(relayer.requests.map((request) => request.productId).sort(), ["ai-chips", "magnificent-7", "qqq-covered-call", "retail-favorites", "spy-covered-call", "spy-qqq-autocall-1", "us-core"]);
  assert.ok(relayer.requests.every((request) => request.action === "publish_nav" && request.effectiveAt === at));
  // Investing in them is not open, so no record counts shares (the server's demo balances are retired).
  assert.ok(relayer.requests.every((request) => !request.sharesOutstandingMicros));
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

  // Five minutes later every price is there: all five and the income products are recorded, and a series grows.
  const later = "2026-10-04T03:10:00.000Z";
  const second = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, later, { fetcher: priceFetch(later), poolPrices: pools() });
  assert.equal(second.navsPublished, 8);
  assert.equal(JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(fundStateKey("magnificent-7", "series")).value).length, 2);
  // Pools 5% away from OnchainOS stop a fund they fully cover, and only that kind.
  const third = "2026-10-04T03:15:00.000Z";
  const moved = await runFundsCycle({ ...credentials, DB: db }, repo, relayer, third, { fetcher: priceFetch(third), poolPrices: pools(1.05) });
  assert.match(moved.warnings.join(" "), /M7X not published: The NAV at the X Layer pools is \+5\.00%/);
  assert.match(moved.warnings.join(" "), /CORX not published/);
  assert.match(moved.warnings.join(" "), /SPYC not published: The SPYx pool on X Layer is \+5\.00%/);
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
const request = (path, init = {}, cookie) => new Request(`https://demo.test${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });

test("the fund API reads only and carries no demo totals", async () => {
  const { db, sql } = database();
  try {
    env.DB = db;
    env.NAV_REGISTRY_ADDRESS = REGISTRY;
    db.readOnly = true;
    const list = await fundsGET(request("/api/v1/funds"));
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("access-control-allow-origin"), "*");
    const body = await list.json();
    assert.deepEqual(body.funds.map((fund) => fund.ticker), ["USTX", "M7X", "AIX", "CRYX", "CORX", "RTLX", "SPYC", "QQQC", "ELS1"]);
    assert.equal(body.funds[1].nav, null);
    assert.equal((await fundsGET(request("/api/v1/funds?id=nope"))).status, 404);
    const detail = await (await fundsGET(request("/api/v1/funds?id=us-core"))).json();
    assert.deepEqual(detail.fund.holdings.map((holding) => holding.symbol), ["SPYx", "QQQx"]);
    assert.equal(detail.fund.demo, undefined);
    // USTX's records live under the first product's keys; its detail reads them, without the document.
    db.readOnly = false;
    const record = { asOf: "2026-10-06T14:20:44.000Z", navPerShareMicros: "101570295", status: "confirmed", txHash: `0x${"c".repeat(64)}` };
    sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run("xstocks:history", JSON.stringify([record]));
    sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run("xstocks:latest", JSON.stringify({ evaluatedAt: record.asOf, status: "published", blockers: [], warnings: [], composition: null, canonical: "{}", holdingsHash: null, publication: record }));
    db.readOnly = true;
    const ustx = (await (await fundsGET(request("/api/v1/funds?id=us-tech-x"))).json()).fund;
    assert.deepEqual(ustx.history.map((entry) => entry.navPerShareMicros), ["101570295"]);
    assert.equal(ustx.latest.publication.txHash, record.txHash);
    assert.equal(ustx.latest.canonical, undefined);
    // While newer records wait for X Layer, the last confirmed one stays listed with its document for the browser's check.
    db.readOnly = false;
    const waiting = Array.from({ length: 12 }, (_, index) => ({ asOf: new Date(Date.parse("2026-10-06T14:25:00.000Z") + index * 300_000).toISOString(), navPerShareMicros: "100000000", holdingsHash: `0x${String(index).padStart(64, "0")}`, canonical: "{}", status: "submitted", txHash: null, error: null }));
    const confirmedRecord = { asOf: "2026-10-06T14:20:44.000Z", navPerShareMicros: "100500000", holdingsHash: `0x${"d".repeat(64)}`, canonical: "{}", status: "confirmed", txHash: `0x${"e".repeat(64)}`, error: null };
    sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run("fund:magnificent-7:history", JSON.stringify(waiting));
    sql.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run("fund:magnificent-7:confirmed", JSON.stringify(confirmedRecord));
    db.readOnly = true;
    const m7x = (await (await fundsGET(request("/api/v1/funds?id=magnificent-7"))).json()).fund;
    assert.equal(m7x.history.length, 13);
    assert.deepEqual(m7x.history.at(-1), confirmedRecord);
  } finally { delete env.DB; delete env.NAV_REGISTRY_ADDRESS; sql.close(); }
});

test("Ask USTX and MCP agents read every product: the list, a basket's weights, the month's call and the note's knock-in", async () => {
  const { db, sql } = database();
  try {
    const repo = new EngineRepository(db);
    const at = "2026-10-04T03:05:00.000Z";
    await runFundsCycle({ ...credentials, DB: db }, repo, settlement(), at, { fetcher: priceFetch(at), poolPrices: pools() });
    env.DB = db;
    db.readOnly = true;
    const tools = ustxTools("https://ganymede.example");
    const run = (name, args = {}) => tools.find((tool) => tool.name === name).run(args);
    const listed = await run("list_funds");
    assert.deepEqual(listed.funds.map((fund) => [fund.ticker, fund.kind, fund.investable]), [
      ["USTX", "basket", true], ["M7X", "basket", false], ["AIX", "basket", false], ["CRYX", "basket", false], ["CORX", "basket", false], ["RTLX", "basket", false],
      ["SPYC", "covered-call", false], ["QQQC", "covered-call", false], ["ELS1", "autocall", false],
    ]);
    assert.ok(Math.abs(Number(listed.funds.find((fund) => fund.ticker === "M7X").navUsd) - 100) < 0.001, "a new fund starts at US$100");
    // Only USTX takes orders, and it says whether it does now; here its NAV cannot be read, so it does not claim it.
    const ustxListed = listed.funds.find((fund) => fund.ticker === "USTX");
    assert.notEqual(ustxListed.ordersOpen, true);
    assert.match(ustxListed.ordersNote, /could not be read|over an hour old/);
    assert.equal("ordersOpen" in listed.funds.find((fund) => fund.ticker === "M7X"), false);
    const basket = await run("get_fund", { id: "M7X" });
    assert.equal(basket.holdings.length, 7);
    assert.ok(Math.abs(basket.holdings.reduce((sum, holding) => sum + holding.weightPercent, 0) - 100) < 0.1);
    assert.match(basket.notOpen, /not open yet/);
    const call = await run("get_fund", { id: "spy-covered-call" });
    assert.equal(call.etf.symbol, "SPYx");
    assert.equal(call.call.strikeUsd, 682.28);
    assert.equal(call.terms.tenorDays, 30);
    assert.ok(call.call.premiumThisMonthPercent > 0.5 && call.returnFromTodayToExpiryPercent.etfFlat === call.call.premiumThisMonthPercent, JSON.stringify(call.returnFromTodayToExpiryPercent));
    assert.equal(call.documentConsistent, true);
    const note = await run("get_fund", { id: "els1" });
    assert.equal(note.status, "live");
    assert.equal(note.knockIn.levelPercent, 50);
    assert.equal(note.knockIn.furtherFallToKnockInPercent, 50);
    assert.equal(note.nextObservation.barrierPercent, 90);
    assert.equal(note.nextObservation.paysPer100IfCalled, 103.5);
    assert.equal(note.schedule.length, 6);
    assert.equal(note.documentConsistent, true);
    // Records the relayer has not confirmed do not replace the confirmed record's document, which the NAV is from.
    db.readOnly = false;
    const key = fundStateKey("spy-covered-call", "history");
    const queued = JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(key).value);
    const moved = JSON.parse(queued[0].canonical);
    moved.underlying.price = 700;
    queued.unshift({ ...queued[0], asOf: "2026-10-04T03:10:00.000Z", canonical: JSON.stringify(moved), status: "failed", txHash: null });
    sql.prepare("UPDATE engine_state SET value = ? WHERE key = ?").run(JSON.stringify(queued.map((entry) => ({ ...entry, status: entry.txHash ? "failed" : entry.status }))), key);
    db.readOnly = true;
    const confirmedCall = await run("get_fund", { id: "SPYC" });
    assert.equal(confirmedCall.etf.priceUsd, 668.9, "the confirmed record's ETF price, not a newer unconfirmed one");
    assert.equal(confirmedCall.asOf, at);
    // An archived sale that does not hash to its fingerprint leaves the record not shown consistent.
    db.readOnly = false;
    const archiveKey = fundStateKey("spy-covered-call", "transitions");
    const archive = JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(archiveKey).value);
    assert.equal(archive.records[0].asOf, at, "the call's sale is archived");
    archive.records[0].holdingsHash = `0x${"0".repeat(64)}`;
    sql.prepare("UPDATE engine_state SET value = ? WHERE key = ?").run(JSON.stringify(archive), archiveKey);
    db.readOnly = true;
    assert.equal((await run("get_fund", { id: "SPYC" })).documentConsistent, false);
    const ustx = await run("get_fund", { id: "USTX" });
    assert.match(ustx.seeAlso, /get_ustx_holdings/);
    assert.notEqual(ustx.ordersOpen, true);
    await assert.rejects(run("get_fund", { id: "nope" }), /id must be one of/);
  } finally { delete env.DB; sql.close(); }
});
