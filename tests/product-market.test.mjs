import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBasket, constituentsWithAddresses, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { compositionForRecord, constituentFigures, currentWeights, formatCountdown, navAtFixing, nextRecordAt, publicationHistory, decodeMarketSnapshot } from "../lib/product-market.ts";

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

test("each constituent's fixing price comes back from its units, and its change is measured against it", async () => {
  const data = await fixture();
  const composition = compositionForRecord(data);
  const points = publicationHistory(data);
  // The basket was fixed at this record: the record's own NAV is the NAV at the fixing.
  assert.equal(navAtFixing(composition, points), BigInt(points[0].micros));
  const figures = constituentFigures(composition, navAtFixing(composition, points));
  assert.deepEqual(figures.map(item => item.symbol), composition.holdings.map(item => item.symbol));
  for (const item of figures) {
    const difference = item.fixingPriceMicros - item.priceMicros;
    assert.ok((difference < 0n ? -difference : difference) <= 100n, `${item.symbol} fixed at its own price`);
    assert.equal(Math.round(item.changePercent * 100), 0);
    assert.equal(item.targetPercent, 100 / 6);
    assert.equal(item.unitsWad, BigInt(composition.holdings.find(holding => holding.symbol === item.symbol).unitsWad));
  }
  // Ten percent higher prices on the same units read as ten percent up; their value per share follows.
  const higher = { ...composition, holdings: composition.holdings.map(holding => ({ ...holding, priceMicros: String(BigInt(holding.priceMicros) * 11n / 10n), valueMicros: String(BigInt(holding.valueMicros) * 11n / 10n) })) };
  for (const item of constituentFigures(higher, 100_000_000n)) assert.ok(Math.abs(item.changePercent - 10) < 0.01, `${item.symbol}: ${item.changePercent}`);
  // Without the NAV at the fixing there is no fixing price, and no invented change.
  assert.ok(constituentFigures(composition, null).every(item => item.fixingPriceMicros === null && item.changePercent === null));
});

test("the NAV at the fixing is the record at that second, the inception NAV before any record, or unknown", async () => {
  const data = await fixture();
  const composition = compositionForRecord(data);
  const later = [{ at: "2026-09-24T08:00:00.000Z", micros: "101000000", hash: "" }];
  assert.equal(navAtFixing(composition, later), 100_000_000n, "fixed before the first record: the inception NAV");
  assert.equal(navAtFixing({ ...composition, basketFixedAt: "2026-09-24T09:00:00.000Z" }, later), null, "fixed after the records shown, with none at that second");
  assert.equal(navAtFixing(composition, []), null);
  assert.equal(navAtFixing({ ...composition, basketFixedAt: "not a time" }, later), null);
});

test("the next NAV record is due on the next five-minute boundary, counted down to the second", () => {
  assert.equal(nextRecordAt("2026-09-25T11:25:08.000Z"), Date.parse("2026-09-25T11:30:00.000Z"));
  assert.equal(nextRecordAt("2026-09-25T11:30:00.000Z"), Date.parse("2026-09-25T11:35:00.000Z"));
  assert.equal(nextRecordAt("not a time"), 0);
  assert.equal(formatCountdown(299_500), "5:00");
  assert.equal(formatCountdown(61_001), "1:02");
  assert.equal(formatCountdown(9_000), "0:09");
  assert.equal(formatCountdown(-5_000), "0:00");
});
