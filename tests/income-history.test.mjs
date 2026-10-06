import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { INCOME_TERMS } from "../lib/income/terms.ts";
import { coveredCallNav, stepCoveredCall } from "../lib/income/covered-call.ts";
import { stepAutocall } from "../lib/income/autocall.ts";
import { addTransition, transitionLabel, transitionsAt, TRANSITIONS_LIMIT } from "../lib/income/transitions.ts";
import { verifyIncomeSnapshot } from "../lib/income/verify.ts";
import { incomeFund, universeToken } from "../lib/funds/catalog.ts";
import { fundStateKey } from "../lib/funds/cycle.ts";
import { fundDetail } from "../lib/funds/api.ts";
import { runIncomeCycle } from "../lib/income/cycle.ts";
import { EngineRepository } from "../lib/engine/repository.ts";
import { sha256Hex } from "../lib/engine/fixed.ts";
import { NAV_PUBLISHED_TOPIC } from "../lib/xstocks/onchain.ts";
import { PROOF_DEPLOYMENT } from "../lib/xstocks/proof.ts";

const SPYC = "spy-covered-call";
const NOTE = "spy-qqq-autocall-1";
const SPY = universeToken("SPYx").address;

/** A D1 stand-in on SQLite, which binds a number as REAL as D1 does; its batch is one transaction. */
function ledgerDatabase() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(["0000_giant_speedball.sql", "0001_demo_ledger.sql"].map((file) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).join("\n"));
  const db = {
    prepare(query) { const prepared = sql.prepare(query); let args = []; return { bind(...values) { args = values; return this; }, async first() { return prepared.get(...args) ?? null; }, async all() { return { results: prepared.all(...args) }; }, async run() { return prepared.run(...args); }, runNow() { return prepared.run(...args); } }; },
    async batch(statements) { sql.exec("BEGIN"); try { const results = statements.map((statement) => statement.runNow()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } },
  };
  return { sql, db };
}
const stateOf = (sql, key) => JSON.parse(sql.prepare("SELECT value FROM engine_state WHERE key = ?").get(key)?.value ?? "null");
const quote = (symbol, dollars, time) => [symbol, { symbol, address: universeToken(symbol).address, priceMicros: BigInt(Math.round(dollars * 1e6)), time, source: "test" }];
const prices = (spy, qqq, time) => new Map([quote("SPYx", spy, time), quote("QQQx", qqq, time)]);
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * X Layer in a test: a relayer that records each NAV it confirms as GanymedeNavRegistry would, with a
 * receipt carrying its NavPublished event, and an RPC that serves the latest record and the receipts.
 */
function xlayer() {
  const latest = new Map();
  const receipts = new Map();
  const requests = [];
  let sent = 0;
  let refuse = () => false;
  function publish(productKey, holdingsHash, nav, effectiveAt) {
    sent += 1;
    const txHash = `0x${sent.toString(16).padStart(64, "0")}`;
    const seconds = Math.floor(Date.parse(effectiveAt) / 1000);
    latest.set(productKey.toLowerCase(), { nav, holdingsHash, seconds });
    receipts.set(txHash, { status: "0x1", blockNumber: "0x1", logs: [{ address: PROOF_DEPLOYMENT.registry, topics: [NAV_PUBLISHED_TOPIC, productKey.toLowerCase(), holdingsHash.toLowerCase()], data: `0x${word(nav)}${word(0)}${word(seconds)}` }] });
    return txHash;
  }
  const settlement = {
    async settle(request) {
      requests.push(request);
      if (refuse(request)) return { id: `stl_${requests.length}`, payloadHash: "0x", status: "failed", txHash: null, blockNumber: null, error: "Settlement relayer 401: Unauthorized" };
      const txHash = publish(incomeFund(request.productId).productKey, request.holdingsHash, request.navPerShareMicros, request.effectiveAt);
      return { id: `stl_${requests.length}`, payloadHash: "0x", status: "confirmed", txHash, blockNumber: "1", error: null };
    },
  };
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "eth_chainId") return answer(`0x${PROOF_DEPLOYMENT.chainId.toString(16)}`);
    if (body.method === "eth_getTransactionReceipt") return answer(receipts.get(body.params[0]) ?? null);
    if (body.method === "eth_call") {
      const record = latest.get(`0x${body.params[0].data.slice(10)}`);
      return answer(`0x${word(record?.nav ?? 0)}${word(0)}${(record?.holdingsHash ?? `0x${"0".repeat(64)}`).slice(2)}${word(record?.seconds ?? 0)}${word(record?.seconds ?? 0)}`);
    }
    throw new Error(`unexpected ${body.method}`);
  };
  return { settlement, fetcher, requests, publish, refuse: (rule) => { refuse = rule; } };
}

