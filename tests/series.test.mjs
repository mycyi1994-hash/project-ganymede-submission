import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { EngineRepository } from "../lib/engine/repository.ts";
import { NAV_PUBLISHED_TOPIC } from "../lib/xstocks/evidence.ts";
import { XSTOCKS_PRODUCT_KEY } from "../lib/xstocks/onchain.ts";
import { decodeMarketSnapshot, publicationHistory, publishedRecordCount } from "../lib/product-market.ts";
import { downsampleSeries, mergeSeries, parseSeries, SERIES_LIMIT, STATE_SERIES, STATE_SERIES_CURSOR, updateNavSeries } from "../lib/xstocks/series.ts";
import { runXStocksCycle, STATE_HISTORY } from "../lib/xstocks/cycle.ts";
import { XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";

const REGISTRY = "0x" + "b".repeat(40);
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const base = Math.floor(Date.parse("2026-09-23T11:15:00Z") / 1000);

function memoryRepo(settlements = []) {
  const rows = new Map();
  return {
    rows,
    async getState(key) { return rows.has(key) ? { value: rows.get(key) } : null; },
    async setState(key, value) { rows.set(key, value); },
    async saveSettlement() {},
    async deleteStatesWithPrefix(prefix, keep) { for (const key of [...rows.keys()]) if (key.startsWith(prefix) && !keep.includes(key)) rows.delete(key); },
    async confirmedNavSettlements(prefix, before, limit) {
      return settlements.filter((row) => row.entityId.startsWith(prefix) && (!before || row.entityId < before)).sort((a, b) => (a.entityId < b.entityId ? 1 : -1)).slice(0, limit);
    },
  };
}

function receiptFetcher(events, failOn = new Set()) {
  const asked = [];
  const fetcher = async (_url, init) => {
    const { params: [tx] } = JSON.parse(init.body);
    asked.push(tx);
    if (failOn.has(tx)) throw new TypeError("network down");
    const event = events.get(tx);
    const logs = event ? [{ address: event.address ?? REGISTRY, topics: [NAV_PUBLISHED_TOPIC, event.key ?? XSTOCKS_PRODUCT_KEY, "0x" + "c".repeat(64)], data: "0x" + word(event.nav) + word(0) + word(event.seconds) }] : [];
    return Response.json({ jsonrpc: "2.0", id: 1, result: { status: "0x1", logs } });
  };
  return { fetcher, asked };
}

test("series points are one per second, oldest first, capped and thinned with the newest kept", () => {
  const merged = mergeSeries([[3, "30"], [1, "10"]], [[2, "20"], [3, "31"], ["x", "1"]]);
  assert.deepEqual(merged, [[1, "10"], [2, "20"], [3, "31"]]);
  const long = Array.from({ length: SERIES_LIMIT + 5 }, (_, i) => [i + 1, String(i)]);
  assert.equal(mergeSeries(long, []).length, SERIES_LIMIT);
  assert.deepEqual(mergeSeries(long, []).at(-1), long.at(-1));
  const thin = downsampleSeries(long, 300);
  assert.ok(thin.length <= 301);
  assert.deepEqual(thin.at(-1), long.at(-1));
  assert.deepEqual(parseSeries("not json"), []);
});

test("confirmed history is added and older publications are recovered from their receipts", async () => {
  const settlements = Array.from({ length: 30 }, (_, i) => ({ entityId: `us-tech-x:${iso(base + i * 300)}`, txHash: "0x" + String(i).padStart(64, "0") }));
  const events = new Map(settlements.map((row, i) => [row.txHash, { nav: 100_000_000 + i, seconds: base + i * 300 }]));
  // A legacy paper product shares the registry; its events must be ignored.
  events.set(settlements[5].txHash, { nav: 959_948_631, seconds: base + 5 * 300, key: "0x" + "7".repeat(64) });
  const repo = memoryRepo(settlements);
  await repo.setState(STATE_HISTORY, JSON.stringify([{ asOf: iso(base + 40 * 300), navPerShareMicros: "123", status: "confirmed", txHash: "0x" + "f".repeat(64) }, { asOf: iso(base + 41 * 300), navPerShareMicros: "124", status: "queued", txHash: null }]));
  const { fetcher, asked } = receiptFetcher(events);
  const first = await updateNavSeries(repo, { rpcUrl: "https://rpc.test", registry: REGISTRY, historyKey: STATE_HISTORY, fetcher });
  assert.equal(first.backfilled, 24);
  assert.equal(asked.length, 24);
  let series = parseSeries(repo.rows.get(STATE_SERIES));
  assert.deepEqual(series.at(-1), [base + 40 * 300, "123"]);
  assert.equal(series.length, 1 + 24);
  assert.equal(repo.rows.get(STATE_SERIES_CURSOR), settlements[6].entityId);
  const second = await updateNavSeries(repo, { rpcUrl: "https://rpc.test", registry: REGISTRY, historyKey: STATE_HISTORY, fetcher });
  assert.equal(second.backfilled, 6);
  series = parseSeries(repo.rows.get(STATE_SERIES));
  assert.equal(series.length, 1 + 29, "the legacy product's event is skipped");
  assert.equal(series.find((point) => point[0] === base + 5 * 300), undefined);
  assert.equal(repo.rows.get(STATE_SERIES_CURSOR), "done");
  const idle = await updateNavSeries(repo, { rpcUrl: "https://rpc.test", registry: REGISTRY, historyKey: STATE_HISTORY, fetcher });
  assert.equal(idle.backfilled, 0);
  assert.equal(asked.length, 30, "a finished walk reads no more receipts");
});

test("an unreadable receipt stops the walk so it is retried, without losing points already read", async () => {
  const settlements = Array.from({ length: 5 }, (_, i) => ({ entityId: `us-tech-x:${iso(base + i * 300)}`, txHash: "0x" + String(i).padStart(64, "0") }));
  const events = new Map(settlements.map((row, i) => [row.txHash, { nav: 100 + i, seconds: base + i * 300 }]));
  const repo = memoryRepo(settlements);
  const failing = receiptFetcher(events, new Set([settlements[2].txHash]));
  const result = await updateNavSeries(repo, { rpcUrl: "https://rpc.test", registry: REGISTRY, historyKey: STATE_HISTORY, fetcher: failing.fetcher });
  assert.equal(result.backfilled, 2);
  assert.equal(repo.rows.get(STATE_SERIES_CURSOR), settlements[3].entityId);
  await updateNavSeries(repo, { rpcUrl: "https://rpc.test", registry: REGISTRY, historyKey: STATE_HISTORY, fetcher: receiptFetcher(events).fetcher });
  assert.equal(parseSeries(repo.rows.get(STATE_SERIES)).length, 5);
  assert.equal(repo.rows.get(STATE_SERIES_CURSOR), "done");
});

test("a series failure never stops a NAV publication", async (t) => {
  const addresses = XSTOCKS_CONSTITUENTS.map((item, index) => ({ ...item, address: `0x${String(index + 1).repeat(40)}` }));
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "0", data: addresses.map((item) => ({ chainIndex: "196", tokenContractAddress: item.address, price: "100", time: "2026-09-24T09:59:00.000Z" })) }));
  const repo = memoryRepo();
  repo.confirmedNavSettlements = async () => { throw new Error("D1 unavailable"); };
  const settlement = { rpcUrl: "https://rpc.test", async settle() { return { id: "stl", payloadHash: "0x", blockNumber: null, status: "confirmed", txHash: "0x" + "ab".repeat(32), error: null }; } };
  const env = { OKX_API_KEY: "k", OKX_API_SECRET: "s", OKX_API_PASSPHRASE: "p", NAV_REGISTRY_ADDRESS: REGISTRY, XSTOCKS_ADDRESSES: addresses.map((item) => `${item.symbol}=${item.address}`).join(",") };
  const result = await runXStocksCycle(env, repo, settlement, "2026-09-24T10:00:00.000Z");
  assert.equal(result.navsPublished, 1);
  assert.ok(result.warnings.some((warning) => warning.startsWith("NAV series not updated")));
  assert.equal(JSON.parse(repo.rows.get(STATE_HISTORY))[0].status, "confirmed");
});

