import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TRANSACTION_NEVER_ARRIVED, waitForFundReceipt } from "../lib/xstocks/fund.ts";
import { sendWalletTransaction, walletFee } from "../lib/xstocks/wallet-send.ts";

const FROM = "0x00000000000000000000000000000000000a11ce";
const CALL = { to: "0xf07535080f74e8b0f571e58dfa600f47e72ea9bf", data: "0x4e71d92d" };

/** The public RPC: gas price 0.02 gwei, two confirmed transactions, an estimate of 50,000 gas. */
function publicRpc(change = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (change[method]) return change[method](params);
    if (method === "eth_gasPrice") return "0x1312d00";
    if (method === "eth_getTransactionCount") { assert.deepEqual(params, [FROM, "latest"]); return "0x2"; }
    if (method === "eth_estimateGas") return "0xc350";
    if (method === "eth_sendRawTransaction") return keccak256(params[0]);
    throw new Error(`unexpected ${method}`);
  };
  return { rpc, calls };
}

/** A wallet that answers each method with `answers[method]` (a value, or a function that may throw). */
function wallet(answers) {
  const requests = [];
  const provider = { request: async ({ method, params }) => {
    requests.push({ method, params });
    const answer = answers[method];
    if (answer === undefined) throw Object.assign(new Error("The method does not exist / is not available."), { code: -32601 });
    return typeof answer === "function" ? answer(params) : answer;
  } };
  return { provider, requests };
}

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const sign = async ([tx]) => signer.signTransaction({ to: tx.to, data: tx.data, chainId: Number(tx.chainId), gas: BigInt(tx.gas), gasPrice: BigInt(tx.gasPrice), nonce: Number(tx.nonce), value: 0n, type: "legacy" });

test("the app names twice the network's gas price, the gas with a margin and the confirmed nonce", async () => {
  assert.deepEqual(await walletFee(FROM, CALL, publicRpc().rpc), { gasPrice: "0x2625a00", gas: "0x11170", nonce: "0x2" });
  // An estimate that fails leaves the gas to the wallet.
  assert.equal((await walletFee(FROM, CALL, publicRpc({ eth_estimateGas: () => { throw new Error("header not found"); } }).rpc)).gas, null);
});

test("a wallet that signs has its transaction sent by the app to the public RPC", async () => {
  const { rpc, calls } = publicRpc();
  const { provider, requests } = wallet({ eth_signTransaction: sign });
  const hash = await sendWalletTransaction(provider, FROM, CALL, rpc);
  assert.deepEqual(requests.map(request => request.method), ["eth_signTransaction"]);
  assert.deepEqual(requests[0].params[0], { from: FROM, to: CALL.to, data: CALL.data, chainId: "0x7a0", gas: "0x11170", gasPrice: "0x2625a00", nonce: "0x2", value: "0x0" });
  const sent = calls.find(call => call.method === "eth_sendRawTransaction").params[0];
  assert.equal(hash, keccak256(sent));
  // One the wallet also sent is already known to the node: the same hash.
  const known = publicRpc({ eth_sendRawTransaction: () => { throw new Error("already known"); } });
  assert.equal(await sendWalletTransaction(wallet({ eth_signTransaction: sign }).provider, FROM, CALL, known.rpc), hash);
  // geth's { raw, tx } form.
  assert.equal(await sendWalletTransaction(wallet({ eth_signTransaction: async params => ({ raw: await sign(params) }) }).provider, FROM, CALL, rpc), hash);
  // A refused raw transaction is the customer's error, not a second prompt.
  const refused = wallet({ eth_signTransaction: sign });
  await assert.rejects(sendWalletTransaction(refused.provider, FROM, CALL, publicRpc({ eth_sendRawTransaction: () => { throw new Error("nonce too low"); } }).rpc), /nonce too low/);
  assert.equal(refused.requests.length, 1);
});

