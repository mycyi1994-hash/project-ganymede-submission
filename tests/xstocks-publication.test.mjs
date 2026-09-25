import assert from "node:assert/strict";
import test from "node:test";
import { SettlementClient } from "../lib/engine/settlement.ts";
import { sha256Hex } from "../lib/engine/fixed.ts";
import { fetchXStockQuotes, MAX_COOLDOWN_MS } from "../lib/xstocks/prices.ts";
import { runXStocksCycle, STATE_CONFIRMED, STATE_DOCUMENT_PREFIX, STATE_HISTORY, STATE_LATEST, STATE_REBALANCE } from "../lib/xstocks/cycle.ts";
import { XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";

const credentials = { apiKey: "key", secret: "secret", passphrase: "pass", baseUrl: "https://onchainos.test" };
const addressesOf = (overrides = {}) => XSTOCKS_CONSTITUENTS.map((item, index) => ({ ...item, address: overrides[item.symbol] ?? `0x${String(index + 1).repeat(40)}` }));
const configured = (addresses) => ({ OKX_API_KEY: "k", OKX_API_SECRET: "s", OKX_API_PASSPHRASE: "p", XSTOCKS_ADDRESSES: addresses.map((item) => `${item.symbol}=${item.address}`).join(",") });

function memoryRepo() {
  const rows = new Map();
  return {
    rows,
    async getState(key) { return rows.has(key) ? { value: rows.get(key) } : null; },
    async setState(key, value) { rows.set(key, value); },
    async saveSettlement() {},
    async deleteStatesWithPrefix(prefix, keep) { for (const key of [...rows.keys()]) if (key.startsWith(prefix) && !keep.includes(key)) rows.delete(key); },
  };
}

// Quotes are stamped just before each cycle time used below, never with the wall clock: a quote later
// than the cycle is rejected as invalid, and one more than ten minutes older blocks the NAV.
const QUOTE_TIME = "2026-09-24T09:59:00.000Z";

function pricesFor(addresses, price = "100", time = QUOTE_TIME) {
  return async () => Response.json({ code: "0", data: addresses.map((item) => ({ chainIndex: "196", tokenContractAddress: item.address, price, time: typeof time === "function" ? time() : time })) });
}

function settlementRecorder(outcome) {
  const requests = [];
  return { requests, async settle(request) { requests.push(request); return { id: "stl", payloadHash: "0x", blockNumber: null, ...outcome(request, requests) }; } };
}

const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();

test("a publication whose outcome was unknown is asked about again with the same key and recorded as confirmed", async (t) => {
  const repo = memoryRepo();
  const addresses = addressesOf();
  const start = "2026-09-24T10:00:00.000Z";
  // Prices stamped at each cycle's own time, as OnchainOS stamps the response, so each record's time is its cycle's.
  let quoteTime = start;
  t.mock.method(globalThis, "fetch", pricesFor(addresses, "100", () => quoteTime));
  let answer = { status: "queued", txHash: null, error: "Settlement relayer no answer in time; the result will be checked again" };
  const settlement = settlementRecorder(() => answer);
  await runXStocksCycle(configured(addresses), repo, settlement, start);
  const [first] = JSON.parse(repo.rows.get(STATE_HISTORY));
  assert.equal(first.status, "queued");
  assert.equal(repo.rows.has(STATE_CONFIRMED), false);

  answer = { status: "confirmed", txHash: `0x${"ab".repeat(32)}`, error: null };
  quoteTime = at(start, 300);
  await runXStocksCycle(configured(addresses), repo, settlement, at(start, 300));
  const asked = settlement.requests.filter((request) => request.entityId === `us-tech-x:${start}`);
  assert.equal(asked.length, 2, "the unresolved publication was asked about again");
  assert.deepEqual(asked[1], asked[0], "with the identical request, so the relayer's idempotency key matches");
  const reconciled = JSON.parse(repo.rows.get(STATE_HISTORY)).find((entry) => entry.asOf === start);
  assert.equal(reconciled.status, "confirmed");
  assert.equal(reconciled.txHash, `0x${"ab".repeat(32)}`);
  assert.equal(JSON.parse(repo.rows.get(`${STATE_DOCUMENT_PREFIX}${reconciled.holdingsHash}`)).status, "confirmed");
  assert.equal(JSON.parse(repo.rows.get(STATE_CONFIRMED)).asOf, at(start, 300), "the newer confirmed publication stays the confirmed record");
});

test("a relayer 5xx or silence is retryable, a 409 is final, and error text never carries a URL", async (t) => {
  const client = new SettlementClient({ SETTLEMENT_RELAYER_URL: "https://relayer.test", SETTLEMENT_RELAYER_TOKEN: "token" });
  const request = { entityType: "nav", entityId: "us-tech-x:2026-09-24T10:00:00.000Z", action: "publish_nav", productId: "us-tech-x", navPerShareMicros: "1", holdingsHash: `0x${"a".repeat(64)}`, effectiveAt: "2026-09-24T10:00:00.000Z" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "RPC https://rpc.provider.test/v2/SECRET-KEY failed", code: "submission_failed" }, { status: 502 }));
  const transient = await client.settle(request);
  assert.equal(transient.status, "queued");
  assert.doesNotMatch(transient.error, /SECRET|https?:/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "An equal or newer snapshot exists", code: "stale_publication" }, { status: 409 }));
  assert.equal((await client.settle(request)).status, "failed");
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
  const silent = await client.settle(request);
  assert.equal(silent.status, "queued");
  assert.match(silent.error, /checked again/);
});

