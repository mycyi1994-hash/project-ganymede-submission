import assert from "node:assert/strict";
import test from "node:test";
import {
  FUND_DEPLOYMENT, FUND_EVENTS, FUND_SELECTORS, STATE_WALLET_SHARES, dollarsFor, fundCalls, fundErrorMessage, fundFill, fundRpc,
  parseStoredWalletTotals, readFundAccount, readFundTotals, sharesFor, simulateFundCall, waitForFundReceipt, withSlippage,
} from "../lib/xstocks/fund.ts";
import { combineFund } from "../lib/demo/api.ts";
import { runXStocksCycle } from "../lib/xstocks/cycle.ts";
import { XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const ALICE = "0x00000000000000000000000000000000000a11ce";

/** A JSON-RPC endpoint for X Layer Testnet answering from `state`; `lagging` blocks answer "header not found" once. */
function chain(state) {
  const calls = [];
  const lagging = new Set(state.lagging ?? []);
  const fetcher = async (url, init) => {
    assert.equal(url, FUND_DEPLOYMENT.rpcUrl);
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const fail = (message, data) => Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message, data } });
    const [first, block] = body.params ?? [];
    if (typeof block === "string" && lagging.has(block)) { lagging.delete(block); return fail("header not found"); }
    switch (body.method) {
      case "eth_chainId": return answer(hex(state.chainId ?? 1952));
      case "eth_blockNumber": return answer(hex(state.block));
      case "eth_getBalance": return answer(hex(state.gas ?? 10n ** 15n));
      case "eth_getTransactionReceipt": return answer(state.receipts?.shift() ?? null);
      case "eth_call": {
        const selector = first.data.slice(0, 10);
        if (state.revert?.[selector]) return fail("execution reverted", state.revert[selector]);
        if (first.to === FUND_DEPLOYMENT.dollar) return answer(`0x${word({ [FUND_SELECTORS.balanceOf]: state.dollars, [FUND_SELECTORS.allowance]: state.allowance, [FUND_SELECTORS.nextClaimAt]: state.nextClaimAt }[selector] ?? 0)}`);
        if (selector === FUND_SELECTORS.currentNav) return answer(`0x${word(state.nav)}${word(state.navAt)}`);
        return answer(`0x${word({ [FUND_SELECTORS.balanceOf]: state.shares, [FUND_SELECTORS.totalSupply]: state.supply, [FUND_SELECTORS.investorCount]: state.investors }[selector] ?? 0)}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
  return { rpc: fundRpc({ fetcher }), fetcher, calls };
}

test("orders are encoded for the pinned contracts and priced with the contract's own rounding", () => {
  assert.deepEqual(fundCalls.claim(), { to: FUND_DEPLOYMENT.dollar, data: FUND_SELECTORS.claim });
  assert.equal(fundCalls.approve(1_000_000_000n).data, `${FUND_SELECTORS.approve}${FUND_DEPLOYMENT.fund.slice(2).padStart(64, "0")}${word(1_000_000_000n)}`);
  assert.deepEqual(fundCalls.invest(10_000_000n, 3_333_333n), { to: FUND_DEPLOYMENT.fund, data: `${FUND_SELECTORS.invest}${word(10_000_000n)}${word(3_333_333n)}` });
  assert.equal(fundCalls.redeem(5n, 0n).data, `${FUND_SELECTORS.redeem}${word(5n)}${word(0n)}`);
  assert.throws(() => fundCalls.invest(-1n, 0n), /out of range/);
  // The same example as the contract tests: $10 at a $3 NAV, and back.
  assert.equal(sharesFor(10_000_000n, 3_000_000n), 3_333_333n);
  assert.equal(dollarsFor(3_333_333n, 3_000_000n), 9_999_999n);
  assert.equal(sharesFor(1_000_000_000n, 99_449_929n), 10_055_311n);
  assert.equal(withSlippage(10_000n), 9_900n);
  assert.equal(sharesFor(1n, 0n), 0n);
});

test("a wallet is read at one block, never below the newest block the page has seen", async () => {
  const { rpc, calls } = chain({ block: 100, dollars: 9_000_000_000n, allowance: 0n, nextClaimAt: 1_790_000_000n, shares: 10_055_311n, nav: 99_449_929n, navAt: 1_790_300_000n, lagging: [hex(120)] });
  const account = await readFundAccount(ALICE, { rpc, minBlock: 120 });
  assert.equal(account.block, 120, "the receipt's block, although the node reported 100");
  assert.equal(account.dollarsMicros, 9_000_000_000n);
  assert.equal(account.sharesMicros, 10_055_311n);
  assert.equal(account.nextClaimAt, 1_790_000_000);
  assert.deepEqual(account.nav, { navMicros: 99_449_929n, effectiveAt: new Date(1_790_300_000 * 1000).toISOString() });
  const reads = calls.filter((call) => call.method === "eth_call" || call.method === "eth_getBalance");
  assert.ok(reads.every((call) => call.params[1] === hex(120)), "every read is pinned to one block");
  assert.ok(reads.length > 6, "a lagging node's answer was retried");
});

test("a stale or missing NAV is a reason to show, not a failure", async () => {
  const { rpc } = chain({ block: 5, nav: 0n, navAt: 0n, revert: { [FUND_SELECTORS.currentNav]: "0x220d4d06" + word(1_790_000_000n) } });
  const account = await readFundAccount(ALICE, { rpc });
  assert.equal(account.nav.navMicros, null);
  assert.match(account.nav.reason, /over an hour old/);
  await assert.rejects(readFundAccount(ALICE, { rpc: chain({ block: 5, chainId: 196 }).rpc }), /does not match X Layer Testnet/);
});

test("fund totals come from the contract; a dry run surfaces the revert reason", async () => {
  const { rpc } = chain({ block: 7, supply: 2_005_480n, investors: 1n, revert: { [FUND_SELECTORS.invest]: "0x8199f5f3" } });
  assert.deepEqual(await readFundTotals({ rpc }), { block: 7, sharesMicros: 2_005_480n, investors: 1 });
  await assert.rejects(simulateFundCall(ALICE, fundCalls.invest(10_000_000n, 1n), { rpc }), (error) => fundErrorMessage(error).includes("NAV changed"));
});

test("a mined order is read back from the fund's event", async () => {
  const { rpc } = chain({ block: 1, receipts: [null, {
    blockNumber: "0x2a", status: "0x1",
    logs: [
      { address: FUND_DEPLOYMENT.dollar, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x" },
      { address: FUND_DEPLOYMENT.fund.toUpperCase().replace("0X", "0x"), topics: [FUND_EVENTS.invested, `0x${ALICE.slice(2).padStart(64, "0")}`], data: `0x${word(100_000_000n)}${word(1_002_740n)}${word(99_726_660n)}${word(1_790_302_866n)}` },
    ],
  }] });
  const receipt = await waitForFundReceipt(`0x${"ab".repeat(32)}`, { rpc, intervalMs: 1 });
  assert.equal(receipt.block, 42);
  assert.deepEqual(fundFill(receipt), { side: "invest", investor: ALICE, dollarsMicros: 100_000_000n, sharesMicros: 1_002_740n, navMicros: 99_726_660n, navEffectiveAt: new Date(1_790_302_866 * 1000).toISOString() });
  const redeemed = { ...receipt, logs: [{ address: FUND_DEPLOYMENT.fund, topics: [FUND_EVENTS.redeemed, `0x${ALICE.slice(2).padStart(64, "0")}`], data: `0x${word(1_002_740n)}${word(99_999_822n)}${word(99_726_660n)}${word(1_790_302_866n)}` }] };
  assert.equal(fundFill(redeemed).dollarsMicros, 99_999_822n);
  assert.equal(fundFill({ ...receipt, logs: [] }), null);
  await assert.rejects(waitForFundReceipt("0x1234"), /invalid transaction hash/);
});

test("wallet and RPC errors read as a customer would need them", () => {
  assert.equal(fundErrorMessage({ code: 4001, message: "User rejected the request." }), "You cancelled the request in your wallet.");
  assert.match(fundErrorMessage({ code: -32000, message: "insufficient funds for gas * price + value" }), /test OKB/);
  // MetaMask nests the revert under data; OKX Wallet under data.originalError.
  assert.match(fundErrorMessage({ code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, message: "execution reverted", data: "0x860b82a9" } }), /minimum order is \$10/);
  assert.match(fundErrorMessage({ code: -32603, message: "failed", data: { originalError: { data: "0x854f3dd0" + word(1n) } } }), /last 24 hours/);
  assert.equal(fundErrorMessage({ message: "execution reverted" }), "The contract rejected this order.");
  assert.match(fundErrorMessage(new Error("x".repeat(400))), /could not be completed/);
});

test("fund totals add wallets to demo balances, and a stored read is validated", () => {
  const demo = { sharesOutstandingMicros: "70195063", investors: 7, ordersToday: 2, last24h: { investedMicros: "0", redeemedMicros: "0", orders: 0 } };
  const combined = combineFund(demo, { sharesMicros: "2005480", investors: 1, block: 9 });
  assert.equal(combined.sharesOutstandingMicros, "72200543");
  assert.equal(combined.investors, 8);
  assert.deepEqual(combined.demo, { sharesMicros: "70195063", investors: 7 });
  assert.deepEqual(combineFund(demo, null).sharesOutstandingMicros, "70195063");
  assert.equal(parseStoredWalletTotals('{"sharesMicros":"5","investors":1,"block":3,"readAt":"2026-09-25T00:00:00.000Z"}').sharesMicros, "5");
  assert.equal(parseStoredWalletTotals('{"sharesMicros":"-5","investors":1,"block":3,"readAt":"x"}'), null);
  assert.equal(parseStoredWalletTotals("not json"), null);
});

test("each NAV record carries wallet shares plus demo shares, and the last wallet read when the chain is down", async (t) => {
  const rows = new Map();
  const repo = { async getState(key) { return rows.has(key) ? { value: rows.get(key) } : null; }, async setState(key, value) { rows.set(key, value); }, async saveSettlement() {}, async deleteStatesWithPrefix() {} };
  const addresses = XSTOCKS_CONSTITUENTS.map((item, i) => ({ ...item, address: "0x" + String(i + 1).repeat(40) }));
  const configured = { OKX_API_KEY: "k", OKX_API_SECRET: "s", OKX_API_PASSPHRASE: "p", XSTOCKS_ADDRESSES: addresses.map((item) => `${item.symbol}=${item.address}`).join(",") };
  const at = new Date().toISOString();
  const prices = async () => Response.json({ code: "0", data: addresses.map((item) => ({ chainIndex: "196", tokenContractAddress: item.address, price: "100", time: at })) });
  let rpcUp = true;
  const { fetcher } = chain({ block: 50, supply: 2_005_480n, investors: 1n });
  t.mock.method(globalThis, "fetch", async (url, init) => url === FUND_DEPLOYMENT.rpcUrl ? (rpcUp ? fetcher(url, init) : Promise.reject(new TypeError("fetch failed"))) : prices());
  const sent = [];
  const settlement = { async settle(request) { sent.push(request); return { status: "confirmed", txHash: `0x${String(sent.length).padStart(64, "0")}`, error: null }; } };

  await runXStocksCycle(configured, repo, settlement, at);
  assert.equal(sent.at(-1).sharesOutstandingMicros, "2005480", "no demo ledger here, so wallet shares only");
  assert.equal(JSON.parse(rows.get(STATE_WALLET_SHARES)).sharesMicros, "2005480");

  rpcUp = false;
  const result = await runXStocksCycle(configured, repo, settlement, new Date(Date.parse(at) + 300_000).toISOString());
  assert.equal(sent.at(-1).sharesOutstandingMicros, "2005480", "the last value read stands in");
  assert.ok(result.warnings.some((warning) => /wallet shares could not be read/.test(warning)));
});
