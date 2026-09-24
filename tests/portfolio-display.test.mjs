import assert from "node:assert/strict";
import test from "node:test";
import { hasValuation, isPendingRequest, portfolioSummary } from "../lib/portfolio-display.ts";

const position = { costBasisKrw: "1000000", currentValueKrw: "1020000", navPerShareMicros: "1020000000", navAsOf: "2026-09-23T12:00:00Z" };

test("portfolio change is weighted by saved amounts, not average strategy returns", () => {
  const result = portfolioSummary([position, { ...position, costBasisKrw: "500000", currentValueKrw: "490000" }]);
  assert.equal(result.invested, 1500000);
  assert.equal(result.value, 1510000);
  assert.equal(result.gain, 10000);
  assert.equal(result.returnPct, 10000 / 1500000 * 100);
});

test("missing recorded NAV does not present a partial total or a fabricated return", () => {
  const result = portfolioSummary([position, { ...position, navAsOf: null }]);
  assert.equal(result.value, null);
  assert.equal(result.gain, null);
  assert.equal(result.returnPct, null);
  assert.equal(result.invested, 2000000);
  assert.equal(hasValuation({ ...position, navPerShareMicros: "Infinity" }), false);
});

test("historical completed or rejected requests do not imply an allocation is still being prepared", () => {
  for (const status of ["settled", "rejected", "cancelled"]) assert.equal(isPendingRequest({ status }), false);
  for (const status of ["requested", "approved", "locked", "executing"]) assert.equal(isPendingRequest({ status }), true);
});
