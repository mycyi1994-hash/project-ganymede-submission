/**
 * Reads GanymedeNavRegistry.latestNav straight from the settlement chain, so
 * the proof page compares against the chain rather than against our database.
 */
import { XSTOCKS_PRODUCT } from "./basket";

/**
 * keccak256("us-tech-x") — relayer/src/ids.ts#productKey. Precomputed because
 * the app bundle carries no keccak; tests/xstocks.test.mjs pins the product id.
 */
export const XSTOCKS_PRODUCT_KEY = "0x7fd4bda948705c478ec63926a4cdececd33422c85c3e35f414251992b48c2a20";
/** toFunctionSelector("latestNav(bytes32)") */
const LATEST_NAV_SELECTOR = "0xe8b7fcde";

export type OnchainNav = {
  navPerShareMicros: string;
  sharesOutstandingMicros: string;
  holdingsHash: string;
  effectiveAt: string | null;
  publishedAt: string | null;
};

export function decodeLatestNav(result: string): OnchainNav {
  const hex = result.startsWith("0x") ? result.slice(2) : result;
  if (hex.length !== 64 * 5 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("latestNav returned an invalid payload");
  const word = (index: number) => hex.slice(index * 64, (index + 1) * 64);
  const seconds = (index: number) => {
    const value = BigInt(`0x${word(index)}`);
    return value === 0n ? null : new Date(Number(value) * 1000).toISOString();
  };
  return {
    navPerShareMicros: BigInt(`0x${word(0)}`).toString(),
    sharesOutstandingMicros: BigInt(`0x${word(1)}`).toString(),
    holdingsHash: `0x${word(2)}`,
    effectiveAt: seconds(3),
    publishedAt: seconds(4),
  };
}

/** keccak256("NavPublished(bytes32,uint256,uint256,bytes32,uint64)"); equals topic0 of the registry's logs on X Layer Testnet. */
export const NAV_PUBLISHED_TOPIC = "0x7473313be7106e5141b2da10837d77c93ad5b7e1fa646edaaafcb7493432298b";

export type NavPublishedEvent = { productKey: string; holdingsHash: string; navPerShareMicros: string; sharesOutstandingMicros: string; effectiveAt: string };

export function decodeNavPublished(log: { topics: string[]; data: string }): NavPublishedEvent | null {
  if (log.topics.length !== 3 || log.topics[0].toLowerCase() !== NAV_PUBLISHED_TOPIC) return null;
  const data = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
  if (data.length !== 64 * 3 || !/^[0-9a-f]+$/i.test(data)) return null;
  const word = (index: number) => BigInt(`0x${data.slice(index * 64, (index + 1) * 64)}`);
  return { productKey: log.topics[1].toLowerCase(), holdingsHash: log.topics[2].toLowerCase(), navPerShareMicros: word(0).toString(), sharesOutstandingMicros: word(1).toString(), effectiveAt: new Date(Number(word(2)) * 1000).toISOString() };
}

export type TransactionReceipt = { status?: string; blockNumber?: string; logs?: { address: string; topics: string[]; data: string }[] };

/** A transaction's receipt, or null if the chain does not know the transaction. */
export async function readTransactionReceipt(rpcUrl: string, txHash: string, options: { fetcher?: typeof fetch } = {}): Promise<TransactionReceipt | null> {
  if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error("Invalid transaction hash");
  const response = await (options.fetcher ?? fetch)(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_getTransactionReceipt", params: [txHash] }),
  });
  if (!response.ok) throw new Error(`Settlement RPC ${response.status}`);
  const payload = await response.json() as { result?: TransactionReceipt | null; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "eth_getTransactionReceipt failed");
  return payload.result ?? null;
}

/** Reads USTX's record, or with `productKey` another basket's record in the registry it names. */
export async function readLatestNav(rpcUrl: string, registry: string, options: { fetcher?: typeof fetch; chainId?: number; productKey?: string } = {}): Promise<OnchainNav> {
  if (!options.productKey && XSTOCKS_PRODUCT.id !== "us-tech-x") throw new Error("XSTOCKS_PRODUCT_KEY is stale — recompute it for the new product id");
  const productKey = options.productKey ?? XSTOCKS_PRODUCT_KEY;
  if (!/^0x[0-9a-f]{64}$/i.test(productKey)) throw new Error("Invalid product key");
  if (!/^0x[0-9a-f]{40}$/i.test(registry)) throw new Error("Invalid NAV registry address");
  const fetcher = options.fetcher ?? fetch;
  if (options.chainId !== undefined) {
    const chainResponse = await fetcher(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] }),
    });
    if (!chainResponse.ok) throw new Error(`Settlement RPC ${chainResponse.status}`);
    const chain = await chainResponse.json() as { result?: string };
    if (!chain.result || !/^0x[0-9a-f]+$/i.test(chain.result) || BigInt(chain.result) !== BigInt(options.chainId)) throw new Error("The RPC returned a different network");
  }
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: registry, data: `${LATEST_NAV_SELECTOR}${productKey.slice(2).toLowerCase()}` }, "latest"],
    }),
  });
  if (!response.ok) throw new Error(`Settlement RPC ${response.status}`);
  const payload = await response.json() as { result?: string; error?: { message?: string } };
  if (payload.error || !payload.result) throw new Error(payload.error?.message ?? "latestNav call failed");
  return decodeLatestNav(payload.result);
}
