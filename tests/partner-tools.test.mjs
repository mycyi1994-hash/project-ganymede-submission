import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { FaucetError, dripGas } from "../lib/faucet.ts";
import { FAUCET_TERMS, formatOkb } from "../lib/faucet-terms.ts";
import { addUsage, summarizeUsage, updateUsage } from "../lib/xstocks/usage.ts";
import { USAGE_SEED } from "../lib/xstocks/usage-seed.ts";
import { TEAM_WALLETS } from "../lib/xstocks/team-wallets.ts";
import { DEX_QUOTE_PATH, STATE_DEX_QUOTES, compareDex, parseQuote, quoteBasket, runDexQuotes } from "../lib/xstocks/dex-quotes.ts";
import { PERMISSION_SELECTORS, controlSpecs, readControls } from "../lib/xstocks/permissions.ts";
import { FUND_DEPLOYMENT } from "../lib/xstocks/fund.ts";
import { okxAppUrl } from "../lib/okx-app.ts";
import { XSTOCK_TOKENS } from "../lib/xstocks/mainnet.ts";
import { GET as openApi, OPENAPI } from "../app/api/v1/openapi.json/route.ts";

const schema = readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8");

/** A D1 stand-in whose batch is one transaction. */
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
  return {
    sql,
    prepare(query) {
      const prepared = sql.prepare(query);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return prepared.get(...args) ?? null; },
        async run() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
        runNow() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try { const results = statements.map((statement) => statement.runNow()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
}

const wallet = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const balanceRpc = (wei) => async (method) => { assert.equal(method, "eth_getBalance"); return `0x${wei.toString(16)}`; };
const now = new Date("2026-10-03T12:00:00Z");

test("the faucet sends a first-time wallet test OKB once, only while it holds almost none", async () => {
  const db = database();
  const sent = [];
  const send = async (to, wei) => { sent.push([to, wei]); return `0x${"ab".repeat(32)}`; };
  const drip = (address, options = {}) => dripGas({ db, address, visitor: "1.2.3.4", now, send, rpc: balanceRpc(0n), ...options });

  await assert.rejects(drip("not an address"), (error) => error instanceof FaucetError && error.status === 400);
  await assert.rejects(drip(wallet(1), { rpc: balanceRpc(FAUCET_TERMS.lowWei) }), (error) => error.code === "has_gas" && error.status === 409);
  assert.deepEqual(await drip(wallet(1).toUpperCase().replace("0X", "0x")), { hash: `0x${"ab".repeat(32)}`, wei: FAUCET_TERMS.dripWei.toString() });
  assert.deepEqual(sent, [[wallet(1), FAUCET_TERMS.dripWei]]);
  await assert.rejects(drip(wallet(1)), (error) => error.code === "wallet_done");
  assert.equal(db.sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(`faucet:wallet:${wallet(1)}`).value, `0x${"ab".repeat(32)}`);
  assert.equal(sent.length, 1);
  assert.equal(formatOkb(FAUCET_TERMS.dripWei), "0.0005 test OKB");
});

test("a failed send leaves the wallet free to ask again, and each visitor and the site have a daily allowance", async () => {
  const db = database();
  let fail = true;
  const send = async () => { if (fail) throw new Error("nonce too low"); return "0x01"; };
  const drip = (address, visitor = "5.6.7.8") => dripGas({ db, address, visitor, now, send, rpc: balanceRpc(0n) });
  await assert.rejects(drip(wallet(2)), (error) => error.code === "send_failed" && error.status === 503);
  fail = false;
  assert.equal((await drip(wallet(2))).hash, "0x01");
  // The failed attempt counts toward the visitor's allowance too.
  for (let n = 3; n <= FAUCET_TERMS.perVisitorPerDay; n++) await drip(wallet(n));
  await assert.rejects(drip(wallet(100)), (error) => error.code === "limit" && /several wallets/.test(error.message));
  // The refused wallet was not marked as served.
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM engine_state WHERE key = ?").get(`faucet:wallet:${wallet(100)}`).n, 0);
  for (let n = 0; n < FAUCET_TERMS.perSitePerDay; n++) await drip(wallet(1_000 + n), `10.0.0.${n}`).catch(() => undefined);
  await assert.rejects(drip(wallet(5_000), "9.9.9.9"), (error) => error.code === "limit" && /run out/.test(error.message));
});

const row = (block, account, kind = "invest", dollars = 100_000_000n) => ({
  kind, hash: `0x${block.toString(16).padStart(64, "0")}`, block, logIndex: 0, at: new Date(Date.UTC(2026, 9, 3, 0, 0, block % 60)).toISOString(), account,
  dollarsMicros: dollars, sharesMicros: 1_000_000n, navMicros: 100_000_000n, dollarsOutMicros: null, boughtInPool: null,
});

test("usage counts each new row once, keeps the team's wallets apart and summarizes other wallets", () => {
  const admin = "0x107633a3aa88c81d4c47d01992e089573e2e87c9";
  assert.equal(TEAM_WALLETS[admin], "Ganymede administrator");
  assert.ok(Object.keys(TEAM_WALLETS).length >= 35);
  const start = { fromBlock: 1, toBlock: 10, wallets: {}, kinds: {}, team: { actions: 0, volumeMicros: "0" } };
  const rows = [row(13, wallet(7), "borrow", 50_000_000n), row(12, admin), row(11, wallet(7)), row(10, wallet(8))];
  const usage = addUsage(start, rows, 13);
  assert.equal(usage.toBlock, 13);
  assert.deepEqual(Object.keys(usage.wallets), [wallet(7)]);
  assert.equal(usage.wallets[wallet(7)].actions, 2);
  // A loan moves no trade volume.
  assert.equal(usage.wallets[wallet(7)].volumeMicros, "100000000");
  assert.deepEqual(usage.team, { actions: 1, volumeMicros: "100000000" });
  assert.deepEqual(usage.kinds, { invest: { all: 2, outside: 1 }, borrow: { all: 1, outside: 1 } });
  assert.equal(addUsage(usage, rows, 13), usage);
  const summary = summarizeUsage(usage, Date.parse("2026-10-05T00:00:00Z"));
  assert.deepEqual(summary.outside, { wallets: 1, activeLast7Days: 1, actions: 2, volumeMicros: "100000000" });
  assert.equal(summary.team.wallets, Object.keys(TEAM_WALLETS).length);
  // The first run starts from the history read at launch.
  assert.equal(updateUsage(null, { fromBlock: 0, toBlock: USAGE_SEED.toBlock, keep: 1_500, rows: [] }), USAGE_SEED);
  assert.ok(Object.keys(USAGE_SEED.wallets).every((address) => !(address in TEAM_WALLETS)));
});

const quotePayload = (symbol) => ({
  code: "0", msg: "",
  data: [{ toTokenAmount: "500000000000000000", priceImpactPercent: "-0.25", tradeFee: "0.0011", toToken: { decimal: "18", tokenUnitPrice: "330.5", tokenSymbol: symbol }, dexRouterList: [{ dexProtocol: { dexName: "Uniswap V3", percent: "100" } }] }],
});

test("OKX DEX quotes: each xStock is asked for with a signed GET, and the legs add up", async () => {
  const leg = parseQuote("AAPLx", 166_666_666n, quotePayload("AAPLx"));
  assert.deepEqual(leg, { symbol: "AAPLx", paidMicros: "166666666", receivedMicros: "165250000", priceImpactPercent: "-0.25", networkFeeUsd: "0.0011", routes: ["Uniswap V3"] });
  assert.throws(() => parseQuote("AAPLx", 1n, { code: "51000", msg: "Parameter chainIndex error" }), /Parameter chainIndex error/);

  const requests = [];
  const fetcher = async (url, init) => { requests.push({ url, headers: init.headers }); return new Response(JSON.stringify(quotePayload("x"))); };
  const credentials = { apiKey: "key", secret: "secret", passphrase: "pass", baseUrl: "https://example.test" };
  const quotes = await quoteBasket(credentials, { fetcher, wait: async () => undefined, now });
  assert.equal(requests.length, XSTOCK_TOKENS.length);
  const first = new URL(requests[0].url);
  assert.equal(first.pathname, DEX_QUOTE_PATH);
  assert.equal(first.searchParams.get("chainIndex"), "196");
  assert.equal(first.searchParams.get("amount"), "111111111");
  assert.ok(requests[0].headers["OK-ACCESS-SIGN"]);
  const total = compareDex(quotes);
  assert.equal(total.legs, 9);
  assert.equal(total.paidMicros, 999_999_999n);
  assert.equal(total.costMicros, 999_999_999n - 9n * 165_250_000n);
  assert.equal(total.maxImpactPercent, 0.25);
  assert.ok(Math.abs(total.networkFeeUsd - 0.0099) < 1e-9);
});

test("OKX DEX quotes are asked for once an hour, and a failure is kept as a failure", async () => {
  const db = database();
  const env = { DB: db, OKX_API_KEY: "key", OKX_API_SECRET: "secret", OKX_API_PASSPHRASE: "pass" };
  let calls = 0;
  const failing = async () => { calls++; return new Response("{}", { status: 401 }); };
  const kept = await runDexQuotes(env, { fetcher: failing, wait: async () => undefined, now });
  assert.equal(kept.legs.length, 0);
  assert.match(kept.error, /HTTP 401/);
  assert.equal(await runDexQuotes(env, { fetcher: failing, wait: async () => undefined, now: new Date(now.getTime() + 30 * 60_000) }), null);
  assert.equal(calls, 1);
  const later = await runDexQuotes(env, { fetcher: async () => new Response(JSON.stringify(quotePayload("x"))), wait: async () => undefined, now: new Date(now.getTime() + 60 * 60_000) });
  assert.equal(later.legs.length, 9);
  assert.equal(JSON.parse(db.sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(STATE_DEX_QUOTES).value).legs.length, 9);
  assert.equal(await runDexQuotes({ DB: db }), null);
});

test("the contract controls read each role and pause flag from X Layer, and a failed read is null", async () => {
  const specs = controlSpecs();
  assert.ok(specs.some((spec) => spec.address === FUND_DEPLOYMENT.fund && spec.pausable));
  assert.ok(specs.some((spec) => spec.address === FUND_DEPLOYMENT.pool && spec.roles.length === 0));
  const admin = "107633a3aa88c81d4c47d01992e089573e2e87c9";
  const rpc = async (method, [{ to, data }]) => {
    assert.equal(method, "eth_call");
    if (data === PERMISSION_SELECTORS.paused) return to === FUND_DEPLOYMENT.lending ? `0x${"0".repeat(63)}1` : `0x${"0".repeat(64)}`;
    if (data === PERMISSION_SELECTORS.publisher) throw new Error("rpc down");
    return `0x${"0".repeat(24)}${admin}`;
  };
  const controls = await readControls(rpc);
  const lending = controls.find((control) => control.address === FUND_DEPLOYMENT.lending);
  assert.equal(lending.paused, true);
  assert.equal(lending.roles[0].holder, `0x${admin}`);
  const registry = controls.find((control) => control.name === "NAV registry");
  assert.equal(registry.paused, false);
  assert.deepEqual(registry.roles.find((role) => role.label === "Publisher"), { label: "Publisher", holder: null });
  assert.equal(controls.find((control) => control.address === FUND_DEPLOYMENT.pool).paused, null);
});

test("the OpenAPI document lists every public read, and the OKX app link carries the page", async () => {
  const response = openApi();
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const body = await response.json();
  assert.equal(body.openapi, OPENAPI.openapi);
  for (const path of ["/api/v1/ustx", "/api/v1/ustx/pools", "/api/v1/ustx/activity", "/api/v1/ustx/usage", "/api/v1/ustx/dex-quotes", "/api/v1/funds", "/mcp"]) assert.ok(body.paths[path], path);
  const link = new URL(okxAppUrl("https://example.test/products/ustx?a=1"));
  assert.equal(link.hostname, "www.okx.com");
  assert.equal(new URL(link.searchParams.get("deeplink")).searchParams.get("dappUrl"), "https://example.test/products/ustx?a=1");
});
