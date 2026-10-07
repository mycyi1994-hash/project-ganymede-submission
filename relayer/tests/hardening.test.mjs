import test from "node:test";
import assert from "node:assert/strict";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { Submitter } from "../src/submitter.ts";
import { FUND_SHARE_ABI } from "../src/contracts.ts";
import worker from "../src/index.ts";

const INVESTOR = "0x" + "c".repeat(40);
const mint = (overrides = {}) => ({ entityType: "subscription", entityId: "sub_1", action: "mint_subscription", productId: "core-20", walletAddress: INVESTOR, sharesMicros: "1000000", effectiveAt: "2026-09-24T00:00:00Z", ...overrides });

function harness(publicOverrides = {}, walletWrite = async () => "0x" + "b".repeat(64)) {
  const rows = new Map();
  const db = { prepare: () => ({ bind: (...values) => ({
    first: async () => rows.get(values[0]) ?? null,
    run: async () => { const [key, status, tx_hash, block_number, error, note, updated_at] = values; rows.set(key, { key, status, tx_hash, block_number, error, note, updated_at }); },
  }) }) };
  const publicClient = { simulateContract: async () => ({ request: {} }), getTransactionCount: async () => 7, waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 1n }), ...publicOverrides };
  const writes = [];
  const submitter = new Submitter({}, { DB: db, FUND_SHARE_ADDRESS: "0x" + "1".repeat(40), NAV_REGISTRY_ADDRESS: "0x" + "2".repeat(40) });
  submitter.clients = () => ({ account: { address: "0x" + "3".repeat(40) }, publicClient, walletClient: { writeContract: async (args) => { writes.push(args); return walletWrite(args); } } });
  const send = async (request) => {
    const response = await submitter.fetch(new Request("https://test/submit", { method: "POST", body: JSON.stringify(request) }));
    return { status: response.status, body: await response.json() };
  };
  return { send, writes, rows, submitter };
}

function revert(errorName) {
  return new BaseError("Simulation reverted", { cause: new ContractFunctionRevertedError({ abi: FUND_SHARE_ABI, functionName: "settleSubscription", data: encodeErrorResult({ abi: FUND_SHARE_ABI, errorName }) }) });
}

test("malformed amounts are a 400 the app will not retry, not a 502", async () => {
  const h = harness();
  for (const sharesMicros of ["2.5", "", "-1"]) {
    const result = await h.send(mint({ sharesMicros }));
    assert.equal(result.status, 400, sharesMicros);
    assert.equal(result.body.code, "invalid_request");
  }
  assert.equal(h.writes.length, 0);
});

test("only the product on the share ledger can be minted or burned", async () => {
  const h = harness();
  const refused = await h.send(mint({ productId: "next-frontier" }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "product_not_tokenized");
  assert.equal((await h.send(mint())).status, 200);
  assert.equal(h.writes.length, 1);
});

test("a mint that already landed is confirmed even when the ledger reverts for another reason first", async () => {
  let checked;
  const h = harness({
    simulateContract: async () => { throw revert("TransferRestricted"); },
    readContract: async (args) => { checked = args; return true; },
  });
  const result = await h.send(mint());
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "confirmed");
  assert.equal(checked.functionName, "processedSettlement");
  assert.equal(h.writes.length, 0);
});

test("a failed send whose nonce resync also fails does not leave a nonce gap", async () => {
  let chainNonce = 7;
  let failNext = true;
  const h = harness(
    { getTransactionCount: async () => { if (failNext) throw new Error("RPC 429 while resyncing"); return chainNonce; } },
    async () => { if (failNext) throw new Error("nonce too low at https://rpc.provider.test/v2/SECRET-KEY"); return "0x" + "d".repeat(64); },
  );
  // Prime the counter at the chain's nonce, then fail both the send and the resync.
  failNext = false;
  await h.send(mint({ entityId: "sub_prime" }));
  chainNonce = 8;
  failNext = true;
  const writesBefore = h.writes.length;
  const failed = await h.send(mint({ entityId: "sub_2" }));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(failed.body), /https?:/);
  failNext = false;
  await h.send(mint({ entityId: "sub_3" }));
  const retried = h.writes.slice(writesBefore);
  assert.equal(retried.at(-1).nonce, 8, "the next send reads the chain's pending nonce again");
});

test("health reports an RPC on the wrong network as not ready and never echoes the RPC URL", async (t) => {
  const env = { SETTLEMENT_CHAIN: "xlayer-testnet", SETTLEMENT_RPC_URL: "https://rpc.provider.test/v2/SECRET-KEY" };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { id, method } = JSON.parse(init.body);
    return Response.json({ jsonrpc: "2.0", id, result: method === "eth_chainId" ? "0x1" : "0x10" });
  });
  const wrong = await (await worker.fetch(new Request("https://relayer.test/v1/health"), env)).json();
  assert.equal(wrong.ready, false);
  assert.match(wrong.error, /chain 1, expected 1952/);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("connect ECONNREFUSED https://rpc.provider.test/v2/SECRET-KEY"); });
  const down = await worker.fetch(new Request("https://relayer.test/v1/health"), env);
  assert.equal(down.status, 503);
  assert.doesNotMatch(await down.text(), /SECRET|https?:/);
});

