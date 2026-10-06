import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractFunctionExecutionError, ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, keccak256, parseAbi, parseTransaction, toFunctionSelector,
} from "viem";
import { MIN_PROFIT_MICROS, RANGE_OPEN_GAP, revertReason, runKeeper, runRangeArbitrage, runRepeg, xlayerKeeperChain } from "../src/keeper.ts";

const USD = 1_000_000n;
const MAX = 2n ** 256n - 1n;

/**
 * A keeper chain answering from `state`; every write succeeds unless named in `state.revert`.
 * `state.quotes` answers successive quotes, and a simulation returns `state.simulate(size)`, by
 * default the quoted demo dollars back scaled to the size.
 */
function fakeChain(state) {
  const calls = [];
  const quotes = [...(state.quotes ?? [state.quote])];
  let last = quotes[0];
  const write = (name) => async (...args) => {
    calls.push([name, ...args]);
    return { hash: `0x${String(calls.length).padStart(64, "0")}`, success: state.revert !== name };
  };
  return {
    calls,
    chain: {
      quote: async () => {
        if (state.quoteError) throw state.quoteError;
        last = quotes.length > 1 ? quotes.shift() : quotes[0];
        return last;
      },
      dollarBalance: async () => state.balance ?? 0n,
      allowance: async () => state.allowance ?? 0n,
      nextClaimAt: async () => state.nextClaimAt ?? 0n,
      now: async () => state.now ?? 1_000n,
      simulate: async (buyInPool, size) => (state.simulate ? state.simulate(size) : { dollarsOut: (last.dollarsOut * size) / last.dollarsIn }),
      claim: write("claim"),
      approve: write("approve"),
      arbitrage: write("arbitrage"),
    },
  };
}

// The live arbitrage on X Layer Testnet: the pool 17% below the NAV.
const discount = { buyInPool: true, dollarsIn: 447_824_215n, dollarsOut: 491_800_048n };

test("does nothing while the pool is within its fee of the NAV", async () => {
  const { chain, calls } = fakeChain({ quote: { buyInPool: false, dollarsIn: 0n, dollarsOut: 0n }, balance: 10_000n * USD });
  assert.deepEqual(await runKeeper(chain), { action: "none", reason: "the pool is within its fee of the NAV" });
  assert.deepEqual(calls, []);
});

test("does nothing without a usable NAV", async () => {
  const { chain, calls } = fakeChain({ quoteError: new Error("NavTooOld(1790000000) at https://rpc.example/key") });
  const outcome = await runKeeper(chain);
  assert.equal(outcome.action, "none");
  assert.match(outcome.reason, /^no quote: NavTooOld/);
  assert.doesNotMatch(outcome.reason, /rpc\.example/);
  assert.deepEqual(calls, []);
});

test("closes a discount by buying in the pool and redeeming at the fund, insisting on half the profit", async () => {
  const { chain, calls } = fakeChain({ quote: discount, balance: 10_000n * USD, allowance: MAX });
  const outcome = await runKeeper(chain);
  assert.deepEqual(calls, [["arbitrage", true, discount.dollarsIn, (discount.dollarsOut - discount.dollarsIn) / 2n]]);
  assert.equal(outcome.action, "arbitrage");
  assert.equal(outcome.direction, "buyAndRedeem");
  assert.equal(outcome.dollarsIn, "447824215");
  assert.equal(outcome.expectedOut, "491800048");
  assert.equal(outcome.success, true);
});

test("claims demo dollars and approves the arbitrage contract first, then trades on a fresh quote", async () => {
  const premium = { buyInPool: false, dollarsIn: 120n * USD, dollarsOut: 121n * USD };
  const moved = { buyInPool: false, dollarsIn: 118n * USD, dollarsOut: 118_900_000n };
  const { chain, calls } = fakeChain({ quotes: [premium, moved], balance: 100n * USD, allowance: 0n, nextClaimAt: 900n, now: 1_000n });
  const outcome = await runKeeper(chain);
  assert.deepEqual(calls.map(([name]) => name), ["claim", "approve", "arbitrage"]);
  assert.deepEqual(calls[2], ["arbitrage", false, 118n * USD, 450_000n]);
  assert.equal(outcome.direction, "investAndSell");
  assert.equal(outcome.expectedOut, "118900000");
});

