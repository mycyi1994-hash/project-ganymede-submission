import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { EngineRepository } from "../lib/engine/repository.ts";
import { runEngineCycle } from "../lib/engine/runner.ts";
import { krwForShares, sharesForSubscription } from "../lib/engine/fixed.ts";
import { ASSET_UNIVERSE, PRODUCT_DEFINITIONS } from "../lib/engine/seed.ts";
import { calculateStrategy } from "../lib/engine/strategy.ts";
import { GET, POST, DELETE } from "../app/api/portfolio/route.ts";
import { POST as actionPOST } from "../app/api/operations/actions/route.ts";

// D1 runs a batch as one transaction and enforces foreign keys; so does this stand-in.
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8"));
  sql.exec("PRAGMA foreign_keys = ON");
  const prepare = (query) => {
    const prepared = sql.prepare(query);
    let args = [];
    const run = () => ({ success: true, meta: { changes: Number(prepared.run(...args).changes) } });
    return {
      bind(...values) { args = values; return this; },
      async first() { return prepared.get(...args) ?? null; },
      async all() { return { results: prepared.all(...args) }; },
      async run() { return run(); },
      runInBatch: run,
    };
  };
  const db = {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runInBatch());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sql };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = globalThis.fetch;

/** Live-looking Upbit tickers and order books at reference prices times `factor()`; everything else is offline. */
function marketStub({ factor = () => 1, relayer = null } = {}) {
  return async (url, init) => {
    const u = String(url);
    const now = Date.now();
    if (relayer && u.startsWith("https://relayer.test/")) return relayer(JSON.parse(init.body));
    if (u.includes("/v1/ticker")) return Response.json(ASSET_UNIVERSE.map((asset) => ({ market: asset.market, trade_price: asset.referencePriceKrw * factor(), acc_trade_price_24h: asset.referenceVolume24hKrw, signed_change_rate: 0, timestamp: now })));
    if (u.includes("/v1/orderbook")) return Response.json(ASSET_UNIVERSE.map((asset) => ({ market: asset.market, timestamp: now, orderbook_units: [{ ask_price: asset.referencePriceKrw * factor() * 1.0005, bid_price: asset.referencePriceKrw * factor() * 0.9995 }] })));
    throw new Error("offline");
  };
}

const request = (cookie, method, body) => new Request("https://site.test/api/portfolio", {
  method,
  headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const newSession = async () => (await GET(request(undefined, "GET"))).headers.get("set-cookie").split(";")[0];
const portfolio = async (cookie) => (await GET(request(cookie, "GET"))).json();
const product = (sql, id) => sql.prepare("SELECT shares_outstanding_micros AS shares, cash_balance_krw AS cash FROM products WHERE id = ?").get(id);
const latestNav = (sql, id) => BigInt(sql.prepare("SELECT nav_per_share_micros AS n FROM nav_snapshots WHERE product_id = ? ORDER BY as_of DESC LIMIT 1").get(id).n);

/** Stand-in for the engine's NAV step, recorded after every pending request. */
function navAfterRequests(sql, productId, navMicros = "1000000000") {
  sql.prepare("INSERT INTO nav_snapshots (product_id, nav_per_share_micros, net_asset_value_krw, gross_asset_value_krw, liabilities_krw, shares_outstanding_micros, daily_return_bps, tracking_error_bps, quality, holdings_hash, as_of) VALUES (?, ?, '0', '0', '0', '0', 0, 0, 'indicative', '0x', ?)")
    .run(productId, navMicros, new Date(Date.now() + 3000).toISOString());
}

function withEnv(values, body) {
  return async () => {
    const keys = Object.keys(values);
    Object.assign(env, values);
    try { await body(); } finally {
      for (const key of keys) delete env[key];
      globalThis.fetch = realFetch;
    }
  };
}

test("public portfolio writes reject malformed or oversized values with 400 and write nothing", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    await new EngineRepository(db).seed();
    const cookie = await newSession();
    const bodies = [
      { productId: "core-20", amountKrw: "10000000000000000" },
      { productId: "core-20", amountKrw: "1000000001" },
      { productId: "core-20", amountKrw: "100000.5" },
      { productId: "core-20", amountKrw: "1e6" },
      { productId: "core-20", amountKrw: 1e400 },
      { productId: "core-20", amountKrw: "100000", clientReference: 42 },
      { amountKrw: "100000" },
      null,
    ];
    for (const body of bodies) {
      const response = await POST(request(cookie, "POST", body));
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal((await response.json()).code, "INVALID_REQUEST");
    }
    for (const body of [{ productId: "core-20", sharesMicros: "-1" }, { productId: "core-20", sharesMicros: "1.5" }, { productId: "core-20", sharesMicros: "99999999999999999999" }]) {
      assert.equal((await DELETE(request(cookie, "DELETE", body))).status, 400, JSON.stringify(body));
    }
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM subscriptions").get().n, 0);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM investors").get().n, 0);
  })();
});

