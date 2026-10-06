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
  const expected = [["/", "Markets"], ["/pools", "Pools"], ["/portfolio", "Portfolio"], ["/products/ustx/transparency", "Transparency"]];
  for (const [path, current, heading] of [
    ["/", "/", "US Tech Basket"],
    ["/pools", "/pools", "Provide liquidity to USTX"],
    ["/products/ustx", "/", "Fund overview"],
    ["/products/ustx/transparency", "/products/ustx/transparency", "Transparency"],
    ["/portfolio", "/portfolio", "Your wallet on X Layer"],
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

test("product pages offer investing from a wallet on X Layer Testnet next to the verification", async () => {
  for (const path of ["/", "/products/ustx", "/products/ustx/transparency"]) {
    const html = visible(await (await render(path)).text());
    assert.doesNotMatch(html, /Subscriptions not open|Investment access|Know what you own|before investing|Connect wallet|USDC/, path);
    assert.match(html, /href="\/products\/ustx\/transparency"/, path);
    assert.match(html, /X Layer Testnet/, path);
  }
  const product = visible(await (await render("/products/ustx")).text());
  assert.match(product, /Invest in USTX/);
  assert.match(product, /Borrow against USTX/);
  assert.match(product, /Borrow up to/);
  assert.match(product, /href="#borrow"/);
  assert.match(product, /href="\/pools"/, "the USTX page links to its liquidity pools");
  assert.match(product, /You are on X Layer Testnet/);
  assert.match(product, /No real stocks or money/);
  assert.match(product, /Invest from your own wallet on X Layer Testnet/);
  assert.doesNotMatch(product, /Demo balance|demo balance|Use demo balance/, "no balance held for a visitor off chain");
  assert.match(product, /USTX on X Layer Testnet/, "the share token in the fund facts");
  assert.match(product, /Price source/);
  assert.match(product, /OKX OnchainOS/);
  assert.doesNotMatch(product, /Testnet demo · demo dollars|Proof of NAV|model share/, "one testnet notice, customer wording");
  assert.match(product, /id="investment"/);
});

test("Pools offers the live pool's liquidity from a wallet, with its figures read in the browser", async () => {
  const response = await render("/pools");
  assert.equal(response.status, 200);
  const html = visible(await response.text());
  assert.match(html, /<h1>Pools<\/h1>/);
  assert.match(html, /USTX \/ dUSD/);
  assert.match(html, /Constant product/);
  assert.match(html, /Provide liquidity/);
  assert.match(html, /<div class="gmd-detail-aside" id="provide">/);
  assert.match(html, /href="#provide"/);
  assert.match(html, /Install the OKX Wallet extension/, "the panel asks for a wallet before the browser has one");
  assert.match(html, /How providing liquidity works/);
  assert.match(html, /If the NAV moves/);
  assert.match(html, /Pool activity/);
  assert.match(html, /Reading market activity from X Layer Testnet/);
  assert.match(html, /You are on X Layer Testnet\. Balances are demo funds with no real value\./);
  assert.match(html, /Demo dollars and USTX have no value/);
  // Figures come from the chain in the browser: nothing is invented on the server.
  assert.doesNotMatch(html, /Example account|\$12,454|Try to break it|npm run|viem|parseAbi|addLiquidity\(|Built on X Layer and OKX/);
  const grid = html.match(/<div class="gmd-fund-grid" aria-busy="true">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(grid, "the pool's figures wait for the chain");
  assert.doesNotMatch(grid, /\$\d/, "no amount before the chain is read");
  // The NAV calculator is plain arithmetic and starts at +10%.
  assert.match(html, /\$1,050\.00/);
  assert.match(html, /\$1,048\.81/);
  // The pinned Uniswap v4 pool is listed beside the live pool; its figures also wait for the chain.
  assert.match(html, /Uniswap v4 · held at the NAV/);
  // The two pools side by side for their providers, from the served totals once the page has them.
  assert.match(html, /Compare liquidity returns/);
  assert.match(html, /0\.30–1\.00%/);
  assert.match(html, /<title>Pools · Ganymede<\/title>/);
  assert.equal(html.match(/You are on X Layer Testnet/g).length, 1, "one testnet notice");
});

test("legacy URLs, the retired paper Lab's among them, route to the dollar product", async () => {
  for (const [path, target] of [["/?app=select", "/products/ustx"], ["/?app=portfolio", "/portfolio"], ["/proof", "/products/ustx/transparency"], ["/etfs/gmd-core", "/products/ustx"], ["/lab", "/portfolio"], ["/lab/strategies/gmd-core", "/products/ustx"], ["/lab/verification", "/developers"], ["/activity", "/products/ustx"], [`/activity/0x${"a".repeat(64)}`, "/products/ustx"]]) {
    const response = await render(path);
    assert.ok([307, 308].includes(response.status), `${path}: ${response.status}`);
    assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, target);
  }
});

test("public Portfolio does not contain the local example account or simulated balances, and no operator console is public", async () => {
  const html = visible(await (await render("/portfolio")).text());
  assert.doesNotMatch(html, /12,454|125\.250000|Example account|Preview processing/);
  const operations = visible(await (await render("/?app=operations")).text());
  assert.doesNotMatch(operations, /Operator workspace|Fund operations|operator access/i, "the old operator console is not served to the public");
  assert.match(operations, /US Tech Basket/);
  const missing = await render("/not-a-page");
  assert.equal(missing.status, 404);
  assert.match(visible(await missing.text()), /Page not found/);
  const response = await render("/design-preview?screen=portfolio");
  assert.equal(response.status, 404, "design fixtures must not be served by the production build");
});

test("transparency is a customer proof page that starts unverified and states its scope", async () => {
  const response = await render("/products/ustx/transparency");
  const html = visible(await response.text());
  assert.equal(response.status, 200);
  assert.match(html, /Checking the USTX price/);
  assert.match(html, /OKX market prices/);
  assert.match(html, /xStock pool prices/);
  assert.match(html, /Your browser’s result/);
  assert.match(html, /A calculation check, not a third price source/);
  assert.match(html, /Recent records/);
  assert.match(html, /Compare prices/);
  assert.match(html, /See the calculation/);
  assert.match(html, /Published record/);
  assert.match(html, /range is ±1% of the OKX basket value/);
  assert.match(html, /do not confirm asset backing/);
  assert.doesNotMatch(html, /Price checks complete|Record matches|Calculation matches/, "no success before browser checks complete");
  assert.doesNotMatch(html, /Try to break it|npm run|Who controls the contracts|SHA-256|Public RPC|JavaScript|fingerprint|The technical checks/);
  const prices = [...html.matchAll(/class="gmd-price-source[^"]*"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(prices.length, 3);
  assert.ok(prices.every(([, card]) => !/\$\d/.test(card)), "no fabricated price before data arrives");
});

test("the developer page keeps the checks, the experiment on a local copy and the evidence file", async () => {
  const html = visible(await (await render("/developers")).text());
  assert.match(html, /Verify it yourself/);
  assert.match(html, /Who controls the contracts/);
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

test("public pages are in US dollars and say nothing of paper portfolios", async () => {
  for (const path of ["/", "/pools", "/products/ustx", "/products/ustx/transparency", "/portfolio", "/developers", "/issuers", "/methodology", "/limitations"]) {
    const html = visible(await (await render(path)).text());
    assert.doesNotMatch(html, /\bKRW\b|₩|paper portfolio|paper strateg|Strategy Lab|GMDCORE|share ledger|earlier work/i, path);
    if (!["/developers", "/issuers"].includes(path)) {
      assert.doesNotMatch(html, /SHA-256|canonical JSON|npm run|Public RPC|product key|database budget|arbitrage keeper|unitsWad|priceMicros|Try to break it|Who controls the contracts/i, path);
    }
  }
});

test("unknown ETF slugs return not found", async () => {
  assert.equal((await render("/etfs/not-a-real-etf")).status, 404);
});

test("Portfolio reads real xStocks read-only and offers the basket calculator", async () => {
  const html = visible(await (await render("/portfolio")).text());
  assert.match(html, /Connect OKX Wallet/);
  assert.match(html, /Or view any public address/);
  assert.match(html, /does not request a payment or signature/);
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
  // Market activity is read in the browser, so the page arrives with the section and no rows.
  assert.match(product, /<section id="activity"[^>]*aria-labelledby="activity-title"/);
  assert.match(product, /Market activity/);
  assert.match(product, /href="#activity"/);
  assert.match(product, /Reading market activity from X Layer Testnet/);
  const markets = visible(await (await render("/")).text());
  assert.match(markets, /OKX OnchainOS/);
  // The cross-check sits on Markets; the USTX page links to Transparency instead of repeating it.
  assert.doesNotMatch(product, /gmd-price-confidence/);
  for (const html of [markets]) {
    assert.match(html, /gmd-price-confidence is-compact/);
    assert.match(html, /Two market sources/);
    assert.doesNotMatch(html, /Price checks complete/, "price comparison starts unchecked");
  }
  // Markets shows the latest activity in brief and links to the full list on the USTX page.
  assert.match(markets, /<section class="gmd-market-pulse" aria-labelledby="pulse-title">/);
  assert.match(markets, /href="\/products\/ustx#activity"/);
  assert.match(markets, /href="\/issuers"/);
  assert.match(markets, /href="\/developers"/);
});

test("issuer, developer and embed pages render for partners", async () => {
  const issuers = visible(await (await render("/issuers")).text());
  assert.match(issuers, /Give your basket a clear price/);
  assert.match(issuers, /Contact us/);
  assert.match(issuers, /Start on Testnet/);
  assert.match(issuers, /No paid issuer service or real-money fund is currently offered/);
  assert.doesNotMatch(issuers, /Roadmap|The road to mainnet|How Ganymede earns|database writes|configuration file|SHA-256/);
  const developers = visible(await (await render("/developers")).text());
  assert.match(developers, /\/api\/v1\/ustx/);
  assert.match(developers, /latestNav/);
  assert.match(developers, /href="\/api\/v1\/openapi.json"/);
  assert.match(developers, /href="\/llms.txt"/);
  assert.match(developers, /\/embed\/ustx/);
  assert.match(developers, /verify:evidence/);
  assert.match(developers, /Invest from a wallet or a contract/);
  assert.match(developers, /0x77eaeba1366bde7818da12d3cbdbea0a2ee97596/);
  assert.match(developers, /Read the NAV from a contract/);
  assert.match(developers, /Trade USTX on X Layer/);
  assert.match(developers, /A keeper checks the pool every five minutes and sends that trade when closing the gap earns at least a cent/);
  assert.match(developers, /quotes both the fund and the pool for each order and routes it to the better price/);
  assert.match(developers, /Use USTX as collateral/);
  assert.match(developers, /Provide liquidity/);
  assert.match(developers, /\/api\/v1\/ustx\/pools/);
  assert.match(developers, /npm run fork:v4/);
  assert.match(developers, /address\/0x96a78af00ef351f294f2ccc05adf09b119f968c0/);
  assert.match(developers, /0xae2f54ae3d0370295de18510d56de92afb8843c7/);
  assert.match(developers, /0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1/);
  assert.match(developers, /address\/0xccf372068496d9bef0f7cf83d697183d358dec1b/);
  assert.match(developers, /tx\/0xbec5c89a1546e65c1f03a4131c85c1ef50e1ac9e3f4e6e09f929b33f7c33d26f/);
  assert.match(developers, /AggregatorV3Interface\(0x292c56c5290Cc7B73e3eE33c2C2688eB3e04c3c8\)/);
  assert.doesNotMatch(developers, /never signs/, "OKX Wallet now signs orders on X Layer Testnet");
  const embed = await render("/embed/ustx");
  assert.equal(embed.status, 200);
  const badge = visible(await embed.text());
  assert.match(badge, /<h1>USTX · US Tech Basket<\/h1>/);
  assert.match(badge, /Checking the record/);
  assert.doesNotMatch(badge, /Primary navigation/);
  assert.equal(embed.headers.get("x-frame-options"), null, "partners can frame the badge");
  // A second basket, defined by a configuration file, is checked on the developer page and has its own badge.
  assert.match(developers, /Publish your own basket/);
  assert.match(developers, /\/embed\/basket\?config=\/baskets\/mag3\/basket\.json/);
  assert.match(developers, /npm run basket:publish/);
  const basket = await render("/embed/basket?config=/baskets/mag3/basket.json");
  assert.equal(basket.status, 200);
  assert.match(visible(await basket.text()), /Loading the basket/);
  assert.match(visible(await (await render("/embed/basket?config=https://other.example/basket.json")).text()), /No basket configured/);
});

test("Markets lists every fund, and each fund other than USTX has its own page", async () => {
  const markets = visible(await (await render("/")).text());
  assert.match(markets, /All products/);
  for (const label of ["RWA baskets", "Income", "Structured"]) assert.match(markets, new RegExp(label), "the category tabs");
  for (const [id, name, ticker] of [["spy-covered-call", "S&amp;P 500 Covered Call", "SPYC"], ["qqq-covered-call", "Nasdaq-100 Covered Call", "QQQC"], ["spy-qqq-autocall-1", "Step-Down Note", "ELS1"]]) {
    const html = visible(await (await render(`/funds/${id}`)).text());
    assert.match(html, new RegExp(name), id);
    assert.match(html, new RegExp(ticker), id);
    assert.match(html, /Demo product · model pricing/, id);
    assert.match(html, /no options market for xStocks on X Layer|nothing hedges it/, id);
  }
  for (const [id, name, ticker] of [["magnificent-7", "Magnificent 7", "M7X"], ["ai-chips", "AI &amp; Semiconductors", "AIX"], ["crypto-economy", "Crypto Economy", "CRYX"], ["us-core", "US Core Index", "CORX"], ["retail-favorites", "Retail Favorites", "RTLX"]]) {
    const response = await render(`/funds/${id}`);
    assert.equal(response.status, 200, id);
    const html = visible(await response.text());
    assert.match(html, new RegExp(name), id);
    assert.match(html, new RegExp(ticker), id);
    assert.match(html, /Demo fund/);
    assert.doesNotMatch(html, /KRW|paper portfolio/i);
  }
  assert.equal((await render("/funds/nope")).status, 404);
  const ustx = await render("/funds/us-tech-x");
  assert.equal(ustx.status, 307);
  assert.match(ustx.headers.get("location"), /\/products\/ustx$/);
});
