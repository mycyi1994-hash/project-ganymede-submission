import assert from "node:assert/strict";
import test from "node:test";
import { FUND_DEPLOYMENT, FUND_SELECTORS, fundRpc } from "../lib/xstocks/fund.ts";
import { V4_DYNAMIC_FEE, V4_SELECTORS, V4_SWAPPED_TOPIC, V4_TICK_SPACING, readV4Quote, v4SwapCalls, v4SwapFill } from "../lib/xstocks/v4-liquidity.ts";

const USD = 1_000_000n;
const ALICE = "0x00000000000000000000000000000000000a11ce";
const word = (value) => (BigInt(value) & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const pad = (address) => address.slice(2).padStart(64, "0");
// USTX (the fund) is currency0 on X Layer Testnet; FLIPPED is the same pool with the dollar first.
const D = {
  poolManager: "0x00000000000000000000000000000000000000aa", hook: "0x00000000000000000000000000000000000028c0", router: "0x00000000000000000000000000000000000000bb",
  asset: FUND_DEPLOYMENT.fund, dollar: FUND_DEPLOYMENT.dollar, assetIsCurrency0: true, poolId: `0x${"4".repeat(64)}`, stateSlot: `0x${"5".repeat(64)}`,
};
const FLIPPED = { ...D, assetIsCurrency0: false };
const key = (deployment) => {
  const [currency0, currency1] = deployment.assetIsCurrency0 ? [deployment.asset, deployment.dollar] : [deployment.dollar, deployment.asset];
  return `${pad(currency0)}${pad(currency1)}${word(V4_DYNAMIC_FEE)}${word(V4_TICK_SPACING)}${pad(deployment.hook)}`;
};

test("swaps go through the router with the pool key, the direction by the pool's currency order", () => {
  const calls = v4SwapCalls(D);
  // Buying USTX pays demo dollars, currency1 here: not zero for one.
  assert.deepEqual(calls.swap("buy", 25n * USD, 248_000n, 1_790_000_600), {
    to: D.router, data: `${V4_SELECTORS.swapExactInput}${key(D)}${word(0)}${word(25n * USD)}${word(248_000n)}${word(1_790_000_600)}`,
  });
  assert.equal(calls.swap("sell", USD, 0n, 1).data.slice(10 + 5 * 64, 10 + 6 * 64), word(1), "selling USTX, currency0, is zero for one");
  assert.equal(v4SwapCalls(FLIPPED).swap("buy", USD, 0n, 1).data, `${V4_SELECTORS.swapExactInput}${key(FLIPPED)}${word(1)}${word(USD)}${word(0)}${word(1)}`);
  // Approvals are the router's, which takes the input with transferFrom.
  assert.deepEqual(calls.approveDollars(5n), { to: D.dollar, data: `${FUND_SELECTORS.approve}${pad(D.router)}${word(5)}` });
  assert.deepEqual(calls.approveShares(6n), { to: D.asset, data: `${FUND_SELECTORS.approve}${pad(D.router)}${word(6)}` });
});

/** The router quotes $25 for 0.249877 USTX; with `stale`, the hook refuses the swap, and `dust` quotes nothing. */
function chain({ stale = false, dust = false } = {}) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const revert = (data) => Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data } });
    const [first] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(70));
      case "eth_call": {
        const selector = first.data.slice(0, 10);
        if (first.to === D.router && selector === V4_SELECTORS.quoteExactInput) {
          assert.equal(first.data, `${V4_SELECTORS.quoteExactInput}${key(D)}${word(0)}${word(25n * USD)}`);
          return stale ? revert(`0xfad298ff${word(1_790_000_000n)}`) : answer(`0x${word(dust ? 0n : 249_877n)}`);
        }
        if (first.to === D.hook && selector === V4_SELECTORS.currentFee) return stale ? revert(`0xfad298ff${word(1_790_000_000n)}`) : answer(`0x${word(3_421n)}`);
        if (first.to === D.dollar && selector === FUND_SELECTORS.allowance) {
          assert.equal(first.data, `${FUND_SELECTORS.allowance}${pad(ALICE)}${pad(D.router)}`);
          return answer(`0x${word(7n * USD)}`);
        }
        throw new Error(`unexpected call ${first.to} ${selector}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), calls };
}

test("an order is quoted by the router's dry run, with the fee and the wallet's allowance, at one block", async () => {
  const { rpc, calls } = chain();
  assert.deepEqual(await readV4Quote(D, "buy", 25n * USD, ALICE, { rpc, minBlock: 80 }), { block: 80, amountOut: 249_877n, reason: null, feePips: 3_421, allowanceMicros: 7n * USD });
  assert.ok(calls.filter(call => call.method === "eth_call").every(call => call.params[1] === hex(80)), "every read is pinned to one block");
  // A stale NAV stops swaps: the quote says why rather than failing.
  const stale = await readV4Quote(D, "buy", 25n * USD, ALICE, { rpc: chain({ stale: true }).rpc });
  assert.equal(stale.amountOut, null);
  assert.equal(stale.feePips, null);
  assert.match(stale.reason, /over an hour old/);
  const dust = await readV4Quote(D, "buy", 25n * USD, ALICE, { rpc: chain({ dust: true }).rpc });
  assert.deepEqual([dust.amountOut, dust.reason], [null, "The pool cannot fill an order this small."]);
});

test("a fill is read from the router's Swapped event for the wallet and this pool only", () => {
  const swapped = (trader, poolId, zeroForOne, amountIn, amountOut) => ({
    address: D.router, topics: [V4_SWAPPED_TOPIC, `0x${pad(trader)}`, poolId], data: `0x${word(zeroForOne ? 1 : 0)}${word(amountIn)}${word(amountOut)}`,
  });
  const receipt = (logs) => ({ hash: `0x${"1".repeat(64)}`, block: 9, status: "success", logs });
  assert.deepEqual(v4SwapFill(receipt([swapped(ALICE, D.poolId, false, 25n * USD, 249_877n)]), D, ALICE), { side: "buy", dollarsMicros: 25n * USD, sharesMicros: 249_877n });
  assert.deepEqual(v4SwapFill(receipt([swapped(ALICE, D.poolId, true, 124_938n, 12_400_000n)]), D, ALICE), { side: "sell", sharesMicros: 124_938n, dollarsMicros: 12_400_000n });
  assert.deepEqual(v4SwapFill(receipt([swapped(ALICE, D.poolId, true, 25n * USD, 249_877n)]), FLIPPED, ALICE), { side: "buy", dollarsMicros: 25n * USD, sharesMicros: 249_877n });
  const bob = "0x0000000000000000000000000000000000000b0b";
  assert.equal(v4SwapFill(receipt([swapped(bob, D.poolId, false, 1n, 1n)]), D, ALICE), null, "another wallet's swap");
  assert.equal(v4SwapFill(receipt([swapped(ALICE, `0x${"7".repeat(64)}`, false, 1n, 1n)]), D, ALICE), null, "another pool's swap");
  assert.equal(v4SwapFill(receipt([]), D, ALICE), null);
});