test("stops after claiming if the fresh quote no longer pays", async () => {
  const closed = { buyInPool: true, dollarsIn: 0n, dollarsOut: 0n };
  const { chain, calls } = fakeChain({ quotes: [discount, closed], balance: 0n, allowance: MAX });
  assert.deepEqual(await runKeeper(chain), { action: "none", reason: "the pool is within its fee of the NAV" });
  assert.deepEqual(calls.map(([name]) => name), ["claim"]);
});

test("trades what it holds when it cannot claim yet", async () => {
  const { chain, calls } = fakeChain({ quote: discount, balance: 200n * USD, allowance: MAX, nextClaimAt: 5_000n, now: 1_000n, simulate: () => ({ dollarsOut: 210n * USD }) });
  const outcome = await runKeeper(chain);
  assert.deepEqual(calls, [["arbitrage", true, 200n * USD, 5n * USD]]);
  assert.equal(outcome.expectedOut, String(210n * USD));
});

test("ignores a gap that earns under a cent, without claiming for it", async () => {
  // The keeper's first quote on X Layer Testnet: $1.83 in for $0.000576 of profit.
  const { chain, calls } = fakeChain({ quote: { buyInPool: true, dollarsIn: 1_834_955n, dollarsOut: 1_835_531n }, balance: 0n });
  const outcome = await runKeeper(chain);
  assert.equal(outcome.action, "none");
  assert.match(outcome.reason, /would earn 576 demo-dollar micros, under the 10000 worth a trade/);
  assert.deepEqual(calls, []);
});

test("does not send a trade that would revert or that earns under a cent at its size", async () => {
  const reverting = fakeChain({ quote: discount, balance: 10_000n * USD, allowance: MAX, simulate: () => ({ revert: "Unprofitable(1834955, 1834943)" }) });
  assert.deepEqual(await runKeeper(reverting.chain), { action: "none", reason: "the trade would revert: Unprofitable(1834955, 1834943)" });

  const thin = fakeChain({ quote: discount, balance: 3n * USD, allowance: MAX, nextClaimAt: 5_000n, now: 1_000n, simulate: size => ({ dollarsOut: size + MIN_PROFIT_MICROS - 1n }) });
  const outcome = await runKeeper(thin.chain);
  assert.equal(outcome.action, "none");
  assert.match(outcome.reason, /a trade of 3000000 demo-dollar micros would earn 9999/);
  assert.deepEqual([...reverting.calls, ...thin.calls], []);
});

test("skips when it holds too little, including an investment under the fund's $10", async () => {
  const empty = fakeChain({ quote: discount, balance: 0n, nextClaimAt: 5_000n, now: 1_000n });
  assert.match((await runKeeper(empty.chain)).reason, /holds 0 demo-dollar micros, too few/);
  const invest = fakeChain({ quote: { buyInPool: false, dollarsIn: 12n * USD, dollarsOut: 12_100_000n }, balance: 5n * USD, allowance: MAX, nextClaimAt: 5_000n, now: 1_000n });
  assert.match((await runKeeper(invest.chain)).reason, /holds 5000000 demo-dollar micros, too few/);
  assert.deepEqual([...empty.calls, ...invest.calls], []);
});

test("stops when a claim or an approval reverts, and reports a reverted trade", async () => {
  const claim = fakeChain({ quote: discount, balance: 0n, revert: "claim" });
  assert.match((await runKeeper(claim.chain)).reason, /^claim reverted/);
  assert.deepEqual(claim.calls.map(([name]) => name), ["claim"]);

  const approve = fakeChain({ quote: discount, balance: 10_000n * USD, allowance: 0n, revert: "approve" });
  assert.match((await runKeeper(approve.chain)).reason, /^approve reverted/);
  assert.deepEqual(approve.calls.map(([name]) => name), ["approve"]);

  const trade = fakeChain({ quote: discount, balance: 10_000n * USD, allowance: MAX, revert: "arbitrage" });
  assert.equal((await runKeeper(trade.chain)).success, false);
});

