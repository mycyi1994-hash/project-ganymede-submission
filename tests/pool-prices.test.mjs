import assert from "node:assert/strict";
import test from "node:test";
import { comparePrices, formatDifference, poolPriceMicros, POOL_FACTORY, readPoolPrices, XSTOCK_POOLS } from "../lib/xstocks/pool-prices.ts";
import { runXStocksCycle, STATE_LATEST } from "../lib/xstocks/cycle.ts";
import { XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";

// sqrtPriceX96 and the wrapper rate read from X Layer mainnet on 25 September 2026, with the prices
// they give; every pool but MSFTx lists the stablecoin first.
const SNAPSHOT = {
  AAPLx: { sqrt: "4294489313063688175353045796660612", rate: "1003269012539818700", micros: "339249108" },
  MSFTx: { sqrt: "1807632206191072682304369", rate: "1005903390478745600", micros: "517493264" },
  NVDAx: { sqrt: "5282611802738843163291539009468840", rate: "1001701196801074000", micros: "224555439" },
  AMZNx: { sqrt: "5005966426575011346018237028070874", rate: "1000000000000000000", micros: "250485910" },
  METAx: { sqrt: "2889457901570345100966747783134730", rate: "1002851543327289800", micros: "749703912" },
  TSLAx: { sqrt: "4107125565436188973220897818428118", rate: "1000000000000000000", micros: "372120166" },
};

test("a pool's sqrt price and the wrapper rate give dollars per whole xStock", () => {
  for (const pool of XSTOCK_POOLS) {
    const { sqrt, rate, micros } = SNAPSHOT[pool.symbol];
    assert.equal(poolPriceMicros(BigInt(sqrt), pool.symbol !== "MSFTx", BigInt(rate)).toString(), micros, pool.symbol);
  }
  assert.throws(() => poolPriceMicros(0n, true, 10n ** 18n), /no price/);
});

const word = (value) => (typeof value === "string" ? value.replace(/^0x/, "") : value.toString(16)).padStart(64, "0");

/** A mainnet RPC that answers the batch calls from the snapshot; `change` edits one answer. */
function mainnet(change = () => undefined) {
  const requests = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://rpc.xlayer.tech");
    const calls = JSON.parse(init.body);
    requests.push(calls.length);
    assert.ok(calls.length <= 10, "the public RPC answers at most ten calls a request");
    return Response.json(calls.map(({ id, method, params }) => {
      let result;
      if (method === "eth_chainId") result = "0xc4";
      else if (method === "eth_blockNumber") result = "0x4445a1f";
      else if (method === "eth_getBlockByNumber") result = { timestamp: "0x68d5780b" };
      else {
        const { to, data } = params[0];
        const pool = XSTOCK_POOLS.find((entry) => [entry.wrapper, entry.pool].includes(to) || (to === POOL_FACTORY && data.includes(entry.wrapper.slice(2))));
        if (data === "0x313ce567") result = "0x" + word(pool ? 18 : 6);
        else if (to === POOL_FACTORY) result = "0x" + word(pool.pool);
        else if (data === "0x38d52e0f") result = "0x" + word(pool.token);
        else if (data.startsWith("0x07a2d13a")) result = "0x" + word(BigInt(SNAPSHOT[pool.symbol].rate));
        else if (data === "0x0dfe1681") result = "0x" + word(pool.symbol === "MSFTx" ? pool.wrapper : pool.stable.address);
        else if (data === "0x3850c7bd") result = "0x" + word(BigInt(SNAPSHOT[pool.symbol].sqrt)) + word(0).repeat(6);
      }
      return { jsonrpc: "2.0", id, result: change({ method, params, result }) ?? result };
    }));
  };
  return { fetcher, requests };
}

test("the browser reads every pool at one block after confirming the pool and the wrapper", async () => {
  const { fetcher, requests } = mainnet();
  const read = await readPoolPrices(fetcher);
  assert.equal(read.blockNumber, 71588383);
  assert.deepEqual(read.prices.map((price) => [price.symbol, price.priceMicros]), XSTOCK_POOLS.map((pool) => [pool.symbol, SNAPSHOT[pool.symbol].micros]));
  assert.deepEqual(requests, [2, 10, 10, 10, 9]);
  // A pool the factory does not name, a wrapper around another token, or another chain is refused.
  const elsewhere = "0x" + "9".repeat(40);
  await assert.rejects(readPoolPrices(mainnet(({ params, result }) => params[0]?.to === POOL_FACTORY && params[0].data.includes(XSTOCK_POOLS[0].wrapper.slice(2)) ? "0x" + word(elsewhere) : result).fetcher), /different AAPLx pool/);
  await assert.rejects(readPoolPrices(mainnet(({ params, result }) => params[0]?.to === XSTOCK_POOLS[5].wrapper && params[0].data === "0x38d52e0f" ? "0x" + word(elsewhere) : result).fetcher), /no longer holds TSLAx/);
  await assert.rejects(readPoolPrices(mainnet(({ method, result }) => method === "eth_chainId" ? "0x1" : result).fetcher), /not X Layer mainnet/);
});

