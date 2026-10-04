import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { callPrice, normalCdf } from "../lib/income/options.ts";
import { coveredCallNav, premiumYield, stepCoveredCall } from "../lib/income/covered-call.ts";
import { couponPayout, maturityPayout, stepAutocall } from "../lib/income/autocall.ts";
import { addMonths, INCOME_TERMS } from "../lib/income/terms.ts";
import { recomputeIncomeNav } from "../lib/income/verify.ts";
import { demoFund, fundKind, INCOME_FUNDS, otherFund } from "../lib/funds/catalog.ts";
import { ensureFundDemoTables, FundDemoLedger } from "../lib/funds/demo.ts";

const SPY = "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48";

test("Black–Scholes prices a call as the textbook does", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  // S = K = 100, one year, 20% volatility, 5% rate: 10.4506.
  assert.ok(Math.abs(callPrice(100, 100, 1, 0.2, 0.05) - 10.4506) < 1e-3);
  assert.equal(callPrice(110, 100, 0, 0.2, 0.05), 10);
  assert.equal(callPrice(90, 100, 0, 0.2, 0.05), 0);
});

test("a covered call starts at $100, keeps its premium, caps the gain at the strike and rolls at expiry", () => {
  const terms = INCOME_TERMS["spy-covered-call"];
  const start = stepCoveredCall("spy-covered-call", terms, null, { price: 650, time: "2026-10-04T12:00:00.000Z", address: SPY });
  assert.ok(Math.abs(Number(start.document.navPerShareMicros) - 100_000_000) <= 2, "worth $100 at inception");
  assert.equal(start.document.call.strike, 663);
  const yieldNow = premiumYield(start.document);
  assert.ok(yieldNow.month > 0.005 && yieldNow.month < 0.03, `premium ${yieldNow.month}`);
  // The recorded NAV is what its document's inputs give.
  assert.equal(coveredCallNav(start.document).navMicros.toString(), start.document.navPerShareMicros);
  assert.equal(recomputeIncomeNav("spy-covered-call", JSON.parse(JSON.stringify(start.document))), BigInt(start.document.navPerShareMicros));
  // At expiry, 10% higher: the fund keeps the premium and the move to the strike, then rolls.
  const expiry = stepCoveredCall("spy-covered-call", terms, start.state, { price: 715, time: start.state.call.expiresAt, address: SPY });
  assert.equal(expiry.rolled, true);
  assert.equal(expiry.state.rolls, 1);
  const nav = Number(expiry.document.navPerShareMicros) / 1e6;
  const capped = 100 * (663 / 650) + start.state.units * start.state.call.premium;
  assert.ok(Math.abs(nav - capped) < 0.01, `${nav} vs ${capped}`);
  assert.equal(expiry.document.call.strike, 729.3);
  // A document altered after the fact does not reproduce its NAV.
  const tampered = { ...start.document, underlying: { ...start.document.underlying, price: 600 } };
  assert.notEqual(recomputeIncomeNav("spy-covered-call", tampered), BigInt(start.document.navPerShareMicros));
});

test("the step-down note fixes, knocks in, is called early, or pays the worse index at maturity", () => {
  const terms = INCOME_TERMS["spy-qqq-autocall-1"];
  assert.equal(stepAutocall("spy-qqq-autocall-1", terms, null, { SPYx: 650, QQQx: 590 }, "2026-10-03T00:00:00.000Z"), null, "not before the fixing date");
  const fixed = stepAutocall("spy-qqq-autocall-1", terms, null, { SPYx: 650, QQQx: 590 }, "2026-10-04T12:00:00.000Z");
  assert.deepEqual(fixed.state.initial, { SPYx: 650, QQQx: 590 });
  assert.equal(fixed.document.navPerShareMicros, "100000000");
  assert.equal(fixed.document.nextObservation.date, addMonths("2026-10-04T12:00:00.000Z", 6));
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", fixed.document), 100_000_000n);
  // A month later QQQ is down 52%: knocked in, still live at face.
  const fall = stepAutocall("spy-qqq-autocall-1", terms, fixed.state, { SPYx: 640, QQQx: 283.2 }, "2026-11-04T12:00:00.000Z");
  assert.equal(fall.state.knockedIn, true);
  assert.equal(fall.state.status, "live");
  // Recovered by the first observation, above 90%: called at $103.50.
  const called = stepAutocall("spy-qqq-autocall-1", terms, fall.state, { SPYx: 660, QQQx: 560 }, "2027-04-04T12:00:00.000Z");
  assert.equal(called.state.status, "called");
  assert.equal(called.document.navPerShareMicros, "103500000");
  assert.equal(couponPayout(terms, 6), 121);
  assert.equal(maturityPayout(terms, 0.6, false), 121, "no knock-in: the full coupon");
  assert.equal(maturityPayout(terms, 0.6, true), 60, "knocked in and below 75%: the worse index's level");
  assert.equal(maturityPayout(terms, 0.8, true), 121, "knocked in but above the last barrier");
});

test("income products are bought with a demo balance; a settled note pays its holders once", async () => {
  assert.equal(INCOME_FUNDS.length, 3);
  assert.equal(otherFund("spy-covered-call"), null, "not a basket");
  assert.equal(demoFund("spy-covered-call")?.ticker, "SPYC");
  assert.equal(fundKind("spy-qqq-autocall-1"), "autocall");
  const sql = new DatabaseSync(":memory:");
  sql.exec(["0000_giant_speedball.sql", "0001_demo_ledger.sql"].map((file) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).join("\n"));
  const db = {
    prepare(query) { const prepared = sql.prepare(query); let args = []; return { bind(...values) { args = values; return this; }, async first() { return prepared.get(...args) ?? null; }, async all() { return { results: prepared.all(...args) }; }, async run() { return prepared.run(...args); }, runNow() { return prepared.run(...args); } }; },
    async batch(statements) { sql.exec("BEGIN"); try { const results = statements.map((statement) => statement.runNow()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } },
  };
  await ensureFundDemoTables(db);
  const ledger = new FundDemoLedger(db);
  const face = { navMicros: 100_000_000n, effectiveAt: new Date().toISOString(), holdingsHash: "0x" + "b".repeat(64) };
  await ledger.place("alice", "spy-qqq-autocall-1", { id: "a1", side: "subscribe", usdMicros: 1_000_000_000n }, face, new Date());
  assert.equal(await ledger.cash("alice"), 9_000_000_000n);
  const paid = { navMicros: 103_500_000n, effectiveAt: "2027-04-04T12:00:00.000Z", holdingsHash: "0x" + "c".repeat(64) };
  await ledger.settleAll("spy-qqq-autocall-1", paid);
  await ledger.settleAll("spy-qqq-autocall-1", paid);
  assert.equal(await ledger.cash("alice"), 9_000_000_000n + 1_035_000_000n, "paid $1,035 once");
  assert.deepEqual(await ledger.positions("alice"), []);
  const orders = await ledger.orders("alice", "spy-qqq-autocall-1");
  assert.equal(orders.filter((order) => order.side === "redeem").length, 1);
});