test("names the contract error a simulated trade reverts with", () => {
  const abi = parseAbi(["function buyAndRedeem(uint256 dollarsIn, uint256 minProfit) returns (uint256)", "error Unprofitable(uint256 dollarsIn, uint256 dollarsOut)"]);
  // The revert data of the keeper's first trade on X Layer Testnet.
  const data = "0x4482de3e00000000000000000000000000000000000000000000000000000000001bffcb00000000000000000000000000000000000000000000000000000000001bffbf";
  const reverted = new ContractFunctionRevertedError({ abi, data, functionName: "buyAndRedeem" });
  const error = new ContractFunctionExecutionError(reverted, { abi, functionName: "buyAndRedeem", args: [1_834_955n, 0n] });
  assert.equal(revertReason(error), "Unprofitable(1834955, 1834943)");
  assert.equal(revertReason(new Error("fetch failed")), undefined);
});

test("the Worker refuses to start without its key and addresses", (t) => {
  assert.throws(() => xlayerKeeperChain({}), /KEEPER_PRIVATE_KEY is not set/);
  const key = `0x${"1".repeat(64)}`;
  assert.throws(() => xlayerKeeperChain({ KEEPER_PRIVATE_KEY: key }), /ARBITRAGE_ADDRESS is not set/);
  assert.throws(() => xlayerKeeperChain({ KEEPER_PRIVATE_KEY: key, ARBITRAGE_ADDRESS: "0x1234" }), /ARBITRAGE_ADDRESS is not an address/);
  assert.throws(() => xlayerKeeperChain({ KEEPER_PRIVATE_KEY: key, ARBITRAGE_ADDRESS: `0x${"a".repeat(40)}` }), /DOLLAR_ADDRESS is not set/);
  // The v4 pool is left alone until its hook is configured. A malformed hook address is reported, and
  // the arbitrage still runs: the v4 pool is optional.
  const env = { KEEPER_PRIVATE_KEY: key, ARBITRAGE_ADDRESS: `0x${"a".repeat(40)}`, DOLLAR_ADDRESS: `0x${"b".repeat(40)}` };
  assert.equal(xlayerKeeperChain(env).v4, null);
  assert.equal(typeof xlayerKeeperChain({ ...env, V4_HOOK_ADDRESS: `0x${"c".repeat(36)}28c0` }).v4.repeg, "function");
  const errors = t.mock.method(console, "error", () => {});
  const misconfigured = xlayerKeeperChain({ ...env, V4_HOOK_ADDRESS: "0x1234" });
  assert.equal(misconfigured.v4, null);
  assert.equal(typeof misconfigured.claim, "function");
  assert.match(String(errors.mock.calls[0].arguments[0]), /V4_HOOK_ADDRESS is not an address/);
});

/** The v4 pool's side of the keeper, answering from `state`. */
function fakeHook(state) {
  const calls = [];
  return {
    calls,
    chain: {
      pegState: async () => ({ navUpdatedAt: state.navUpdatedAt ?? null, peggedAt: state.peggedAt ?? 0n }),
      simulateRepeg: async () => { calls.push(["simulate"]); return state.simulate ?? { repegged: true }; },
      repeg: async () => { calls.push(["repeg"]); return { hash: `0x${"9".repeat(64)}`, success: state.revert !== true }; },
    },
  };
}

