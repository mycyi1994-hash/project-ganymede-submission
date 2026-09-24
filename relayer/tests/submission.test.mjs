import test from "node:test";
import assert from "node:assert/strict";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { Submitter } from "../src/submitter.ts";
import { NAV_REGISTRY_ABI, classifyRevert } from "../src/contracts.ts";
import { SubmissionQueue, navPayloadHash } from "../src/publication-evidence.ts";

const request = { entityType: "nav", entityId: "example:1", action: "publish_nav", productId: "us-tech-x", navPerShareMicros: "100000000", holdingsHash: "0x" + "a".repeat(64), effectiveAt: "2026-09-24T00:00:00Z" };
const tx = "0x" + "b".repeat(64);
function harness(overrides = {}, initial = null) {
  let row = initial; const writes = []; let broadcasts = 0;
  const db = { prepare: () => ({ bind: (...values) => ({
    first: async () => row,
    run: async () => { const [key, status, tx_hash, block_number, error, note, updated_at] = values; row = { key, status, tx_hash, block_number, error, note, updated_at }; writes.push({ ...row }); },
  }) }) };
  const publicClient = { simulateContract: async () => ({ request: {} }), getTransactionCount: async () => 0, waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 1n }), ...overrides };
  const submitter = new Submitter({}, { DB: db, NAV_REGISTRY_ADDRESS: "0x" + "1".repeat(40) });
  submitter.clients = () => ({ account: { address: "0x" + "2".repeat(40) }, publicClient, walletClient: { writeContract: async () => { broadcasts++; return tx; } } });
  return { submitter, writes, broadcasts: () => broadcasts, run: () => submitter.fetch(new Request("https://test/submit", { method: "POST", body: JSON.stringify(request) })) };
}
function stale() {
  return new BaseError("Simulation reverted", { cause: new ContractFunctionRevertedError({ abi: NAV_REGISTRY_ABI, functionName: "publishNav", data: encodeErrorResult({ abi: NAV_REGISTRY_ABI, errorName: "StalePublication" }) }) });
}

test("stale publication is confirmed only with exact historical payload evidence", async () => {
  assert.equal(classifyRevert("StalePublication").kind, "client");
  for (const published of [false, true]) {
    let checked;
    const h = harness({ simulateContract: async () => { throw stale(); }, readContract: async args => { checked = args; return published; } });
    const response = await h.run();
    assert.equal(response.status, published ? 200 : 409);
    assert.equal(h.writes.at(-1).status, published ? "confirmed" : "failed");
    assert.equal(checked.functionName, "publishedPayload");
    assert.equal(h.broadcasts(), 0);
  }
});

test("a receipt timeout persists the hash and retry reconciles without rebroadcast", async () => {
  const h = harness({ waitForTransactionReceipt: async () => { throw new Error("timeout"); }, getTransactionReceipt: async () => ({ status: "success", blockNumber: 42n }) });
  assert.equal((await (await h.run()).json()).status, "submitted");
  assert.equal(h.writes[0].tx_hash, tx);
  assert.equal(h.writes[0].status, "submitted");
  assert.equal((await (await h.run()).json()).status, "confirmed");
  assert.equal(h.broadcasts(), 1);
});

test("an unreadable receipt stays submitted rather than generating another transaction", async () => {
  const h = harness({ waitForTransactionReceipt: async () => { throw new Error("timeout"); }, getTransactionReceipt: async () => { throw new Error("RPC unavailable"); } });
  await h.run(); await h.run(); assert.equal(h.broadcasts(), 1); assert.equal(h.writes.at(-1).status, "submitted");
});

test("concurrent duplicate requests broadcast once", async () => {
  const h = harness();
  const responses = await Promise.all([h.run(), h.run(), h.run()]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(h.broadcasts(), 1);
});

test("submission queue recovers after failure and payload hash includes every field", async () => {
  const queue = new SubmissionQueue();
  const results = await Promise.allSettled([queue.run(async () => { throw new Error("first failed"); }), queue.run(async () => "next")]);
  assert.equal(results[1].value, "next");
  const args = ["0x" + "1".repeat(64), 100n, 0n, "0x" + "a".repeat(64), 1000n];
  for (const index of [1, 2, 4]) { const changed = [...args]; changed[index]++; assert.notEqual(navPayloadHash(args), navPayloadHash(changed)); }
});