test("repeating a client reference returns the original request instead of an error", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    await new EngineRepository(db).seed();
    const cookie = await newSession();
    const body = { productId: "core-20", amountKrw: "100000", clientReference: "save-1" };
    const first = await (await POST(request(cookie, "POST", body))).json();
    const second = await POST(request(cookie, "POST", body));
    assert.equal(second.status, 201);
    assert.equal((await second.json()).subscription.id, first.subscription.id);
    // Another visitor may use the same reference text for their own request.
    assert.equal((await POST(request(await newSession(), "POST", body))).status, 201);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM subscriptions").get().n, 2);
  })();
});

test("a position can be redeemed only once, however many requests arrive", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    const repo = new EngineRepository(db);
    await repo.seed();
    const cookie = await newSession();
    assert.equal((await POST(request(cookie, "POST", { productId: "core-20", amountKrw: "100000" }))).status, 201);
    navAfterRequests(sql, "core-20");
    const subscription = (await repo.listSubscriptionsForProcessing(true))[0];
    const nav = await repo.navForSettlement(subscription.product_id, subscription.created_at);
    const shares = sharesForSubscription(100000n, BigInt(nav.nav_per_share_micros));
    assert.equal((await repo.settleSubscription(subscription, null, true, shares, BigInt(nav.nav_per_share_micros))).status, "settled");

    const held = (await portfolio(cookie)).positions[0].sharesMicros;
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await DELETE(request(cookie, "DELETE", { productId: "core-20", sharesMicros: held }))).status);
    assert.deepEqual(statuses, [201, 400, 400, 400, 400]);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM redemptions").get().n, 1);
  })();
});

test("a settlement applied twice, as by two overlapping workers, credits the ledger once", async () => {
  const { db, sql } = database();
  const repo = new EngineRepository(db);
  await repo.seed();
  const before = product(sql, "core-20");
  await repo.createSubscription({ subject: "paper-session:a", productId: "core-20", amountKrw: 1_000_000n, clientReference: "a" });
  navAfterRequests(sql, "core-20");
  const [row] = await repo.listSubscriptionsForProcessing(true);
  const nav = BigInt((await repo.navForSettlement(row.product_id, row.created_at)).nav_per_share_micros);
  const shares = sharesForSubscription(1_000_000n, nav);
  // Both workers read the same pending row before either writes.
  const [first, second] = [await repo.settleSubscription(row, null, true, shares, nav), await repo.settleSubscription(row, null, true, shares, nav)];
  assert.equal(first.status, "settled");
  assert.equal(second.status, "pending");
  assert.equal(sql.prepare("SELECT shares_micros AS s FROM investor_positions").get().s, shares.toString());
  const after = product(sql, "core-20");
  assert.equal(BigInt(after.shares) - BigInt(before.shares), shares);
  assert.equal(BigInt(after.cash) - BigInt(before.cash), 1_000_000n);

  // The same holds for a redemption.
  const investor = sql.prepare("SELECT id FROM investors").get().id;
  await repo.createRedemption({ subject: "paper-session:a", productId: "core-20", sharesMicros: shares, clientReference: "r" });
  navAfterRequests(sql, "core-20");
  const [redemption] = await repo.listRedemptionsForProcessing(true);
  const proceeds = krwForShares(shares, BigInt((await repo.navForSettlement(redemption.product_id, redemption.created_at)).nav_per_share_micros));
  assert.equal((await repo.settleRedemption(redemption, null, true, proceeds)).status, "settled");
  assert.equal((await repo.settleRedemption(redemption, null, true, proceeds)).status, "rejected");
  assert.equal(product(sql, "core-20").shares, before.shares);
  assert.equal(BigInt(product(sql, "core-20").cash), BigInt(after.cash) - proceeds);
  assert.equal(sql.prepare("SELECT shares_micros AS s FROM investor_positions WHERE investor_id = ?").get(investor).s, "0");
});

