import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBasket, constituentsWithAddresses, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { buildEvidence, decodeNavPublished, NAV_PUBLISHED_TOPIC, parseEvidence, verifyEvidence } from "../lib/xstocks/evidence.ts";
import { XSTOCKS_PRODUCT_KEY } from "../lib/xstocks/onchain.ts";
import { PROOF_DEPLOYMENT } from "../lib/xstocks/proof.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = "2026-09-23T12:26:11.456Z";
const pass = { state: "pass", detail: "" };

async function fixture() {
  const addresses = XSTOCKS_CONSTITUENTS.map((item, i) => ({ ...item, address: "0x" + String(i + 1).repeat(40) }));
  const constituents = constituentsWithAddresses(addresses.map((item) => `${item.symbol}=${item.address}`).join(","));
  const quotes = new Map(addresses.map((item, i) => [item.symbol, { ...item, priceMicros: 231250001n + BigInt(i), time: now, source: "test" }]));
  const evaluation = await evaluateBasket({ constituents, quotes, previous: null, now, maxQuoteAgeMinutes: 60 });
  const record = { navPerShareMicros: evaluation.composition.navPerShareMicros, holdingsHash: evaluation.holdingsHash, effectiveAt: "2026-09-23T12:26:11.000Z", publishedAt: now, sharesOutstandingMicros: "0" };
  return { canonical: evaluation.canonical, record };
}

function evidence(canonical, record, transactionHash = "0x" + "ab".repeat(32)) {
  return buildEvidence({ record, document: canonical, transactionHash, checks: { chain: pass, hash: pass, nav: pass }, now: new Date("2026-09-24T13:00:00Z") });
}

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
function receiptFetcher(logs, chainId = "0x7a0", blockTime = "2026-09-23T12:26:20.000Z") {
  return async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const block = { timestamp: "0x" + Math.floor(Date.parse(blockTime) / 1000).toString(16) };
    const result = method === "eth_chainId" ? chainId : method === "eth_getTransactionReceipt" ? { status: "0x1", blockNumber: "0x10", logs } : method === "eth_getBlockByNumber" ? block : null;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
}
function navLog(record, overrides = {}) {
  const seconds = Math.floor(Date.parse(record.effectiveAt) / 1000);
  return { address: PROOF_DEPLOYMENT.registry, topics: [NAV_PUBLISHED_TOPIC, overrides.productKey ?? XSTOCKS_PRODUCT_KEY, overrides.holdingsHash ?? record.holdingsHash], data: "0x" + word(overrides.nav ?? record.navPerShareMicros) + word(0) + word(seconds) };
}

test("an evidence file re-verifies offline and a one-price edit fails", async () => {
  const { canonical, record } = await fixture();
  const bundle = parseEvidence(JSON.parse(JSON.stringify(evidence(canonical, record))));
  assert.equal(bundle.document, canonical);
  const results = await verifyEvidence(bundle, { offline: true });
  assert.deepEqual(results.map((result) => [result.label, result.state]), [["Deployment", "pass"], ["Fingerprint", "pass"], ["Row arithmetic", "pass"], ["Record NAV and time", "pass"], ["X Layer record", "skip"]]);
  const edited = JSON.parse(canonical);
  edited.holdings[0].priceMicros = (BigInt(edited.holdings[0].priceMicros) + 1_000_000n).toString();
  const failed = await verifyEvidence({ ...bundle, document: JSON.stringify(edited) }, { offline: true });
  assert.equal(failed.find((result) => result.label === "Fingerprint").state, "fail");
  assert.equal(failed.find((result) => result.label === "Row arithmetic").state, "fail");
});

test("a file naming another registry or product is rejected even if its document is consistent", async () => {
  const { canonical, record } = await fixture();
  const bundle = evidence(canonical, record);
  const other = await verifyEvidence({ ...bundle, network: { ...bundle.network, registry: "0x" + "1".repeat(40) } }, { offline: true });
  assert.equal(other[0].state, "fail");
  assert.throws(() => parseEvidence({ ...bundle, kind: "something-else" }));
  assert.throws(() => parseEvidence({ ...bundle, record: { ...bundle.record, transactionHash: "0x1234" } }));
});

test("the X Layer check needs the matching NavPublished event in the transaction receipt", async () => {
  const { canonical, record } = await fixture();
  const bundle = evidence(canonical, record);
  const last = async (logs, chainId) => (await verifyEvidence(bundle, { fetcher: receiptFetcher(logs, chainId) })).at(-1);
  assert.equal((await last([navLog(record)])).state, "pass");
  assert.equal((await last([navLog(record, { nav: "1" })])).state, "fail");
  assert.equal((await last([navLog(record, { holdingsHash: "0x" + "9".repeat(64) })])).state, "fail");
  assert.equal((await last([navLog(record, { productKey: "0x" + "7".repeat(64) })])).state, "fail");
  assert.equal((await last([{ ...navLog(record), address: "0x" + "2".repeat(40) }])).state, "fail");
  assert.equal((await last([navLog(record)], "0x1")).state, "fail");
  // A record written in a block five minutes before the time it claims is refused.
  const early = (await verifyEvidence(bundle, { fetcher: receiptFetcher([navLog(record)], "0x7a0", "2026-09-23T12:21:11.000Z") })).at(-1);
  assert.equal(early.state, "fail");
  assert.match(early.detail, /later than the block/);
});

test("a real NavPublished log from the X Layer Testnet registry decodes to its fields", () => {
  // Logged by the registry on X Layer Testnet for a legacy paper product that shares it.
  const event = decodeNavPublished({
    topics: [NAV_PUBLISHED_TOPIC, "0x7fcc76152f4a361bc8c8d76a01419fa01766d2cc39611b405fd17f374ac6ef17", "0x8587dc185b356f50b6faa41d50c84b4fb5258c5f2fced16f01e2d90369a5cae7"],
    data: "0x000000000000000000000000000000000000000000000000000000003937a75700000000000000000000000000000000000000000000000000005af3107a4000000000000000000000000000000000000000000000000000000000006ab5229a",
  });
  assert.equal(event.navPerShareMicros, "959948631");
  assert.equal(event.sharesOutstandingMicros, "100000000000000");
  assert.equal(event.effectiveAt, new Date(0x6ab5229a * 1000).toISOString());
  assert.notEqual(event.productKey, XSTOCKS_PRODUCT_KEY);
  assert.equal(decodeNavPublished({ topics: ["0x" + "0".repeat(64), "0x", "0x"], data: "0x" }), null);
});

test("the command-line check passes a fresh file and fails an edited one", async () => {
  const { canonical, record } = await fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "ganymede-evidence-"));
  const run = (bundle) => {
    const file = path.join(directory, `evidence-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(bundle, null, 2));
    return spawnSync(process.execPath, ["--experimental-loader", "./tests/cloudflare-loader.mjs", "scripts/verify-evidence.mjs", file, "--offline"], { cwd: root, encoding: "utf8" });
  };
  const bundle = evidence(canonical, record);
  const ok = run(bundle);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Result: PASS \(document checks only\)/);
  const edited = JSON.parse(canonical);
  edited.holdings[1].valueMicros = (BigInt(edited.holdings[1].valueMicros) + 1n).toString();
  const failed = run({ ...bundle, document: JSON.stringify(edited) });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /\[FAIL\] Row arithmetic/);
  assert.match(failed.stdout, /Result: FAIL/);
});
