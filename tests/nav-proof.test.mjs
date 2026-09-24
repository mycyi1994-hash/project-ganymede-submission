import { changedPriceCopy, compensatedEditCopy, consistentEditCopy, layeredChecks, priceEditCopy } from "../lib/xstocks/proof-experiment.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBasket, constituentsWithAddresses, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { verifyComposition, PROOF_DEPLOYMENT } from "../lib/xstocks/proof.ts";
import { readLatestNav } from "../lib/xstocks/onchain.ts";
import { sha256Hex } from "../lib/engine/fixed.ts";
import { pricingStatus, elapsedTime, formatRecordTime } from "../lib/nav-status.ts";

const now = "2026-09-23T12:26:11.456Z";
async function fixture() {
  const addresses = XSTOCKS_CONSTITUENTS.map((item, i) => ({ ...item, address: "0x" + String(i + 1).repeat(40) }));
  const constituents = constituentsWithAddresses(addresses.map((item) => `${item.symbol}=${item.address}`).join(","));
  const quotes = new Map(addresses.map((item, i) => [item.symbol, { ...item, priceMicros: 231250001n + BigInt(i), time: now, source: "test" }]));
  const evaluation = await evaluateBasket({ constituents, quotes, previous: null, now, maxQuoteAgeMinutes: 60 });
  return { canonical: evaluation.canonical, record: { navPerShareMicros: evaluation.composition.navPerShareMicros, holdingsHash: evaluation.holdingsHash, effectiveAt: "2026-09-23T12:26:11Z", publishedAt: now, sharesOutstandingMicros: "0" } };
}

test("browser recalculation exactly matches issuer integer truncation", async () => {
  const { canonical, record } = await fixture();
  const result = await verifyComposition(canonical, record);
  assert.equal(result.hash.state, "pass");
  assert.equal(result.nav.state, "pass");
});

test("a document byte change fails the hash even if the arithmetic still matches", async () => {
  const { canonical, record } = await fixture();
  const result = await verifyComposition(canonical + " ", record);
  assert.equal(result.hash.state, "fail");
  assert.equal(result.nav.state, "pass");
});

test("matching hash and claimed NAV cannot conceal incorrect holding arithmetic", async () => {
  const { canonical, record } = await fixture();
  const document = JSON.parse(canonical);
  document.holdings[0].unitsWad = (BigInt(document.holdings[0].unitsWad) * 2n).toString();
  const changed = JSON.stringify(document);
  const result = await verifyComposition(changed, { ...record, holdingsHash: await sha256Hex(changed) });
  assert.equal(result.hash.state, "pass");
  assert.equal(result.nav.state, "fail");
  assert.match(result.nav.detail, /units × price/);
});

test("missing, duplicate, negative and wrong-product data cannot pass", async () => {
  const { canonical, record } = await fixture();
  for (const mutate of [
    (doc) => { delete doc.holdings[0].priceMicros; },
    (doc) => { doc.holdings.pop(); },
    (doc) => { doc.holdings[1] = doc.holdings[0]; },
    (doc) => { doc.holdings[0].unitsWad = "-1"; },
    (doc) => { doc.productId = "wrong-product"; },
    (doc) => { doc.asOf = "2026-09-23T13:00:00Z"; },
  ]) {
    const doc = JSON.parse(canonical);
    mutate(doc);
    const changed = JSON.stringify(doc);
    assert.equal((await verifyComposition(changed, { ...record, holdingsHash: await sha256Hex(changed) })).nav.state, "fail");
  }
  assert.equal((await verifyComposition(canonical, { ...record, navPerShareMicros: "100000000" })).nav.state, "fail");
});

test("direct reads reject a wrong chain, malformed response or failed RPC", async () => {
  for (const fetcher of [
    async () => Response.json({ result: "0x1" }),
    async () => Response.json({ error: { message: "RPC down" } }),
    async () => { throw new TypeError("Failed to fetch"); },
  ]) await assert.rejects(readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: 1952, fetcher }));
  await assert.rejects(readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { fetcher: async () => Response.json({ result: "0xdead" }) }));
});