test("a huge Retry-After pauses pricing for at most an hour, and an older unbounded wait is ignored", async (t) => {
  const constituents = [{ symbol: "AAPLx", address: `0x${"1".repeat(40)}` }];
  for (const retryAfter of ["31536000", "Wed, 21 Oct 2099 07:28:00 GMT"]) {
    const before = Date.now();
    const result = await fetchXStockQuotes(credentials, constituents, async () => new Response("slow down", { status: 429, headers: { "Retry-After": retryAfter } }));
    assert.ok(Date.parse(result.retryAt) - before <= MAX_COOLDOWN_MS + 1000, `${retryAfter} -> ${result.retryAt}`);
  }
  const repo = memoryRepo();
  const addresses = addressesOf();
  repo.rows.set(STATE_LATEST, JSON.stringify({ evaluatedAt: "2026-09-24T10:00:00.000Z", retryAt: "2099-10-21T07:28:00.000Z", status: "awaiting_prices", blockers: [], warnings: [] }));
  let priced = 0;
  // Counts price requests only; the cycle also reads wallet shares from X Layer Testnet.
  t.mock.method(globalThis, "fetch", async (...args) => { if (!String(args[0]).includes("testrpc.xlayer.tech")) priced += 1; return pricesFor(addresses)(...args); });
  const result = await runXStocksCycle(configured(addresses), repo, settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null })), "2026-09-24T10:05:00.000Z");
  assert.equal(priced, 1, "the far-future wait did not stop pricing");
  assert.equal(result.navsPublished, 1);
});

test("refused provider access is reported as such, with a bounded pause", async () => {
  const before = Date.now();
  const result = await fetchXStockQuotes(credentials, [{ symbol: "AAPLx", address: `0x${"1".repeat(40)}` }], async () => new Response("forbidden", { status: 403 }));
  assert.match(result.warnings[0], /access refused/);
  assert.ok(Date.parse(result.retryAt) - before <= 10 * 60_000 + 1000);
});

test("two constituents configured with one address block publication instead of publishing an unverifiable document", async (t) => {
  const shared = `0x${"7".repeat(40)}`;
  const addresses = addressesOf({ AAPLx: shared, MSFTx: shared });
  t.mock.method(globalThis, "fetch", pricesFor(addresses));
  const repo = memoryRepo();
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  const result = await runXStocksCycle(configured(addresses), repo, settlement, "2026-09-24T10:00:00.000Z");
  assert.equal(result.navsPublished, 0);
  assert.equal(settlement.requests.length, 0);
  assert.match(JSON.parse(repo.rows.get(STATE_LATEST)).blockers.join(" "), /same address/);
});

test("a corrected address re-fixes at the prevailing NAV and publishes rebalance evidence anyone can recompute", async (t) => {
  const repo = memoryRepo();
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  const original = addressesOf();
  t.mock.method(globalThis, "fetch", pricesFor(original, "100"));
  await runXStocksCycle(configured(original), repo, settlement, "2026-09-24T10:00:00.000Z");
  t.mock.method(globalThis, "fetch", pricesFor(original, "110", "2026-09-24T10:04:00.000Z"));
  await runXStocksCycle(configured(original), repo, settlement, "2026-09-24T10:05:00.000Z");
  const navBefore = BigInt(JSON.parse(repo.rows.get(STATE_HISTORY))[0].navPerShareMicros);

  const corrected = addressesOf({ TSLAx: `0x${"9aBcDe".repeat(6)}9aBc` });
  t.mock.method(globalThis, "fetch", pricesFor(corrected, "110", "2026-09-24T10:09:00.000Z"));
  await runXStocksCycle(configured(corrected), repo, settlement, "2026-09-24T10:10:00.000Z");
  const navAfter = BigInt(JSON.parse(repo.rows.get(STATE_HISTORY))[0].navPerShareMicros);
  assert.ok(navAfter <= navBefore && navBefore - navAfter < 10n, `NAV jumped from ${navBefore} to ${navAfter}`);

  const evidence = JSON.parse(repo.rows.get(STATE_REBALANCE));
  assert.equal(evidence.status, "confirmed");
  assert.equal(await sha256Hex(evidence.canonical), evidence.holdingsHash);
  const published = settlement.requests.find((request) => request.action === "publish_rebalance");
  assert.equal(published.holdingsHash, evidence.holdingsHash);
  const holdings = JSON.parse(evidence.canonical).holdings;
  assert.equal(holdings.find((holding) => holding.symbol === "TSLAx").address, `0x${"9abcde".repeat(6)}9abc`, "the corrected address, lowercase");
  for (const holding of holdings) assert.equal(holding.address, holding.address.toLowerCase());
});

