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

test("server-renders the Ganymede landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Ganymede/);
  assert.match(html, /Six holdings. One reported value/);
  assert.match(html, /Try verification/);
  assert.match(html, /An index you/);
  assert.match(html, /can inspect/);
  assert.match(html, /href="\/proof"/);
  assert.match(html, /Last published NAV/);
  assert.match(html, /Model basket/);
  assert.match(html, /X Layer Testnet/);
});

test("direct ETF detail URLs render product and basket data", async () => {
  const response = await render("/etfs/gmd-core");
  assert.equal(response.status, 200);
  const html = (await response.text()).replaceAll("<!-- -->", "");
  assert.match(html, /GANYMEDE CORE 20/);
  assert.match(html, /PRE-LAUNCH TEST ENVIRONMENT/);
  assert.match(html, /INDICATIVE FUND DATA/);
  assert.match(html, /INDICATIVE NAV/);
  assert.match(html, /Model results/);
  assert.match(html, /HOLDINGS/);
  assert.match(html, /INVESTMENT OBJECTIVE/);
  assert.match(html, /Review simulation/);
  assert.match(html, /THE FOUNDATION/);
  assert.match(html, /X Layer Testnet/);
  const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.doesNotMatch(visibleHtml, /\$23\.84/);
  assert.match(html, /LOADING DATA/);
  assert.match(html, /MODEL HOLDINGS/);
  assert.match(html, /ILLUSTRATIVE YEARLY FEE/);
  assert.match(html, /Not an upfront charge/);
});

test("proof page distinguishes loading from missing configuration", async () => {
  const response = await render("/proof");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /LOADING DATA/);
  assert.match(html, /Loading publications/);
  assert.doesNotMatch(html, /AWAITING CONFIGURATION/);
  assert.match(html, /Last published NAV/);
  assert.match(html, /The original document/);
  assert.match(html, /Recalculated NAV/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:[=>\s])/);
});

test("unknown ETF slugs return not found", async () => {
  const response = await render("/etfs/not-a-real-etf");
  assert.equal(response.status, 404);
});

test("all public screens keep the same primary links and select the requested section before hydration", async () => {
  const links = [
    ["/", "Overview"], ["/?app=select", "Basket"],
    ["/proof", "Verify NAV"], ["/?app=portfolio", "Paper lab"],
  ];
  for (const [path, active, heading] of [
    ["/", "/", "An index you"],
    ["/?app=select", "/?app=select", "Start with what’s inside"],
    ["/?app=portfolio", "/?app=portfolio", "Your paper portfolio"],
    ["/etfs/gmd-core", "/?app=portfolio", "GANYMEDE CORE 20"],
    ["/proof", "/proof", "Last published NAV"],
  ]) {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const nav = html.match(/<nav\b[^>]*aria-label="Primary navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(nav, `${path} must provide primary navigation`);
    const anchors = [...nav.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)];
    assert.deepEqual(anchors.map(([, attrs, label]) => [attrs.match(/href="([^"]*)"/)?.[1], label]), links);
    const selected = anchors.filter(([, attrs]) => attrs.includes('aria-current="page"'));
    assert.equal(selected.length, 1, `${path} must select exactly one section`);
    assert.ok(selected[0][1].includes(`href="${active}"`));
    assert.ok(html.includes(heading), `${path} must render its content directly`);
    if (path.includes("?app=")) assert.ok(!html.includes('id="hero-title"'), "App screens must not first render the landing page");
  }
});

test("basket and simulation journeys stay separate, with proof links in reading order", async () => {
  const visible = async (url) => (await (await render(url)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const basket = await visible('/?app=select');
  assert.match(basket, /What makes up one model share/);
  assert.doesNotMatch(basket, /aria-label="Paper strategies"/);
  const lab = await visible('/?app=portfolio');
  assert.match(lab, /aria-label="Paper strategies"/);
  assert.match(lab, /id="paper-strategy-lab"/);
  const proof = await visible('/proof');
  assert.ok(proof.indexOf('href="#proof-verify"') < proof.indexOf('href="#proof-holdings"'));
  assert.ok(proof.indexOf('id="proof-experiment"') < proof.indexOf('id="proof-holdings"'));
  assert.match(proof, /<details[^>]*journey-examples/);
});
