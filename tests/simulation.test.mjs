import assert from "node:assert/strict";
import test from "node:test";
import { estimatePaperAllocation } from "../lib/simulation.ts";

test("paper shares and fee illustration use the KRW sample and indicative NAV", () => {
  const result = estimatePaperAllocation("1000000", "1000000000", "0.35%");
  assert.equal(result.amountError, "");
  assert.equal(result.shares, 1000);
  assert.equal(result.annualFeeKrw, 3500);
});

test("estimates do not invent a price when NAV is missing or invalid", () => {
  for (const nav of [undefined, "0", "-1", "NaN", "Infinity"]) {
    assert.equal(estimatePaperAllocation("1000000", nav, "0.35%").shares, null);
  }
});

test("invalid amounts cannot produce a reviewable estimate", () => {
  for (const amount of ["", "99999", "-100000", "100000.5", "1e6", "9007199254740992"]) {
    const result = estimatePaperAllocation(amount, "1000000000", "0.35%");
    assert.ok(result.amountError);
    assert.equal(result.shares, null);
    assert.equal(result.annualFeeKrw, null);
  }
});

test("whole KRW amounts at and above the minimum are supported", () => {
  assert.equal(estimatePaperAllocation("100000", "1000000000", "0.65%").shares, 100);
  assert.equal(estimatePaperAllocation("100001", "1000000000", "0.65%").amountError, "");
});
