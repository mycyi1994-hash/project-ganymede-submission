import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { callPrice, normalCdf } from "../lib/income/options.ts";
import { coveredCallNav, coveredCallReturn, premiumYield, stepCoveredCall } from "../lib/income/covered-call.ts";
import { couponPayout, maturityPayout, stepAutocall } from "../lib/income/autocall.ts";
import { addMonths, INCOME_TERMS } from "../lib/income/terms.ts";
import { recomputeIncomeNav } from "../lib/income/verify.ts";
import { fundKind, incomeFund, INCOME_FUNDS, otherFund, universeToken } from "../lib/funds/catalog.ts";
import { fundStateKey } from "../lib/funds/cycle.ts";
import { incomeModelKey, runIncomeCycle } from "../lib/income/cycle.ts";
import { EngineRepository } from "../lib/engine/repository.ts";

const SPY = "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48";

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
const quote = (symbol, priceMicros, time, address = universeToken(symbol).address) => [symbol, { symbol, address, priceMicros, time, source: "test" }];
const prices = (spy, qqq, time) => new Map([quote("SPYx", spy, time), quote("QQQx", qqq, time)]);
/** A relayer that confirms every record, except that it refuses those `refuse` picks, as a 401 would. */
function relayer(refuse = () => false) {
  const requests = [];
  return {
    requests,
    async settle(request) {
      requests.push(request);
      if (refuse(request)) return { id: `stl_${requests.length}`, payloadHash: "0x", status: "failed", txHash: null, blockNumber: null, error: "Settlement relayer 401: Unauthorized" };
      return { id: `stl_${requests.length}`, payloadHash: "0x", status: "confirmed", txHash: `0x${requests.length.toString(16).padStart(64, "0")}`, blockNumber: "1", error: null };
    },
  };
}

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

