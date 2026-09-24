import assert from "node:assert/strict";
import test from "node:test";
import { krwForShares, notionalToUnitsAtomic, sharesForSubscription, unitsToMarketValueKrw } from "../lib/engine/fixed.ts";
import { ASSET_UNIVERSE, PRODUCT_DEFINITIONS } from "../lib/engine/seed.ts";
import { calculateStrategy, shouldRebalance } from "../lib/engine/strategy.ts";

const asOf = new Date("2026-07-18T00:00:00.000Z");

function candlesFor(symbol, price, trend = 0.001) {
  return Array.from({ length: 100 }, (_, index) => {
    const close = Math.max(1, price * (1 + trend * index) * (1 + Math.sin(index / 5) * 0.01));
    return {
      symbol,
      candleDate: new Date(asOf.getTime() - (99 - index) * 86_400_000).toISOString().slice(0, 10),
      openKrw: close * 0.995,
      highKrw: close * 1.01,
      lowKrw: close * 0.99,
      closeKrw: close,
      volumeKrw: 20_000_000_000,
      source: "REFERENCE",
    };
  });
}

function strategyInputs(currentWeights = new Map()) {
  return ASSET_UNIVERSE.map((asset, index) => ({
    asset,
    tick: {
      symbol: asset.symbol,
      market: asset.market,
      priceKrw: asset.referencePriceKrw,
      bidKrw: asset.referencePriceKrw * 0.999,
      askKrw: asset.referencePriceKrw * 1.001,
      volume24hKrw: asset.referenceVolume24hKrw,
      change24hBps: 0,
      source: "REFERENCE",
      quality: "reference",
      asOf: asOf.toISOString(),
    },
    candles: candlesFor(asset.symbol, asset.referencePriceKrw, 0.0004 + index * 0.00008),
    currentWeightBps: currentWeights.get(asset.symbol) ?? 0,
  }));
}

test("fixed-point fund share and asset arithmetic round-trips", () => {
  const navMicros = 1_025_000_000n;
  const amountKrw = 1_000_000n;
  const shares = sharesForSubscription(amountKrw, navMicros);
  const recovered = krwForShares(shares, navMicros);
  assert.ok(recovered <= amountKrw && amountKrw - recovered <= 1n);

  const units = notionalToUnitsAtomic(50_000_000n, 100_000_000n, 6);
  assert.equal(unitsToMarketValueKrw(units, 100_000_000n, 6), 50_000_000n);
});

test("passive strategy excludes stablecoins and respects cash, caps and initial constitution", () => {
  const product = PRODUCT_DEFINITIONS.find((candidate) => candidate.id === "core-20");
  const result = calculateStrategy(product, strategyInputs(), asOf);
  assert.equal(result.style, "passive");
  assert.equal(result.blocked, false);
  assert.equal(result.targets.reduce((sum, target) => sum + target.weightBps, 0), 10_000 - product.cashBufferBps);
  assert.equal(result.cashWeightBps, product.cashBufferBps);
  assert.ok(result.targets.every((target) => !["USDT", "USDC"].includes(target.symbol)));
  assert.ok(result.targets.every((target) => target.weightBps <= product.maxWeightBps));
});

test("active strategy is systematic and turnover controls block an excessive transition", () => {
  const product = PRODUCT_DEFINITIONS.find((candidate) => candidate.id === "tech-leaders");
  const current = new Map([["BTC", 9_700]]);
  const result = calculateStrategy(product, strategyInputs(current), asOf);
  assert.equal(result.style, "active");
  assert.ok(result.targets.length > 0 && result.targets.length <= product.parameters.topN);
  assert.ok(result.targets.every((target) => target.rationale.includes("Momentum")));
  assert.ok(result.turnoverBps > product.turnoverLimitBps);
  assert.equal(result.blocked, true);
  assert.match(result.blockReason, /Turnover/);
});

test("rebalance cadence is deterministic", () => {
  const weekly = PRODUCT_DEFINITIONS.find((candidate) => candidate.rebalanceCadence === "weekly");
  assert.equal(shouldRebalance(weekly, null, asOf), true);
  assert.equal(shouldRebalance(weekly, "2026-07-13T00:00:00.000Z", asOf), false);
  assert.equal(shouldRebalance(weekly, "2026-07-10T00:00:00.000Z", asOf), true);
});
