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
  assert.match(html, />Invest </);
  assert.match(html, /You are on X Layer Testnet\. Balances are demo funds with no real value\./);
  assert.match(html, /Connect OKX Wallet/);
  assert.match(html, /NAV per share/);
  assert.match(html, /Priced by OKX OnchainOS/);
  assert.doesNotMatch(html, /Try to break it|Recent investor activity|Built on X Layer and OKX|What you can do/, "no pitch or developer material on the customer page");
  assert.match(html, /href="\/products\/ustx#investment"/);
  assert.doesNotMatch(html, /Try verification|Try changing one price|<img\b[^>]*clearform-stack/);
  assert.doesNotMatch(html, /\$12,454|Example account/);
});

test("public product routes share navigation and select the right destination before hydration", async () => {
  const expected = [["/", "Markets"], ["/portfolio", "Portfolio"], ["/products/ustx/transparency", "Transparency"]];
  for (const [path, current, heading] of [
    ["/", "/", "US Tech Basket"],
    ["/products/ustx", "/", "About USTX"],
    ["/products/ustx/transparency", "/products/ustx/transparency", "Transparency"],
    ["/portfolio", "/portfolio", "Your wallet on X Layer"],
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

test("product pages offer clearly labelled demo investing next to the verification", async () => {
  for (const path of ["/", "/products/ustx", "/products/ustx/transparency"]) {
    const html = visible(await (await render(path)).text());
    assert.doesNotMatch(html, /Subscriptions not open|Investment access|Know what you own|before investing|Connect wallet|USDC/, path);
    assert.match(html, /href="\/products\/ustx\/transparency"/, path);
    assert.match(html, /X Layer Testnet/, path);
  }
  const product = visible(await (await render("/products/ustx")).text());
  assert.match(product, /Invest in USTX/);
  assert.match(product, /You are on X Layer Testnet/);
  assert.match(product, /no real money moves/);
  assert.match(product, /aria-label="Pay with"/);
  assert.match(product, /Demo balance/);
  assert.match(product, /USTX on X Layer Testnet/, "the share token in the fund facts");
  assert.match(product, /Price oracle/);
  assert.match(product, /OKX OnchainOS/);
  assert.doesNotMatch(product, /Testnet demo · demo dollars|Proof of NAV|model share/, "one testnet notice, customer wording");
  assert.match(product, /id="investment"/);
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

test("transparency is a customer proof page that starts unverified and states its scope", async () => {
  const response = await render("/products/ustx/transparency");
  const html = visible(await response.text());
  assert.equal(response.status, 200);
  assert.match(html, /Checking the latest NAV/);
  assert.match(html, /Priced by OKX OnchainOS/);
  assert.match(html, /Recorded on X Layer/);
  assert.match(html, /Recent records/);
  assert.match(html, /What verification covers/);
  assert.match(html, /What it does not cover/);
  assert.match(html, /href="\/developers#verify"/);
  // Developer material lives on /developers, not on the customer page.
  assert.doesNotMatch(html, /Try to break it|npm run verify:evidence|Original composition document|NAV verified on X Layer/);
});

test("the developer page keeps the checks, the experiment on a local copy and the evidence file", async () => {
  const html = visible(await (await render("/developers")).text());
  assert.match(html, /Verify it yourself/);
  assert.match(html, /Reading the published record/);
  assert.match(html, /Original composition document/);
  assert.match(html, /latest 12 publications/);
  assert.match(html, /Download evidence/);
  assert.match(html, /npm run verify:evidence/);
  // The experiment is labelled as a browser copy and shows no result before the record is read.
  assert.match(html, /Try to break it/);
  assert.match(html, /edits a copy of the published document in your browser/);
  assert.match(html, /The published record is not changed/);
  assert.match(html, /starts once this browser has read the published record/);
  assert.doesNotMatch(html, /All three checks pass|Try changing one price|Try a change/);
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
  assert.match(html, /Connect OKX Wallet/);
  assert.match(html, /Or view any public address/);
  assert.match(html, /nothing is signed or sent/);
  assert.match(html, /Your wallet on X Layer/);
  assert.doesNotMatch(html, /Size a USTX-weighted basket/);
  assert.doesNotMatch(html, /GMDCORE|testnet share records|Invest in USTX/);
});

test("the product page shows fund figures and Markets shows the OKX and X Layer integration", async () => {
  const product = visible(await (await render("/products/ustx")).text());
  assert.match(product, /Fund overview/);
  assert.match(product, /href="#overview"/);
  assert.match(product, /Minimum investment/);
  assert.match(product, /Net flows, 24h/);
  assert.doesNotMatch(product, /Recent investor activity/);
  const markets = visible(await (await render("/")).text());
  assert.match(markets, /OKX OnchainOS/);
  assert.match(markets, /href="\/issuers"/);
  assert.match(markets, /href="\/developers"/);
});

test("issuer, developer and embed pages render for partners", async () => {
  const issuers = visible(await (await render("/issuers")).text());
  assert.match(issuers, /Launch a basket investors can verify/);
  assert.match(issuers, /Plans/);
  assert.match(issuers, /Contact us/);
  assert.doesNotMatch(issuers, /Roadmap|Planned/);
  const developers = visible(await (await render("/developers")).text());
  assert.match(developers, /\/api\/v1\/ustx/);
  assert.match(developers, /latestNav/);
  assert.match(developers, /\/embed\/ustx/);
  assert.match(developers, /verify:evidence/);
  assert.match(developers, /Invest from a wallet or a contract/);
  assert.match(developers, /0x77eaeba1366bde7818da12d3cbdbea0a2ee97596/);
  assert.doesNotMatch(developers, /never signs/, "OKX Wallet now signs orders on X Layer Testnet");
  const embed = await render("/embed/ustx");
  assert.equal(embed.status, 200);
  const badge = visible(await embed.text());
  assert.match(badge, /<h1>USTX · US Tech Basket<\/h1>/);
  assert.match(badge, /Checking the record/);
  assert.doesNotMatch(badge, /Primary navigation/);
  assert.equal(embed.headers.get("x-frame-options"), null, "partners can frame the badge");
});