test("the covered call's chart counts from today's NAV once the ETF has moved after the call was sold", () => {
  const terms = INCOME_TERMS["spy-covered-call"];
  const start = stepCoveredCall("spy-covered-call", terms, null, { price: 650, time: "2026-10-04T12:00:00.000Z", address: SPY });
  const units = start.state.units;
  // At inception a flat ETF earns the premium, and above the strike the gain stops there.
  assert.ok(Math.abs(coveredCallReturn(start.document, 0) - premiumYield(start.document).month) < 1e-4);
  const capped = coveredCallReturn(start.document, 0.08);
  assert.ok(Math.abs(coveredCallReturn(start.document, 0.12) - capped) < 1e-12, "no gain above the strike");
  // Fifteen days later the ETF is 5% higher, above the 663 strike.
  const later = stepCoveredCall("spy-covered-call", terms, start.state, { price: 682.5, time: "2026-10-19T12:00:00.000Z", address: SPY });
  const nav = Number(later.document.navPerShareMicros) / 1e6;
  const flat = coveredCallReturn(later.document, 0);
  // A flat ETF from here earns only the call's time value: what it is worth over what it settles for.
  assert.ok(Math.abs(flat - units * (later.document.call.value - (682.5 - 663)) / nav) < 1e-6, `${flat}`);
  assert.ok(flat > 0 && flat < premiumYield(start.document).month, `${flat}`);
  // The chart used to add the whole premium to the move capped at the strike from today's price: −1.76% here.
  const old = Math.min(0, 663 / 682.5 - 1) + premiumYield(later.document).month;
  assert.ok(old < -0.01, `${old}`);
  // A minute before expiry nothing is left to earn on a flat ETF.
  const last = stepCoveredCall("spy-covered-call", terms, start.state, { price: 682.5, time: new Date(Date.parse(start.state.call.expiresAt) - 60_000).toISOString(), address: SPY });
  assert.equal(last.rolled, false);
  assert.ok(Math.abs(coveredCallReturn(last.document, 0)) < 1e-4);
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

test("a record passes only with its product's published terms, not other terms whose NAV holds together", () => {
  const callTerms = INCOME_TERMS["spy-covered-call"];
  const start = stepCoveredCall("spy-covered-call", callTerms, null, { price: 650, time: "2026-10-04T12:00:00.000Z", address: SPY });
  const later = stepCoveredCall("spy-covered-call", callTerms, start.state, { price: 670, time: "2026-10-10T12:00:00.000Z", address: SPY });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  assert.equal(recomputeIncomeNav("spy-covered-call", copy(later.document)), BigInt(later.document.navPerShareMicros));
  // Its keys in another order are still the same terms.
  const reordered = copy(later.document);
  reordered.terms = { rate: callTerms.rate, volatility: callTerms.volatility, tenorDays: callTerms.tenorDays, moneyness: callTerms.moneyness };
  assert.equal(recomputeIncomeNav("spy-covered-call", reordered), BigInt(later.document.navPerShareMicros));
  // A lower volatility marks the call cheaper; with the NAV and the call's value made to agree, the inputs hold together.
  const calm = copy(later.document);
  calm.terms.volatility = 0.05;
  const marked = coveredCallNav(calm);
  calm.call.value = marked.callValue;
  calm.navPerShareMicros = marked.navMicros.toString();
  assert.notEqual(calm.navPerShareMicros, later.document.navPerShareMicros);
  assert.equal(recomputeIncomeNav("spy-covered-call", calm), null, "not this product's volatility");
  const elsewhere = copy(later.document);
  elsewhere.underlying.address = "0x0000000000000000000000000000000000000001";
  assert.equal(recomputeIncomeNav("spy-covered-call", elsewhere), null, "not this product's ETF");
  const longer = copy(later.document);
  longer.call.expiresAt = new Date(Date.parse(longer.call.expiresAt) + 86_400_000).toISOString();
  assert.equal(recomputeIncomeNav("spy-covered-call", longer), null, "not this product's tenor");
  const mark = copy(later.document);
  mark.call.value = mark.call.value + 1;
  assert.equal(recomputeIncomeNav("spy-covered-call", mark), null, "the call's value is the one its inputs give");
  // The holding is the call's: the cash is the premium on the units, which at inception are $100 of the ETF.
  const remade = (document) => { const marked = coveredCallNav(document); document.call.value = marked.callValue; document.navPerShareMicros = marked.navMicros.toString(); return document; };
  const extraCash = copy(later.document);
  extraCash.cash = extraCash.cash + 5;
  assert.equal(recomputeIncomeNav("spy-covered-call", remade(extraCash)), null, "cash beyond the premium");
  const doubled = copy(later.document);
  doubled.units = doubled.units * 2;
  doubled.cash = Number((doubled.units * doubled.call.premium).toFixed(6));
  assert.equal(recomputeIncomeNav("spy-covered-call", remade(doubled)), null, "$200 of the ETF at inception");
  // The roll count and the start agree with the call: none yet, sold at the start.
  const rolled = copy(later.document);
  rolled.rolls = 3;
  assert.equal(recomputeIncomeNav("spy-covered-call", rolled), null, "no roll before the first call expires");
  const relaunched = copy(later.document);
  relaunched.startedAt = "2026-09-01T12:00:00.000Z";
  assert.equal(recomputeIncomeNav("spy-covered-call", relaunched), null, "the first call is sold at the start");
  // The call was sold at $650: its strike is 2% above that and its premium is Black–Scholes's. A lower
  // strike with a richer premium, the call's value and the NAV made to agree, is not this product's call.
  assert.equal(later.document.call.spot, 650);
  const lowStrike = copy(later.document);
  lowStrike.call.strike = 600;
  lowStrike.call.premium = 100;
  assert.equal(recomputeIncomeNav("spy-covered-call", remade(lowStrike)), null, "the strike and premium of a call sold at $650");
  const resold = copy(later.document);
  resold.call.spot = 600;
  assert.equal(recomputeIncomeNav("spy-covered-call", remade(resold)), null, "the strike follows the price it was sold at");
  // A call sold before its price was recorded is held to the premium its strike gives, within the cent.
  const legacy = copy(later.document);
  delete legacy.call.spot;
  assert.equal(recomputeIncomeNav("spy-covered-call", legacy), BigInt(later.document.navPerShareMicros));
  const legacyRich = copy(legacy);
  legacyRich.call.strike = 600;
  legacyRich.call.premium = 100;
  assert.equal(recomputeIncomeNav("spy-covered-call", remade(legacyRich)), null, "a premium its strike does not give");
  // The note: its terms, observations and payout are the published ones.
  const terms = INCOME_TERMS["spy-qqq-autocall-1"];
  const fixed = stepAutocall("spy-qqq-autocall-1", terms, null, { SPYx: 650, QQQx: 590 }, "2026-10-04T12:00:00.000Z");
  const called = stepAutocall("spy-qqq-autocall-1", terms, fixed.state, { SPYx: 660, QQQx: 560 }, "2027-04-04T12:00:00.000Z");
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", copy(called.document)), 103_500_000n);
  const richer = copy(called.document);
  richer.state.payout = 150;
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", richer), null, "pays what its observation pays");
  const lower = copy(fixed.document);
  lower.terms.barriers = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", lower), null, "not this note's barriers");
  const early = copy(called.document);
  early.state.observations[0].barrier = 0.8;
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", early), null, "each observation against its own barrier");
  const unknocked = stepAutocall("spy-qqq-autocall-1", terms, fixed.state, { SPYx: 640, QQQx: 283.2 }, "2026-11-04T12:00:00.000Z");
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", copy(unknocked.document)), 100_000_000n);
  const hidden = copy(unknocked.document);
  hidden.state.knockedIn = false;
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", hidden), null, "a knock-in cannot be hidden");
  // Nor by raising the lowest level above this record's worse index, which is at 48%.
  const raised = copy(unknocked.document);
  Object.assign(raised.state, { lowestWorst: 1, knockedIn: false, knockedInAt: null });
  assert.equal(raised.worst, 0.48);
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", raised), null, "the lowest level is at or below today's");
  const untimed = copy(unknocked.document);
  untimed.state.knockedInAt = null;
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", untimed), null, "a knock-in has its time");
  // The note settles in the record that observes it: that record's levels are the observation's.
  const reprice = (document, prices) => {
    document.prices = prices;
    document.performance = Object.fromEntries(Object.entries(prices).map(([symbol, price]) => [symbol, Number((price / document.state.initial[symbol]).toFixed(6))]));
    document.worst = Math.min(...Object.values(document.performance));
    return document;
  };
  const belowBarrier = reprice(copy(called.document), { SPYx: 660, QQQx: 500 });
  assert.ok(belowBarrier.worst < 0.9);
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", belowBarrier), null, "called at levels the record does not show");
  const afterwards = copy(called.document);
  afterwards.asOf = "2027-04-05T12:00:00.000Z";
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", afterwards), null, "nothing is recorded after the record it settled in");
  // Nor a timeline that starts after the record, or an observation before its date.
  const future = copy(fixed.document);
  future.state.fixedAt = "2028-10-04T12:00:00.000Z";
  future.subscriptionEndsAt = new Date(Date.parse(future.state.fixedAt) + terms.subscriptionDays * 86_400_000).toISOString();
  future.nextObservation = { ...future.nextObservation, date: addMonths(future.state.fixedAt, 6) };
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", future), null, "fixed after its own record");
  const beforeDate = copy(called.document);
  beforeDate.state.observations[0].observedAt = "2027-04-01T12:00:00.000Z";
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", beforeDate), null, "observed before its date");
  // No knock-in can be invented at the fixing, where nothing is lower yet, nor at a record above the knock-in.
  const invented = copy(fixed.document);
  Object.assign(invented.state, { lowestWorst: 0.4, knockedIn: true, knockedInAt: invented.state.fixedAt });
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", invented), null, "a knock-in at the fixing");
  const shifted = copy(fixed.document);
  shifted.prices = { SPYx: 660, QQQx: 590 };
  shifted.performance = { SPYx: Number((660 / 650).toFixed(6)), QQQx: 1 };
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", shifted), null, "the fixing's prices are its starting levels");
  const unbreached = stepAutocall("spy-qqq-autocall-1", terms, fixed.state, { SPYx: 640, QQQx: 560 }, "2026-11-04T12:00:00.000Z");
  const claimed = copy(unbreached.document);
  Object.assign(claimed.state, { lowestWorst: 0.4, knockedIn: true, knockedInAt: claimed.asOf });
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", claimed), null, "knocked in at a record above the knock-in");
  // A live record dated past its next observation skipped it: the note would have been observed then.
  const skipped = copy(unknocked.document);
  skipped.asOf = "2027-04-05T12:00:00.000Z";
  assert.equal(recomputeIncomeNav("spy-qqq-autocall-1", skipped), null, "a live note past its observation date");
});

test("three income products beside the baskets, recorded under their own product keys", () => {
  assert.equal(INCOME_FUNDS.length, 3);
  assert.equal(otherFund("spy-covered-call"), null, "not a basket");
  assert.equal(incomeFund("spy-covered-call")?.ticker, "SPYC");
  assert.equal(fundKind("spy-qqq-autocall-1"), "autocall");
});

test("a note whose final record the relayer refused sends it again until it is confirmed, and records no shares", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const NOTE = "spy-qqq-autocall-1";
  let refusing = false;
  const network = relayer((request) => refusing && request.productId === NOTE);
  const fixing = "2026-10-04T13:20:19.000Z";
  await runIncomeCycle(repo, network, prices(770_000_000n, 750_000_000n, fixing), fixing, 10, null);
  // Investing is not open, so no record counts shares.
  assert.ok(network.requests.every((request) => !request.sharesOutstandingMicros));

  // Both indices hold up at the first observation, so the note is called at $103.50; the relayer refuses that record.
  refusing = true;
  const observed = "2027-04-04T13:25:00.000Z";
  await runIncomeCycle(repo, network, prices(780_000_000n, 760_000_000n, observed), observed, 10, null);
  assert.equal(stateOf(sql, incomeModelKey(NOTE)).status, "called");
  assert.notEqual(stateOf(sql, fundStateKey(NOTE, "confirmed")).navPerShareMicros, "103500000", "not confirmed while the relayer refuses it");
  const again = await runIncomeCycle(repo, network, prices(780_000_000n, 760_000_000n, "2027-04-04T13:30:00.000Z"), "2027-04-04T13:30:00.000Z", 10, null);
  assert.ok(again.warnings.includes("ELS1 final record: Settlement relayer 401: Unauthorized"), "a refusal is sent again and said so");

  // Once the relayer takes it, that same record is confirmed, and nothing more is sent.
  refusing = false;
  for (const at of ["2027-04-04T13:35:00.000Z", "2027-04-04T13:40:00.000Z"]) await runIncomeCycle(repo, network, prices(780_000_000n, 760_000_000n, at), at, 10, null);
  assert.equal(stateOf(sql, fundStateKey(NOTE, "confirmed")).navPerShareMicros, "103500000");
  const finals = network.requests.filter((request) => request.productId === NOTE && request.navPerShareMicros === "103500000");
  assert.equal(finals.length, 3, "sent once and again twice, and not after it was confirmed");
  assert.ok(finals.every((request) => request.entityId === finals[0].entityId), "under the record's own idempotency key");
});

test("the income products refuse a price of zero, one for another token or one stamped ahead, as the baskets do", async () => {
  const { sql, db } = ledgerDatabase();
  const repo = new EngineRepository(db);
  const network = relayer();
  const start = "2026-10-05T12:00:00.000Z";
  await runIncomeCycle(repo, network, prices(770_000_000n, 750_000_000n, start), start, 10, null);
  const note = stateOf(sql, incomeModelKey("spy-qqq-autocall-1"));
  const qqqc = stateOf(sql, fundStateKey("qqq-covered-call", "confirmed"));

  // A QQQx price of zero, with no pool read to catch it.
  const zero = "2026-10-05T12:05:00.000Z";
  const priced = await runIncomeCycle(repo, network, prices(771_000_000n, 0n, zero), zero, 10, null);
  assert.equal(priced.published, 1, "SPYC alone");
  assert.ok(priced.warnings.includes("QQQC not published: Non-positive price for QQQx"));
  assert.ok(priced.warnings.includes("ELS1 not published: Non-positive price for QQQx"));
  assert.deepEqual(stateOf(sql, fundStateKey("qqq-covered-call", "confirmed")), qqqc);
  assert.deepEqual(stateOf(sql, incomeModelKey("spy-qqq-autocall-1")), note, "no knock-in from a price of zero");

  // A price quoted for another token, and one stamped a year ahead.
  const later = "2026-10-05T12:10:00.000Z";
  const wrong = await runIncomeCycle(repo, network, new Map([quote("SPYx", 772_000_000n, later, universeToken("QQQx").address), quote("QQQx", 752_000_000n, "2027-10-05T12:10:00.000Z")]), later, 10, null);
  assert.equal(wrong.published, 0);
  assert.ok(wrong.warnings.includes("SPYC not published: Price address mismatch for SPYx"));
  assert.ok(wrong.warnings.includes("QQQC not published: Invalid price timestamp for QQQx"));
  assert.deepEqual(stateOf(sql, incomeModelKey("spy-qqq-autocall-1")), note, "no early observation from a price stamped ahead");
});