/** A record of `id` put on the test chain as its latest, and the page's response with it as the newest record. */
async function forge(chain, fund, id, document) {
  const canonical = JSON.stringify(document);
  const holdingsHash = await sha256Hex(canonical);
  chain.publish(incomeFund(id).productKey, holdingsHash, document.navPerShareMicros, document.asOf);
  const entry = { ...fund.history[0], asOf: document.asOf, navPerShareMicros: document.navPerShareMicros, holdingsHash, canonical };
  return { ...fund, history: [entry, ...fund.history], nav: { ...fund.nav, perShareMicros: document.navPerShareMicros, asOf: document.asOf } };
}

/** A covered call's position with its units doubled, its cash the premium on them, and its call and NAV marked again. */
function doubled(document) {
  const copy = clone(document);
  copy.units = Number((copy.units * 2).toFixed(9));
  copy.cash = Number((copy.units * copy.call.premium).toFixed(6));
  const marked = coveredCallNav(copy);
  copy.call.value = marked.callValue;
  copy.navPerShareMicros = marked.navMicros.toString();
  return copy;
}

test("the archive keeps each sale, fixing, knock-in and observation once, oldest first, and is complete from its start", () => {
  const terms = INCOME_TERMS[SPYC];
  const start = stepCoveredCall(SPYC, terms, null, { price: 650, time: "2026-10-04T12:00:00.000Z", address: SPY });
  const mark = stepCoveredCall(SPYC, terms, start.state, { price: 660, time: "2026-10-05T12:00:00.000Z", address: SPY });
  const roll = stepCoveredCall(SPYC, terms, start.state, { price: 670, time: "2026-11-03T12:05:00.000Z", address: SPY });
  const record = (document, status = "confirmed") => ({ asOf: document.asOf, calculatedAt: document.asOf, navPerShareMicros: document.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: `0x${Buffer.from(document.asOf).toString("hex").padEnd(64, "0").slice(0, 64)}`, canonical: JSON.stringify(document), status, txHash: `0x${"a".repeat(64)}`, error: null });
  assert.deepEqual([transitionsAt(start.document), transitionsAt(mark.document), transitionsAt(roll.document)], [["sale"], [], ["sale"]]);
  assert.deepEqual([transitionLabel(start.document), transitionLabel(roll.document)], ["first call's record", "roll record"]);

  // The first record confirmed starts the archive; a mark decides nothing and changes nothing.
  const empty = addTransition(null, record(mark.document));
  assert.deepEqual(empty, { since: mark.document.asOf, records: [] });
  const first = addTransition(null, record(start.document));
  assert.equal(first.since, start.document.asOf);
  assert.deepEqual(Object.keys(first.records[0]).sort(), ["asOf", "canonical", "holdingsHash", "navPerShareMicros", "txHash"]);
  assert.equal(addTransition(first, record(mark.document)), first);
  assert.equal(addTransition(first, record(roll.document, "failed")), first, "only a confirmed record is kept");
  assert.equal(addTransition(first, record(start.document)), first, "once");
  const rolled = addTransition(first, record(roll.document));
  assert.deepEqual(rolled.records.map((item) => item.asOf), [start.document.asOf, roll.document.asOf]);

  // A note's fixing, knock-in and observations, each named for the cycle's messages.
  const note = INCOME_TERMS[NOTE];
  const fixing = stepAutocall(NOTE, note, null, { SPYx: 770, QQQx: 750 }, "2026-10-04T13:20:00.000Z");
  const breach = stepAutocall(NOTE, note, fixing.state, { SPYx: 380, QQQx: 740 }, "2026-10-06T13:20:00.000Z");
  const observed = stepAutocall(NOTE, note, breach.state, { SPYx: 780, QQQx: 760 }, "2027-04-04T13:25:00.000Z");
  assert.deepEqual([transitionsAt(fixing.document), transitionsAt(breach.document), transitionsAt(observed.document)], [["fixing"], ["knock-in"], ["observation"]]);
  assert.deepEqual([transitionLabel(fixing.document), transitionLabel(breach.document), transitionLabel(observed.document)], ["fixing record", "knock-in record", "final record"]);

  // Past its limit the oldest go, and the archive is then complete only from the oldest it keeps.
  let archive = null;
  for (let index = 0; index < TRANSITIONS_LIMIT + 6; index += 1) {
    const asOf = new Date(Date.parse("2026-10-04T00:00:00.000Z") + index * 31 * 86_400_000).toISOString();
    archive = addTransition(archive, { asOf, calculatedAt: asOf, navPerShareMicros: "100000000", sharesOutstandingMicros: "0", holdingsHash: `0x${index.toString(16).padStart(64, "0")}`, canonical: JSON.stringify({ kind: "covered-call", asOf, call: { soldAt: asOf }, rolls: index }), status: "confirmed", txHash: null, error: null });
  }
  assert.equal(archive.records.length, TRANSITIONS_LIMIT);
  assert.equal(archive.since, archive.records[0].asOf);
});

