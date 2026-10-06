import assert from "node:assert/strict";
import test from "node:test";
import { DRAWN_LEVELS, DRAWN_MAX, DRAWN_STEP, allocateShares, binTicksFor, binsToReach, maxReachFor, constantProductRange, drawingFrom, drawingProblem, fitDrawing, LP_STRATEGIES, ownAboveShare, ownBins, ownSides, planRange, planStrategy, strategyShape, strategyYear, workingNearNav } from "../lib/xstocks/lp-strategy.ts";
import { MULTICALL3, RangePriceMoved, assertRangePriceNear, openLimits, previewShape, previewWeights, rangeCalls, rangeErrorMessage, rangeFill, readAll, readRangeTick, shapeWeights } from "../lib/xstocks/range-liquidity.ts";
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

test("a wide range takes the bins it needs: each bin is at most 500 ticks, about 5%", () => {
  // 5 bins a side reach about 28% above the price, 10 about 65%, 20 about 172%.
  assert.ok(Math.abs(maxReachFor(5) - 28.4) < 0.1 && Math.abs(maxReachFor(10) - 64.9) < 0.1 && Math.abs(maxReachFor(20) - 171.8) < 0.1);
  assert.equal(binsToReach(10, [5, 10, 15, 20]), 5);
  assert.equal(binsToReach(50, [5, 10, 15, 20]), 10);
  assert.equal(binsToReach(100, [5, 10, 15, 20]), 15);
  assert.equal(binsToReach(500, [5, 10, 15, 20]), 20);
  // With enough bins the reach is what was asked: ±50% in 10 bins of 410 ticks.
  assert.equal(binTicksFor(50, 10), 410);
  assert.ok(Math.abs((Math.pow(1.0001, 4100) - 1) * 100 - 50) < 1);
  // With too few, each bin stops at 500 ticks.
  assert.equal(binTicksFor(50, 5), 500);
});

test("a preset's weights, lowest price first, are the hook's: even, nearest heaviest, or farthest heaviest", () => {
  // Three bins below the price, then two above it.
  assert.deepEqual(shapeWeights("spot", 3, 2), [1, 1, 1, 1, 1]);
  assert.deepEqual(shapeWeights("curve", 3, 2), [1, 2, 3, 2, 1]);
  assert.deepEqual(shapeWeights("bid-ask", 3, 2), [3, 2, 1, 1, 2]);
  assert.deepEqual(shapeWeights("curve", 0, 3), [3, 2, 1]);
  // previewShape is the preset's weights through previewWeights.
  assert.deepEqual(previewShape("curve", 30, 3, 2, 600, 300, 100), previewWeights([1, 2, 3, 2, 1], 30, 3, 2, 600, 300, 100));
});

test("a drawn shape: each column is the dollars its bin holds, and the deposit splits by the columns", () => {
  const own = { shape: "drawn", rangePercent: 3, bins: 5, sides: "both", drawn: [10, 20, 30, 40, 100, 60, 0, 30, 30, 0] };
  assert.deepEqual(ownBins(own), { binsBelow: 5, binsAbove: 5, weights: [10, 20, 30, 40, 100, 60, 0, 30, 30, 0] });
  // 120 of the 320 drawn are above the price: that share of the deposit buys USTX at the NAV.
  assert.equal(ownAboveShare(own), 120 / 320);
  assert.deepEqual(planRange(1_000_000_000n, NAV, "both", ownAboveShare(own)), { investMicros: 375_000_000n, sharesMicros: 3_750_000n, dollarsMicros: 625_000_000n });
  const bins = previewWeights(ownBins(own).weights, 30, 5, 5, 625, 375, 100);
  // Below the price the farthest bin comes first; each bin's dollars are its bar's share of its side.
  assert.deepEqual(bins.map(bin => Math.round(bin.value * 1e6) / 1e6), [31.25, 62.5, 93.75, 125, 312.5, 187.5, 0, 93.75, 93.75, 0]);
  assert.equal(bins[6].side, "shares");
  // One side only sends that side's columns, and takes the whole deposit.
  assert.deepEqual(ownBins({ ...own, sides: "below" }), { binsBelow: 5, binsAbove: 0, weights: [10, 20, 30, 40, 100] });
  assert.deepEqual(ownBins({ ...own, sides: "above" }), { binsBelow: 0, binsAbove: 5, weights: [60, 0, 30, 30, 0] });
  assert.equal(ownAboveShare({ ...own, sides: "above" }), 1);
  assert.equal(ownAboveShare({ ...own, sides: "below" }), 0);
  assert.equal(ownSides(own), "both");
  // A preset keeps half each, whatever was drawn before it.
  assert.equal(ownAboveShare({ ...own, shape: "curve" }), 0.5);
  assert.deepEqual(ownBins({ ...own, shape: "curve" }).weights, shapeWeights("curve", 5, 5));
  // A side drawn empty is not filled, as on DLMM Pro: the position is one-sided and takes the whole deposit there.
  const below = { ...own, drawn: [10, 20, 30, 40, 100, 0, 0, 0, 0, 0] };
  assert.deepEqual(ownBins(below), { binsBelow: 5, binsAbove: 0, weights: [10, 20, 30, 40, 100] });
  assert.equal(ownSides(below), "below");
  assert.equal(ownAboveShare(below), 0);
  assert.deepEqual(planRange(1_000_000_000n, NAV, ownSides(below), ownAboveShare(below)), { investMicros: 0n, sharesMicros: 0n, dollarsMicros: 1_000_000_000n });
  assert.equal(ownSides({ ...own, drawn: [0, 0, 0, 0, 0, 10, 0, 0, 0, 0] }), "above");
  // It needs a block on a side it fills.
  assert.equal(drawingProblem(own), null);
  assert.equal(drawingProblem(below), null);
  assert.equal(drawingProblem({ ...below, sides: "below" }), null);
  assert.equal(drawingProblem({ ...below, sides: "above" }), "Draw at least one block above the price.");
  assert.equal(drawingProblem({ ...own, drawn: Array(10).fill(0) }), "Draw at least one block.");
  assert.equal(drawingProblem({ ...own, sides: "below", drawn: Array(10).fill(0) }), "Draw at least one block below the price.");
  assert.equal(drawingProblem({ ...own, shape: "spot", drawn: Array(10).fill(0) }), null);
  // A drawing whose bars above are few may leave the part bought at the NAV under the fund's $10.
  assert.equal(planRange(100_000_000n, NAV, "both", 0.05), null);
  assert.ok(planRange(100_000_000n, NAV, "both", 0.1));
});

