import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { basketConfigPath, basketDocument, basketProfile, fixUnits, parseBasketConfig, verifyBasket } from "../lib/xstocks/basket-config.ts";
import { verifyReport } from "../lib/xstocks/proof.ts";
import { readLatestNav } from "../lib/xstocks/onchain.ts";
import { sha256Hex } from "../lib/engine/fixed.ts";

const folder = new URL("../public/baskets/mag3/", import.meta.url);
const shipped = JSON.parse(readFileSync(new URL("basket.json", folder), "utf8"));
const documents = readdirSync(new URL("documents/", folder)).map((name) => ({ name, canonical: readFileSync(new URL(`documents/${name}`, folder), "utf8") }));
const records = JSON.parse(readFileSync(new URL("records.json", folder), "utf8"));
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);

test("the MAG3 configuration describes a complete basket in its own registry", () => {
  const config = parseBasketConfig(shipped);
  assert.equal(config.ticker, "MAG3");
  // keccak256("mag3-demo"), computed by the publish script; the registry stores MAG3's records under it.
  assert.equal(config.productKey, "0xff4259f72153def6feb71e171f34f0c4461a01fc9c6d9be5855e1ab5adfe6dc6");
  assert.notEqual(config.registry.address, "0xf320d2a7f280b7ab61e24374986869d7be34289c", "not USTX's registry");
  assert.deepEqual(config.constituents.map((row) => row.symbol), ["AAPLx", "MSFTx", "NVDAx"]);
  assert.equal(basketConfigPath("/baskets/mag3/basket.json"), "/baskets/mag3/basket.json");
});

test("every published MAG3 document is named by its fingerprint, adds up and holds the configured units", async () => {
  const config = parseBasketConfig(shipped);
  assert.ok(documents.length >= 1);
  assert.equal(records.length, documents.length);
  for (const { name, canonical } of documents) {
    const hash = await sha256Hex(canonical);
    assert.equal(`${hash}.json`, name);
    assert.ok(records.some((record) => record.holdingsHash === hash && /^0x[0-9a-f]{64}$/.test(record.transactionHash)));
    const document = JSON.parse(canonical);
    const record = { navPerShareMicros: document.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: hash, effectiveAt: document.asOf, publishedAt: document.asOf };
    const result = await verifyReport(canonical, record, basketProfile(config));
    assert.equal(result.hash.state, "pass");
    assert.equal(result.nav.state, "pass");
    assert.deepEqual(document.holdings.map((row) => row.unitsWad), config.constituents.map((row) => row.unitsWad));
  }
});

/** X Layer Testnet answering for MAG3's registry, and this site serving its documents. */
function site(canonical, overrides = {}) {
  const config = parseBasketConfig(shipped);
  const document = JSON.parse(canonical);
  const calls = [];
  const fetcher = async (url, init) => {
    if (url === config.registry.rpcUrl) {
      const { method, params } = JSON.parse(init.body);
      calls.push({ method, params });
      if (method === "eth_chainId") return Response.json({ result: overrides.chainId ?? "0x7a0" });
      return Response.json({ result: "0x" + word(document.navPerShareMicros) + word(0) + overrides.hash.slice(2) + word(seconds(document.asOf)) + word(seconds(document.asOf) + 9) });
    }
    if (overrides.serve !== false && url === `https://ganymede.test/baskets/mag3/documents/${overrides.hash}.json`) return new Response(canonical);
    return new Response("not found", { status: 404 });
  };
  return { config, fetcher, calls };
}

test("the browser check reads the basket's own registry and key, then hashes and recalculates its document", async () => {
  const { canonical } = documents[0];
  const hash = await sha256Hex(canonical);
  const { config, fetcher, calls } = site(canonical, { hash });
  const check = await verifyBasket(config, { base: "https://ganymede.test", fetcher });
  assert.deepEqual([check.chain.state, check.hash.state, check.nav.state, check.definition.state], ["pass", "pass", "pass", "pass"]);
  const call = calls.find((entry) => entry.method === "eth_call");
  assert.equal(call.params[0].to, config.registry.address);
  assert.equal(call.params[0].data, "0xe8b7fcde" + config.productKey.slice(2));

  // A document with other units, fingerprinted and recorded as such, adds up but is not this basket.
  const changed = JSON.parse(canonical);
  changed.holdings[0].unitsWad = (BigInt(changed.holdings[0].unitsWad) * 2n).toString();
  changed.holdings[0].valueMicros = ((BigInt(changed.holdings[0].unitsWad) * BigInt(changed.holdings[0].priceMicros)) / 10n ** 18n).toString();
  changed.navPerShareMicros = changed.holdings.reduce((sum, row) => sum + BigInt(row.valueMicros), 0n).toString();
  const other = JSON.stringify(changed);
  const otherSite = site(other, { hash: await sha256Hex(other) });
  const mismatch = await verifyBasket(config, { base: "https://ganymede.test", fetcher: otherSite.fetcher });
  assert.deepEqual([mismatch.hash.state, mismatch.nav.state, mismatch.definition.state], ["pass", "pass", "fail"]);

  // Another network, or a record whose document is not served, never passes.
  const elsewhere = await verifyBasket(config, { base: "https://ganymede.test", fetcher: site(canonical, { hash, chainId: "0x1" }).fetcher });
  assert.equal(elsewhere.chain.state, "pending");
  const missing = await verifyBasket(config, { base: "https://ganymede.test", fetcher: site(canonical, { hash, serve: false }).fetcher });
  assert.equal(missing.hash.state, "pending");
  assert.match(missing.hash.detail, /not served/);

  // The fingerprint covers the bytes served: a byte-order mark in front changes them.
  const marked = site(canonical, { hash });
  const bom = await verifyBasket(config, { base: "https://ganymede.test", fetcher: async (url, init) => url.includes("/documents/") ? new Response(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(canonical)])) : marked.fetcher(url, init) });
  assert.equal(bom.hash.state, "fail");
  // A repeated key that another parser could read differently is not one document, whatever its hash.
  const repeated = canonical.replace('{"asOf"', '{"productId":"another-basket","asOf"');
  const repeatedCheck = await verifyBasket(config, { base: "https://ganymede.test", fetcher: site(repeated, { hash: await sha256Hex(repeated) }).fetcher });
  assert.equal(repeatedCheck.hash.state, "pass");
  assert.equal(repeatedCheck.nav.state, "fail");
  assert.match(repeatedCheck.nav.detail, /canonical form/);
});