test("a refused roll goes on chain before any later record, and every sale is archived once confirmed", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const chain = xlayer();
  const cycle = (spy, qqq, at) => runIncomeCycle(repo, chain.settlement, prices(spy, qqq, at), at, 10, null);
  await cycle(770, 750, "2026-10-04T13:20:00.000Z");
  await cycle(775, 752, "2026-10-05T13:20:00.000Z");
  for (const id of [SPYC, "qqq-covered-call", NOTE]) {
    const archive = stateOf(sql, fundStateKey(id, "transitions"));
    assert.deepEqual([archive.since, archive.records.map((record) => record.asOf)], ["2026-10-04T13:20:00.000Z", ["2026-10-04T13:20:00.000Z"]], `${id} archives its sale or fixing, not the mark after it`);
  }

  // SPYC's call expires and rolls, but the relayer refuses that record.
  chain.refuse((request) => request.productId === SPYC);
  await cycle(790, 760, "2026-11-03T13:25:00.000Z");
  assert.equal(stateOf(sql, fundStateKey(SPYC, "confirmed")).asOf, "2026-10-05T13:20:00.000Z");
  const held = await cycle(792, 761, "2026-11-03T13:30:00.000Z");
  assert.ok(held.warnings.includes("SPYC roll record: Settlement relayer 401: Unauthorized"), held.warnings.join("\n"));
  assert.ok(held.warnings.includes("SPYC not published: The roll record at 2026-11-03T13:25:00.000Z is not confirmed yet, and no later record is sent before it"));
  assert.ok(!chain.requests.some((request) => request.productId === SPYC && request.effectiveAt === "2026-11-03T13:30:00.000Z"), "nothing later is sent while the roll is refused");
  assert.equal(stateOf(sql, fundStateKey(SPYC, "latest")).blockers[0], "The roll record at 2026-11-03T13:25:00.000Z is not confirmed yet, and no later record is sent before it");

  // Once the relayer takes it, the roll is confirmed and archived, and the record of this cycle follows.
  chain.refuse(() => false);
  const resumed = await cycle(794, 762, "2026-11-03T13:35:00.000Z");
  assert.equal(resumed.published, 4, "the roll sent again, and this cycle's three records");
  const sent = chain.requests.filter((request) => request.productId === SPYC).map((request) => request.effectiveAt);
  assert.deepEqual(sent.slice(-4), ["2026-11-03T13:25:00.000Z", "2026-11-03T13:25:00.000Z", "2026-11-03T13:25:00.000Z", "2026-11-03T13:35:00.000Z"]);
  assert.equal(stateOf(sql, fundStateKey(SPYC, "confirmed")).asOf, "2026-11-03T13:35:00.000Z");
  assert.deepEqual(stateOf(sql, fundStateKey(SPYC, "transitions")).records.map((record) => record.asOf), ["2026-10-04T13:20:00.000Z", "2026-11-03T13:25:00.000Z"]);
});