test("a drawing is whole blocks, keeps its picture when the bins change, and starts from a preset", () => {
  // Each column is a stack of up to ten blocks: a multiple of DRAWN_STEP from 0 to DRAWN_MAX.
  assert.equal(DRAWN_LEVELS * DRAWN_STEP, DRAWN_MAX);
  assert.deepEqual(fitDrawing([0, 50.4, 120, -3, 7, 8], 3), [0, 50, DRAWN_MAX, 0, 10, 10]);
  assert.deepEqual(fitDrawing([0, 54, 55, 45, 44, 99], 3), [0, 50, 60, 50, 40, 100]);
  // Five columns a side stretched to ten and back: each side resampled along its length.
  const drawn = [0, 20, 50, 80, 100, 100, 80, 50, 20, 0];
  const ten = fitDrawing(drawn, 10);
  assert.equal(ten.length, 20);
  assert.ok(ten.every(column => column % DRAWN_STEP === 0));
  assert.deepEqual([ten[0], ten[9], ten[10], ten[19]], [0, 100, 100, 0]);
  assert.ok(ten.slice(0, 10).every((column, index, side) => index === 0 || column >= side[index - 1]), "the left side still rises");
  assert.deepEqual(fitDrawing(ten, 5), drawn);
  // Nothing drawn yet is a flat half.
  assert.deepEqual(fitDrawing(undefined, 2), [50, 50, 50, 50]);
  // A preset as blocks: Curve's tallest next to the price, every bin at least one block.
  assert.deepEqual(drawingFrom("curve", 4), [30, 50, 80, 100, 100, 80, 50, 30]);
  assert.deepEqual(drawingFrom("bid-ask", 5), [100, 80, 60, 40, 20, 20, 40, 60, 80, 100]);
  assert.ok(drawingFrom("curve", 20).every(column => column >= DRAWN_STEP));
  assert.deepEqual(drawingFrom("spot", 2), [100, 100, 100, 100]);
});

