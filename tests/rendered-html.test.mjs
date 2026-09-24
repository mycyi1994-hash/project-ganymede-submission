import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}
const visible = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replaceAll("<!-- -->", "");

test("Markets renders the actual product path without fabricated values or the verification exercise", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = visible(await response.text());
  assert.match(html, /US Tech Basket/);
  assert.match(html, /Explore basket/);
  assert.match(html, /Published NAV/);
  assert.match(html, /href="\/products\/ustx"/);
  assert.doesNotMatch(html, /Try verification|Try changing one price|<img\b[^>]*clearform-stack/);
  assert.doesNotMatch(html, /\$12,454|Example account/);
});

test("public product routes share navigation and select the right destination before hydration", async () => {
  const expected = [["/", "Markets"], ["/products/ustx/transparency", "Verify"], ["/portfolio", "Portfolio"]];
  for (const [path, current, heading] of [
    ["/", "/", "US Tech Basket"],
    ["/products/ustx", "/", "Terms &amp; approach"],
    ["/products/ustx/transparency", "/products/ustx/transparency", "Transparency"],
    ["/portfolio", "/portfolio", "Your xStocks on X Layer"],
    // The separate test share ledger stays reachable by address but is not a primary destination.
    ["/activity", null, "Your testnet share records"],
  ]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = visible(await response.text());
    const nav = html.match(/<nav\b[^>]*aria-label="Primary navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(nav, path);
    const anchors = [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.deepEqual(anchors.map(([, attrs, label]) => [attrs.match(/href="([^"]*)"/)?.[1], label.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, "")]), expected);
    const selected = anchors.filter(([, attrs]) => attrs.includes('aria-current="page"'));
    assert.equal(selected.length, current ? 1 : 0, path);
    if (current) assert.ok(selected[0][1].includes(`href="${current}"`));
    assert.ok(html.includes(heading), path);
  }
});

test("product pages lead with verification instead of closed investment access", async () => {
  for (const path of ["/", "/products/ustx", "/products/ustx/transparency"]) {
    const html = visible(await (await render(path)).text());
    assert.doesNotMatch(html, /Subscriptions not open|Investment access|Invest in USTX|Know what you own|before investing|Connect wallet/, path);
    assert.match(html, /href="\/products\/ustx\/transparency"/, path);
    assert.match(html, /X Layer Testnet/, path);
  }
  const product = visible(await (await render("/products/ustx")).text());
  assert.match(product, /Verify this record/);
  assert.match(product, /None are issued/);
});

test("legacy URLs route to their matching product or simulation destination", async () => {
  for (const [path, target] of [["/?app=select", "/products/ustx"], ["/?app=portfolio", "/lab"], ["/proof", "/products/ustx/transparency"], ["/etfs/gmd-core", "/lab/strategies/gmd-core"]]) {
    const response = await render(path);
    assert.ok([307, 308].includes(response.status), `${path}: ${response.status}`);
    assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, target);
  }
});

test("public Portfolio and Activity do not contain the local example account or simulated balances", async () => {
  for (const path of ["/portfolio", "/activity"]) {
    const html = visible(await (await render(path)).text());
    assert.doesNotMatch(html, /12,454|125\.250000|Example account|Preview processing/);
  }
  assert.match(visible(await (await render("/activity")).text()), /href="\/lab"/);
  const response = await render("/design-preview?screen=portfolio");
  assert.equal(response.status, 404, "design fixtures must not be served by the production build");
});

test("transparency starts unverified, states its scope and keeps the experiment on a local copy", async () => {
  const response = await render("/products/ustx/transparency");
  const html = visible(await response.text());
  assert.equal(response.status, 200);
  assert.match(html, /Reading the published record/);
  assert.match(html, /Original composition document/);
  assert.match(html, /What a match confirms/);
  assert.match(html, /What it does not confirm/);
  assert.match(html, /latest 12 publications/);
  assert.match(html, /Download evidence/);
  assert.match(html, /npm run verify:evidence/);
  // The experiment is labelled as a browser copy and shows no result before the record is read.
  assert.match(html, /Try to break it/);
  assert.match(html, /edits a copy of the published document in your browser/);
  assert.match(html, /The published record is not changed/);
  assert.match(html, /starts once this browser has read the published record/);
  assert.doesNotMatch(html, /record and calculation match|Try changing one price|Try a change/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:[=>\s])/);
});

test("legacy paper products remain reachable and distinct from the customer portfolio", async () => {
  const response = await render("/lab/strategies/gmd-core");
  assert.equal(response.status, 200);
  const html = visible(await response.text());
  assert.match(html, /GANYMEDE CORE 20/);
  assert.match(html, /Review simulation/);
  assert.doesNotMatch(html, /\$23\.84/);
  const lab = visible(await (await render("/lab")).text());
  assert.match(lab, /Your paper portfolio/);
  assert.match(lab, /aria-label="Paper strategies"/);
  const exercise = visible(await (await render("/lab/verification")).text());
  assert.match(exercise, /Try changing one price/);
});

test("unknown ETF slugs return not found", async () => {
  assert.equal((await render("/etfs/not-a-real-etf")).status, 404);
});

test("Portfolio reads real xStocks read-only and offers the basket calculator", async () => {
  const html = visible(await (await render("/portfolio")).text());
  assert.match(html, /Connect wallet/);
  assert.match(html, /Or view any public address/);
  assert.match(html, /nothing is signed or sent/);
  assert.match(html, /Size a USTX-weighted basket/);
  assert.match(html, /not an order or a quote/);
  assert.doesNotMatch(html, /GMDCORE|testnet share records|Invest in USTX/);
});
