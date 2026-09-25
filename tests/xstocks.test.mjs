import assert from "node:assert/strict";
import test from "node:test";
import { maxQuoteAgeMinutes } from "../lib/xstocks/cycle.ts";
import {
  basketNavMicros,
  constituentsWithAddresses,
  equalWeightsBps,
  evaluateBasket,
  fixBasket,
  parseDecimalMicros,
  XSTOCKS_CONSTITUENTS,
  XSTOCKS_PRODUCT,
} from "../lib/xstocks/basket.ts";
import { sha256Hex } from "../lib/engine/fixed.ts";
import { decodeLatestNav, XSTOCKS_PRODUCT_KEY } from "../lib/xstocks/onchain.ts";
import { fetchXStockQuotes, normalizeQuoteTime, signedHeaders } from "../lib/xstocks/prices.ts";

const NOW = "2026-09-23T09:00:00.000Z";
const PRICES = { AAPLx: "231.25", MSFTx: "512.4", NVDAx: "187.431234", AMZNx: "228.9", METAx: "742.05", TSLAx: "402.117" };
const address = (index) => `0x${String(index + 1).padStart(40, "a")}`;
const ADDRESSES = XSTOCKS_CONSTITUENTS.map((constituent, index) => `${constituent.symbol}=${address(index)}`).join(",");

function quotes(prices = PRICES, time = NOW) {
  return new Map(Object.entries(prices).map(([symbol, price], index) => [symbol, {
    symbol, address: address(index), priceMicros: parseDecimalMicros(price), time, source: "test",
  }]));
}

test("equal weights always sum to 10,000 bps", () => {
  for (const count of [1, 3, 6, 7]) {
    assert.equal(equalWeightsBps(count).reduce((sum, weight) => sum + weight, 0), 10_000);
  }
  assert.deepEqual(equalWeightsBps(6), [1667, 1667, 1667, 1667, 1666, 1666]);
});

test("decimal prices parse to micros without floating point", () => {
  assert.equal(parseDecimalMicros("187.431234"), 187_431_234n);
  assert.equal(parseDecimalMicros("231.25"), 231_250_000n);
  assert.equal(parseDecimalMicros("0.0000019"), 1n);
  assert.throws(() => parseDecimalMicros("1e3"));
  assert.throws(() => parseDecimalMicros("-4"));
});

test("inception fixing prices the basket at US$100 within rounding", () => {
  const constituents = XSTOCKS_CONSTITUENTS.map((constituent, index) => ({ symbol: constituent.symbol, address: address(index) }));
  const prices = new Map(Object.entries(PRICES).map(([symbol, price]) => [symbol, parseDecimalMicros(price)]));
  const basket = fixBasket(constituents, prices, XSTOCKS_PRODUCT.inceptionNavMicros, NOW);
  const nav = basketNavMicros(basket, prices);
  assert.ok(nav <= XSTOCKS_PRODUCT.inceptionNavMicros);
  assert.ok(XSTOCKS_PRODUCT.inceptionNavMicros - nav < 10n, `rounding loss ${XSTOCKS_PRODUCT.inceptionNavMicros - nav} micros`);
});

test("NAV follows prices once units are fixed", () => {
  const constituents = XSTOCKS_CONSTITUENTS.map((constituent, index) => ({ symbol: constituent.symbol, address: address(index) }));
  const prices = new Map(Object.entries(PRICES).map(([symbol, price]) => [symbol, parseDecimalMicros(price)]));
  const basket = fixBasket(constituents, prices, XSTOCKS_PRODUCT.inceptionNavMicros, NOW);
  const doubled = new Map([...prices].map(([symbol, price]) => [symbol, price * 2n]));
  const nav = basketNavMicros(basket, prices);
  // Each holding floors to a micro-dollar independently, so allow one micro per holding.
  const gap = nav * 2n - basketNavMicros(basket, doubled);
  assert.ok(gap >= -6n && gap <= 6n, `doubling prices moved NAV off 2x by ${gap} micros`);
});