test("moves the v4 pool to a NAV record it has not used, and only then", async () => {
  const moved = fakeHook({ navUpdatedAt: 1_790_000_300n, peggedAt: 1_790_000_000n });
  assert.deepEqual(await runRepeg(moved.chain), { action: "repeg", navUpdatedAt: "1790000300", hash: `0x${"9".repeat(64)}`, success: true });
  assert.deepEqual(moved.calls, [["simulate"], ["repeg"]]);
  // At the latest record, or without a usable NAV, nothing is sent.
  for (const state of [{ navUpdatedAt: 1_790_000_000n, peggedAt: 1_790_000_000n }, { navUpdatedAt: null, peggedAt: 1_790_000_000n }]) {
    const idle = fakeHook(state);
    const outcome = await runRepeg(idle.chain);
    assert.equal(outcome.action, "none");
    assert.deepEqual(idle.calls, []);
  }
  // Someone moved it first, or the call would revert: not sent.
  const first = fakeHook({ navUpdatedAt: 2n, peggedAt: 1n, simulate: { repegged: false } });
  assert.deepEqual(await runRepeg(first.chain), { action: "none", reason: "the v4 pool is at the latest NAV record" });
  const failing = fakeHook({ navUpdatedAt: 2n, peggedAt: 1n, simulate: { revert: "Reentrancy()" } });
  assert.deepEqual(await runRepeg(failing.chain), { action: "none", reason: "the re-peg would revert: Reentrancy()" });
  assert.deepEqual(failing.calls, [["simulate"]]);
  // A re-peg that reverts on chain is reported as such.
  assert.equal((await runRepeg(fakeHook({ navUpdatedAt: 2n, peggedAt: 1n, revert: true }).chain)).success, false);
});

test("a write that fails before it is mined leaves no nonce gap for the next one", async (t) => {
  const sent = [];
  let counts = 0;
  let failNext = true;
  // X Layer Testnet's JSON-RPC: the account's next nonce is 7; the first broadcast is lost.
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    switch (body.method) {
      case "eth_chainId": return answer("0x7a0");
      case "eth_getTransactionCount": counts += 1; return answer("0x7");
      case "eth_getBlockByNumber": return answer({ number: "0x10", hash: `0x${"1".repeat(64)}`, timestamp: "0x1", baseFeePerGas: "0x1", transactions: [] });
      case "eth_maxPriorityFeePerGas": case "eth_gasPrice": return answer("0x1");
      case "eth_blockNumber": return answer("0x10");
      case "eth_sendRawTransaction": {
        if (failNext) { failNext = false; return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "connection reset" } }); }
        sent.push(parseTransaction(body.params[0]));
        return answer(keccak256(body.params[0]));
      }
      case "eth_getTransactionReceipt": return answer({
        transactionHash: body.params[0], blockNumber: "0x10", blockHash: `0x${"1".repeat(64)}`, status: "0x1", logs: [], cumulativeGasUsed: "0x1", gasUsed: "0x1",
        effectiveGasPrice: "0x1", from: "0x0000000000000000000000000000000000000001", to: null, contractAddress: null, transactionIndex: "0x0", type: "0x2", logsBloom: `0x${"0".repeat(512)}`,
      });
      default: throw new Error(`unexpected ${body.method}`);
    }
  });
  const chain = xlayerKeeperChain({
    KEEPER_PRIVATE_KEY: `0x${"1".repeat(64)}`, ARBITRAGE_ADDRESS: `0x${"a".repeat(40)}`, DOLLAR_ADDRESS: `0x${"b".repeat(40)}`, V4_HOOK_ADDRESS: `0x${"c".repeat(36)}28c0`,
    SETTLEMENT_RPC_URL: "https://rpc.example/key",
  });
  await assert.rejects(chain.claim());
  // The re-peg after a failed arbitrage takes nonce 7 again, asked of the network, not 8.
  const repegged = await chain.v4.repeg();
  assert.equal(repegged.success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].nonce, 7);
  assert.equal(counts, 2, "the nonce is asked for again after the failure");
  // The next write in the run takes the following nonce without asking.
  await chain.approve();
  assert.deepEqual(sent.map((transaction) => transaction.nonce), [7, 8]);
  assert.equal(counts, 2);
});