test("the settlement query returns confirmed USTX publications newest first", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8"));
  const db = { prepare(query) { const prepared = sql.prepare(query); let args = []; return { bind(...values) { args = values; return this; }, async all() { return { results: prepared.all(...args) }; }, async first() { return prepared.get(...args) ?? null; }, async run() { prepared.run(...args); return { success: true }; } }; } };
  const insert = sql.prepare("INSERT INTO giwa_settlements (id, entity_type, entity_id, action, payload_hash, status, tx_hash) VALUES (?, ?, ?, ?, '0x', ?, ?)");
  insert.run("1", "nav", "us-tech-x:2026-09-23T11:15:00.000Z", "publish_nav", "confirmed", "0x01");
  insert.run("2", "nav", "us-tech-x:2026-09-23T11:20:00.000Z", "publish_nav", "confirmed", "0x02");
  insert.run("3", "nav", "us-tech-x:2026-09-23T11:25:00.000Z", "publish_nav", "queued", null);
  insert.run("4", "nav", "gmd-core:2026-09-23T11:30:00.000Z", "publish_nav", "confirmed", "0x04");
  insert.run("5", "rebalance", "us-tech-x:2026-09-23T11:35:00.000Z", "publish_rebalance", "confirmed", "0x05");
  const repo = new EngineRepository(db);
  assert.deepEqual(await repo.confirmedNavSettlements("us-tech-x:", null, 10), [{ entityId: "us-tech-x:2026-09-23T11:20:00.000Z", txHash: "0x02" }, { entityId: "us-tech-x:2026-09-23T11:15:00.000Z", txHash: "0x01" }]);
  assert.deepEqual(await repo.confirmedNavSettlements("us-tech-x:", "us-tech-x:2026-09-23T11:20:00.000Z", 10), [{ entityId: "us-tech-x:2026-09-23T11:15:00.000Z", txHash: "0x01" }]);
  sql.close();
});

