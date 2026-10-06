import assert from "node:assert/strict";
import test from "node:test";
import { allocateShares, binTicksFor, constantProductRange, LP_STRATEGIES, planRange, planStrategy, strategyShape, strategyYear, workingNearNav } from "../lib/xstocks/lp-strategy.ts";
import { MULTICALL3, previewShape, rangeCalls, rangeFill, readAll } from "../lib/xstocks/range-liquidity.ts";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";

const NAV = 100_000_000n; // $100
const cp = { sharesMicros: 50_000_000n, dollarsMicros: 5_000_000_000n }; // 50 USTX, $5,000: at the NAV
const v4 = { sharesMicros: 30_000_000n, dollarsMicros: 7_000_000_000n }; // $3,000 of USTX, $7,000 of dUSD

test("a strategy splits the deposit between the pools, each part in its pool's ratio", () => {
  assert.deepEqual(LP_STRATEGIES.map(item => item.id), ["spot", "curve", "spot-curve", "bid-ask", "custom"]);
  assert.deepEqual(LP_STRATEGIES.filter(item => item.pool === "range").map(item => item.id), ["bid-ask", "custom"]);
  const plan = planStrategy(1_000_000_000n, 50, NAV, cp, v4);
  assert.ok(plan);
  // $500 to the constant-product pool at half USTX; $500 to the v4 pool at 30% USTX.
  assert.equal(plan.constantProduct.investMicros, 250_000_000n);
  assert.equal(plan.constantProduct.dollarsMicros, 250_000_000n);
  assert.equal(plan.v4.investMicros, 150_000_000n);
  assert.equal(plan.v4.dollarsMicros, 350_000_000n);
  assert.equal(plan.investMicros, 400_000_000n);
  assert.equal(plan.sharesMicros, 4_000_000n);
  const shares = allocateShares(plan, 3_999_999n);
  assert.equal(shares.constantProduct + shares.v4, 3_999_999n);
  assert.equal(shares.constantProduct, 2_499_999n);
  // All in one pool, and nothing without a NAV, an empty pool it needs, or under the fund's $10 minimum.
  assert.equal(planStrategy(1_000_000_000n, 0, NAV, cp, null).v4, null);
  assert.equal(planStrategy(1_000_000_000n, 100, NAV, null, v4).constantProduct, null);
  assert.equal(planStrategy(1_000_000_000n, 50, null, cp, v4), null);
  assert.equal(planStrategy(1_000_000_000n, 50, NAV, cp, null), null);
  assert.equal(planStrategy(20_000_000n, 100, NAV, cp, v4), null);
  assert.ok(planStrategy(40_000_000n, 100, NAV, cp, v4));
});

test("the shape puts a Curve deposit near the NAV and a Spot deposit across every price", () => {
  const constantProduct = { ranges: constantProductRange(cp), price: 100, valueMicros: 10_000_000_000n };
  // One range of ±2% around $100 holding the v4 pool's value.
  const lower = 98, upper = 102, sp = Math.sqrt(100);
  const liquidity = 10_000 / ((sp - Math.sqrt(lower)) + 100 * (1 / sp - 1 / Math.sqrt(upper))) * 1e6;
  const pegged = { ranges: [{ lower, upper, liquidity }], price: 100, valueMicros: 10_000_000_000n };
  const curve = strategyShape({ navMicros: NAV, constantProductMicros: 0n, v4Micros: 1_000_000_000n, constantProduct, v4: pegged });
  const spot = strategyShape({ navMicros: NAV, constantProductMicros: 1_000_000_000n, v4Micros: 0n, constantProduct, v4: pegged });
  assert.equal(curve.length, 24);
  const nearCurve = workingNearNav(curve, NAV), nearSpot = workingNearNav(spot, NAV);
  // USTX is valued at each bin's middle price, so a little above the price it was bought at.
  assert.ok(Math.abs(nearCurve.v4 - 1_000) < 10, `curve ${nearCurve.v4}`);
  assert.equal(nearCurve.constantProduct, 0);
  // A constant-product pool keeps about 1% of its value within 2% of the price.
  assert.ok(nearSpot.constantProduct > 9 && nearSpot.constantProduct < 11, `spot ${nearSpot.constantProduct}`);
  // Below the NAV the bins hold demo dollars, above it USTX.
  assert.equal(curve[0].side, "dollars");
  assert.equal(curve[23].side, "shares");
});

test("a year at the measured results adds each pool's part", () => {
  assert.equal(strategyYear(5_000_000_000n, 5_000_000_000n, { constantProduct: 2_000_000_000n, v4: 1_000_000_000n }), 1_500_000_000n);
  assert.equal(strategyYear(0n, 1_000_000_000n, { constantProduct: null, v4: 1_000_000_000n }), 100_000_000n);
  assert.equal(strategyYear(1n, 0n, { constantProduct: null, v4: null }), null);
});

