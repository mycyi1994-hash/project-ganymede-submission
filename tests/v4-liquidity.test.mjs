import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FUND_DEPLOYMENT, FUND_SELECTORS, fundRpc } from "../lib/xstocks/fund.ts";
import {
  V4_ERRORS, V4_EVENTS, V4_POOL_DEPLOYMENT, V4_SELECTORS, byCurrency, byToken, formatFeePips, isPinnedToFund, readV4Pool, tickToUsd, v4Calls, v4DepositQuote, v4ErrorMessage,
  v4Fill, v4PairedDollars, v4PairedShares, v4PriceMicros, v4RepegDue, v4ValueMicros, v4WithdrawEstimate,
} from "../lib/xstocks/v4-liquidity.ts";

const word = (value) => (BigInt(value) & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const USD = 1_000_000n;
const ALICE = "0x00000000000000000000000000000000000a11ce";
/** A deployment as `npm run deploy:v4` would record it; addresses made up for the test. */
const D = {
  poolManager: "0x00000000000000000000000000000000000000aa", hook: "0x00000000000000000000000000000000000028c0", router: "0x00000000000000000000000000000000000000bb",
  asset: FUND_DEPLOYMENT.fund, dollar: FUND_DEPLOYMENT.dollar, assetIsCurrency0: true, poolId: `0x${"4".repeat(64)}`, stateSlot: `0x${"5".repeat(64)}`,
};
const FLIPPED = { ...D, assetIsCurrency0: false };
const Q96 = 1n << 96n;

test("the pool is pinned to the seeded deployment recorded on X Layer Testnet", () => {
  const { contracts } = JSON.parse(readFileSync(new URL("../onchain/deployments/xlayer-testnet.json", import.meta.url), "utf8"));
  assert.ok(contracts.GanymedeRwaLiquidityHook.seedTransaction, "the recorded pool is seeded");
  assert.equal(V4_POOL_DEPLOYMENT.hook, contracts.GanymedeRwaLiquidityHook.address.toLowerCase());
  assert.equal(V4_POOL_DEPLOYMENT.poolManager, contracts.UniswapV4PoolManager.address.toLowerCase());
  assert.equal(V4_POOL_DEPLOYMENT.router, contracts.GanymedeV4Router.address.toLowerCase());
  assert.equal(V4_POOL_DEPLOYMENT.poolId, contracts.GanymedeRwaLiquidityHook.poolId.toLowerCase());
  assert.equal(V4_POOL_DEPLOYMENT.assetIsCurrency0, BigInt(V4_POOL_DEPLOYMENT.asset) < BigInt(V4_POOL_DEPLOYMENT.dollar));
  assert.equal(isPinnedToFund(V4_POOL_DEPLOYMENT), true);
  assert.equal(isPinnedToFund(D), true);
  assert.equal(isPinnedToFund({ ...D, dollar: ALICE }), false);
});

test("amounts map to the pool's currencies in either order", () => {
  assert.deepEqual(byToken(D, 1n, 2n), { sharesMicros: 1n, dollarsMicros: 2n });
  assert.deepEqual(byToken(FLIPPED, 1n, 2n), { sharesMicros: 2n, dollarsMicros: 1n });
  assert.deepEqual(byCurrency(D, { sharesMicros: 1n, dollarsMicros: 2n }), [1n, 2n]);
  assert.deepEqual(byCurrency(FLIPPED, { sharesMicros: 1n, dollarsMicros: 2n }), [2n, 1n]);
});

test("calls are encoded for the pinned hook, in the pool's currency order", () => {
  const calls = v4Calls(D);
  const hook = D.hook.slice(2).padStart(64, "0");
  assert.deepEqual(calls.approveShares(5n), { to: D.asset, data: `${FUND_SELECTORS.approve}${hook}${word(5n)}` });
  assert.deepEqual(calls.approveDollars(6n), { to: D.dollar, data: `${FUND_SELECTORS.approve}${hook}${word(6n)}` });
  assert.deepEqual(calls.deposit({ sharesMicros: 3n * USD, dollarsMicros: 300n * USD }, 1_790_000_600), { to: D.hook, data: `${V4_SELECTORS.deposit}${word(3n * USD)}${word(300n * USD)}${word(1_790_000_600)}` });
  assert.equal(v4Calls(FLIPPED).deposit({ sharesMicros: 3n * USD, dollarsMicros: 300n * USD }, 1).data, `${V4_SELECTORS.deposit}${word(300n * USD)}${word(3n * USD)}${word(1)}`);
  assert.deepEqual(calls.cancelDeposit(), { to: D.hook, data: V4_SELECTORS.cancelDeposit });
  assert.deepEqual(calls.claimShares(ALICE), { to: D.hook, data: `${V4_SELECTORS.claimShares}${ALICE.slice(2).padStart(64, "0")}` });
  assert.deepEqual(calls.repeg(), { to: D.hook, data: V4_SELECTORS.repeg });
  assert.equal(calls.withdraw(7n, { sharesMicros: 1n, dollarsMicros: 2n }, 9).data, `${V4_SELECTORS.withdraw}${word(7n)}${word(1n)}${word(2n)}${word(9)}`);
});

test("the pool's price and ranges read in dollars per USTX", () => {
  // √100 × 2^96 is $100 per USTX with USTX as currency0, and $0.01 the other way round.
  assert.equal(v4PriceMicros(10n * Q96, true), 100n * USD);
  assert.equal(v4PriceMicros(10n * Q96, false), 10_000n);
  assert.equal(v4PriceMicros(0n, true), 0n);
  assert.ok(Math.abs(tickToUsd(46_050, true) - 100) < 0.05);
  assert.ok(Math.abs(tickToUsd(-46_050, false) - 100) < 0.05);
  assert.equal(formatFeePips(3_000), "0.30%");
  assert.equal(formatFeePips(10_000), "1.00%");
  assert.equal(formatFeePips(6_499), "0.64%");
  assert.equal(v4ValueMicros({ sharesMicros: 2n * USD, dollarsMicros: 5n }, 100_00000000n), 200n * USD + 5n);
});

test("deposits are quoted with the hook's arithmetic: the holdings' ratio, each amount rounded up", () => {
  const nav = { answer: 100_00000000n, navMicros: 100n * USD, updatedAt: 1 };
  // The first deposit takes both in full and mints its value less 1,000 locked; under $10 it is refused.
  assert.deepEqual(v4DepositQuote({ sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD }, { supply: 0n, sharesMicros: 0n, dollarsMicros: 0n, nav }), { sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD, lpEstimateMicros: 10_000n * USD - 1_000n });
  assert.equal(v4DepositQuote({ sharesMicros: 0n, dollarsMicros: 9n * USD }, { supply: 0n, sharesMicros: 0n, dollarsMicros: 0n, nav }), null);
  // Later: 50.1 USTX and $4,980 held for 10,000 LP tokens.
  const pool = { supply: 10_000n * USD, sharesMicros: 50_100_000n, dollarsMicros: 4_980n * USD, nav };
  const dollars = v4PairedDollars(3n * USD, pool);
  assert.equal(dollars, 298_203_593n, "3 × 4,980 / 50.1, rounded up");
  const quote = v4DepositQuote({ sharesMicros: 3n * USD, dollarsMicros: dollars }, pool);
  // 3 USTX buys 598.802395 units of the holdings; each side is that share of what is held, rounded up.
  assert.deepEqual(quote, { sharesMicros: 3n * USD, dollarsMicros: 298_203_593n, lpEstimateMicros: (3n * 100n * USD + 298_203_593n) * pool.supply / (50_100_000n * 100n + 4_980n * USD) });
  assert.ok(quote.sharesMicros <= 3n * USD && quote.dollarsMicros <= dollars, "never more than the maxima");
  // Typed as dollars, the USTX follows; the deposit is sized by whichever side binds.
  const shares = v4PairedShares(300n * USD, pool);
  assert.equal(shares, 3_018_073n);
  assert.ok(v4DepositQuote({ sharesMicros: shares, dollarsMicros: 300n * USD }, pool).dollarsMicros <= 300n * USD);
  assert.equal(v4DepositQuote({ sharesMicros: 0n, dollarsMicros: 300n * USD }, pool), null, "one side missing buys nothing");
  assert.deepEqual(v4DepositQuote({ sharesMicros: 1n, dollarsMicros: 1n }, pool), { sharesMicros: 1n, dollarsMicros: 1n, lpEstimateMicros: 101n }, "a micro of each still buys two units, rounded up");
  assert.equal(v4DepositQuote({ sharesMicros: 5n, dollarsMicros: 5n }, { ...pool, sharesMicros: 0n, dollarsMicros: 0n }), null, "nothing held, nothing to match");
  // Without a usable NAV a later deposit still goes in, waiting for the next record; only the estimate is missing.
  assert.equal(v4DepositQuote({ sharesMicros: 3n * USD, dollarsMicros: dollars }, { ...pool, nav: { answer: null, reason: "stale" } }).lpEstimateMicros, null);
  // Withdrawals: their part of what is held, rounded down.
  assert.deepEqual(v4WithdrawEstimate(1_000n * USD, pool), { sharesMicros: 5_010_000n, dollarsMicros: 498n * USD });
  assert.equal(v4WithdrawEstimate(pool.supply + 1n, pool), null);
  assert.equal(v4WithdrawEstimate(1n, { ...pool, sharesMicros: 5n, dollarsMicros: 5n }), null, "too few LP tokens to pay anything out");
});

/** X Layer Testnet answering for the hook, the pool manager and the tokens; the NAV can be stale, and the pool already moved to it. */
function chain({ stale = false, repegged = false } = {}) {
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
      case "eth_getBalance": return answer(hex(5n));
      case "eth_call": {
        const selector = first.data.slice(0, 10);
        const owner = first.data.length >= 74 ? first.data.slice(34, 74) : "";
        if (first.to === D.poolManager) {
          assert.equal(first.data, `${V4_SELECTORS.extsload}${"5".repeat(64)}`);
          // lpFee 0x800000 (dynamic), tick 46050, √100 × 2^96.
          return answer(`0x${word((0x800000n << 208n) | (46_050n << 160n) | (10n * Q96))}`);
        }
        if (first.to === D.hook) switch (selector) {
          case V4_SELECTORS.totalSupply: return answer(`0x${word(10_000n * USD)}`);
          case V4_SELECTORS.totalAmounts: return answer(`0x${word(50_100_000n)}${word(4_980n * USD)}`);
          case V4_SELECTORS.epoch: return answer(`0x${word(4n)}`);
          case V4_SELECTORS.pending0: return answer(`0x${word(3n * USD)}`);
          case V4_SELECTORS.pending1: return answer(`0x${word(298n * USD)}`);
          case V4_SELECTORS.peggedAt: return answer(`0x${word(1_790_000_000n)}`);
          case V4_SELECTORS.nav: return stale ? revert(`0xfad298ff${word(1_790_000_000n)}`) : answer(`0x${word(100_00000000n)}${word(1_790_000_000n)}${word(10n * Q96)}`);
          case V4_SELECTORS.currentFee: return stale ? revert(`0xfad298ff${word(1_790_000_000n)}`) : answer(`0x${word(3_350n)}`);
          case V4_SELECTORS.repeg: return stale ? revert(`0xfad298ff${word(1_790_000_000n)}`) : answer(`0x${word(repegged ? 0n : 1n)}`);
          case V4_SELECTORS.baseRange: return answer(`0x${word(45_850n)}${word(46_260n)}${word(123n)}`);
          case V4_SELECTORS.limitRange: return answer(`0x${word(-45_750n)}${word(-45_450n)}${word(45n)}`);
          case V4_SELECTORS.balanceOf: return answer(`0x${word(owner === ALICE.slice(2).padStart(40, "0") ? 7n * USD : 0n)}`);
          case V4_SELECTORS.pendingOf: return answer(`0x${word(3n * USD)}${word(298n * USD)}${word(4n)}`);
          case V4_SELECTORS.claimableShares: return answer(`0x${word(11n)}`);
        }
        if (selector === FUND_SELECTORS.balanceOf) return answer(`0x${word(first.to === D.asset ? 2n * USD : 900n * USD)}`);
        if (selector === FUND_SELECTORS.allowance) return answer(`0x${word(first.to === D.asset ? 12n : 13n)}`);
        throw new Error(`unexpected call ${first.to} ${selector}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), calls };
}

test("the pool and a wallet are read at one block, by token rather than by currency", async () => {
  const { rpc, calls } = chain();
  const { pool, account } = await readV4Pool(D, ALICE, { rpc, minBlock: 80 });
  assert.deepEqual(pool, {
    block: 80, supply: 10_000n * USD, sharesMicros: 50_100_000n, dollarsMicros: 4_980n * USD, pending: { sharesMicros: 3n * USD, dollarsMicros: 298n * USD }, epoch: 4n,
    peggedAt: 1_790_000_000, nav: { answer: 100_00000000n, navMicros: 100n * USD, updatedAt: 1_790_000_000 }, feePips: 3_350, sqrtPriceX96: 10n * Q96, priceMicros: 100n * USD,
    base: { lower: 45_850, upper: 46_260, liquidity: 123n }, limit: { lower: -45_750, upper: -45_450, liquidity: 45n },
  });
  assert.deepEqual(account, {
    gasWei: 5n, dollarsMicros: 900n * USD, sharesMicros: 2n * USD, lpMicros: 7n * USD, waiting: { sharesMicros: 3n * USD, dollarsMicros: 298n * USD }, claimableLpMicros: 11n,
    assetAllowanceMicros: 12n, dollarAllowanceMicros: 13n,
  });
  const reads = calls.filter((call) => call.method === "eth_call" || call.method === "eth_getBalance");
  assert.ok(reads.every((call) => call.params[1] === hex(80)), "every read is pinned to one block");
  // A stale record is a reason to show, not a failure: withdrawals still work.
  const stale = await readV4Pool(D, null, { rpc: chain({ stale: true }).rpc });
  assert.equal(stale.account, null);
  assert.equal(stale.pool.feePips, null);
  assert.match(stale.pool.nav.reason, /over an hour old/);
});

test("Convert now asks the hook, from the wallet and at the page's block or later, whether a newer record is still to apply", async () => {
  const due = chain();
  assert.equal(await v4RepegDue(D, ALICE, { rpc: due.rpc, minBlock: 80 }), true);
  assert.deepEqual(due.calls.find((call) => call.method === "eth_call").params, [{ from: ALICE, to: D.hook, data: V4_SELECTORS.repeg }, hex(80)]);
  // A trade, a deposit or the keeper moved the pool first: only the claim is left to send.
  assert.equal(await v4RepegDue(D, ALICE, { rpc: chain({ repegged: true }).rpc }), false);
  // A record the hook cannot use is a reason to show, not a transaction to send.
  await assert.rejects(v4RepegDue(D, ALICE, { rpc: chain({ stale: true }).rpc }), (error) => /over an hour old/.test(v4ErrorMessage(error)));
});

test("a deposit, a conversion, a claim and a withdrawal are read back from the hook's events", () => {
  const topic = (value) => `0x${word(value)}`;
  const account = topic(BigInt(ALICE));
  const log = (topics, values) => ({ address: D.hook.toUpperCase().replace("0X", "0x"), topics, data: `0x${values.map(word).join("")}` });
  const receipt = { hash: "0x", block: 1, status: "success", logs: [
    log([V4_EVENTS.converted, topic(4n)], [101_00000000n, 1_000n * USD, 990n * USD]),
    log([V4_EVENTS.transfer, topic(0n), account], [7n]),
    log([V4_EVENTS.deposited, account, topic(5n)], [3n * USD, 300n * USD]),
    log([V4_EVENTS.sharesClaimed, account, topic(4n)], [990n * USD]),
    log([V4_EVENTS.withdrawn, account], [10n, 1n, 2n]),
    log([V4_EVENTS.deposited, topic(BigInt(FUND_DEPLOYMENT.keeper)), topic(5n)], [1n, 1n]),
    { address: FUND_DEPLOYMENT.pool, topics: [V4_EVENTS.withdrawn, account], data: `0x${word(1n)}${word(1n)}${word(1n)}` },
  ] };
  assert.deepEqual(v4Fill(receipt, FLIPPED, ALICE), {
    deposited: { sharesMicros: 300n * USD, dollarsMicros: 3n * USD, epoch: 5n }, cancelled: null, claimedLpMicros: 990n * USD,
    withdrawn: { sharesMicros: 2n, dollarsMicros: 1n, lpMicros: 10n }, converted: { epoch: 4n, navAnswer: 101_00000000n, valueMicros: 1_000n * USD, lpMicros: 990n * USD }, mintedLpMicros: 7n,
  });
  const cancelled = v4Fill({ ...receipt, logs: [log([V4_EVENTS.depositCancelled, account, topic(5n)], [3n * USD, 300n * USD])] }, D, ALICE);
  assert.deepEqual(cancelled.cancelled, { sharesMicros: 3n * USD, dollarsMicros: 300n * USD });
});

test("hook errors read as a liquidity provider would need them, unwrapped from a swap", () => {
  assert.match(v4ErrorMessage({ data: "0x80e681ab" }), /No deposit is waiting/);
  assert.match(v4ErrorMessage({ data: `0xfad298ff${word(1n)}` }), /over an hour old/);
  assert.match(v4ErrorMessage({ data: "0x860b82a9" }), /first deposit must be worth at least \$10/);
  // During a swap the pool manager wraps the hook's revert: WrappedError(hook, beforeSwap, reason, details).
  const reason = `fad298ff${word(1n)}`;
  const wrapped = `0x90bfb865${word(BigInt(D.hook))}${"575e24b4".padEnd(64, "0")}${word(128n)}${word(224n)}${word(BigInt(reason.length / 2))}${reason.padEnd(128, "0")}${word(4n)}${"a9e35b2e".padEnd(64, "0")}`;
  assert.match(v4ErrorMessage({ data: wrapped }), /over an hour old/);
  // The fund's words where the hook shares an error, and wallet errors as before.
  assert.match(v4ErrorMessage({ data: "0x203d82d8" }), /expired/);
  assert.equal(v4ErrorMessage({ code: 4001, message: "User rejected the request." }), "You cancelled the request in your wallet.");
  assert.ok(Object.keys(V4_ERRORS).every((selector) => /^0x[0-9a-f]{8}$/.test(selector)));
});