test("direct read pins the network and registry with bounded requests", async () => {
  const methods = [];
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  const fetcher = async (url, init) => {
    assert.equal(url, PROOF_DEPLOYMENT.rpcUrl);
    assert.ok(init.signal instanceof AbortSignal);
    const request = JSON.parse(init.body);
    methods.push(request.method);
    if (request.method === "eth_chainId") return Response.json({ result: "0x7a0" });
    assert.equal(request.params[0].to, PROOF_DEPLOYMENT.registry);
    return Response.json({ result: "0x" + [99_000_000, 0, 1, 1_790_165_171, 1_790_165_177].map(word).join("") });
  };
  const record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: 1952, fetcher });
  assert.equal(record.navPerShareMicros, "99000000");
  assert.deepEqual(methods, ["eth_chainId", "eth_call"]);
});

test("historical record age and current pricing are independent", () => {
  const clock = Date.parse(now);
  assert.equal(pricingStatus({ status: "priced", evaluatedAt: "2026-09-23T11:00:00Z" }, clock).label, "Pricing update delayed");
  assert.equal(pricingStatus({ status: "awaiting_prices", evaluatedAt: now }, clock).label, "Awaiting fresh prices");
  assert.equal(pricingStatus({ status: "priced", evaluatedAt: now }, clock, true).label, "Refresh unavailable");
  const firstLoadFailure = pricingStatus(null, clock, true);
  assert.equal(firstLoadFailure.label, "Pricing unavailable");
  assert.doesNotMatch(firstLoadFailure.detail, /last loaded record/i);
  assert.equal(elapsedTime("2026-09-23T10:26:11Z", clock), "2 hr 0 min ago");
  assert.equal(formatRecordTime(now), "2026-09-23 12:26:11 UTC");
});


test("price experiment edits exactly one field, fails real checks, and restores the original", async () => {
  const {canonical, record} = await fixture();
  const copy = changedPriceCopy(canonical);
  const original = JSON.parse(canonical), edited = JSON.parse(copy.canonical);
  assert.equal(BigInt(edited.holdings[0].priceMicros) - BigInt(original.holdings[0].priceMicros), 1000000n);
  edited.holdings[0].priceMicros = original.holdings[0].priceMicros;
  assert.deepEqual(edited, original);
  const failed = await verifyComposition(copy.canonical, record);
  assert.equal(failed.hash.state, "fail");
  assert.equal(failed.nav.state, "fail");
  const restored = await verifyComposition(canonical, record);
  assert.equal(restored.hash.state, "pass");
  assert.equal(restored.nav.state, "pass");
  assert.deepEqual(JSON.parse(canonical), original);
});

test("the three experiment edits isolate what each layer of the check catches", async () => {
  const { canonical, record } = await fixture();
  const states = checks => [checks.fingerprint.state, checks.arithmetic.state, checks.record.state];
  assert.deepEqual(states(await layeredChecks(canonical, record)), ["pass", "pass", "pass"]);
  // A careless edit breaks the row arithmetic; the document still claims the recorded NAV.
  const price = priceEditCopy(canonical);
  assert.deepEqual(states(await layeredChecks(price.canonical, record)), ["fail", "fail", "pass"]);
  // Fixing the arithmetic moves the document NAV away from the X Layer record.
  const consistent = consistentEditCopy(canonical);
  assert.deepEqual(states(await layeredChecks(consistent.canonical, record)), ["fail", "pass", "fail"]);
  // Offsetting two prices keeps every number and the NAV; only the recorded fingerprint differs.
  const compensated = compensatedEditCopy(canonical);
  assert.ok(compensated);
  const original = JSON.parse(canonical), edited = JSON.parse(compensated.canonical);
  assert.equal(edited.navPerShareMicros, original.navPerShareMicros);
  assert.equal(compensated.changes.length, 2);
  assert.equal(BigInt(edited.holdings[0].priceMicros) - BigInt(original.holdings[0].priceMicros), 1000000n);
  assert.ok(BigInt(edited.holdings[1].priceMicros) < BigInt(original.holdings[1].priceMicros));
  assert.deepEqual(edited.holdings.slice(2), original.holdings.slice(2));
  assert.deepEqual(states(await layeredChecks(compensated.canonical, record)), ["fail", "pass", "pass"]);
  // The live verdict rejects every edit.
  for (const copy of [price, consistent, compensated]) assert.equal((await verifyComposition(copy.canonical, record)).hash.state, "fail");
  assert.deepEqual(JSON.parse(canonical), original);
});