test("the chart merges the long series with exact recent records", () => {
  const snapshot = decodeMarketSnapshot({ product: { id: "us-tech-x" }, pricing: { constituents: [] }, registry: {}, latest: null, history: [], onchain: null, onchainError: null, series: [[base, "100000000"], [base + 300, "100100000"]] });
  assert.deepEqual(publicationHistory(snapshot).map((point) => point.micros), ["100000000", "100100000"]);
  assert.throws(() => decodeMarketSnapshot({ ...snapshot, series: [["x", "1"]] }), /series is invalid/);
});

test("the chart counts every stored record, not only the thinned points it draws", () => {
  const full = Array.from({ length: 400 }, (_, i) => [base + i * 300, String(100_000_000 + i)]);
  const thin = downsampleSeries(full, 300);
  assert.ok(thin.length < full.length);
  const entry = (seconds) => ({ asOf: iso(seconds), navPerShareMicros: "123", holdingsHash: "0x" + "a".repeat(64), canonical: "{}", status: "confirmed", txHash: "0x" + "b".repeat(64) });
  // One exact record inside the thinned range and one newer than the stored series.
  const snapshot = decodeMarketSnapshot({ product: { id: "us-tech-x" }, pricing: { constituents: [] }, registry: {}, latest: null, history: [entry(base + 400 * 300), entry(base + 300)], onchain: null, onchainError: null, series: thin, seriesCount: full.length });
  const points = publicationHistory(snapshot);
  assert.equal(points.length, thin.length + 2);
  assert.equal(publishedRecordCount(snapshot, points), full.length + 1);
  assert.equal(publishedRecordCount({ ...snapshot, seriesCount: undefined }, points), points.length, "older responses without a count use the points shown");
  assert.throws(() => decodeMarketSnapshot({ ...snapshot, seriesCount: -1 }), /series is invalid/);
  assert.throws(() => decodeMarketSnapshot({ ...snapshot, seriesCount: 1.5 }), /series is invalid/);
});