test("a wallet that cannot only sign is asked to send, with the app's fee", async () => {
  const { provider, requests } = wallet({ eth_sendTransaction: `0x${"cd".repeat(32)}` });
  assert.equal(await sendWalletTransaction(provider, FROM, CALL, publicRpc().rpc), `0x${"cd".repeat(32)}`);
  assert.deepEqual(requests.map(request => request.method), ["eth_signTransaction", "eth_sendTransaction"]);
  assert.deepEqual(requests[1].params[0], { from: FROM, to: CALL.to, data: CALL.data, gasPrice: "0x2625a00", nonce: "0x2", gas: "0x11170" });
  // A wallet that returns something other than a signed transaction is asked to send too.
  const odd = wallet({ eth_signTransaction: "0x1234", eth_sendTransaction: `0x${"cd".repeat(32)}` });
  await sendWalletTransaction(odd.provider, FROM, CALL, publicRpc().rpc);
  assert.equal(odd.requests[1].method, "eth_sendTransaction");
  // No estimate: no signing request, the wallet estimates the gas.
  const unestimated = wallet({ eth_sendTransaction: `0x${"cd".repeat(32)}` });
  await sendWalletTransaction(unestimated.provider, FROM, CALL, publicRpc({ eth_estimateGas: () => { throw new Error("header not found"); } }).rpc);
  assert.deepEqual(unestimated.requests.map(request => [request.method, request.params[0].gas]), [["eth_sendTransaction", undefined]]);
  // The public RPC unreachable: the wallet sends as before.
  const offline = wallet({ eth_sendTransaction: `0x${"cd".repeat(32)}` });
  await sendWalletTransaction(offline.provider, FROM, CALL, async () => { throw new Error("X Layer Testnet is temporarily unavailable."); });
  assert.deepEqual(offline.requests[0].params[0], { from: FROM, to: CALL.to, data: CALL.data });
  await assert.rejects(sendWalletTransaction(wallet({ eth_sendTransaction: null }).provider, FROM, CALL, publicRpc().rpc), /did not return a transaction/);
});

test("a cancellation in the wallet stops there", async () => {
  const { provider, requests } = wallet({ eth_signTransaction: () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }, eth_sendTransaction: "0x" });
  await assert.rejects(sendWalletTransaction(provider, FROM, CALL, publicRpc().rpc), { code: 4001 });
  assert.equal(requests.length, 1);
});

const HASH = `0x${"ab".repeat(32)}`;

test("a transaction no node has heard of is reported as never arriving, not waited for", async () => {
  const unknown = async (method) => (method === "eth_getTransactionReceipt" || method === "eth_getTransactionByHash" ? null : undefined);
  await assert.rejects(waitForFundReceipt(HASH, { rpc: unknown, intervalMs: 1, unseenMs: 20 }), { message: TRANSACTION_NEVER_ARRIVED });
  // Known to a node but not yet mined: waited for until the usual timeout.
  const pending = async (method) => (method === "eth_getTransactionByHash" ? { hash: HASH } : null);
  await assert.rejects(waitForFundReceipt(HASH, { rpc: pending, intervalMs: 1, unseenMs: 5, timeoutMs: 40 }), /has not confirmed the transaction yet/);
  // A failed lookup proves nothing.
  const failing = async (method) => { if (method === "eth_getTransactionByHash") throw new Error("timeout"); return null; };
  await assert.rejects(waitForFundReceipt(HASH, { rpc: failing, intervalMs: 1, unseenMs: 5, timeoutMs: 40 }), /has not confirmed the transaction yet/);
  // Mined: the receipt, however long the lookup said nothing.
  let polls = 0;
  const mined = async (method) => (method === "eth_getTransactionReceipt" ? (++polls > 2 ? { blockNumber: "0x2a", status: "0x1", logs: [] } : null) : null);
  assert.equal((await waitForFundReceipt(HASH, { rpc: mined, intervalMs: 1, unseenMs: 60_000 })).block, 42);
});