function composition(priceOf) {
  const holdings = XSTOCK_POOLS.map((pool) => ({ symbol: pool.symbol, address: pool.token, weightBps: 1667, unitsWad: "50000000000000000", priceMicros: priceOf(pool.symbol), valueMicros: "0", priceTime: "", priceSource: "" }));
  const nav = holdings.reduce((sum, row) => sum + (BigInt(row.unitsWad) * BigInt(row.priceMicros)) / 10n ** 18n, 0n);
  return { holdings, navPerShareMicros: nav.toString() };
}
const pools = { prices: XSTOCK_POOLS.map((pool) => ({ symbol: pool.symbol, token: pool.token, pool: pool.pool, stable: pool.stable.symbol, priceMicros: SNAPSHOT[pool.symbol].micros })) };

test("recorded prices agree with the pools when the NAV at pool prices is within 1%", () => {
  const same = comparePrices(composition((symbol) => SNAPSHOT[symbol].micros), pools);
  assert.equal(same.agrees, true);
  assert.equal(same.navDifferenceBps, 0);
  assert.equal(same.poolNavMicros, same.recordedNavMicros);
  // One thin pool moved 6% by a trade moves this NAV by under 1%, so the record still agrees...
  const moved = comparePrices(composition((symbol) => symbol === "AAPLx" ? (BigInt(SNAPSHOT.AAPLx.micros) * 106n / 100n).toString() : SNAPSHOT[symbol].micros), pools);
  assert.equal(formatDifference(moved.rows[0].differenceBps), "−5.66%");
  assert.equal(moved.agrees, true);
  // ...while a wrong price of 10% on the largest holding moves it by more.
  const wrong = comparePrices(composition((symbol) => symbol === "METAx" ? (BigInt(SNAPSHOT.METAx.micros) * 110n / 100n).toString() : SNAPSHOT[symbol].micros), pools);
  assert.equal(wrong.agrees, false);
  assert.ok(wrong.navDifferenceBps < -100);
  // A document of other tokens is never compared with these pools.
  const other = composition((symbol) => SNAPSHOT[symbol].micros);
  other.holdings[0].address = "0x" + "1".repeat(40);
  assert.equal(comparePrices(other, pools), null);
  assert.equal(formatDifference(12), "+0.12%");
  assert.equal(formatDifference(-0.4), "0.00%");
});

const credentials = { OKX_API_KEY: "k", OKX_API_SECRET: "s", OKX_API_PASSPHRASE: "p", XSTOCKS_ADDRESSES: XSTOCK_POOLS.map((pool) => `${pool.symbol}=${pool.token}`).join(",") };
function memoryRepo() {
  const rows = new Map();
  return { rows, async getState(key) { return rows.has(key) ? { value: rows.get(key) } : null; }, async setState(key, value) { rows.set(key, value); }, async saveSettlement() {}, async deleteStatesWithPrefix() {} };
}
const now = "2026-09-25T17:20:00.000Z";
const quotes = (priceOf) => async () => Response.json({ code: "0", data: XSTOCK_POOLS.map((pool) => ({ chainIndex: "196", tokenContractAddress: pool.token, price: (Number(priceOf(pool.symbol)) / 1e6).toString(), time: now })) });

test("the publisher records a NAV only when OnchainOS agrees with the pools, and goes ahead if they cannot be read", async (t) => {
  assert.equal(XSTOCKS_CONSTITUENTS.length, XSTOCK_POOLS.length);
  const run = async (priceOf, poolPrices) => {
    const repo = memoryRepo();
    const requests = [];
    const settlement = { async settle(request) { requests.push(request); return { id: "stl", payloadHash: "0x", blockNumber: null, status: "confirmed", txHash: "0x1", error: null }; } };
    t.mock.method(globalThis, "fetch", quotes(priceOf));
    const result = await runXStocksCycle(credentials, repo, settlement, now, { poolPrices });
    t.mock.restoreAll();
    return { result, requests, latest: JSON.parse(repo.rows.get(STATE_LATEST)) };
  };
  const read = async () => ({ blockNumber: 71588383, blockTime: now, ...pools });
  const agreed = await run((symbol) => SNAPSHOT[symbol].micros, read);
  assert.equal(agreed.requests.filter((request) => request.action === "publish_nav").length, 1);
  assert.deepEqual(agreed.latest.blockers, []);

  const wrong = await run((symbol) => symbol === "NVDAx" ? (BigInt(SNAPSHOT.NVDAx.micros) * 10n).toString() : SNAPSHOT[symbol].micros, read);
  assert.equal(wrong.requests.filter((request) => request.action === "publish_nav").length, 0);
  assert.match(wrong.latest.blockers.join(" "), /The NAV at the X Layer pools \(block 71588383\) is −\d+\.\d+% from the NAV at OnchainOS prices, beyond 1% \(widest: NVDAx pool −90\.00%\)/);

  const unreadable = await run((symbol) => SNAPSHOT[symbol].micros, async () => { throw new Error("X Layer RPC 503"); });
  assert.deepEqual(unreadable.latest.blockers, []);
  assert.equal(unreadable.requests.filter((request) => request.action === "publish_nav").length, 1);
  assert.match(unreadable.result.warnings.join(" "), /not compared with the X Layer pools: X Layer RPC 503/);
});