test("a missing or stale price blocks publication", async () => {
  const constituents = constituentsWithAddresses(ADDRESSES);
  const missing = quotes();
  missing.delete("TSLAx");
  const blocked = await evaluateBasket({ constituents, quotes: missing, previous: null, now: NOW, maxQuoteAgeMinutes: 60 });
  assert.equal(blocked.publishable, false);
  assert.match(blocked.blockers.join(" "), /TSLAx/);

  const stale = await evaluateBasket({ constituents, quotes: quotes(PRICES, "2026-09-23T06:00:00.000Z"), previous: null, now: NOW, maxQuoteAgeMinutes: 60 });
  assert.equal(stale.publishable, false);
  assert.equal(stale.status, "awaiting_prices");
});

test("under the default policy a NAV is never published from prices more than ten minutes old", async () => {
  const constituents = constituentsWithAddresses(ADDRESSES);
  const policy = maxQuoteAgeMinutes({});
  // Prices stamped 11:00 and a NAV calculated at 16:00: the record would carry 16:00, so it must not publish.
  const hoursOld = await evaluateBasket({ constituents, quotes: quotes(PRICES, "2026-09-25T11:00:00.000Z"), previous: null, now: "2026-09-25T16:00:00.000Z", maxQuoteAgeMinutes: policy });
  assert.equal(hoursOld.publishable, false);
  assert.match(hoursOld.blockers.join(" "), /300 minutes old/);
  const elevenMinutes = await evaluateBasket({ constituents, quotes: quotes(PRICES, "2026-09-25T15:49:00.000Z"), previous: null, now: "2026-09-25T16:00:00.000Z", maxQuoteAgeMinutes: policy });
  assert.equal(elevenMinutes.publishable, false);
  const fresh = await evaluateBasket({ constituents, quotes: quotes(PRICES, "2026-09-25T15:59:30.000Z"), previous: null, now: "2026-09-25T16:00:00.000Z", maxQuoteAgeMinutes: policy });
  assert.equal(fresh.publishable, true);
});

test("unconfigured addresses block publication instead of guessing", async () => {
  const evaluation = await evaluateBasket({ constituents: constituentsWithAddresses(""), quotes: quotes(), previous: null, now: NOW, maxQuoteAgeMinutes: 60 });
  assert.equal(evaluation.status, "awaiting_configuration");
  assert.equal(evaluation.publishable, false);
});

test("the published holdings hash is sha256 of the canonical composition", async () => {
  const evaluation = await evaluateBasket({ constituents: constituentsWithAddresses(ADDRESSES), quotes: quotes(), previous: null, now: NOW, maxQuoteAgeMinutes: 60 });
  assert.equal(evaluation.publishable, true);
  assert.equal(evaluation.holdingsHash, await sha256Hex(evaluation.canonical));
  assert.match(evaluation.holdingsHash, /^0x[0-9a-f]{64}$/);
  assert.equal(JSON.parse(evaluation.canonical).navPerShareMicros, evaluation.composition.navPerShareMicros);
});

test("the basket is kept within a quarter and re-fixed at the prevailing NAV in the next", async () => {
  const constituents = constituentsWithAddresses(ADDRESSES);
  const first = await evaluateBasket({ constituents, quotes: quotes(), previous: null, now: NOW, maxQuoteAgeMinutes: 60 });
  const later = "2026-09-29T09:00:00.000Z";
  const risen = Object.fromEntries(Object.entries(PRICES).map(([symbol, price]) => [symbol, (Number(price) * 1.1).toFixed(4)]));
  const same = await evaluateBasket({ constituents, quotes: quotes(risen, later), previous: first.basket, now: later, maxQuoteAgeMinutes: 60 });
  assert.equal(same.rebalanced, false);
  assert.equal(same.basket.fixedAt, NOW);

  const nextQuarter = "2026-10-01T00:05:00.000Z";
  const refixed = await evaluateBasket({ constituents, quotes: quotes(risen, nextQuarter), previous: first.basket, now: nextQuarter, maxQuoteAgeMinutes: 60 });
  assert.equal(refixed.rebalanced, true);
  assert.equal(refixed.basket.fixedAt, nextQuarter);
  // Continuity: the re-fixed basket is worth what the old one was at that moment.
  const drift = BigInt(refixed.composition.navPerShareMicros) - BigInt(same.composition.navPerShareMicros);
  assert.ok(drift <= 0n && drift > -10n, `NAV jumped by ${drift} micros across the re-fixing`);
});

