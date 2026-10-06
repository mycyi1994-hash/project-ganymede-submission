import assert from "node:assert/strict";
import test from "node:test";
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_INFO, MCP_TOOL_CALLS_PER_MINUTE, ToolInputError, handleMcp, takeToolCall } from "../lib/mcp/server.ts";
import { ustxTools } from "../app/mcp/tools.ts";
import { POST, GET, OPTIONS } from "../app/mcp/route.ts";
import { FUND_DEPLOYMENT, FUND_SELECTORS, POOL_SELECTORS } from "../lib/xstocks/fund.ts";
import { LIQUIDITY_SELECTORS } from "../lib/xstocks/liquidity.ts";
import { V4_POOL_DEPLOYMENT, V4_SELECTORS } from "../lib/xstocks/v4-liquidity.ts";
import { RANGE_POOL_DEPLOYMENT } from "../lib/xstocks/range-liquidity.ts";

const USD = 1_000_000n;
const word = (value) => (BigInt(value) & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const ORIGIN = "https://ganymede.example";
const post = (body) => new Request(`${ORIGIN}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

const ECHO = [{
  name: "echo", title: "Echo", description: "Returns its input.", inputSchema: { type: "object", properties: { text: { type: "string" } } },
  run: async (args) => {
    if (args.text === "bad") throw new ToolInputError("text must not be bad.");
    if (args.text === "down") throw new Error("connect ECONNREFUSED https://rpc.example");
    return { echoed: args.text };
  },
}];

test("initialize agrees a protocol version and names the server, its tools capability and how to use it", async () => {
  const known = await (await handleMcp(post(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "okx-ai", version: "1" } })), ECHO)).json();
  assert.deepEqual([known.jsonrpc, known.id, known.result.protocolVersion], ["2.0", 1, "2025-03-26"]);
  assert.deepEqual(known.result.serverInfo, MCP_SERVER_INFO);
  assert.deepEqual(known.result.capabilities, { tools: { listChanged: false } });
  assert.match(known.result.instructions, /USTX/);
  assert.match(known.result.instructions, /no value/);
  const unknown = await (await handleMcp(post(rpc("initialize", { protocolVersion: "1999-01-01" })), ECHO)).json();
  assert.equal(unknown.result.protocolVersion, MCP_PROTOCOL_VERSIONS[0], "an unknown version gets the latest supported");
});

test("notifications are accepted without a body, and a batch is answered as a batch", async () => {
  const accepted = await handleMcp(post({ jsonrpc: "2.0", method: "notifications/initialized" }), ECHO);
  assert.equal(accepted.status, 202);
  assert.equal(await accepted.text(), "");
  const batch = await (await handleMcp(post([rpc("ping", null, 7), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", null, 8)]), ECHO)).json();
  assert.deepEqual(batch.map(item => item.id), [7, 8]);
  assert.deepEqual(batch[0].result, {});
});

test("tools are listed read-only and called with their result as text and structured content", async () => {
  const listed = await (await handleMcp(post(rpc("tools/list")), ECHO)).json();
  const { name, title, description, inputSchema } = ECHO[0];
  assert.deepEqual(listed.result.tools, [{ name, title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } }]);
  const called = await (await handleMcp(post(rpc("tools/call", { name: "echo", arguments: { text: "hi" } })), ECHO)).json();
  assert.deepEqual(called.result.structuredContent, { echoed: "hi" });
  assert.deepEqual(JSON.parse(called.result.content[0].text), { echoed: "hi" });
  assert.equal(called.result.isError, false);
});

test("a wrong argument comes back as a tool error the model can correct; a failed read hides its details", async (t) => {
  const bad = await (await handleMcp(post(rpc("tools/call", { name: "echo", arguments: { text: "bad" } })), ECHO)).json();
  assert.deepEqual(bad.result, { content: [{ type: "text", text: "text must not be bad." }], isError: true });
  t.mock.method(console, "error", () => {});
  const down = await (await handleMcp(post(rpc("tools/call", { name: "echo", arguments: { text: "down" } })), ECHO)).json();
  assert.equal(down.result.isError, true);
  assert.doesNotMatch(down.result.content[0].text, /ECONNREFUSED|rpc\.example/);
  const missing = await (await handleMcp(post(rpc("tools/call", { name: "nope" })), ECHO)).json();
  assert.equal(missing.error.code, -32602);
  const method = await (await handleMcp(post(rpc("resources/list")), ECHO)).json();
  assert.equal(method.error.code, -32601);
});

test("malformed requests are refused, GET offers no stream, and any origin may call it", async () => {
  const parse = await handleMcp(post("{"), ECHO);
  assert.equal(parse.status, 400);
  assert.equal((await parse.json()).error.code, -32700);
  assert.equal((await (await handleMcp(post({ jsonrpc: "1.0", id: 1, method: "ping" }), ECHO)).json()).error.code, -32600);
  assert.equal((await handleMcp(post([]), ECHO)).status, 400);
  assert.equal((await handleMcp(post("x".repeat(70_000)), ECHO)).status, 413);
  const get = await GET(new Request(`${ORIGIN}/mcp`));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  const preflight = await OPTIONS(new Request(`${ORIGIN}/mcp`, { method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers"), /Mcp-Protocol-Version/);
});

test("the server offers its nine tools, all reads: seven for USTX and two for every product", async () => {
  const listed = await (await POST(post(rpc("tools/list")))).json();
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ["get_ustx_nav", "verify_ustx_nav", "get_ustx_holdings", "quote_ustx_order", "prepare_ustx_order", "get_ustx_pools", "get_ustx_market_activity", "list_funds", "get_fund"]);
  assert.ok(listed.result.tools.every(tool => tool.annotations.readOnlyHint && tool.inputSchema.type === "object" && tool.description.length > 40));
});

/** X Layer Testnet: the fund at $100, the constant-product pool holding 50 USTX and $5,000, and the v4 router's quote. */
function chain({ staleV4 = false } = {}) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first] = body.params ?? [];
    switch (body.method) {
      case "eth_chainId": return answer(hex(1952));
      case "eth_blockNumber": return answer(hex(100));
      case "eth_call": {
        const selector = first.data.slice(0, 10);
        if (first.to === FUND_DEPLOYMENT.pool && selector === POOL_SELECTORS.getReserves) return answer(`0x${word(50n * USD)}${word(5_000n * USD)}`);
        if (first.to === FUND_DEPLOYMENT.pool && selector === LIQUIDITY_SELECTORS.totalSupply) return answer(`0x${word(500n * USD)}`);
        if (first.to === FUND_DEPLOYMENT.fund && selector === FUND_SELECTORS.currentNav) return answer(`0x${word(100n * USD)}${word(1_790_000_000)}`);
        if (first.to === V4_POOL_DEPLOYMENT.router && selector === V4_SELECTORS.quoteExactInput) {
          return staleV4 ? Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data: `0xfad298ff${word(1_790_000_000n)}` } }) : answer(`0x${word(4_985_000n)}`);
        }
        if (first.to === V4_POOL_DEPLOYMENT.hook && selector === V4_SELECTORS.currentFee) return answer(`0x${word(3_300n)}`);
        if (selector === FUND_SELECTORS.allowance) return answer(`0x${word(0n)}`);
        throw new Error(`unexpected call ${first.to} ${selector}`);
      }
      default: throw new Error(`unexpected ${body.method}`);
    }
  };
}

const quote = ustxTools(ORIGIN).find(tool => tool.name === "quote_ustx_order");

test("an order is quoted at the fund, both pools and the best of them, with how to place it", async (t) => {
  t.mock.method(globalThis, "fetch", chain());
  const result = await quote.run({ side: "buy", amount: 500 });
  // $500 at $100: 5 USTX at the fund; the pool gives less after its fee and impact; the v4 pool quotes 4.985.
  assert.equal(result.amount, "500.000000 dUSD");
  assert.equal(result.navUsd, "100.000000");
  assert.deepEqual(result.venues.fund, { name: "Invest at the fund at the NAV", receive: "5.000000 USTX", pricePerShareUsd: "100.000000", fee: "none", unavailable: null });
  assert.equal(result.venues.pool.fee, "0.3%");
  assert.ok(BigInt(result.venues.pool.receive.split(".")[0]) < 5n);
  assert.deepEqual(result.venues.v4, { name: "Uniswap v4 pool held at the NAV", receive: "4.985000 USTX", pricePerShareUsd: "100.300902", fee: "0.33%", unavailable: null });
  assert.equal(result.best, "fund");
  assert.match(result.howToExecute, /\/products\/ustx/);
  assert.match(result.environment, /no value/);
});

test("a stale v4 pool quotes nothing and says why, and wrong arguments are explained", async (t) => {
  t.mock.method(globalThis, "fetch", chain({ staleV4: true }));
  const result = await quote.run({ side: "sell", amount: "1.5" });
  assert.equal(result.venues.fund.receive, "150.000000 dUSD");
  assert.equal(result.venues.v4.receive, null);
  assert.match(result.venues.v4.unavailable, /over an hour old/);
  await assert.rejects(quote.run({ side: "hold", amount: 1 }), /side must be/);
  await assert.rejects(quote.run({ side: "buy", amount: 5 }), /between 10\.000000/);
  await assert.rejects(quote.run({ side: "buy", amount: "1.1234567" }), /at most six decimals/);
  await assert.rejects(quote.run({ side: "buy", amount: -3 }), /positive number/);
});

test("a batch holds at most four messages, and each address makes a limited number of tool calls a minute", async () => {
  const many = await handleMcp(post([1, 2, 3, 4, 5].map(id => rpc("ping", null, id))), ECHO);
  assert.equal(many.status, 400);
  assert.match((await many.json()).error.message, /at most 4/);
  const start = Date.now();
  for (let call = 0; call < MCP_TOOL_CALLS_PER_MINUTE; call++) assert.equal(takeToolCall("203.0.113.9", start), true);
  assert.equal(takeToolCall("203.0.113.9", start + 1_000), false, "the next call in the same minute is refused");
  assert.equal(takeToolCall("203.0.113.10", start + 1_000), true, "another address is counted apart");
  assert.equal(takeToolCall("203.0.113.9", start + 61_000), true, "a minute later it may call again");
  const flooded = new Request(`${ORIGIN}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.7" }, body: JSON.stringify(rpc("tools/call", { name: "echo", arguments: { text: "hi" } })) });
  for (let call = 0; call < MCP_TOOL_CALLS_PER_MINUTE; call++) takeToolCall("198.51.100.7");
  const refused = await handleMcp(flooded, ECHO);
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).error.code, -32000);
});