test("a configuration must be complete, and the badge loads only this site's basket files", () => {
  const variants = [
    (c) => { c.constituents[0].address = c.constituents[0].address.toUpperCase().replace("0X", "0x"); },
    (c) => { c.constituents[0].weightBps -= 1; },
    (c) => { c.constituents[1].symbol = c.constituents[0].symbol; },
    (c) => { c.constituents[0].unitsWad = "0"; },
    (c) => { c.documents = "/baskets/mag3/documents/latest.json"; },
    (c) => { c.documents = "//other.example/{hash}.json"; },
    (c) => { c.documents = "http://other.example/{hash}.json"; },
    (c) => { c.documents = "/\\other.example/{hash}.json"; },
    (c) => { c.documents = "/\tother.example/{hash}.json"; },
    (c) => { c.documents = "/baskets/../{hash}.json"; },
    (c) => { c.documents = "https://other.example//{hash}.json"; },
    (c) => { c.registry.rpcUrl = "http://rpc.example"; },
    (c) => { c.productKey = "0x1234"; },
  ];
  for (const change of variants) {
    const config = structuredClone(shipped);
    change(config);
    assert.throws(() => parseBasketConfig(config), /Invalid basket configuration/);
  }
  for (const path of ["https://other.example/baskets/x/basket.json", "/baskets/../secrets/basket.json", "/baskets/mag3/records.json", "//other.example/baskets/x/basket.json", null]) assert.equal(basketConfigPath(path), null);
});

test("units fixed at the fixing prices start a share just under $100, and a document values them", async () => {
  const constituents = [{ symbol: "A", weightBps: 3334 }, { symbol: "B", weightBps: 3333 }, { symbol: "C", weightBps: 3333 }];
  const prices = new Map([["A", 339_249_108n], ["B", 517_493_264n], ["C", 224_555_439n]]);
  const units = fixUnits(constituents, prices);
  const config = { ...parseBasketConfig(shipped), id: "units-test", constituents: constituents.map((row, index) => ({ ...row, address: "0x" + String(index + 1).repeat(40), unitsWad: units[index] })) };
  const { composition, canonical } = basketDocument(config, new Map([...prices].map(([symbol, priceMicros]) => [symbol, { priceMicros, source: "test" }])), "2026-09-25T17:48:04.000Z");
  const nav = BigInt(composition.navPerShareMicros);
  assert.ok(nav <= 100_000_000n && nav > 99_999_990n, String(nav));
  const record = { navPerShareMicros: composition.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: await sha256Hex(canonical), effectiveAt: composition.asOf, publishedAt: null };
  assert.equal((await verifyReport(canonical, record, basketProfile(config))).nav.state, "pass");
  assert.throws(() => fixUnits(constituents, new Map([["A", 1n]])), /No fixing price for B/);
});

test("reading another basket's record sends its product key, never USTX's", async () => {
  const key = "0x" + "ab".repeat(32);
  let data = null;
  const fetcher = async (_url, init) => { data = JSON.parse(init.body).params[0].data; return Response.json({ result: "0x" + word(1) + word(0) + "cd".repeat(32) + word(2) + word(3) }); };
  await readLatestNav("https://rpc.test", "0x" + "1".repeat(40), { fetcher, productKey: key });
  assert.equal(data, "0xe8b7fcde" + "ab".repeat(32));
  await assert.rejects(readLatestNav("https://rpc.test", "0x" + "1".repeat(40), { fetcher, productKey: "0x12" }), /Invalid product key/);
});