test("the range pool's arbitrage is sent when it pays a cent, insisting on half of it, or to bring back a price that keeps positions out", async () => {
  const sent = [];
  const gaps = [];
  const chain = (simulated, gap = 0.012) => ({
    dollarAllowance: async () => 2n ** 256n - 1n,
    approveDollars: async () => { throw new Error("already approved"); },
    simulate: async () => simulated,
    navGap: async () => { gaps.push(gap); return gap; },
    arbitrage: async (minProfit) => { sent.push(minProfit); return { hash: `0x${"7".repeat(64)}`, success: true }; },
  });
  const landed = { hash: `0x${"7".repeat(64)}`, success: true };
  assert.deepEqual(await runRangeArbitrage(chain({ revert: "NothingToDo()" })), { action: "none", reason: "the range pool is within its fee of the NAV" });
  assert.equal((await runRangeArbitrage(chain({ revert: "NavTooOld(1)" }))).reason, "the arbitrage would revert: NavTooOld(1)");
  assert.deepEqual(await runRangeArbitrage(chain({ profit: 650_000n })), { action: "arbitrage", profit: "650000", ...landed });
  assert.deepEqual(sent, [325_000n]);
  // Nothing between the price and the NAV: the pool is moved across for the gas alone.
  assert.deepEqual(await runRangeArbitrage(chain({ profit: 0n })), { action: "recentre", profit: "0", ...landed });
  assert.deepEqual(sent, [325_000n, 0n]);
  assert.deepEqual(gaps, [], "a trade worth a cent, or nothing at all, is sent without reading the price");
  // Under a cent, the trade waits while positions can still open, or while the NAV cannot be read...
  for (const gap of [RANGE_OPEN_GAP, -RANGE_OPEN_GAP, 0.004, null]) {
    assert.equal((await runRangeArbitrage(chain({ profit: MIN_PROFIT_MICROS - 1n }, gap))).action, "none");
  }
  assert.deepEqual(sent, [325_000n, 0n]);
  // ...and is sent, insisting on half of it, once the price is too far for them: a few dollars of
  // USTX over a pool 3% under the NAV earn about a third of a cent, and nothing else moves it.
  assert.deepEqual(await runRangeArbitrage(chain({ profit: 3_301n }, -0.029)), { action: "recentre", profit: "3301", ...landed });
  assert.deepEqual(await runRangeArbitrage(chain({ profit: 1n }, 0.0096)), { action: "recentre", profit: "1", ...landed });
  assert.deepEqual(sent, [325_000n, 0n, 1_650n, 0n]);
});

test("the keeper approves its demo dollars to the range arbitrage once, before the first call", async () => {
  const calls = [];
  let allowance = 0n;
  const chain = (approval = true) => ({
    dollarAllowance: async () => { calls.push("allowance"); return allowance; },
    approveDollars: async () => { calls.push("approve"); if (approval) allowance = 2n ** 256n - 1n; return { hash: `0x${"8".repeat(64)}`, success: approval }; },
    simulate: async () => { calls.push("simulate"); return { revert: "NothingToDo()" }; },
    navGap: async () => null,
    arbitrage: async () => { throw new Error("not sent"); },
  });
  // Selling into fewer bids than the fund's minimum draws the rest from the keeper, so the call needs the allowance.
  assert.equal((await runRangeArbitrage(chain(false))).reason, `approving demo dollars for the range arbitrage failed in 0x${"8".repeat(64)}`);
  assert.deepEqual(calls.splice(0), ["allowance", "approve"], "nothing is run without it");
  assert.equal((await runRangeArbitrage(chain())).action, "none");
  assert.deepEqual(calls.splice(0), ["allowance", "approve", "simulate"]);
  assert.equal((await runRangeArbitrage(chain())).action, "none");
  assert.deepEqual(calls.splice(0), ["allowance", "simulate"], "and not again");
});

test("the keeper claims demo dollars for the range arbitrage when it holds under $10 and a claim is due", async () => {
  const claims = [];
  const range = { dollarAllowance: async () => 2n ** 256n - 1n, approveDollars: async () => { throw new Error("approved"); }, simulate: async () => ({ revert: "NothingToDo()" }), navGap: async () => null, arbitrage: async () => { throw new Error("not sent"); } };
  const wallet = (balance, nextClaimAt, success = true) => ({
    dollarBalance: async () => balance, nextClaimAt: async () => nextClaimAt, now: async () => 1_000n,
    claim: async () => { claims.push(balance); return { hash: `0x${"9".repeat(64)}`, success }; },
  });
  // Shortfall trades draw up to $10 each, whether or not the constant-product pool's run claimed.
  assert.equal((await runRangeArbitrage(range, wallet(5n * USD, 0n))).reason, "the range pool is within its fee of the NAV");
  assert.deepEqual(claims, [5n * USD]);
  // Enough held, or no claim due yet: nothing is claimed and the call still runs.
  await runRangeArbitrage(range, wallet(10n * USD, 0n));
  await runRangeArbitrage(range, wallet(5n * USD, 2_000n));
  assert.deepEqual(claims, [5n * USD]);
  assert.equal((await runRangeArbitrage(range, wallet(0n, 0n, false))).reason, `claim reverted: 0x${"9".repeat(64)}`);
});