/** A wallet on X Layer Testnet with $1,000 of demo dollars and nothing approved, beside the chain() pools. */
function walletChain({ staleFund = false } = {}) {
  const base = chain();
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const answer = (result) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const [first] = body.params ?? [];
    if (body.method === "eth_getBalance") return answer(hex(10n ** 18n));
    if (body.method === "eth_getBlockByNumber") return answer({ number: hex(100), timestamp: hex(1_790_000_000) });
    if (body.method === "eth_call") {
      const selector = first.data.slice(0, 10);
      if (staleFund && first.to === FUND_DEPLOYMENT.fund && selector === FUND_SELECTORS.currentNav) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data: "0x12345678" } });
      if (first.to === FUND_DEPLOYMENT.dollar && selector === FUND_SELECTORS.balanceOf) return answer(`0x${word(1_000n * USD)}`);
      if (first.to === FUND_DEPLOYMENT.fund && selector === FUND_SELECTORS.balanceOf) return answer(`0x${word(0n)}`);
      if (first.to === FUND_DEPLOYMENT.dollar && selector === FUND_SELECTORS.nextClaimAt) return answer(`0x${word(2_000_000_000n)}`);
      if (RANGE_POOL_DEPLOYMENT && first.to === RANGE_POOL_DEPLOYMENT.router && selector === V4_SELECTORS.quoteExactInput && first.data.includes(RANGE_POOL_DEPLOYMENT.hook.slice(2))) return answer(`0x${word(4_990_000n)}`);
      if (RANGE_POOL_DEPLOYMENT && first.to === RANGE_POOL_DEPLOYMENT.hook && selector === V4_SELECTORS.currentFee) return answer(`0x${word(3_000n)}`);
    }
    return base(url, init);
  };
}

