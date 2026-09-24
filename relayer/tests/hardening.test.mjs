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
  return { send, writes, rows };
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
