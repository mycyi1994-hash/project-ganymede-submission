import assert from "node:assert/strict";
import test from "node:test";
import { FUND_DEPLOYMENT, FUND_SELECTORS, POOL_SELECTORS, fundRpc } from "../lib/xstocks/fund.ts";
import {
  LIQUIDITY_EVENTS, LIQUIDITY_SELECTORS, POOL_LAUNCH_BLOCK, POOL_MINIMUM_LIQUIDITY, buyFeeMicros, changeWad, formatSharePpm, formatYield, invariantPerLp, liquidityCalls, liquidityErrorMessage,
  liquidityFill, liquidityPosition, lpTokenValueMicros, minimumDollarsOnly, pairedDollars, pairedShares, poolValueMicros, poolYield, quoteAddLiquidity, quoteRemoveLiquidity,
  readLiquidity, readPoolYield, sellFeeMicros, splitDollarsOnly, sqrt,
} from "../lib/xstocks/liquidity.ts";

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const ALICE = "0x00000000000000000000000000000000000a11ce";
const USD = 1_000_000n;
const WAD = 10n ** 18n;
const POOL = FUND_DEPLOYMENT.pool;
/** The pool on X Layer Testnet when this was written: 50.524455 USTX, $4,970.520110, 500.586653 LP. */
const LIVE = { sharesMicros: 50_524_455n, dollarsMicros: 4_970_520_110n, supply: 500_586_653n };

