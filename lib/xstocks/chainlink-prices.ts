/**
 * A third price, from outside crypto markets: Chainlink's US equity feeds on OP Mainnet (10), the
 * price of the share itself from licensed market data, 24 hours a day on weekdays (pre-market,
 * regular, after-hours and overnight sessions). The recorded prices and the X Layer pools are both
 * xStock markets; these feeds are the stock. Chainlink has no US equity feed on X Layer and none for
 * ORCL or PLTR on any network (its feed directory, 7 October 2026), so seven of the nine holdings are
 * compared. The browser reads the feeds from the public RPC; nothing here stops a record.
 */
import type { Composition } from "./basket";
import { decodeSymbol } from "./mainnet";
import { POOL_TOLERANCE } from "./pool-prices";

export const CHAINLINK_CHAIN = { name: "OP Mainnet", chainId: 10, rpcUrl: "https://mainnet.optimism.io", explorerUrl: "https://optimistic.etherscan.io" } as const;

/**
 * Pinned in code with each feed's description and checked on chain at every read: the feed must
 * describe itself as this stock's 24/5 feed and answer in 8 decimals.
 */
export const CHAINLINK_FEEDS = [
  { symbol: "AAPLx", token: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a", feed: "0x5241f3beadad396ef67035a9187c2f71d9cc58f2", description: "AAPL-USD (24/5)" },
  { symbol: "MSFTx", token: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35", feed: "0xab97582664f2a24eca411aa2b02d4c1ae82e52a6", description: "MSFT-USD (24/5)" },
  { symbol: "NVDAx", token: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d", feed: "0xe04e47a971770c55ad7a73f294aa28e625c5b911", description: "NVDA-USD (24/5)" },
  { symbol: "AMZNx", token: "0x3557ba345b01efa20a1bddc61f573bfd87195081", feed: "0x55d54a8550fc9ce4bad8432155ef7d1da190c411", description: "AMZN-USD (24/5)" },
  { symbol: "METAx", token: "0x96702be57cd9777f835117a809c7124fe4ec989a", feed: "0x7125f14f85503da9a51267fc3bcb00b5d16bbb8d", description: "META-USD (24/5)" },
  { symbol: "TSLAx", token: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0", feed: "0x5ce9c0a0bc15236a110fbc19df547d2b23d3ce3b", description: "TSLA-USD (24/5)" },
  { symbol: "GOOGLx", token: "0xe92f673ca36c5e2efd2de7628f815f84807e803f", feed: "0x367d706bf106136dc51a74209f619d4ef833bcc4", description: "GOOGL-USD (24/5)" },
] as const;

const DESCRIPTION = "0x7284e416";
const DECIMALS = "0x313ce567";
const LATEST_ROUND_DATA = "0xfeaf968c";
/** The public RPC refuses a batch of more than ten calls. */
const BATCH_LIMIT = 10;

type Call = { method: string; params: unknown[] };

const hex = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) throw new Error("OP Mainnet RPC returned an invalid value.");
  return value;
};
const quantity = (value: unknown) => BigInt(hex(value) === "0x" ? "0x0" : hex(value));

async function batchOnce(calls: Call[], fetcher: typeof fetch): Promise<unknown[]> {
  const response = await fetcher(CHAINLINK_CHAIN.rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, method: call.method, params: call.params }))),
  });
  if (!response.ok) throw new Error(`OP Mainnet RPC ${response.status}`);
  const payload = await response.json() as { id: number; result?: unknown; error?: unknown }[];
  if (!Array.isArray(payload)) throw new Error("OP Mainnet RPC returned an invalid batch response.");
  return calls.map((_, id) => {
    const item = payload.find(entry => entry?.id === id);
    if (!item || item.error !== undefined || item.result === undefined) throw new Error("OP Mainnet RPC did not answer every request.");
    return item.result;
  });
}

async function batch(calls: Call[], fetcher: typeof fetch): Promise<unknown[]> {
  const chunks: Call[][] = [];
  for (let index = 0; index < calls.length; index += BATCH_LIMIT) chunks.push(calls.slice(index, index + BATCH_LIMIT));
  return (await Promise.all(chunks.map(chunk => batchOnce(chunk, fetcher)))).flat();
}

export type ChainlinkPrice = { symbol: string; feed: string; description: string; priceMicros: string; updatedAt: string };
export type ChainlinkPrices = { blockNumber: number; blockTime: string; prices: ChainlinkPrice[] };

