import assert from "node:assert/strict";
import test from "node:test";
import { LEDGER, readLedger, readLedgerReceipt, ledgerTransfers, formatShares, sharedWalletAccount, transferLabel } from "../lib/product-ledger.ts";

const account = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const zero = `0x${"0".repeat(40)}`;
const tx = `0x${"c".repeat(64)}`;
const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const word = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const addressTopic = address => `0x${address.slice(2).padStart(64, "0")}`;
function event(overrides = {}) {
  return { address: LEDGER.address, topics: [topic, addressTopic(zero), addressTopic(account)], data: word(2_000_000), transactionHash: tx, blockNumber: "0x9c4", logIndex: "0x0", removed: false, ...overrides };
}
function fixture(overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(url, LEDGER.rpcUrl);
    assert.equal(options.method, "POST");
    const { method, params, id } = JSON.parse(options.body);
    calls.push({ method, params });
    let result;
    if (Object.hasOwn(overrides, method)) result = typeof overrides[method] === "function" ? await overrides[method](params) : overrides[method];
    else if (method === "eth_chainId") result = "0x7a0";
    else if (method === "eth_blockNumber") result = "0x9c4";
    else if (method === "eth_getCode") result = "0x6001";
    else if (method === "eth_getBlockByNumber") result = { number: params[0], timestamp: "0x6a9b6000" };
    else if (method === "eth_call") {
      assert.equal(params[0].to, LEDGER.address);
      result = word(params[0].data === "0x313ce567" ? 6 : 2_000_000);
    } else if (method === "eth_getLogs") {
      const filter = params[0];
      assert.equal(filter.address, LEDGER.address);
      assert.ok(Number(filter.toBlock) - Number(filter.fromBlock) < 100);
      result = Number(filter.toBlock) === 2500 ? [event(), event(), event({ topics: [topic, addressTopic(zero), addressTopic(other)], logIndex: "0x1" })] : [];
    } else if (method === "eth_getTransactionReceipt") result = { transactionHash: tx, status: "0x1", blockNumber: "0x9c4", logs: [event()] };
    else throw new Error(`Unexpected RPC method: ${method}`);
    return Response.json({ jsonrpc: "2.0", id, result });
  };
  return { fetcher, calls };
}

test("ledger pins balances to the checked chain/block and paginates the complete stated window", async () => {
  const mock = fixture();
  const data = await readLedger(account, mock);
  assert.equal(data.balance, "2000000");
  assert.equal(data.block, 2500);
  assert.equal(data.fromBlock, 501);
  assert.equal(data.transfers.length, 1); // duplicate logs and unrelated accounts excluded
  assert.equal(transferLabel(data.transfers[0], account), "Shares issued");
  const ranges = mock.calls.filter(c => c.method === "eth_getLogs").map(c => c.params[0]).sort((a, b) => Number(a.fromBlock) - Number(b.fromBlock));
  assert.equal(ranges.length, 20);
  assert.equal(Number(ranges[0].fromBlock), 501);
  assert.equal(Number(ranges.at(-1).toBlock), 2500);
  for (let i = 1; i < ranges.length; i++) assert.equal(Number(ranges[i].fromBlock), Number(ranges[i - 1].toBlock) + 1);
  assert.ok(mock.calls.filter(c => c.method === "eth_call").every(c => c.params[1] === "0x9c4"));
  assert.ok(mock.calls.every(c => !/send|sign|requestAccounts/i.test(c.method)));
});

test("chain mismatch, absent contract, malformed amount and partial history fail rather than invent zero", async () => {
  await assert.rejects(readLedger(account, fixture({ eth_chainId: "0x1" })), /network/);
  await assert.rejects(readLedger(account, fixture({ eth_getCode: "0x" })), /unavailable/);
  await assert.rejects(readLedger(account, fixture({ eth_call: () => "0x0" })), /invalid/);
  await assert.rejects(readLedger(account, fixture({ eth_getLogs: () => { throw new Error("RPC offline"); } })), /offline/);
  await assert.rejects(readLedger("broken", fixture()), /valid EVM/);
});

test("log decoder rejects corrupt/wrong-block events and ignores removed or unrelated contract logs", () => {
  assert.equal(ledgerTransfers([event({ removed: true }), event({ address: other })], 2000, 2500).length, 0);
  assert.throws(() => ledgerTransfers([event({ blockNumber: "0x9c5" })], 2000, 2500), /unexpected block/);
  assert.throws(() => ledgerTransfers([event({ topics: [topic, word(2n ** 200n), addressTopic(account)] })], 2000, 2500), /invalid/);
  assert.throws(() => ledgerTransfers([event({ data: "0xzz" })], 2000, 2500), /invalid/);
});

test("receipt detail accepts only successful matching share transfers", async () => {
  const receipt = await readLedgerReceipt(tx, fixture());
  assert.equal(receipt.transfers.length, 1);
  assert.equal(receipt.hash, tx);
  await assert.rejects(readLedgerReceipt(tx, fixture({ eth_getTransactionReceipt: null })), /not yet available/);
  await assert.rejects(readLedgerReceipt(tx, fixture({ eth_getTransactionReceipt: { transactionHash: tx, status: "0x0", blockNumber: "0x9c4", logs: [] } })), /no successful/);
  await assert.rejects(readLedgerReceipt(tx, fixture({ eth_getTransactionReceipt: { transactionHash: tx, status: "0x1", blockNumber: "0x9c4", logs: [event({ address: other })] } })), /no matching/);
  await assert.rejects(readLedgerReceipt(tx, fixture({ eth_getTransactionReceipt: { transactionHash: tx, status: "0x1", blockNumber: "0x9c4", logs: [event({ transactionHash: `0x${"d".repeat(64)}` })] } })), /no matching/);
});

test("share formatting preserves integer precision and account responses are validated", () => {
  assert.equal(formatShares("9007199254740993123456"), "9,007,199,254,740,993.123456");
  assert.equal(formatShares("0"), "0.000000");
  assert.equal(sharedWalletAccount([account.toUpperCase().replace("0X", "0x")]), account);
  assert.equal(sharedWalletAccount(["invalid"]), "");
  assert.equal(sharedWalletAccount(null), "");
  assert.equal(sharedWalletAccount(account), "");
});
