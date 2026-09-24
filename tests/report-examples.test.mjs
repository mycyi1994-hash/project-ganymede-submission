import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_EXAMPLES, EXAMPLE_SCHEMA } from "../lib/xstocks/report-examples.ts";
import { verifyReport, verifyComposition, parseReport } from "../lib/xstocks/proof.ts";
import { stableJson, sha256Hex } from "../lib/engine/fixed.ts";

for (const example of REPORT_EXAMPLES) {
  test(`${example.name}: verify, mutate and restore without changing the live boundary`, async () => {
    assert.equal(example.schema, EXAMPLE_SCHEMA);
    const record = { holdingsHash: await sha256Hex(example.canonical), navPerShareMicros: example.document.navPerShareMicros, effectiveAt: example.document.asOf, publishedAt: null, sharesOutstandingMicros: "0" };
    const original = await verifyReport(example.canonical, record, example.profile);
    assert.equal(original.hash.state, "pass"); assert.equal(original.nav.state, "pass");
    assert.match(original.hash.detail, /no chain read/);
    assert.match(original.nav.detail, /example NAV/);
    assert.doesNotMatch(original.nav.detail, /on-chain NAV/);
    const document = parseReport(example.canonical, example.profile);
    document.holdings[0].priceMicros = (BigInt(document.holdings[0].priceMicros) + 1_000_000n).toString();
    const changed = await verifyReport(stableJson(document), record, example.profile);
    assert.equal(changed.hash.state, "fail"); assert.equal(changed.nav.state, "fail");
    assert.equal((await verifyReport(example.canonical, record, example.profile)).nav.state, "pass");
    assert.equal((await verifyComposition(example.canonical, record)).nav.state, "fail");
    assert.throws(() => parseReport("{}", example.profile));
    assert.throws(() => parseReport(example.canonical, { ...example.profile, productId: "unsupported" }));
    document.holdings[0].unitsWad = "-1";
    assert.equal((await verifyReport(stableJson(document), record, example.profile)).nav.state, "fail");
  });
}