test("reads the range pool's price against the NAV from the hook and Uniswap's PoolManager", async (t) => {
  // The pool on X Layer Testnet as `npm run deploy:range` recorded it (lib/xstocks/range-liquidity.ts).
  const arbitrage = "0xaee2ffbb9b3c3dbb5bda350d5df7314978b045dc";
  const hook = "0x8e489d68cf8cbb9199105e3f0c32fc08936e28c0";
  const manager = "0xe83eee508ce92832488dd9f574ad329a1203641c";
  const poolId = "0xcdf2037d5744c2bc575bc595e109ac0cb942bcdec8d229c3cf0517edb9bb2942";
  const stateSlot = "0x82e0159c7e66a997561511741bdb0118e92b14965af4fd7e84f15ce23d8a0791";
  // A NAV of $100 (USTX and demo dollars both have six decimals) and a pool 1% under it in square-root terms.
  const navSqrt = 10n * 2n ** 96n;
  const poolSqrt = navSqrt * 99n / 100n;
  const state = { assetIsCurrency0: true, nav: "ok" };
  const word = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method !== "eth_call") throw new Error(`unexpected ${body.method}`);
    const { to, data } = body.params[0];
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const call = `${to.toLowerCase()}:${data.slice(0, 10)}`;
    if (call === `${arbitrage}:${toFunctionSelector("hook()")}`) return answer(word(["address"], [hook]));
    if (call === `${arbitrage}:${toFunctionSelector("poolManager()")}`) return answer(word(["address"], [manager]));
    if (call === `${hook}:${toFunctionSelector("poolId()")}`) return answer(poolId);
    if (call === `${hook}:${toFunctionSelector("assetIsCurrency0()")}`) return answer(word(["bool"], [state.assetIsCurrency0]));
    if (call === `${hook}:${toFunctionSelector("nav()")}`) {
      if (state.nav === "ok") return answer(word(["uint256", "uint256", "uint160"], [100n * 10n ** 8n, 1_790_000_000n, navSqrt]));
      const revert = encodeErrorResult({ abi: parseAbi(["error NavTooOld(uint256 updatedAt)"]), errorName: "NavTooOld", args: [1_790_000_000n] });
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data: revert } });
    }
    if (call === `${manager}:${toFunctionSelector("extsload(bytes32)")}`) {
      assert.equal(`0x${data.slice(10)}`, stateSlot, "slot0 is read where the recorded deployment keeps it");
      // slot0 packs the tick and the fees above the price's 160 bits.
      return answer(word(["uint256"], [(0xbb8n << 208n) | (0xffffd8n << 160n) | poolSqrt]));
    }
    throw new Error(`unexpected call ${call}`);
  });
  const chain = xlayerKeeperChain({
    KEEPER_PRIVATE_KEY: `0x${"1".repeat(64)}`, ARBITRAGE_ADDRESS: `0x${"a".repeat(40)}`, DOLLAR_ADDRESS: `0x${"b".repeat(40)}`, RANGE_ARBITRAGE_ADDRESS: arbitrage,
    SETTLEMENT_RPC_URL: "https://rpc.example/key",
  });
  // USTX at 0.99² of the NAV: 1.99% under it.
  assert.ok(Math.abs(await chain.range.navGap() - (0.9801 - 1)) < 1e-12);
  // With USTX as currency1 the pool's price is demo dollars per USTX's inverse: 2.03% over the NAV.
  state.assetIsCurrency0 = false;
  assert.ok(Math.abs(await chain.range.navGap() - (1 / 0.9801 - 1)) < 1e-12);
  // A NAV the hook will not use: no gap to act on.
  state.nav = "stale";
  assert.equal(await chain.range.navGap(), null);
});
