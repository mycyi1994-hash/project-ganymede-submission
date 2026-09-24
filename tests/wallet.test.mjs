import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBasket, constituentsWithAddresses, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { decodeSymbol, MAINNET, readBalances, readTokenFacts, tokenExplorerUrl, XSTOCK_TOKENS } from "../lib/xstocks/mainnet.ts";
import { buildStatement, formatUnits, parseUsd, planBasket, valueWallet } from "../lib/xstocks/wallet.ts";

const now = "2026-09-24T13:30:00.000Z";
const WAD = 10n ** 18n;

async function composition() {
  const constituents = constituentsWithAddresses(XSTOCK_TOKENS.map((token) => `${token.symbol}=${token.address}`).join(","));
  const quotes = new Map(XSTOCK_TOKENS.map((token, i) => [token.symbol, { symbol: token.symbol, address: token.address, priceMicros: 200_000_000n + BigInt(i) * 50_000_000n, time: now, source: "test" }]));
  return (await evaluateBasket({ constituents, quotes, previous: null, now, maxQuoteAgeMinutes: 60 })).composition;
}

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const abiString = (text) => "0x" + word(32) + word(text.length) + Buffer.from(text).toString("hex").padEnd(64, "0");
function rpc(handler) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return Response.json(body.map((call) => ({ jsonrpc: "2.0", id: call.id, result: handler(call) })));
  };
  return { fetcher, calls };
}

test("the pinned xStock list covers the basket's constituents in order", () => {
  assert.deepEqual(XSTOCK_TOKENS.map((token) => token.symbol), XSTOCKS_CONSTITUENTS.map((item) => item.symbol));
  for (const token of XSTOCK_TOKENS) assert.match(token.address, /^0x[0-9a-f]{40}$/);
  assert.equal(MAINNET.chainId, 196);
  assert.equal(tokenExplorerUrl(XSTOCK_TOKENS[0].address), `https://web3.okx.com/explorer/x-layer/token/${XSTOCK_TOKENS[0].address}`);
});

test("wallet value uses the verified document's price per token address with integer truncation", async () => {
  const doc = await composition();
  const balances = { owner: "0x" + "a".repeat(40), blockNumber: 10, blockTime: now, balances: XSTOCK_TOKENS.map((token, i) => ({ ...token, units: (BigInt(i) * WAD / 3n).toString() })) };
  const valuation = valueWallet(balances, doc);
  let total = 0n;
  for (const [i, row] of valuation.rows.entries()) {
    const price = BigInt(doc.holdings.find((holding) => holding.address === XSTOCK_TOKENS[i].address).priceMicros);
    const expected = (BigInt(i) * WAD / 3n) * price / WAD;
    assert.equal(row.valueMicros, expected.toString());
    total += expected;
  }
  assert.equal(valuation.totalMicros, total.toString());
  assert.equal(valuation.rows[0].weightBps, 0);
  assert.ok(valuation.rows.reduce((sum, row) => sum + row.weightBps, 0) <= 10_000);
  assert.ok(valuation.rows.every((row) => row.modelWeightBps > 1600 && row.modelWeightBps < 1700));
  const statement = buildStatement(balances, valuation, { effectiveAt: now, holdingsHash: "0x" + "1".repeat(64), transactionHash: null }, new Date(now));
  assert.equal(statement.balances.blockNumber, 10);
  assert.equal(statement.totalValueMicros, valuation.totalMicros);
  assert.equal(statement.holdings.length, 6);
  const empty = valueWallet({ ...balances, balances: balances.balances.map((row) => ({ ...row, units: "0" })) }, doc);
  assert.equal(empty.totalMicros, "0");
  assert.throws(() => valueWallet({ ...balances, balances: [{ symbol: "XYZx", address: "0x" + "9".repeat(40), units: "1" }] }, doc));
});

test("the basket plan splits an amount by current value weights without exceeding it", async () => {
  const doc = await composition();
  const plan = planBasket(1_000_000_000n, doc);
  assert.equal(plan.length, 6);
  const spent = plan.reduce((sum, row) => sum + BigInt(row.usdMicros), 0n);
  assert.ok(spent <= 1_000_000_000n && spent > 999_999_990n);
  for (const row of plan) assert.equal(row.units, (BigInt(row.usdMicros) * WAD / BigInt(row.priceMicros)).toString());
  assert.deepEqual(planBasket(0n, doc), []);
  assert.equal(parseUsd("1,000"), 1_000_000_000n);
  assert.equal(parseUsd("$250.5"), 250_500_000n);
  assert.equal(parseUsd("abc"), null);
  assert.equal(parseUsd("1.1234567"), null);
  assert.equal(formatUnits((WAD * 3n / 2n).toString()), "1.500000");
});

test("balances are read at one block after confirming X Layer mainnet", async () => {
  const owner = "0x" + "b".repeat(40);
  const { fetcher, calls } = rpc((call) => {
    if (call.method === "eth_chainId") return "0xc4";
    if (call.method === "eth_blockNumber") return "0x3e8";
    if (call.method === "eth_getBlockByNumber") return { timestamp: "0x66f2a000" };
    return "0x" + word(call.params[0].to === XSTOCK_TOKENS[2].address ? 5n * WAD : 0n);
  });
  const balances = await readBalances(owner, fetcher);
  assert.equal(balances.blockNumber, 1000);
  assert.equal(balances.balances[2].units, (5n * WAD).toString());
  assert.ok(calls[1].filter((call) => call.method === "eth_call").every((call) => call.params[1] === "0x3e8" && call.params[0].data.endsWith("b".repeat(40))));
  const wrongChain = rpc((call) => call.method === "eth_chainId" ? "0x7a0" : "0x1");
  await assert.rejects(readBalances(owner, wrongChain.fetcher), /not X Layer mainnet/);
  await assert.rejects(readBalances("0x1234", fetcher), /valid public EVM address/);
});

test("token facts require code, the expected symbol and 18 decimals", async () => {
  const { fetcher } = rpc((call) => {
    if (call.method === "eth_chainId") return "0xc4";
    if (call.method === "eth_getCode") return call.params[0] === XSTOCK_TOKENS[5].address ? "0x" : "0x6080";
    const token = XSTOCK_TOKENS.find((item) => item.address === call.params[0].to);
    if (call.params[0].data === "0x95d89b41") return abiString(token === XSTOCK_TOKENS[1] ? "FAKE" : token.symbol);
    return "0x" + word(18);
  });
  const facts = await readTokenFacts(fetcher);
  assert.deepEqual(facts.map((fact) => fact.matches), [true, false, true, true, true, false]);
  // The public RPC rejects batches of more than 10 calls, so the 19 reads are split.
  const { fetcher: counting, calls } = rpc((call) => call.method === "eth_chainId" ? "0xc4" : call.method === "eth_getCode" ? "0x60" : call.params[0].data === "0x95d89b41" ? abiString(XSTOCK_TOKENS.find((item) => item.address === call.params[0].to).symbol) : "0x" + word(18));
  assert.ok((await readTokenFacts(counting)).every((fact) => fact.matches));
  assert.ok(calls.length >= 2 && calls.every((body) => body.length <= 10));
  assert.equal(facts[1].chainSymbol, "FAKE");
  assert.equal(decodeSymbol("0x" + Buffer.from("AAPLx").toString("hex").padEnd(64, "0")), "AAPLx");
  assert.equal(decodeSymbol("not hex"), null);
});