test("a partial redemption removes cost basis in proportion and realizes the difference", async () => {
  const { db, sql } = database();
  const repo = new EngineRepository(db);
  await repo.seed();
  await repo.createSubscription({ subject: "paper-session:c", productId: "core-20", amountKrw: 1_000_000n, clientReference: "c" });
  navAfterRequests(sql, "core-20");
  const [row] = await repo.listSubscriptionsForProcessing(true);
  await repo.settleSubscription(row, null, true, 1_000_000_000n, 1_000_000_000n);
  await repo.createRedemption({ subject: "paper-session:c", productId: "core-20", sharesMicros: 250_000_000n, clientReference: "c-r" });
  navAfterRequests(sql, "core-20", "900000000");
  const [redemption] = await repo.listRedemptionsForProcessing(true);
  const proceeds = krwForShares(250_000_000n, 900_000_000n);
  await repo.settleRedemption(redemption, null, true, proceeds);
  const position = sql.prepare("SELECT shares_micros AS s, cost_basis_krw AS c, realized_pnl_krw AS r FROM investor_positions").get();
  assert.deepEqual([position.s, position.c, position.r], ["750000000", "750000", (proceeds - 250_000n).toString()]);
});

test("operator actions that match no record return 404 and write no audit row", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper", OPERATOR_TOKEN: "test-token" }, async () => {
    const call = (payload) => actionPOST(new Request("https://site.test/api/operations/actions", { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify(payload) }));
    assert.equal((await call({ action: "confirm_funding", subscriptionId: "subscription_missing" })).status, 404);
    assert.equal((await call({ action: "set_kyc", investorId: "investor_missing", status: "verified" })).status, 404);
    assert.equal((await call({ action: "set_product_status", productId: "core-20", status: "anything" })).status, 400);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type <> 'rebalance.created'").get().n, 0);
  })();
});

test("an order is priced at the first NAV calculated after it, not the one before a known price move", async () => {
  const { db, sql } = database();
  let factor = 1;
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    globalThis.fetch = marketStub({ factor: () => factor });
    const config = { DB: db, TRADING_MODE: "paper" };
    assert.equal((await runEngineCycle(config, "scheduled", { force: true })).marketDataQuality, "live");
    const cookie = await newSession();
    factor = 1.1;
    assert.equal((await POST(request(cookie, "POST", { productId: "core-20", amountKrw: "10000000" }))).status, 201);
    await runEngineCycle(config, "scheduled", { force: true });
    assert.equal((await portfolio(cookie)).positions.length, 0, "no NAV after the order existed yet");
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "scheduled", { force: true });
    const [position] = (await portfolio(cookie)).positions;
    assert.ok(position, "settled at the post-move NAV");
    const pnl = Number(position.currentValueKrw) - 10_000_000;
    assert.ok(Math.abs(pnl) < 20_000, `value moved by ${pnl} KRW although the price move preceded the order`);
  })();
});

test("a redemption larger than the fund's cash sells holdings instead of creating cash", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    globalThis.fetch = marketStub();
    const config = { DB: db, TRADING_MODE: "paper" };
    await runEngineCycle(config, "scheduled", { force: true });
    const cookie = await newSession();
    assert.equal((await POST(request(cookie, "POST", { productId: "core-20", amountKrw: "1000000000" }))).status, 201);
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "scheduled", { force: true });
    const [position] = (await portfolio(cookie)).positions;
    assert.ok(position);
    // The fund's cash is now fully invested.
    sql.prepare("UPDATE products SET cash_balance_krw = '1000' WHERE id = 'core-20'").run();
    await runEngineCycle(config, "scheduled", { force: true });
    const navBefore = latestNav(sql, "core-20");
    assert.equal((await DELETE(request(cookie, "DELETE", { productId: "core-20", sharesMicros: position.sharesMicros }))).status, 201);
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    const result = await runEngineCycle(config, "scheduled", { force: true });
    const redemption = sql.prepare("SELECT status, proceeds_krw AS proceeds FROM redemptions").get();
    assert.equal(redemption.status, "settled", JSON.stringify(result.warnings));
    assert.ok(BigInt(product(sql, "core-20").cash) >= 0n);
    assert.ok(sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE rebalance_run_id IS NULL AND side = 'sell'").get().n > 0, "holdings were sold to raise the cash");
    await runEngineCycle(config, "scheduled", { force: true });
    const drift = Number(latestNav(sql, "core-20") - navBefore) / Number(navBefore);
    assert.ok(Math.abs(drift) < 0.002, `remaining holders' NAV moved ${(drift * 100).toFixed(3)}%`);
  })();
});