test("latestNav decoding matches the registry's struct layout", () => {
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  const hash = "ab".repeat(32);
  const raw = `0x${word(101_234_567n)}${word(0n)}${hash}${word(1_790_000_000n)}${word(1_790_000_012n)}`;
  const decoded = decodeLatestNav(raw);
  assert.equal(decoded.navPerShareMicros, "101234567");
  assert.equal(decoded.holdingsHash, `0x${hash}`);
  assert.equal(decoded.effectiveAt, new Date(1_790_000_000_000).toISOString());
  assert.equal(XSTOCKS_PRODUCT.id, "us-tech-x", "XSTOCKS_PRODUCT_KEY is keccak256 of this id; recompute it if the id changes");
  assert.match(XSTOCKS_PRODUCT_KEY, /^0x[0-9a-f]{64}$/);
});

test("OnchainOS requests are signed over timestamp + method + path + body", async () => {
  const headers = await signedHeaders({ apiKey: "k", secret: "s", passphrase: "p", baseUrl: "https://web3.okx.com" }, "POST", "/api/v6/dex/market/price", "[]", "2026-09-23T09:00:00.000Z");
  const { createHmac } = await import("node:crypto");
  const expected = createHmac("sha256", "s").update("2026-09-23T09:00:00.000Z" + "POST" + "/api/v6/dex/market/price" + "[]").digest("base64");
  assert.equal(headers["OK-ACCESS-SIGN"], expected);
  assert.equal(headers["OK-ACCESS-PROJECT"], undefined);
  assert.equal(normalizeQuoteTime("1790000000000"), new Date(1_790_000_000_000).toISOString());
});

const CREDENTIALS = { apiKey: "key", secret: "secret", passphrase: "pass", baseUrl: "https://onchainos.test" };
const CONSTITUENTS = constituentsWithAddresses(ADDRESSES);

function priceResponse() {
  const data = CONSTITUENTS.map((constituent) => ({ chainIndex: "196", tokenContractAddress: constituent.address.toLowerCase(), time: String(Date.parse(NOW)), price: PRICES[constituent.symbol] }));
  return new Response(JSON.stringify({ code: "0", msg: "", data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("retries once when the price API answers with a transient server error", async () => {
  const responses = [new Response("upstream unavailable", { status: 503 }), priceResponse()];
  let calls = 0;
  const fetcher = async () => { calls += 1; return responses.shift(); };
  const { quotes, warnings, retryAt } = await fetchXStockQuotes(CREDENTIALS, CONSTITUENTS, fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(warnings, []);
  assert.equal(retryAt, undefined);
  assert.equal(quotes.size, XSTOCKS_CONSTITUENTS.length);
  assert.equal(quotes.get("AAPLx").priceMicros, parseDecimalMicros(PRICES.AAPLx));
});

test("a rate-limited price request sets a cooldown instead of retrying", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response("error code: 1015", { status: 429 }); };
  const before = Date.now();
  const { quotes, warnings, retryAt } = await fetchXStockQuotes(CREDENTIALS, CONSTITUENTS, fetcher);
  assert.equal(calls, 1);
  assert.equal(quotes.size, 0);
  assert.match(warnings[0], /429/);
  assert.match(warnings[0], /rate limit/);
  assert.ok(Date.parse(retryAt) - before >= 10 * 60_000, `cooldown until ${retryAt} is shorter than ten minutes`);
});
