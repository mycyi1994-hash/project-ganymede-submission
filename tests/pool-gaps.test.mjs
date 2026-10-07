import test from "node:test";
import assert from "node:assert/strict";
import { gapsOf, newestReads, poolGaps, poolRead, poolReads, signedGap, withPoolRead } from "../lib/xstocks/pool-gaps.ts";

// The pools as GET /api/v1/ustx/pools served them at 01:15 UTC on 7 October 2026.
const SERVED = {
  pools: [
    { id: "ustx-dusd", block: 42876900, priceMicros: "101223776", navMicros: "101478269" },
    { id: "ustx-dusd-v4", block: 42876899, priceMicros: "101478268", navMicros: "101478269" },
    { id: "ustx-dusd-range", block: 42876900, priceMicros: "101527881", navMicros: "101478269" },
  ],
};

test("each pool's price is measured against the NAV its own read carries", () => {
  const gaps = poolGaps(SERVED);
  assert.deepEqual(gaps.map((gap) => [gap.id, gap.short, gap.premiumPpm]), [
    ["ustx-dusd", "Classic", -2507n],
    ["ustx-dusd-v4", "v4", 0n],
    ["ustx-dusd-range", "Range", 488n],
  ]);
  assert.deepEqual(gaps.map((gap) => signedGap(gap.premiumPpm)), ["−0.25%", "0.00%", "+0.04%"]);
});

test("a pool without a price or a usable NAV is left out, in any order the API lists them", () => {
  const stale = { pools: [
    { id: "ustx-dusd-range", priceMicros: "101527881", navMicros: null, navUnavailable: "The NAV record is over an hour old." },
    { id: "ustx-dusd", priceMicros: "101223776", navMicros: null },
    { id: "ustx-dusd-v4", priceMicros: "0", navMicros: "101478269" },
  ] };
  assert.deepEqual(poolGaps(stale), []);
  assert.deepEqual(poolGaps({ pools: [SERVED.pools[2], SERVED.pools[0]] }).map((gap) => gap.id), ["ustx-dusd", "ustx-dusd-range"]);
  for (const body of [null, {}, { pools: "none" }, { pools: [null, 7] }]) assert.deepEqual(poolGaps(body), []);
});

test("gaps are written signed and truncated to the basis point, with no sign under one", () => {
  assert.equal(signedGap(-2_507n), "−0.25%");
  assert.equal(signedGap(12_345n), "+1.23%");
  assert.equal(signedGap(99n), "0.00%");
  assert.equal(signedGap(-99n), "0.00%");
  assert.equal(signedGap(-100n), "−0.01%");
});

test("a read at a later block replaces the one held, pool by pool, and a later read without a NAV removes the gap", () => {
  const held = poolReads(SERVED);
  assert.deepEqual(held.map((read) => [read.id, read.block]), [["ustx-dusd", 42876900], ["ustx-dusd-v4", 42876899], ["ustx-dusd-range", 42876900]]);
  const older = poolReads({ pools: [{ id: "ustx-dusd", block: 42876800, priceMicros: "101000000", navMicros: "101478269" }] });
  assert.equal(newestReads(held, older)[0].gap.priceMicros, 101223776n);
  const later = poolReads({ pools: [{ id: "ustx-dusd-range", block: 42878000, priceMicros: "101527881", navMicros: null }] });
  const merged = newestReads(held, later);
  assert.equal(merged.length, 3);
  assert.deepEqual(gapsOf(merged).map((gap) => gap.id), ["ustx-dusd", "ustx-dusd-v4"]);
});

test("a page's own later read of the classic pool stands in only while it is against the same NAV", () => {
  const held = poolReads(SERVED);
  // After an order on the page: a later block, the same NAV record, a new pool price.
  const afterOrder = poolRead("ustx-dusd", 42876950, 101300000n, 101478269n);
  assert.equal(gapsOf(withPoolRead(held, afterOrder))[0].priceMicros, 101300000n);
  // A new NAV record the API has not read yet: the API's read of every pool is kept, so one NAV shows.
  const newRecord = poolRead("ustx-dusd", 42877000, 101223776n, 101439651n);
  assert.equal(withPoolRead(held, newRecord), held);
  // An earlier read never replaces a later one.
  assert.equal(withPoolRead(held, poolRead("ustx-dusd", 42876800, 101300000n, 101478269n)), held);
  // With nothing from the API, the page's read is shown alone.
  assert.deepEqual(gapsOf(withPoolRead([], newRecord)).map((gap) => [gap.id, gap.premiumPpm]), [["ustx-dusd", -2128n]]);
  assert.equal(poolRead("ustx-dusd", 1, 101223776n, null).gap, null);
});