// On 6 October 2026 X Layer Testnet stalled; the transactions sent meanwhile never reached the chain,
// some nodes kept counting them, and every later send waited behind the gap (nonce 9751, nodes at 10701).
const NETWORK_FEES = { maxFeePerGas: 24_000_001n, maxPriorityFeePerGas: 1n };

test("transactions a stall dropped are sent again from the chain's own count, outbidding copies nodes still count", async () => {
  let latest = 9751;
  const h = harness({
    getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? latest : 10701,
    estimateFeesPerGas: async () => NETWORK_FEES,
    waitForTransactionReceipt: async () => { latest += 1; return { status: "success", blockNumber: 1n }; },
  });
  assert.equal((await h.send(mint({ entityId: "sub_a" }))).body.status, "confirmed");
  assert.equal((await h.send(mint({ entityId: "sub_b" }))).body.status, "confirmed");
  assert.deepEqual(h.writes.map((write) => write.nonce), [9751, 9752]);
  for (const write of h.writes) {
    assert.equal(write.maxPriorityFeePerGas, 2_000_000n, "double the least tip, past the 10% a node needs to replace its copy");
    assert.equal(write.maxFeePerGas, 2n * NETWORK_FEES.maxFeePerGas + 2_000_000n);
  }
});

test("when the oldest transaction ahead of the chain waits past the stall window, the queue sends again from it, paying more each time", async () => {
  let clock = 0;
  let pending = 7;
  const h = harness({
    getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : pending,
    estimateFeesPerGas: async () => NETWORK_FEES,
    waitForTransactionReceipt: async () => { throw new Error("timed out"); },
  });
  h.submitter.now = () => clock;
  await h.send(mint({ entityId: "sub_1" }));
  pending = 8;
  clock += 30_000;
  await h.send(mint({ entityId: "sub_2" }));
  clock += 100_000;
  pending = 9;
  await h.send(mint({ entityId: "sub_3" }));
  clock += 130_000;
  await h.send(mint({ entityId: "sub_4" }));
  assert.deepEqual(h.writes.map((write) => write.nonce), [7, 8, 7, 7], "a slow transaction is waited for; a lost one is sent again");
  assert.equal(h.writes[0].maxFeePerGas, undefined);
  assert.equal(h.writes[1].maxFeePerGas, undefined, "within the window the next nonce pays the network's own fees");
  assert.equal(h.writes[2].maxPriorityFeePerGas, 2_000_000n);
  assert.equal(h.writes[3].maxPriorityFeePerGas, 4_000_000n);
});

// At 02:00 UTC on 7 October 2026 the USTX record missed its cycle: the object, evicted since the last
// cycle, had forgotten that nodes still held copies up to nonce 10715, read the pending count from a node
// that held none, and its send at 9938 reached one that did ("replacement transaction underpriced").
test("a send refused by a node that holds a copy is sent again at its nonce, paying double, within the same request", async () => {
  let latest = 9938;
  const stored = new Map();
  const h = harness({
    getTransactionCount: async () => latest,
    estimateFeesPerGas: async () => NETWORK_FEES,
    waitForTransactionReceipt: async () => { latest += 1; return { status: "success", blockNumber: 1n }; },
  }, async (args) => {
    if (args.maxPriorityFeePerGas === undefined) throw new Error("replacement transaction underpriced");
    return "0x" + "e".repeat(64);
  });
  h.submitter.state = { storage: { get: async (key) => stored.get(key), put: async (key, value) => { stored.set(key, value); } } };
  const result = await h.send(mint({ entityId: "sub_refused" }));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "confirmed");
  assert.deepEqual(h.writes.map((write) => [write.nonce, write.maxPriorityFeePerGas]), [[9938, undefined], [9938, 2_000_000n]]);
  assert.equal(stored.get("outbidBelow"), 9939, "the nonce a node held a copy at is remembered");
});

test("an evicted object still outbids the nonces it stored, and three refusals are the caller's", async () => {
  const stored = new Map([["outbidBelow", 10715]]);
  const h = harness({
    getTransactionCount: async () => 9938,
    estimateFeesPerGas: async () => NETWORK_FEES,
  }, async () => { throw new Error("replacement transaction underpriced"); });
  h.submitter.state = { storage: { get: async (key) => stored.get(key), put: async (key, value) => { stored.set(key, value); } } };
  const result = await h.send(mint({ entityId: "sub_held" }));
  assert.equal(result.status, 502);
  assert.deepEqual(h.writes.map((write) => [write.nonce, write.maxPriorityFeePerGas]), [[9938, 2_000_000n], [9938, 4_000_000n], [9938, 8_000_000n]],
    "every attempt outbids from the stored floor, doubling at the same nonce");
  assert.equal(stored.get("outbidBelow"), 10715);
});

test("a queue whose transactions land never outbids", async () => {
  let latest = 7;
  const h = harness({
    getTransactionCount: async () => latest,
    estimateFeesPerGas: async () => { throw new Error("fees are not read when nothing is outbid"); },
    waitForTransactionReceipt: async () => { latest += 1; return { status: "success", blockNumber: 1n }; },
  });
  for (const entityId of ["sub_x", "sub_y", "sub_z"]) assert.equal((await h.send(mint({ entityId }))).status, 200);
  assert.deepEqual(h.writes.map((write) => [write.nonce, write.maxFeePerGas]), [[7, undefined], [8, undefined], [9, undefined]]);
});