/** Reads every feed at one block, after confirming the chain and each feed's description and decimals. */
export async function readChainlinkPrices(fetcher: typeof fetch = fetch): Promise<ChainlinkPrices> {
  const head = await batch([{ method: "eth_chainId", params: [] }, { method: "eth_blockNumber", params: [] }], fetcher);
  if (quantity(head[0]) !== BigInt(CHAINLINK_CHAIN.chainId)) throw new Error("The RPC is not OP Mainnet (10).");
  const block = `0x${quantity(head[1]).toString(16)}`;
  const call = (to: string, data: string): Call => ({ method: "eth_call", params: [{ to, data }, block] });
  const calls: Call[] = [{ method: "eth_getBlockByNumber", params: [block, false] }];
  for (const entry of CHAINLINK_FEEDS) calls.push(call(entry.feed, DESCRIPTION), call(entry.feed, DECIMALS), call(entry.feed, LATEST_ROUND_DATA));
  const results = await batch(calls, fetcher);
  const header = results[0] as { timestamp?: unknown } | null;
  if (!header || header.timestamp === undefined) throw new Error("OP Mainnet RPC did not return the block.");
  const prices = CHAINLINK_FEEDS.map((entry, index) => {
    const [description, decimals, round] = results.slice(1 + index * 3, 4 + index * 3);
    if (decodeSymbol(description) !== entry.description) throw new Error(`The ${entry.symbol} feed no longer describes itself as ${entry.description}.`);
    if (quantity(decimals) !== 8n) throw new Error(`The ${entry.symbol} feed no longer has 8 decimals.`);
    const data = hex(round).slice(2);
    if (data.length < 320) throw new Error(`The ${entry.symbol} feed returned no round.`);
    const answer = BigInt(`0x${data.slice(64, 128)}`);
    // int256: a set top bit is a negative answer, which no share price can be.
    if (answer <= 0n || answer >= 1n << 255n) throw new Error(`The ${entry.symbol} feed returned no price.`);
    const updatedAt = Number(BigInt(`0x${data.slice(192, 256)}`));
    return { symbol: entry.symbol, feed: entry.feed, description: entry.description, priceMicros: (answer / 100n).toString(), updatedAt: new Date(updatedAt * 1000).toISOString() };
  });
  return { blockNumber: Number(quantity(head[1])), blockTime: new Date(Number(quantity(header.timestamp)) * 1000).toISOString(), prices };
}

export type ChainlinkComparison = {
  rows: { symbol: string; recordedMicros: string; chainlinkMicros: string; differenceBps: number; updatedAt: string }[];
  /** Holdings with no Chainlink feed, left out of the comparison. */
  uncovered: string[];
  /** The compared holdings' share of the recorded NAV, in basis points. */
  coveredWeightBps: number;
  /** The compared holdings' recorded value per share, and the same units at the Chainlink prices. */
  recordedMicros: string;
  chainlinkMicros: string;
  differenceBps: number;
  agrees: boolean;
};

const WAD = 10n ** 18n;
const bps = (other: bigint, recorded: bigint) => Number(((other - recorded) * 1_000_000n) / recorded) / 100;

/**
 * Values the holdings that have a feed at the recorded prices and at Chainlink's, with the NAV's
 * rounding, and compares the two within the same 1% as the pools. Returns null when no holding is
 * one of the pinned xStocks at its pinned address.
 */
export function compareChainlink(composition: Pick<Composition, "holdings" | "navPerShareMicros">, prices: Pick<ChainlinkPrices, "prices">): ChainlinkComparison | null {
  const nav = BigInt(composition.navPerShareMicros);
  if (nav <= 0n) return null;
  const rows: ChainlinkComparison["rows"] = [];
  const uncovered: string[] = [];
  let recorded = 0n;
  let chainlink = 0n;
  for (const holding of composition.holdings) {
    const entry = CHAINLINK_FEEDS.find(feed => feed.symbol === holding.symbol && feed.token === holding.address.toLowerCase());
    const price = entry ? prices.prices.find(item => item.symbol === entry.symbol) : undefined;
    const recordedPrice = BigInt(holding.priceMicros);
    if (!price || recordedPrice <= 0n) { uncovered.push(holding.symbol); continue; }
    const feedPrice = BigInt(price.priceMicros);
    recorded += (BigInt(holding.unitsWad) * recordedPrice) / WAD;
    chainlink += (BigInt(holding.unitsWad) * feedPrice) / WAD;
    rows.push({ symbol: holding.symbol, recordedMicros: holding.priceMicros, chainlinkMicros: price.priceMicros, differenceBps: bps(feedPrice, recordedPrice), updatedAt: price.updatedAt });
  }
  if (!rows.length || recorded <= 0n) return null;
  const differenceBps = bps(chainlink, recorded);
  return {
    rows, uncovered, coveredWeightBps: Number((recorded * 10_000n) / nav),
    recordedMicros: recorded.toString(), chainlinkMicros: chainlink.toString(),
    differenceBps, agrees: Math.abs(differenceBps) <= POOL_TOLERANCE.navBps,
  };
}