/** X Layer Testnet answering from `states`, keyed by block: the pool's reserves and supply, the NAV and the wallet. */
function chain({ head, states, times = {} }) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first, tag] = body.params ?? [];
    const at = (block) => states[Number(block)] ?? states.latest;
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(head));
      case "eth_getBalance": return answer(hex(10n ** 15n));
      case "eth_getBlockByNumber": return answer({ number: first, timestamp: hex(times[Number(first)] ?? 1_790_000_000 + Number(first)) });
      case "eth_call": {
        const state = at(tag);
        const selector = first.data.slice(0, 10);
        if (first.to === POOL && selector === POOL_SELECTORS.getReserves) return answer(`0x${word(state.sharesMicros)}${word(state.dollarsMicros)}`);
        if (first.to === POOL && selector === LIQUIDITY_SELECTORS.totalSupply) return answer(`0x${word(state.supply)}`);
        if (selector === FUND_SELECTORS.currentNav) return answer(`0x${word(state.nav ?? 100n * USD)}${word(1_790_000_000n)}`);
        const spender = first.data.length >= 138 ? `0x${first.data.slice(-40)}` : null;
        const key = `${first.to}:${selector}${spender ? `:${spender}` : ""}`;
        return answer(`0x${word(state.wallet?.[key] ?? 0n)}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), calls };
}

test("liquidity calls are encoded for the pinned pool", () => {
  assert.deepEqual(liquidityCalls.add(2n * USD, 200n * USD, 1_980_000n, 198n * USD, 1_790_000_600), {
    to: POOL, data: `${LIQUIDITY_SELECTORS.addLiquidity}${word(2n * USD)}${word(200n * USD)}${word(1_980_000n)}${word(198n * USD)}${word(1_790_000_600)}`,
  });
  assert.deepEqual(liquidityCalls.remove(5n * USD, 1n, 2n, 1_790_000_600), {
    to: POOL, data: `${LIQUIDITY_SELECTORS.removeLiquidity}${word(5n * USD)}${word(1n)}${word(2n)}${word(1_790_000_600)}`,
  });
});

test("deposits and withdrawals are quoted with the pool's own arithmetic", () => {
  // The first deposit takes both amounts and mints their geometric mean less the 1,000 locked.
  assert.deepEqual(quoteAddLiquidity(50n * USD, 5_000n * USD, { sharesMicros: 0n, dollarsMicros: 0n, supply: 0n }), { sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD, liquidity: 500_000_000n - POOL_MINIMUM_LIQUIDITY });
  assert.equal(quoteAddLiquidity(1n, 1_000_000n, { sharesMicros: 0n, dollarsMicros: 0n, supply: 0n }), null, "√(1 × 10^6) is not above the locked 1,000");
  // Later deposits take the ratio: 1 USTX needs $98.3785, floored.
  const dollars = pairedDollars(USD, LIVE);
  assert.equal(dollars, 98_378_500n);
  assert.deepEqual(quoteAddLiquidity(USD, dollars, LIVE), { sharesMicros: USD, dollarsMicros: dollars, liquidity: 9_907_809n });
  // Offered more dollars than the ratio needs, the pool takes only what the USTX needs; offered fewer, it takes all the dollars and less USTX.
  assert.deepEqual(quoteAddLiquidity(USD, 500n * USD, LIVE), quoteAddLiquidity(USD, dollars, LIVE));
  const fewer = quoteAddLiquidity(USD, 49n * USD, LIVE);
  assert.equal(fewer.dollarsMicros, 49n * USD);
  assert.equal(fewer.sharesMicros, pairedShares(49n * USD, LIVE));
  assert.equal(quoteAddLiquidity(1n, 1n, LIVE), null, "too small to mint");
  assert.equal(quoteAddLiquidity(0n, 5n, LIVE), null);
  // A withdrawal pays each reserve's share, rounded down.
  assert.deepEqual(quoteRemoveLiquidity(LIVE.supply / 2n, LIVE), { sharesMicros: 25_262_227n, dollarsMicros: 2_485_260_050n });
  assert.equal(quoteRemoveLiquidity(LIVE.supply + 1n, LIVE), null);
  assert.equal(quoteRemoveLiquidity(0n, LIVE), null);
  assert.equal(pairedDollars(USD, { sharesMicros: 0n, dollarsMicros: 0n }), null);
});

test("a position and the pool are valued at the NAV", () => {
  const nav = 98_000_000n;
  assert.equal(poolValueMicros(LIVE, nav), 50_524_455n * 98n + 4_970_520_110n);
  assert.equal(lpTokenValueMicros(LIVE, nav), poolValueMicros(LIVE, nav) * USD / LIVE.supply);
  const position = liquidityPosition(LIVE.supply / 10n, LIVE, nav);
  assert.deepEqual({ ...position }, { sharesMicros: 5_052_445n, dollarsMicros: 497_052_008n, valueMicros: 5_052_445n * 98n + 497_052_008n, sharePpm: 99_999n });
  assert.equal(liquidityPosition(LIVE.supply / 10n, LIVE, null).valueMicros, null);
  assert.deepEqual(liquidityPosition(0n, LIVE, nav), { sharesMicros: 0n, dollarsMicros: 0n, valueMicros: 0n, sharePpm: 0n });
});

test("a deposit of demo dollars alone splits so the USTX it buys at the fund fits the pool's ratio", () => {
  // With the pool at the NAV, half is invested.
  const atNav = { sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD };
  assert.deepEqual(splitDollarsOnly(1_000n * USD, 100n * USD, atNav), { investMicros: 500n * USD, sharesMicros: 5n * USD, dollarsMicros: 500n * USD });
  // The live pool prices USTX below a $100 NAV: the fund's USTX costs more than the pool values it,
  // so a little over half goes to the fund, and the deposit still sits at the ratio.
  const split = splitDollarsOnly(1_000n * USD, 100n * USD, LIVE);
  assert.deepEqual(split, { investMicros: 504_086_883n, sharesMicros: 5_040_868n, dollarsMicros: 495_913_117n });
  const quote = quoteAddLiquidity(split.sharesMicros, split.dollarsMicros, LIVE);
  assert.ok(split.dollarsMicros - quote.dollarsMicros <= 100n, "at most a few micros of dollars left over");
  assert.equal(quote.sharesMicros, split.sharesMicros);
  // The fund's $10 minimum sets the smallest deposit: the minimum splits, one micro less does not.
  const smallest = minimumDollarsOnly(100n * USD, LIVE);
  assert.ok(splitDollarsOnly(smallest, 100n * USD, LIVE).investMicros >= 10n * USD);
  assert.equal(splitDollarsOnly(smallest - 1n, 100n * USD, LIVE), null);
  assert.equal(minimumDollarsOnly(100n * USD, atNav), 20n * USD);
  assert.equal(splitDollarsOnly(1_000n * USD, null, LIVE), null, "no usable NAV");
  assert.equal(splitDollarsOnly(1_000n * USD, 100n * USD, { sharesMicros: 0n, dollarsMicros: 0n }), null, "an empty pool has no ratio");
});

test("fee growth is the reserves' geometric mean per LP token, which deposits leave unchanged", () => {
  assert.equal(sqrt(0n), 0n);
  assert.equal(sqrt(99n), 9n);
  assert.equal(sqrt(10n ** 36n), 10n ** 18n);
  const launch = { sharesMicros: 50_117_400n, dollarsMicros: 4_999_999_948n, supply: 500_586_653n };
  assert.equal(invariantPerLp(launch), sqrt(launch.sharesMicros * launch.dollarsMicros * WAD * WAD) / launch.supply);
  // A deposit at the ratio leaves it where it was, give or take the pool's rounding in its favour.
  const quote = quoteAddLiquidity(USD, pairedDollars(USD, LIVE), LIVE);
  const deposited = { sharesMicros: LIVE.sharesMicros + quote.sharesMicros, dollarsMicros: LIVE.dollarsMicros + quote.dollarsMicros, supply: LIVE.supply + quote.liquidity };
  const before = invariantPerLp(LIVE);
  assert.ok(invariantPerLp(deposited) >= before && invariantPerLp(deposited) - before < before / 10_000_000n);
  // Six days of trading on the live pool: 0.1088% of fees, 6.62% a year.
  const growth = poolYield(launch, LIVE, 6 * 86_400);
  assert.equal(formatYield(growth.growthWad), "0.10%");
  assert.equal(growth.aprWad, growth.growthWad * 365n / 6n);
  assert.equal(formatYield(growth.aprWad), "6.62%");
  assert.equal(poolYield({ ...launch, supply: 0n }, LIVE, 60), null);
  assert.equal(poolYield(launch, LIVE, 0), null);
});

test("the pool and a wallet are read at one block", async () => {
  const wallet = {
    [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.balanceOf}`]: 1_000n * USD, [`${FUND_DEPLOYMENT.fund}:${FUND_SELECTORS.balanceOf}`]: 3n * USD, [`${POOL}:${FUND_SELECTORS.balanceOf}`]: 7n * USD,
    [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.allowance}:${POOL}`]: 11n, [`${FUND_DEPLOYMENT.fund}:${FUND_SELECTORS.allowance}:${POOL}`]: 12n,
    [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.allowance}:${FUND_DEPLOYMENT.fund}`]: 13n, [`${FUND_DEPLOYMENT.dollar}:${FUND_SELECTORS.nextClaimAt}`]: 1_790_086_400n,
  };
  const { rpc, calls } = chain({ head: 50, states: { latest: { ...LIVE, nav: 98n * USD, wallet } } });
  const { pool, account } = await readLiquidity(ALICE, { rpc, minBlock: 60 });
  assert.deepEqual(pool, { block: 60, sharesMicros: LIVE.sharesMicros, dollarsMicros: LIVE.dollarsMicros, supply: LIVE.supply, nav: { navMicros: 98n * USD, effectiveAt: new Date(1_790_000_000 * 1000).toISOString() } });
  assert.deepEqual(account, {
    gasWei: 10n ** 15n, dollarsMicros: 1_000n * USD, sharesMicros: 3n * USD, lpMicros: 7n * USD, poolDollarAllowanceMicros: 11n, poolShareAllowanceMicros: 12n, fundAllowanceMicros: 13n, nextClaimAt: 1_790_086_400,
  });
  const reads = calls.filter((call) => call.method === "eth_call" || call.method === "eth_getBalance");
  assert.ok(reads.every((call) => call.params[1] === hex(60)), "every read is pinned to one block");
  assert.equal((await readLiquidity(null, { rpc: chain({ head: 5, states: { latest: LIVE } }).rpc })).account, null);
});

