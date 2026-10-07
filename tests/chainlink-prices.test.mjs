import assert from "node:assert/strict";
import test from "node:test";
import { CHAINLINK_CHAIN, CHAINLINK_FEEDS, compareChainlink, readChainlinkPrices } from "../lib/xstocks/chainlink-prices.ts";
import { XSTOCK_TOKENS } from "../lib/xstocks/mainnet.ts";

// Prices on OP Mainnet on 7 October 2026 (8 decimals, rounded to the micro) and their update times.
const SNAPSHOT = {
  AAPLx: { answer: 33276000000n, updatedAt: "2026-10-06T14:08:05Z" },
  MSFTx: { answer: 53043500000n, updatedAt: "2026-10-06T18:35:39Z" },
  NVDAx: { answer: 24014999900n, updatedAt: "2026-10-06T17:07:43Z" },
  AMZNx: { answer: 25735693400n, updatedAt: "2026-10-07T00:01:09Z" },
  METAx: { answer: 74104500000n, updatedAt: "2026-10-06T14:20:03Z" },
  TSLAx: { answer: 38045500000n, updatedAt: "2026-10-06T13:40:33Z" },
  GOOGLx: { answer: 34720000000n, updatedAt: "2026-10-06T16:59:41Z" },
};
const seconds = (iso) => BigInt(Date.parse(iso) / 1000);

const word = (value) => value.toString(16).padStart(64, "0");
const abiString = (text) => "0x" + word(32) + word(text.length) + Buffer.from(text).toString("hex").padEnd(64, "0");

/** An OP Mainnet RPC that answers from the snapshot; `change` edits one answer. */
function opMainnet(change = () => undefined) {
  const requests = [];
  const fetcher = async (url, init) => {
    assert.equal(url, CHAINLINK_CHAIN.rpcUrl);
    const calls = JSON.parse(init.body);
    requests.push(calls.length);
    assert.ok(calls.length <= 10, "the public RPC refuses more than ten calls a request");
    return Response.json(calls.map(({ id, method, params }) => {
      let result;
      if (method === "eth_chainId") result = "0xa";
      else if (method === "eth_blockNumber") result = "0x968e57c";
      else if (method === "eth_getBlockByNumber") result = { timestamp: "0x6ab47561" };
      else {
        const { to, data } = params[0];
        const feed = CHAINLINK_FEEDS.find((entry) => entry.feed === to);
        if (data === "0x7284e416") result = abiString(feed.description);
        else if (data === "0x313ce567") result = "0x" + word(8);
        else if (data === "0xfeaf968c") { const { answer, updatedAt } = SNAPSHOT[feed.symbol]; result = "0x" + word(1) + word(answer) + word(seconds(updatedAt)) + word(seconds(updatedAt)) + word(1); }
      }
      return { jsonrpc: "2.0", id, result: change({ method, params, result }) ?? result };
    }));
  };
  return { fetcher, requests };
}

test("reads each pinned Chainlink feed at one block, in dollar micros", async () => {
  const { fetcher, requests } = opMainnet();
  const read = await readChainlinkPrices(fetcher);
  assert.equal(read.blockNumber, 0x968e57c);
  assert.deepEqual(requests, [2, 10, 10, 2]);
  assert.deepEqual(read.prices.map((price) => [price.symbol, price.priceMicros]), Object.entries(SNAPSHOT).map(([symbol, { answer }]) => [symbol, (answer / 100n).toString()]));
  assert.equal(read.prices[0].updatedAt, "2026-10-06T14:08:05.000Z");
  // Every feed is one of the xStocks the verifier pins, at the same address.
  for (const entry of CHAINLINK_FEEDS) assert.equal(XSTOCK_TOKENS.find((token) => token.symbol === entry.symbol)?.address, entry.token);
});

test("refuses another chain, another feed, other decimals or no price", async () => {
  await assert.rejects(readChainlinkPrices(opMainnet(({ method }) => method === "eth_chainId" ? "0x1" : undefined).fetcher), /not OP Mainnet/);
  const feed = CHAINLINK_FEEDS[2];
  const on = (data, value) => ({ params, method }) => method === "eth_call" && params[0].to === feed.feed && params[0].data === data ? value : undefined;
  await assert.rejects(readChainlinkPrices(opMainnet(on("0x7284e416", abiString("NVDA / USD"))).fetcher), /NVDAx feed no longer describes itself/);
  await assert.rejects(readChainlinkPrices(opMainnet(on("0x313ce567", "0x" + word(18))).fetcher), /8 decimals/);
  await assert.rejects(readChainlinkPrices(opMainnet(on("0xfeaf968c", "0x" + word(1) + word(0) + word(1) + word(1) + word(1))).fetcher), /no price/);
  await assert.rejects(readChainlinkPrices(opMainnet(on("0xfeaf968c", "0x" + word(1) + "f".repeat(64) + word(1) + word(1) + word(1))).fetcher), /no price/);
});

const holding = (symbol, priceMicros, unitsWad) => ({ symbol, address: XSTOCK_TOKENS.find((token) => token.symbol === symbol).address, priceMicros, unitsWad });

test("compares the holdings that have a feed and names the ones that do not", async () => {
  const prices = await readChainlinkPrices(opMainnet().fetcher);
  // One share of each: AAPL recorded $1 above Chainlink, ORCL with no feed.
  const composition = { navPerShareMicros: "1000000000", holdings: [holding("AAPLx", "333760000", 10n ** 18n), holding("NVDAx", "240149999", 10n ** 18n), holding("ORCLx", "145000000", 10n ** 18n)] };
  const result = compareChainlink(composition, prices);
  assert.deepEqual(result.uncovered, ["ORCLx"]);
  assert.equal(result.recordedMicros, "573909999");
  assert.equal(result.chainlinkMicros, "572909999");
  assert.equal(result.coveredWeightBps, 5739);
  assert.equal(result.rows[0].differenceBps, -29.96);
  assert.equal(result.differenceBps, -17.42);
  assert.equal(result.agrees, true);
  // Beyond 1% on the compared holdings disagrees, whatever the uncovered ones are worth.
  const apart = compareChainlink({ ...composition, holdings: [holding("TSLAx", "390000000", 10n ** 18n), composition.holdings[2]] }, prices);
  assert.equal(apart.differenceBps, -244.74);
  assert.equal(apart.agrees, false);
  // Nothing to compare: no holding with a feed, a token at another address, or no NAV.
  assert.equal(compareChainlink({ ...composition, holdings: [composition.holdings[2]] }, prices), null);
  assert.equal(compareChainlink({ ...composition, holdings: [{ ...composition.holdings[0], address: "0x" + "1".repeat(40) }] }, prices), null);
  assert.equal(compareChainlink({ ...composition, navPerShareMicros: "0" }, prices), null);
});