test("only KYC-verified investors are minted or burned on chain, to their first wallet, with the shares the ledger issues", async () => {
  const { db, sql } = database();
  const calls = [];
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    globalThis.fetch = marketStub({ relayer: (body) => { calls.push(body); return Response.json({ status: "confirmed", txHash: `0x${"ab".repeat(32)}` }); } });
    const config = { DB: db, TRADING_MODE: "paper", SETTLEMENT_RELAYER_URL: "https://relayer.test", SETTLEMENT_RELAYER_TOKEN: "token" };
    await runEngineCycle(config, "scheduled", { force: true });
    const first = `0x${"a".repeat(40)}`;
    const other = `0x${"b".repeat(40)}`;
    const cookie = await newSession();
    assert.equal((await POST(request(cookie, "POST", { productId: "core-20", amountKrw: "100000", walletAddress: first }))).status, 201);
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "scheduled", { force: true });
    const held = (await portfolio(cookie)).positions[0].sharesMicros;
    assert.equal((await DELETE(request(cookie, "DELETE", { productId: "core-20", sharesMicros: held, walletAddress: other }))).status, 201);
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "scheduled", { force: true });
    const fundFlowCalls = () => calls.filter((call) => call.action === "mint_subscription" || call.action === "burn_redemption");
    assert.deepEqual(fundFlowCalls(), [], "an unverified paper session never reaches the relayer");
    assert.equal(sql.prepare("SELECT wallet_address AS w FROM investors").get().w, first, "a later request cannot replace the wallet");

    sql.prepare("UPDATE investors SET kyc_status = 'verified'").run();
    assert.equal((await POST(request(cookie, "POST", { productId: "core-20", amountKrw: "200000", walletAddress: other }))).status, 201);
    await sleep(1100);
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "scheduled", { force: true });
    const [mint] = fundFlowCalls();
    assert.equal(mint?.action, "mint_subscription");
    assert.equal(mint.walletAddress, first);
    const issued = sql.prepare("SELECT issued_shares_micros AS s FROM subscriptions WHERE amount_krw = '200000'").get().s;
    assert.equal(mint.sharesMicros, issued);
  })();
});

test("reference-data NAVs are labelled stale and are not published on chain", async () => {
  const { db, sql } = database();
  const calls = [];
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://relayer.test/")) { calls.push(JSON.parse(init.body)); return Response.json({ status: "confirmed" }); }
      throw new Error("offline");
    };
    const result = await runEngineCycle({ DB: db, TRADING_MODE: "paper", SETTLEMENT_RELAYER_URL: "https://relayer.test", SETTLEMENT_RELAYER_TOKEN: "token" }, "scheduled", { force: true });
    assert.equal(result.marketDataQuality, "reference");
    assert.equal(calls.filter((call) => call.action === "publish_nav").length, 0);
    assert.deepEqual(sql.prepare("SELECT DISTINCT quality FROM nav_snapshots").all().map((row) => row.quality), ["stale"]);
  })();
});

test("a rebalance straight after another reports near-zero turnover because cash counts in current weights", async () => {
  const { db, sql } = database();
  await withEnv({ DB: db, TRADING_MODE: "paper" }, async () => {
    globalThis.fetch = marketStub();
    const config = { DB: db, TRADING_MODE: "paper" };
    await runEngineCycle(config, "scheduled", { force: true });
    await runEngineCycle(config, "operator", { force: true });
    for (const definition of PRODUCT_DEFINITIONS) {
      const latest = sql.prepare("SELECT turnover_bps AS t, status FROM rebalance_runs WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(definition.id);
      assert.ok(latest.t < 60, `${definition.id} reported ${latest.t} bps turnover for unchanged targets`);
    }
  })();
});

test("target weights always sum to the investable budget", () => {
  const asOf = new Date("2026-09-24T00:00:00.000Z");
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let trial = 0; trial < 300; trial += 1) {
    const inputs = ASSET_UNIVERSE.map((asset) => {
      const price = asset.referencePriceKrw * (0.5 + random());
      const trend = (random() - 0.5) * 0.01;
      return {
        asset,
        tick: { symbol: asset.symbol, market: asset.market, priceKrw: price, bidKrw: price * 0.999, askKrw: price * 1.001, volume24hKrw: asset.referenceVolume24hKrw * (0.2 + random()), change24hBps: 0, source: "TEST", quality: "live", asOf: asOf.toISOString() },
        candles: Array.from({ length: 100 }, (_, index) => {
          const close = price * (1 + trend * (index - 99)) * (1 + Math.sin(index / (3 + random() * 5)) * 0.02);
          return { symbol: asset.symbol, candleDate: new Date(asOf.getTime() - (99 - index) * 86_400_000).toISOString().slice(0, 10), openKrw: close, highKrw: close * 1.01, lowKrw: close * 0.99, closeKrw: close, volumeKrw: 20_000_000_000, source: "TEST" };
        }),
        currentWeightBps: 0,
      };
    });
    for (const definition of PRODUCT_DEFINITIONS) {
      const result = calculateStrategy(definition, inputs, asOf);
      assert.doesNotMatch(result.blockReason ?? "", /Weight validation failed/, `trial ${trial} ${definition.id}`);
    }
  }
});