test("the fee APR compares the pool a week ago, or at its first deposit, with now", async () => {
  const launch = { sharesMicros: 50_117_400n, dollarsMicros: 4_999_999_948n, supply: 500_586_653n };
  // Six days after the first deposit the window starts at the first deposit's block.
  const head = POOL_LAUNCH_BLOCK + 6 * 86_400;
  const young = chain({ head, states: { [POOL_LAUNCH_BLOCK]: launch, latest: LIVE }, times: { [POOL_LAUNCH_BLOCK]: 1_790_000_000, [head]: 1_790_000_000 + 6 * 86_400 } });
  const growth = await readPoolYield({ rpc: young.rpc });
  assert.deepEqual([growth.fromBlock, growth.toBlock, growth.toTime - growth.fromTime], [POOL_LAUNCH_BLOCK, head, 6 * 86_400]);
  assert.equal(formatYield(growth.aprWad), "6.62%");
  // At an unchanged $100 NAV an LP token gained what the fees and the pool's drift gave it; holding the same tokens gained nothing.
  assert.equal(growth.lpValueFromMicros, lpTokenValueMicros(launch, 100n * USD));
  assert.equal(growth.lpValueToMicros, lpTokenValueMicros(LIVE, 100n * USD));
  assert.equal(growth.heldValueToMicros, growth.lpValueFromMicros);
  assert.equal(changeWad(growth.lpValueFromMicros, growth.heldValueToMicros), 0n);
  assert.equal(changeWad(null, 1n), null);
  const tags = young.calls.filter((call) => call.method === "eth_call").map((call) => call.params[1]);
  assert.deepEqual([...new Set(tags)].sort(), [hex(POOL_LAUNCH_BLOCK), hex(head)].sort());
  // Later, the last seven days.
  const older = POOL_LAUNCH_BLOCK + 30 * 86_400;
  const week = await readPoolYield({ rpc: chain({ head: older, states: { latest: LIVE } }).rpc });
  assert.equal(week.fromBlock, older - 7 * 86_400);
  assert.equal(week.growthWad, 0n, "no trades, no fees");
});