test("a drawn position goes to the hook's openCustom with a weight for every bin", () => {
  const deployment = { poolManager: "0x" + "1".repeat(40), hook: "0x" + "2".repeat(40), router: "0x" + "3".repeat(40), asset: "0x" + "4".repeat(40), dollar: "0x" + "5".repeat(40), assetIsCurrency0: true, poolId: "0x" + "6".repeat(64), stateSlot: "0x" + "7".repeat(64), arbitrage: "0x" + "8".repeat(40) };
  const abi = parseAbi(["function openCustom(int24 binTicks, uint8 binsBelow, uint8 binsAbove, uint16[] weights, uint256 amount0, uint256 amount1, int24 minTick, int24 maxTick, uint256 deadline)"]);
  const call = rangeCalls(deployment).openCustom(30, 3, 2, [10, 0, 100, 40, 5], { sharesMicros: 5_000_000n, dollarsMicros: 500_000_000n }, 1_800_000_000, openLimits(-46_050));
  assert.equal(call.to, deployment.hook);
  assert.ok(call.data.startsWith("0xa69e99b6"));
  const { functionName, args } = decodeFunctionData({ abi, data: call.data });
  assert.equal(functionName, "openCustom");
  // USTX is currency0 here: it goes in as amount0, for the bins above the price.
  assert.deepEqual(args, [30, 3, 2, [10, 0, 100, 40, 5], 5_000_000n, 500_000_000n, -46_080, -46_020, 1_800_000_000n]);
  const flipped = rangeCalls({ ...deployment, assetIsCurrency0: false }).openCustom(30, 0, 2, [1, 2], { sharesMicros: 5_000_000n, dollarsMicros: 0n }, 1_800_000_000, openLimits(0));
  assert.deepEqual(decodeFunctionData({ abi, data: flipped.data }).args.slice(4, 6), [0n, 5_000_000n]);
  // A weight for every bin, each a whole number the hook's uint16 holds.
  for (const weights of [[1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1, 2, -1, 4, 5], [1, 2, 3.5, 4, 5], [1, 2, 3, 4, 65_536]]) {
    assert.throws(() => rangeCalls(deployment).openCustom(30, 3, 2, weights, { sharesMicros: 1n, dollarsMicros: 1n }, 1_800_000_000, openLimits(0)), /whole weight/);
  }
});

test("the range pool's calls and events: open, close and what they paid, by token", () => {
  const deployment = { poolManager: "0x" + "1".repeat(40), hook: "0x" + "2".repeat(40), router: "0x" + "3".repeat(40), asset: "0x" + "4".repeat(40), dollar: "0x" + "5".repeat(40), assetIsCurrency0: true, poolId: "0x" + "6".repeat(64), stateSlot: "0x" + "7".repeat(64), arbitrage: "0x" + "8".repeat(40) };
  // The position opens only while the pool's tick is within 30 of the one the provider saw.
  const open = rangeCalls(deployment).open("bid-ask", 30, 10, 10, { sharesMicros: 5_000_000n, dollarsMicros: 500_000_000n }, 1_800_000_000, openLimits(46_050));
  assert.equal(open.to, deployment.hook);
  assert.ok(open.data.startsWith("0x0dd51d63"));
  const words = open.data.slice(10).match(/.{64}/g).map(word => BigInt(`0x${word}`));
  assert.deepEqual(words, [2n, 30n, 10n, 10n, 5_000_000n, 500_000_000n, 46_020n, 46_080n, 1_800_000_000n]);
  // A tick below zero goes in as an int24 does in the ABI, in two's complement.
  const below = rangeCalls(deployment).open("spot", 20, 1, 0, { sharesMicros: 0n, dollarsMicros: 1_000_000n }, 1_800_000_000, openLimits(-10));
  const limits = below.data.slice(10).match(/.{64}/g).slice(6, 8).map(word => BigInt.asIntN(256, BigInt(`0x${word}`)));
  assert.deepEqual(limits, [-40n, 20n]);
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

test("a position opens only if the pool's price is still near the one the provider saw", async () => {
  const deployment = { poolManager: "0x" + "1".repeat(40), hook: "0x" + "2".repeat(40), router: "0x" + "3".repeat(40), asset: "0x" + "4".repeat(40), dollar: "0x" + "5".repeat(40), assetIsCurrency0: true, poolId: "0x" + "6".repeat(64), stateSlot: "0x" + "7".repeat(64), arbitrage: "0x" + "8".repeat(40) };
  // The pool's slot0: the price in the low 160 bits, the tick as an int24 above it.
  const chainAt = (tick) => async (method, params) => {
    if (method === "eth_chainId") return "0x7a0";
    if (method === "eth_blockNumber") return "0x64";
    assert.equal(method, "eth_call");
    assert.equal(params[0].to, deployment.poolManager);
    assert.ok(params[0].data.endsWith(deployment.stateSlot.slice(2)));
    return `0x${((BigInt.asUintN(24, BigInt(tick)) << 160n) | (1n << 96n)).toString(16).padStart(64, "0")}`;
  };
  assert.equal(await readRangeTick(deployment, { rpc: chainAt(46_070) }), 46_070);
  assert.equal(await readRangeTick(deployment, { rpc: chainAt(-1_234) }), -1_234);
  await assertRangePriceNear(deployment, 46_050, { rpc: chainAt(46_080) });
  await assertRangePriceNear(deployment, 46_050, { rpc: chainAt(46_020) });
  await assert.rejects(assertRangePriceNear(deployment, 46_050, { rpc: chainAt(46_081) }), (error) => error instanceof RangePriceMoved && error.tick === 46_081);
  const moved = await assertRangePriceNear(deployment, -10, { rpc: chainAt(-50) }).catch((error) => error);
  assert.ok(moved instanceof RangePriceMoved);
  assert.match(rangeErrorMessage(moved), /price moved before your position opened/);
});
