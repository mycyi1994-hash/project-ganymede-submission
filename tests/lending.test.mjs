import assert from "node:assert/strict";
import test from "node:test";
import { FUND_DEPLOYMENT, FUND_SELECTORS, fundRpc } from "../lib/xstocks/fund.ts";
import {
  LENDING_ALL, LENDING_EVENTS, LENDING_SELECTORS, formatWadPercent, lendingCalls, lendingErrorMessage, lendingFill, lendingPosition, readLending,
} from "../lib/xstocks/lending.ts";

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const ALICE = "0x00000000000000000000000000000000000a11ce";
const USD = 1_000_000n;
const WAD = 10n ** 18n;

/** X Layer Testnet answering from `state`, keyed by contract and selector. */
function chain(state) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(state.block));
      case "eth_getBalance": return answer(hex(state.gas ?? 10n ** 15n));
      case "eth_call": {
        const selector = first.data.slice(0, 10);
        const toMarket = first.data.slice(-40) === FUND_DEPLOYMENT.lending.slice(2);
        if (selector === FUND_SELECTORS.currentNav) return answer(`0x${word(state.nav)}${word(state.navAt)}`);
        const key = `${first.to}:${selector}${selector === FUND_SELECTORS.allowance && toMarket ? ":market" : ""}`;
        return answer(`0x${word(state.values[key] ?? 0n)}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), calls };
}

test("lending orders are encoded for the pinned market, dollar and token", () => {
  const market = FUND_DEPLOYMENT.lending.slice(2).padStart(64, "0");
  assert.deepEqual(lendingCalls.supplyCollateral(20n * USD), { to: FUND_DEPLOYMENT.lending, data: `${LENDING_SELECTORS.supplyCollateral}${word(20n * USD)}` });
  assert.deepEqual(lendingCalls.borrow(950n * USD), { to: FUND_DEPLOYMENT.lending, data: `${LENDING_SELECTORS.borrow}${word(950n * USD)}` });
  assert.equal(lendingCalls.repay(LENDING_ALL).data, `${LENDING_SELECTORS.repay}${"f".repeat(64)}`);
  assert.equal(lendingCalls.withdrawCollateral(1n).data, `${LENDING_SELECTORS.withdrawCollateral}${word(1n)}`);
  assert.equal(lendingCalls.supply(5n).data, `${LENDING_SELECTORS.supply}${word(5n)}`);
  assert.equal(lendingCalls.withdraw(5n).data, `${LENDING_SELECTORS.withdraw}${word(5n)}`);
  assert.deepEqual(lendingCalls.approveDollars(7n), { to: FUND_DEPLOYMENT.dollar, data: `${FUND_SELECTORS.approve}${market}${word(7n)}` });
  assert.deepEqual(lendingCalls.approveShares(7n), { to: FUND_DEPLOYMENT.fund, data: `${FUND_SELECTORS.approve}${market}${word(7n)}` });
});

test("a position is valued at the NAV with the contract's own rounding", () => {
  // 20 USTX at $100: worth $2,000, borrow up to $1,000, liquidatable above $1,300.
  const open = lendingPosition(20n * USD, 950n * USD, 100n * USD, 5_000n * USD);
  assert.equal(open.valueMicros, 2_000n * USD);
  assert.equal(open.borrowLimitMicros, 1_000n * USD);
  assert.equal(open.liquidationLimitMicros, 1_300n * USD);
  // Both leave room for 0.1% of interest before the transaction is mined: $1,000 less $950.950001.
  assert.equal(open.borrowableMicros, 49_049_999n);
  // $950.950001 needs 19.019001 USTX at 50%, so 0.980999 USTX can come back.
  assert.equal(open.withdrawableMicros, 980_999n);
  assert.equal(open.loanToValueWad, 475n * WAD / 1_000n);
  assert.equal(open.liquidationNavMicros, 73_076_923n);
  // What can be borrowed stops at what the market holds; without a loan all collateral can come back.
  assert.equal(lendingPosition(20n * USD, 0n, 100n * USD, 300n * USD).borrowableMicros, 300n * USD);
  assert.equal(lendingPosition(20n * USD, 0n, 100n * USD, 300n * USD).withdrawableMicros, 20n * USD);
  assert.equal(lendingPosition(20n * USD, 0n, 100n * USD, 300n * USD).liquidationNavMicros, null);
  // Past the limit, nothing more can be borrowed or withdrawn.
  const under = lendingPosition(10n * USD, 600n * USD, 100n * USD, 5_000n * USD);
  assert.equal(under.borrowableMicros, 0n);
  assert.equal(under.withdrawableMicros, 0n);
  assert.equal(lendingPosition(0n, 0n, 100n * USD, 0n).loanToValueWad, 0n);
});

test("rates read as percentages", () => {
  assert.equal(formatWadPercent(39n * WAD / 1_000n), "3.90%");
  assert.equal(formatWadPercent(2n * WAD / 100n), "2.00%");
  assert.equal(formatWadPercent(0n), "0.00%");
  assert.equal(formatWadPercent(WAD * 21n / 10n), "210.00%");
});

test("the market and a wallet are read at one block", async () => {
  const L = FUND_DEPLOYMENT.lending;
  const { rpc, calls } = chain({
    block: 50, nav: 100n * USD, navAt: 1_790_000_000n,
    values: {
      [`${L}:${LENDING_SELECTORS.paused}`]: 0n, [`${L}:${LENDING_SELECTORS.cash}`]: 4_050n * USD, [`${L}:${LENDING_SELECTORS.totalSupplied}`]: 5_000n * USD,
      [`${L}:${LENDING_SELECTORS.totalBorrowed}`]: 950n * USD, [`${L}:${LENDING_SELECTORS.utilization}`]: 19n * WAD / 100n,
      [`${L}:${LENDING_SELECTORS.borrowRatePerYear}`]: 39n * WAD / 1_000n, [`${L}:${LENDING_SELECTORS.supplyRatePerYear}`]: 6_669n * WAD / 1_000_000n,
      [`${L}:${LENDING_SELECTORS.supplyBalanceOf}`]: 1n, [`${L}:${LENDING_SELECTORS.borrowBalanceOf}`]: 950n * USD, [`${L}:${LENDING_SELECTORS.collateralOf}`]: 20n * USD,
      [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.balanceOf}`]: 1_000n * USD, [`${FUND_DEPLOYMENT.fund}:${FUND_SELECTORS.balanceOf}`]: 3n * USD,
      [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.allowance}:market`]: 11n, [`${FUND_DEPLOYMENT.fund}:${FUND_SELECTORS.allowance}:market`]: 12n,
    },
  });
  const { market, account } = await readLending(ALICE, { rpc, minBlock: 60 });
  assert.equal(market.block, 60);
  assert.equal(market.paused, false);
  assert.equal(market.cashMicros, 4_050n * USD);
  assert.equal(market.borrowRateWad, 39n * WAD / 1_000n);
  assert.deepEqual(market.nav, { navMicros: 100n * USD, effectiveAt: new Date(1_790_000_000 * 1000).toISOString() });
  assert.deepEqual(account, { gasWei: 10n ** 15n, dollarsMicros: 1_000n * USD, sharesMicros: 3n * USD, dollarAllowanceMicros: 11n, shareAllowanceMicros: 12n, suppliedMicros: 1n, debtMicros: 950n * USD, collateralMicros: 20n * USD });
  const reads = calls.filter((call) => call.method === "eth_call" || call.method === "eth_getBalance");
  assert.ok(reads.every((call) => call.params[1] === hex(60)), "every read is pinned to one block");
  const marketOnly = await readLending(null, { rpc: chain({ block: 5, nav: 1n, navAt: 1n, values: {} }).rpc });
  assert.equal(marketOnly.account, null);
});

test("a lending transaction is read back from the market's event", () => {
  const topic = `0x${ALICE.slice(2).padStart(64, "0")}`;
  const receipt = { hash: "0x", block: 1, status: "success", logs: [
    { address: FUND_DEPLOYMENT.dollar, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x" },
    { address: FUND_DEPLOYMENT.lending.toUpperCase().replace("0X", "0x"), topics: [LENDING_EVENTS.borrowed, topic], data: `0x${word(950n * USD)}` },
  ] };
  assert.deepEqual(lendingFill(receipt, "borrow"), { action: "borrow", account: ALICE, micros: 950n * USD });
  assert.equal(lendingFill(receipt, "repay"), null, "a different action's event is not this fill");
  assert.equal(lendingFill({ ...receipt, logs: [{ ...receipt.logs[1], address: FUND_DEPLOYMENT.fund }] }, "borrow"), null);
});

test("lending errors read as a customer would need them", () => {
  assert.match(lendingErrorMessage({ data: "0x3a23d825" }), /borrow limit of 50%/);
  assert.match(lendingErrorMessage({ data: "0xbb55fd27" }), /does not have that many demo dollars/);
  assert.match(lendingErrorMessage({ data: "0x860b82a9" }), /A loan starts at \$10/);
  assert.match(lendingErrorMessage({ data: "0xab35696f" }), /Lending is paused/);
  // Errors the market shares with the fund keep the fund's words; wallet errors stay the same.
  assert.match(lendingErrorMessage({ data: "0x220d4d06" + word(1n) }), /over an hour old/);
  assert.equal(lendingErrorMessage({ code: 4001, message: "User rejected the request." }), "You cancelled the request in your wallet.");
});