test("a covered call's record is traced through each roll to its start, each record checked against its own transaction", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const chain = xlayer();
  const days = [["2026-10-04T13:20:00.000Z", 770], ["2026-10-05T13:20:00.000Z", 775], ["2026-11-03T13:25:00.000Z", 790], ["2026-11-04T13:20:00.000Z", 785], ["2026-12-03T13:30:00.000Z", 760], ["2026-12-04T13:20:00.000Z", 765]];
  for (const [at, spy] of days) await runIncomeCycle(repo, chain.settlement, prices(spy, 750, at), at, 10, null);
  const archive = stateOf(sql, fundStateKey(SPYC, "transitions"));
  assert.deepEqual(archive.records.map((record) => record.asOf), ["2026-10-04T13:20:00.000Z", "2026-11-03T13:25:00.000Z", "2026-12-03T13:30:00.000Z"]);
  const fund = await fundDetail(repo, incomeFund(SPYC));
  assert.deepEqual(fund.transitions, archive, "the page's response carries the archive");
  const options = { fetcher: chain.fetcher, now: Date.parse("2026-12-04T13:21:00.000Z") };
  const check = await verifyIncomeSnapshot(fund, SPYC, options);
  assert.equal(check.result, "matched", check.detail);
  assert.match(check.detail, /It rests on the sale of its call at 2026-12-03 13:30 UTC, the roll at 2026-11-03 13:25 UTC and the first call's sale at 2026-10-04 13:20 UTC, each checked against its own transaction on X Layer\./);

  // Codex's case: a rolled record with its units doubled, its cash the premium on them and its NAV
  // marked again holds together on its own, and is on chain; its call's sale shows other units.
  const twice = await forge(chain, fund, SPYC, doubled(JSON.parse(fund.history[0].canonical)));
  const scaled = await verifyIncomeSnapshot(twice, SPYC, options);
  assert.deepEqual([scaled.result, scaled.detail], ["failed", "This record's position differs from the one its call was sold with at 2026-12-03 13:30 UTC."]);

  // A roll recorded on chain with doubled units, and a record after it to match: the roll does not follow from the call before it.
  const badRoll = doubled(JSON.parse(archive.records[2].canonical));
  const badRollCanonical = JSON.stringify(badRoll);
  const badRollHash = await sha256Hex(badRollCanonical);
  const rewritten = clone(archive);
  rewritten.records[2] = { asOf: badRoll.asOf, navPerShareMicros: badRoll.navPerShareMicros, holdingsHash: badRollHash, canonical: badRollCanonical, txHash: chain.publish(incomeFund(SPYC).productKey, badRollHash, badRoll.navPerShareMicros, badRoll.asOf) };
  const followed = await forge(chain, { ...fund, transitions: rewritten }, SPYC, doubled(JSON.parse(fund.history[0].canonical)));
  const rolled = await verifyIncomeSnapshot(followed, SPYC, options);
  assert.deepEqual([rolled.result, rolled.detail], ["failed", "The roll at 2026-12-03 13:30 UTC does not follow from the call sold at 2026-11-03 13:25 UTC."]);

  // Back to the honest record: put on chain again as the latest.
  const honest = await forge(chain, fund, SPYC, JSON.parse(fund.history[0].canonical));
  assert.equal((await verifyIncomeSnapshot(honest, SPYC, options)).result, "matched");
  // A record the archive should have but does not leaves the check unavailable, not matched.
  const missing = await verifyIncomeSnapshot({ ...honest, transitions: { ...archive, records: archive.records.filter((record) => record.asOf !== "2026-11-03T13:25:00.000Z") } }, SPYC, options);
  assert.deepEqual([missing.result, missing.detail], ["unavailable", "The record of the call before the roll at 2026-12-03 13:30 UTC is not in this page's archive yet."]);
  // One from before the archive started is held to the terms only, and said so.
  const later = await verifyIncomeSnapshot({ ...honest, transitions: { since: "2026-11-04T13:20:00.000Z", records: archive.records.slice(2) } }, SPYC, options);
  assert.equal(later.result, "matched");
  assert.match(later.detail, /Records before 2026-11-04 13:20 UTC are not archived, so the call before the roll at 2026-12-03 13:30 UTC is held to the product's terms only\./);
  // An archived record its transaction did not record, and one whose document does not hash to it, fail.
  const otherTransaction = clone(archive);
  otherTransaction.records[1].txHash = archive.records[0].txHash;
  const wrongReceipt = await verifyIncomeSnapshot({ ...honest, transitions: otherTransaction }, SPYC, options);
  assert.deepEqual([wrongReceipt.result, wrongReceipt.detail], ["failed", "The transaction of the archived record at 2026-11-03 13:25 UTC did not record it for this product."]);
  const otherHash = clone(archive);
  otherHash.records[1].holdingsHash = archive.records[0].holdingsHash;
  assert.deepEqual(Object.values(await verifyIncomeSnapshot({ ...honest, transitions: otherHash }, SPYC, options)).slice(0, 2), ["failed", "The archived record at 2026-11-03 13:25 UTC does not hash to its fingerprint."]);
  // A page without an archive still checks the record, and says what it could not trace.
  const bare = await verifyIncomeSnapshot({ ...honest, transitions: null }, SPYC, options);
  assert.equal(bare.result, "matched");
  assert.match(bare.detail, /not archived here/);
});

test("a note's fixing, knock-in and observations are traced to their own records; one claimed without its record, or hidden, is not", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const chain = xlayer();
  const days = [["2026-10-04T13:20:00.000Z", 770, 750], ["2026-10-05T13:20:00.000Z", 760, 745], ["2026-10-06T13:20:00.000Z", 380, 740], ["2027-04-04T13:25:00.000Z", 600, 730], ["2027-04-05T13:20:00.000Z", 610, 735]];
  for (const [at, spy, qqq] of days) await runIncomeCycle(repo, chain.settlement, prices(spy, qqq, at), at, 10, null);
  const archive = stateOf(sql, fundStateKey(NOTE, "transitions"));
  assert.deepEqual(archive.records.map((record) => record.asOf), ["2026-10-04T13:20:00.000Z", "2026-10-06T13:20:00.000Z", "2027-04-04T13:25:00.000Z"]);
  const fund = await fundDetail(repo, incomeFund(NOTE));
  const options = { fetcher: chain.fetcher, now: Date.parse("2027-04-05T13:21:00.000Z") };
  const check = await verifyIncomeSnapshot(fund, NOTE, options);
  assert.equal(check.result, "matched", check.detail);
  assert.match(check.detail, /It rests on its fixing at 2026-10-04 13:20 UTC, its knock-in at 2026-10-06 13:20 UTC and its observation 1 at 2027-04-04 13:25 UTC, each checked against its own transaction on X Layer\./);

  // A knock-in hidden from a later record: its own record is archived and on chain.
  const hidden = clone(JSON.parse(fund.history[0].canonical));
  Object.assign(hidden.state, { knockedIn: false, knockedInAt: null, lowestWorst: 0.75 });
  const unknocked = await verifyIncomeSnapshot(await forge(chain, fund, NOTE, hidden), NOTE, options);
  assert.deepEqual([unknocked.result, unknocked.detail], ["failed", "The note's observation 1 at 2027-04-04 13:25 UTC differs from its own record."]);
});