const prepare = ustxTools(ORIGIN).find(tool => tool.name === "prepare_ustx_order");
const WALLET = `0x${"ab".repeat(20)}`;

test("an order is prepared as unsigned transactions for the wallet: the approval it lacks, then the order at the best venue", async (t) => {
  t.mock.method(globalThis, "fetch", walletChain());
  const result = await prepare.run({ side: "buy", amount: 500, wallet: WALLET });
  // $500 at $100 a share: the fund gives 5 USTX, more than the pools; nothing is approved yet.
  assert.equal(result.venue, "fund");
  assert.deepEqual(result.chain.chainId, "0x7a0");
  assert.equal(result.from, WALLET);
  assert.deepEqual(result.transactions.map(({ to, value }) => [to, value]), [[FUND_DEPLOYMENT.dollar, "0x0"], [FUND_DEPLOYMENT.fund, "0x0"]]);
  assert.equal(result.transactions[0].data, `${FUND_SELECTORS.approve}${word(BigInt(FUND_DEPLOYMENT.fund))}${word(500n * USD)}`);
  assert.equal(result.transactions[1].data, `${FUND_SELECTORS.invest}${word(500n * USD)}${word(4_950_000n)}`, "the minimum is the quote less 1%");
  assert.deepEqual([result.receive, result.minimumReceive, result.enough], ["5.000000 USTX", "4.950000 USTX", true]);
  assert.match(result.howToSign, /eth_sendTransaction/);
  // A pool named takes a deadline and its own approval; the range pool is quoted through the same router.
  const range = await prepare.run({ side: "buy", amount: 500, wallet: WALLET, venue: "range" });
  assert.equal(range.venue, "range");
  assert.equal(range.receive, "4.990000 USTX");
  assert.equal(range.transactions.at(-1).to, RANGE_POOL_DEPLOYMENT.router);
  assert.ok(Date.parse(range.deadline) > Date.now());
  await assert.rejects(prepare.run({ side: "buy", amount: 500, wallet: "0x123" }), /wallet must be/);
  await assert.rejects(prepare.run({ side: "buy", amount: 500, wallet: WALLET, venue: "moon" }), /venue must be/);
});

test("while the fund refuses a stale NAV, the best venue is not prepared, and a pool only when named", async (t) => {
  t.mock.method(globalThis, "fetch", walletChain({ staleFund: true }));
  const best = await prepare.run({ side: "buy", amount: 500, wallet: WALLET });
  assert.deepEqual(best.transactions, []);
  assert.match(best.unavailable, /over an hour old/);
  assert.match(best.unavailable, /Name venue "pool"/);
  const pool = await prepare.run({ side: "buy", amount: 500, wallet: WALLET, venue: "pool" });
  assert.equal(pool.venue, "pool");
  assert.equal(pool.transactions.at(-1).to, FUND_DEPLOYMENT.pool);
  const quoted = await quote.run({ side: "buy", amount: 500 });
  assert.match(quoted.venues.fund.unavailable, /over an hour old/);
});
