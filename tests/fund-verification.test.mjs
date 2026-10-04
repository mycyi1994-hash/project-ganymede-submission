import assert from "node:assert/strict";
import test from "node:test";
import { verifyFundSnapshot } from "../lib/funds/verification.ts";
import { PROOF_DEPLOYMENT } from "../lib/xstocks/proof.ts";
import { fundFixture } from "./fixtures/fund-record.mjs";

async function setup(at) {
  const fixture = await fundFixture("ai-chips", at);
  const options = {
    now: Date.parse(fixture.record.effectiveAt) + 60_000,
    fetcher: async (url, init) => {
      assert.equal(url, PROOF_DEPLOYMENT.rpcUrl);
      const { method, params, id } = JSON.parse(init.body);
      if (method === "eth_chainId") return Response.json({ id, result: "0x7a0" });
      assert.equal(params[0].to, PROOF_DEPLOYMENT.registry);
      assert.equal(params[0].data.slice(10), fixture.fund.productKey.slice(2));
      return Response.json({ id, result: fixture.encoded });
    },
  };
  return { ...fixture, options };
}

test("the displayed NAV and holdings come from one verified record, regardless of history order", async () => {
  const { fund, record, options } = await setup();
  fund.history.unshift({ ...fund.history[0], holdingsHash: "0x" + "b".repeat(64), canonical: "unrelated first entry" });
  const checked = await verifyFundSnapshot(fund, "ai-chips", options);
  assert.equal(checked.result, "matched");
  assert.deepEqual(checked.record, record);
  assert.equal(checked.composition.navPerShareMicros, record.navPerShareMicros);
  assert.equal(checked.composition.productId, "ai-chips");
});

test("a valid $100 proof cannot endorse a $999 headline or a different timestamp", async () => {
  const { fund, options } = await setup();
  for (const nav of [{ ...fund.nav, perShareMicros: "999000000" }, { ...fund.nav, asOf: "2026-10-04T03:05:00.000Z" }, null]) {
    const checked = await verifyFundSnapshot({ ...fund, nav }, "ai-chips", options);
    assert.equal(checked.result, "failed");
    assert.equal(checked.record, undefined);
    assert.equal(checked.composition, undefined);
  }
});

test("publication milliseconds match chain seconds, but a different second never does", async () => {
  const { fund, record, options } = await setup("2026-10-04T03:00:00.157Z");
  assert.equal(record.effectiveAt, "2026-10-04T03:00:00.000Z");
  assert.equal((await verifyFundSnapshot(fund, "ai-chips", options)).result, "matched");
  for (const asOf of ["2026-10-04T03:00:01.000Z", "2026-10-04T02:59:59.999Z", "not a date"]) {
    assert.equal((await verifyFundSnapshot({ ...fund, nav: { ...fund.nav, asOf } }, "ai-chips", options)).result, "failed");
  }
});

test("the route's pinned identity cannot be replaced by an API product key", async () => {
  const { fund } = await setup();
  const options = { fetcher: async () => assert.fail("a mismatched product must be refused before RPC") };
  assert.equal((await verifyFundSnapshot({ ...fund, productKey: "0x" + "b".repeat(64) }, "ai-chips", options)).result, "failed");
  assert.equal((await verifyFundSnapshot(fund, "us-core", options)).result, "failed");
});

test("missing, stale or tampered documents do not yield a verified trading NAV", async () => {
  const { fund, options } = await setup();
  assert.equal((await verifyFundSnapshot({ ...fund, history: [] }, "ai-chips", options)).result, "unavailable");
  assert.equal((await verifyFundSnapshot(fund, "ai-chips", { ...options, now: options.now + 3_600_000 })).result, "unavailable");
  const tampered = { ...fund, history: [{ ...fund.history[0], canonical: fund.history[0].canonical.replace('"test fixture"', '"changed price source"') }] };
  const checked = await verifyFundSnapshot(tampered, "ai-chips", options);
  assert.equal(checked.result, "failed");
  assert.equal(checked.composition, undefined);
});