test("a knock-in claimed at an earlier time without its record is not shown as verified", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const chain = xlayer();
  for (const [at, spy, qqq] of [["2026-10-04T13:20:00.000Z", 770, 750], ["2026-10-08T13:20:00.000Z", 735, 712]]) await runIncomeCycle(repo, chain.settlement, prices(spy, qqq, at), at, 10, null);
  assert.equal(stateOf(sql, fundStateKey(NOTE, "transitions")).records.length, 1, "the fixing alone");
  const fund = await fundDetail(repo, incomeFund(NOTE));
  const options = { fetcher: chain.fetcher, now: Date.parse("2026-10-08T13:21:00.000Z") };
  assert.equal((await verifyIncomeSnapshot(fund, NOTE, options)).result, "matched");
  // Codex's case: both indices above half their start now, the lowest level set to 40% and a knock-in placed in between.
  const claimed = clone(JSON.parse(fund.history[0].canonical));
  Object.assign(claimed.state, { lowestWorst: 0.4, knockedIn: true, knockedInAt: "2026-10-06T09:00:00.000Z" });
  const result = await verifyIncomeSnapshot(await forge(chain, fund, NOTE, claimed), NOTE, options);
  assert.deepEqual([result.result, result.detail], ["unavailable", "The record of the note's knock-in at 2026-10-06 09:00 UTC is not in this page's archive yet."]);
  // Placed at the fixing's own record instead, it differs from that record.
  const atFixing = clone(claimed);
  atFixing.state.knockedInAt = "2026-10-04T13:20:00.000Z";
  assert.equal((await verifyIncomeSnapshot(await forge(chain, fund, NOTE, atFixing), NOTE, options)).result, "failed");
});

test("without a relayer, records are simulated and the products keep recording", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const simulated = { async settle() { return { id: "stl", payloadHash: "0x", status: "simulated", txHash: null, blockNumber: null, error: "Settlement relayer is not configured" }; } };
  for (const at of ["2026-10-04T13:20:00.000Z", "2026-10-04T13:25:00.000Z", "2026-10-04T13:30:00.000Z"]) await runIncomeCycle(repo, simulated, prices(770, 750, at), at, 10, null);
  assert.equal(stateOf(sql, fundStateKey(SPYC, "history")).length, 3, "not held behind a first record that cannot go on chain");
  assert.equal(stateOf(sql, fundStateKey(SPYC, "transitions")), null, "nothing confirmed, nothing archived");
});
