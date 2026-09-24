import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBasket, constituentsWithAddresses, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { compositionForRecord, currentWeights, publicationHistory, decodeMarketSnapshot } from "../lib/product-market.ts";

async function fixture() {
  const now = "2026-09-24T07:00:00.456Z";
  const assets = XSTOCKS_CONSTITUENTS.map((asset, i) => ({ ...asset, address: `0x${String(i + 1).repeat(40)}` }));
  const constituents = constituentsWithAddresses(assets.map(a => `${a.symbol}=${a.address}`).join(","));
  const quotes = new Map(assets.map((a, i) => [a.symbol, { ...a, priceMicros: 250_000_000n + BigInt(i), time: now, source: "test" }]));
  const evaluated = await evaluateBasket({ constituents, quotes, previous: null, now, maxQuoteAgeMinutes: 60 });
  const publication = { asOf: now, navPerShareMicros: evaluated.composition.navPerShareMicros, holdingsHash: evaluated.holdingsHash, canonical: evaluated.canonical, status: "confirmed", txHash: null };
  return { product: { id: "us-tech-x" }, pricing: { constituents }, registry: {}, latest: { evaluatedAt: now, status: "ready", warnings: [], blockers: [], composition: evaluated.composition, canonical: evaluated.canonical, publication }, history: [publication], onchainError: null, onchain: { effectiveAt: "2026-09-24T07:00:00Z", navPerShareMicros: publication.navPerShareMicros, holdingsHash: publication.holdingsHash } };
}

test("customer composition belongs to the displayed record, never to an unmatched latest snapshot", async () => {
  const data = await fixture();
  assert.equal(compositionForRecord(data).asOf, data.latest.composition.asOf);
  const missing = { ...data, latest: { ...data.latest, publication: null }, history: [] };
  assert.equal(compositionForRecord(missing), null);
  assert.equal(compositionForRecord(data, { ...data.onchain, navPerShareMicros: "1" }), null);
  assert.equal(compositionForRecord(data, { ...data.onchain, effectiveAt: "2026-09-24T08:00:00Z" }), null);
});

test("history excludes pending/invalid records and deduplicates the chain's second-precision timestamp", async () => {
  const data = await fixture();
  data.history.push({ ...data.history[0], asOf: "2026-09-24T07:05:00Z", status: "submitted" });
  data.history.push({ ...data.history[0], asOf: "bad time" });
  data.history.push({ ...data.history[0], asOf: "2026-09-24T07:10:00Z", navPerShareMicros: "-1" });
  const points = publicationHistory(data);
  assert.equal(points.length, 1);
  assert.equal(points[0].at, data.onchain.effectiveAt);
});

test("a failed chain read does not turn its snapshot into a new confirmed chart point", async () => {
  const data = await fixture();
  data.onchain = { ...data.onchain, effectiveAt: "2026-09-24T08:00:00Z" };
  data.onchainError = "read failed";
  assert.equal(publicationHistory(data).length, 1);
  assert.equal(publicationHistory(data)[0].at, data.history[0].asOf);
});

test("composition weight is actual recorded value weight, not the target fixing weight", async () => {
  const data = await fixture();
  const composition = structuredClone(data.latest.composition);
  composition.holdings[0].valueMicros = "500000000";
  const weights = currentWeights(composition);
  assert.ok(weights.get("AAPLx") > 80);
  assert.notEqual(weights.get("AAPLx"), composition.holdings[0].weightBps / 100);
  assert.equal(currentWeights(null).size, 0);
});

test("malformed API values fail loading instead of rendering an invented zero", async () => {
  const data = await fixture();
  assert.equal(decodeMarketSnapshot(data).product.id, "us-tech-x");
  assert.throws(() => decodeMarketSnapshot({ ...data, onchain: { ...data.onchain, navPerShareMicros: "not a number" } }));
  assert.throws(() => decodeMarketSnapshot({ product: { id: "other" } }));
  assert.throws(() => decodeMarketSnapshot({ ...data, history: [null] }));
  assert.throws(() => decodeMarketSnapshot({ ...data, latest: { ...data.latest, warnings: null } }));
});