test("a position of one's own: its bins, its deposit and the hook's spread, Bid-Ask heaviest at the ends", () => {
  // ±3% in ten bins: about 30 ticks each, in whole spacings of 10.
  assert.equal(binTicksFor(3, 10), 30);
  assert.equal(binTicksFor(0.5, 20), 10);
  assert.equal(binTicksFor(10, 5), 190);
  // Both sides take half each; one side takes all; the part invested must reach the fund's $10.
  assert.deepEqual(planRange(1_000_000_000n, NAV, "both"), { investMicros: 500_000_000n, sharesMicros: 5_000_000n, dollarsMicros: 500_000_000n });
  assert.deepEqual(planRange(1_000_000_000n, NAV, "below"), { investMicros: 0n, sharesMicros: 0n, dollarsMicros: 1_000_000_000n });
  assert.equal(planRange(1_000_000_000n, NAV, "above").dollarsMicros, 0n);
  assert.equal(planRange(15_000_000n, NAV, "both"), null);
  assert.equal(planRange(15_000_000n, NAV, "below").dollarsMicros, 15_000_000n);
  const bins = previewShape("bid-ask", 30, 10, 10, 500, 500, 100);
  assert.equal(bins.length, 20);
  // Below the price, demo dollars, the farthest bin first and heaviest; above it, USTX, heaviest last.
  assert.equal(bins[0].side, "dollars");
  assert.ok(bins[0].value > bins[9].value * 9.9);
  assert.ok(bins[19].value > bins[10].value * 9.9);
  assert.ok(Math.abs(bins.slice(0, 10).reduce((sum, bin) => sum + bin.value, 0) - 500) < 1e-9);
  // The bins skip the 0.1% interval the price is in.
  assert.ok(bins[9].toUsd <= 100 && bins[10].fromUsd > 100.09);
  const curve = previewShape("curve", 30, 10, 0, 500, 0, 100);
  assert.ok(curve[9].value > curve[0].value * 9.9);
});

test("the range pool's calls and events: open, close and what they paid, by token", () => {
  const deployment = { poolManager: "0x" + "1".repeat(40), hook: "0x" + "2".repeat(40), router: "0x" + "3".repeat(40), asset: "0x" + "4".repeat(40), dollar: "0x" + "5".repeat(40), assetIsCurrency0: true, poolId: "0x" + "6".repeat(64), stateSlot: "0x" + "7".repeat(64), arbitrage: "0x" + "8".repeat(40) };
  const open = rangeCalls(deployment).open("bid-ask", 30, 10, 10, { sharesMicros: 5_000_000n, dollarsMicros: 500_000_000n }, 1_800_000_000);
  assert.equal(open.to, deployment.hook);
  assert.ok(open.data.startsWith("0xa9229268"));
  const words = open.data.slice(10).match(/.{64}/g).map(word => BigInt(`0x${word}`));
  assert.deepEqual(words, [2n, 30n, 10n, 10n, 5_000_000n, 500_000_000n, 1_800_000_000n]);
  const word = value => BigInt(value).toString(16).padStart(64, "0");
  const owner = "0x" + "9".repeat(40);
  const receipt = { logs: [
    { address: deployment.hook, topics: ["0x6f21d1c89075fdb10314cef58c6fb0f775fb0912fda2e9562195a5a749228ca8", `0x${word(7)}`, `0x${word(owner)}`], data: `0x${[2, 4_000, 30, 10, 10, 4_999_990, 499_999_990].map(word).join("")}` },
    { address: deployment.hook, topics: ["0x3120c845c5d2c39308641201562a412527c1e7aff294f09c0c936f1c60a1b067", `0x${word(3)}`, `0x${word(owner)}`], data: `0x${[1_000_000, 2_000_000].map(word).join("")}` },
  ] };
  const fill = rangeFill(receipt, deployment, owner);
  assert.deepEqual(fill.opened, { id: 7n, amounts: { sharesMicros: 4_999_990n, dollarsMicros: 499_999_990n } });
  assert.deepEqual(fill.closed, { id: 3n, amounts: { sharesMicros: 1_000_000n, dollarsMicros: 2_000_000n } });
  assert.deepEqual(rangeFill(receipt, deployment, "0x" + "a".repeat(40)), { opened: null, closed: null });
});

test("many reads go in a few multicalls, and one by one where there is no multicall", async () => {
  const abi = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);
  const answer = (data) => `0x${data.slice(2, 10).padStart(64, "0")}`;
  const calls = Array.from({ length: 250 }, (_, index) => ({ to: "0x" + "2".repeat(40), data: `0x${(index + 1).toString(16).padStart(8, "0")}` }));
  const seen = [];
  const withMulticall = async (method, [request]) => {
    seen.push(request.to);
    if (request.to !== MULTICALL3) return answer(request.data);
    const { args: [inner] } = decodeFunctionData({ abi, data: request.data });
    return encodeFunctionResult({ abi, functionName: "aggregate3", result: inner.map((item) => ({ success: true, returnData: answer(item.callData) })) });
  };
  const read = await readAll(withMulticall, calls, "0x1");
  assert.deepEqual(read, calls.map((item) => answer(item.data)));
  assert.deepEqual(seen, [MULTICALL3, MULTICALL3, MULTICALL3], "250 reads in three requests");
  // Without Multicall3 the chain answers 0x, and every read goes on its own.
  seen.length = 0;
  const withoutMulticall = async (method, [request]) => { seen.push(request.to); return request.to === MULTICALL3 ? "0x" : answer(request.data); };
  assert.deepEqual(await readAll(withoutMulticall, calls.slice(0, 12), "0x1"), calls.slice(0, 12).map((item) => answer(item.data)));
  assert.equal(seen.length, 13);
  // An RPC that is down is not tried call by call.
  const down = async () => { throw new Error("fetch failed"); };
  await assert.rejects(readAll(down, calls.slice(0, 3), "0x1"), /fetch failed/);
});