test("a liquidity transaction is read back from the pool's event", () => {
  const topic = `0x${ALICE.slice(2).padStart(64, "0")}`;
  const receipt = { hash: "0x", block: 1, status: "success", logs: [
    { address: FUND_DEPLOYMENT.dollar, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x" },
    { address: POOL.toUpperCase().replace("0X", "0x"), topics: [LIQUIDITY_EVENTS.added, topic], data: `0x${word(USD)}${word(98n * USD)}${word(9_907_668n)}` },
  ] };
  assert.deepEqual(liquidityFill(receipt), { side: "add", provider: ALICE, sharesMicros: USD, dollarsMicros: 98n * USD, lpMicros: 9_907_668n });
  assert.deepEqual(liquidityFill({ ...receipt, logs: [{ ...receipt.logs[1], topics: [LIQUIDITY_EVENTS.removed, topic] }] }).side, "remove");
  assert.equal(liquidityFill({ ...receipt, logs: [{ ...receipt.logs[1], address: FUND_DEPLOYMENT.fund }] }), null);
});

test("fees, yields and shares read as a provider would need them", () => {
  assert.equal(buyFeeMicros(50n * USD), 150_000n);
  assert.equal(sellFeeMicros(20n * USD), 60_180n);
  assert.equal(formatYield(66_200_000_000_000_000n), "6.62%");
  assert.equal(formatYield(1n), "under 0.01%");
  assert.equal(formatYield(-5n * 10n ** 15n), "−0.50%");
  assert.equal(formatSharePpm(99_999n), "9.9999%");
  assert.equal(formatSharePpm(1_000_000n), "100.0000%");
  assert.equal(formatSharePpm(0n, true), "under 0.0001%");
  assert.equal(formatSharePpm(0n), "0.0000%");
  assert.match(liquidityErrorMessage({ data: "0x8199f5f3" }), /The price moved before this was confirmed/);
  assert.match(liquidityErrorMessage({ data: "0x2c5211c6" }), /too small for the pool/);
  // Errors the pool shares with the fund keep the fund's words; wallet errors stay the same.
  assert.match(liquidityErrorMessage({ data: "0x203d82d8" }), /expired/);
  assert.equal(liquidityErrorMessage({ code: 4001, message: "User rejected the request." }), "You cancelled the request in your wallet.");
});