test("stored report documents are pruned to the listed publications and the confirmed one", async (t) => {
  const repo = memoryRepo();
  const addresses = addressesOf();
  const start = "2026-09-24T10:00:00.000Z";
  let cycle = 0;
  t.mock.method(globalThis, "fetch", pricesFor(addresses, "100", () => at(start, cycle * 300)));
  const settlement = settlementRecorder(() => ({ status: cycle === 0 ? "confirmed" : "failed", txHash: cycle === 0 ? "0x1" : null, error: cycle === 0 ? null : "rejected" }));
  for (; cycle < 20; cycle += 1) await runXStocksCycle(configured(addresses), repo, settlement, at(start, cycle * 300));
  const documents = [...repo.rows.keys()].filter((key) => key.startsWith(STATE_DOCUMENT_PREFIX));
  assert.ok(documents.length <= 13, `${documents.length} documents kept`);
  const confirmed = JSON.parse(repo.rows.get(STATE_CONFIRMED));
  assert.equal(confirmed.asOf, start);
  assert.ok(repo.rows.has(`${STATE_DOCUMENT_PREFIX}${confirmed.holdingsHash}`), "the confirmed record's document is kept after rotating out of history");
});

test("prices no newer than the last record are not sent, and each publication keeps its calculation time", async (t) => {
  const repo = memoryRepo();
  const addresses = addressesOf();
  const start = "2026-09-24T10:00:00.000Z";
  t.mock.method(globalThis, "fetch", pricesFor(addresses, "100", start));
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  await runXStocksCycle(configured(addresses), repo, settlement, start);
  const [first] = JSON.parse(repo.rows.get(STATE_HISTORY));
  assert.equal(first.asOf, start);
  assert.equal(first.calculatedAt, start);
  const navsBefore = settlement.requests.filter((request) => request.action === "publish_nav").length;
  // The source returns the same prices five minutes later: the registry would refuse an earlier or equal time.
  const result = await runXStocksCycle(configured(addresses), repo, settlement, at(start, 300));
  assert.equal(settlement.requests.filter((request) => request.action === "publish_nav").length, navsBefore);
  assert.ok(result.warnings.some((warning) => /No price is newer than the last NAV record/.test(warning)));
});

test("a price answered after rate-limit retries is valued at the time it arrived", async (t) => {
  // The request is limited twice and answered two minutes into the cycle, stamped then.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-24T10:00:00.000Z") });
  const repo = memoryRepo();
  const addresses = addressesOf();
  let asks = 0;
  t.mock.method(globalThis, "fetch", async (...args) => {
    if (String(args[0]).includes("testrpc.xlayer.tech")) return pricesFor(addresses)(...args);
    asks += 1;
    if (asks < 3) return new Response("error code: 1015", { status: 429 });
    return pricesFor(addresses, "100", new Date().toISOString())(...args);
  });
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  await runXStocksCycle(configured(addresses), repo, settlement, "2026-09-24T10:00:00.000Z", { wait: async (ms) => { t.mock.timers.tick(ms); } });
  const [first] = JSON.parse(repo.rows.get(STATE_HISTORY));
  assert.equal(asks, 3);
  assert.equal(first.status, "confirmed");
  assert.equal(first.calculatedAt, "2026-09-24T10:02:00.000Z");
  assert.equal(first.asOf, "2026-09-24T10:02:00.000Z");
});

test("prices quoted more than a minute apart are not recorded, with the reason", async (t) => {
  const addresses = addressesOf();
  const spread = (index) => index === 0 ? "2026-09-24T09:57:00.000Z" : "2026-09-24T09:59:30.000Z";
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "0", data: addresses.map((item, index) => ({ chainIndex: "196", tokenContractAddress: item.address, price: "100", time: spread(index) })) }));
  const repo = memoryRepo();
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  const result = await runXStocksCycle(configured(addresses), repo, settlement, "2026-09-24T10:00:00.000Z");
  assert.equal(result.navsPublished, 0);
  assert.match(JSON.parse(repo.rows.get(STATE_LATEST)).blockers.join(" "), /Prices were quoted more than a minute apart/);
});

test("a cycle that loses its lease while waiting for prices stops before writing", async (t) => {
  const repo = memoryRepo();
  const addresses = addressesOf();
  t.mock.method(globalThis, "fetch", pricesFor(addresses, "100", "2026-09-24T10:00:00.000Z"));
  const settlement = settlementRecorder(() => ({ status: "confirmed", txHash: "0x1", error: null }));
  const result = await runXStocksCycle(configured(addresses), repo, settlement, "2026-09-24T10:00:00.000Z", { renewLease: async () => false });
  assert.equal(result.navsPublished, 0);
  assert.equal(settlement.requests.length, 0);
  assert.match(result.warnings.join(" "), /lease lost while waiting for prices/);
  assert.equal(repo.rows.get(STATE_LATEST), undefined);
});
