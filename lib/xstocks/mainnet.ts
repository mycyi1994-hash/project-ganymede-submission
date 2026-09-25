/**
 * Read-only access to the xStock tokens on X Layer mainnet (196). The browser calls the public
 * RPC directly; nothing is signed or sent, and no key is involved.
 */
import { XSTOCKS_CHAIN } from "./basket";

export const MAINNET = { chainId: 196, rpcUrl: XSTOCKS_CHAIN.rpcUrl, explorerUrl: "https://web3.okx.com/explorer/x-layer" } as const;

/**
 * xStocks token contracts on X Layer, pinned in the verifier rather than read from any API
 * response. They match the issuer's public asset API and the published USTX documents
 * as checked on 24 September 2026.
 */
export const XSTOCK_TOKENS = [
  { symbol: "AAPLx", address: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a" },
  { symbol: "MSFTx", address: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35" },
  { symbol: "NVDAx", address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d" },
  { symbol: "AMZNx", address: "0x3557ba345b01efa20a1bddc61f573bfd87195081" },
  { symbol: "METAx", address: "0x96702be57cd9777f835117a809c7124fe4ec989a" },
  { symbol: "TSLAx", address: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0" },
] as const;

export const tokenExplorerUrl = (address: string) => `${MAINNET.explorerUrl}/token/${address}`;

const SYMBOL = "0x95d89b41";
const DECIMALS = "0x313ce567";
const BALANCE_OF = "0x70a08231";
export type Call = { method: string; params: unknown[] };

/** The public RPC answers at most 10 calls per batch request. */
const BATCH_LIMIT = 10;

async function batchOnce(calls: Call[], fetcher: typeof fetch): Promise<unknown[]> {
  const response = await fetcher(MAINNET.rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, method: call.method, params: call.params }))),
  });
  if (!response.ok) throw new Error(`X Layer RPC ${response.status}`);
  const payload = await response.json() as { id: number; result?: unknown; error?: unknown }[];
  if (!Array.isArray(payload)) throw new Error("X Layer RPC returned an invalid batch response.");
  return calls.map((_, id) => {
    const item = payload.find(entry => entry?.id === id);
    if (!item || item.error !== undefined || item.result === undefined) throw new Error("X Layer RPC did not answer every request.");
    return item.result;
  });
}

/** Sends any number of calls, ten to a request, and returns the results in order. */
export async function batch(calls: Call[], fetcher: typeof fetch): Promise<unknown[]> {
  const chunks: Call[][] = [];
  for (let index = 0; index < calls.length; index += BATCH_LIMIT) chunks.push(calls.slice(index, index + BATCH_LIMIT));
  return (await Promise.all(chunks.map(chunk => batchOnce(chunk, fetcher)))).flat();
}

export const hex = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) throw new Error("X Layer RPC returned an invalid value.");
  return value;
};
export const quantity = (value: unknown) => BigInt(hex(value) === "0x" ? "0x0" : hex(value));

const text = (data: string) => new TextDecoder().decode(new Uint8Array(data.match(/../g)?.map(byte => parseInt(byte, 16)) ?? []));

/** Decodes an ABI string, or a bytes32 string used by older tokens. */
export function decodeSymbol(value: unknown): string | null {
  try {
    const data = hex(value).slice(2);
    if (data.length === 64) return text(data).replace(/\0+$/, "") || null;
    if (data.length < 128) return null;
    const length = Number(BigInt(`0x${data.slice(64, 128)}`));
    if (length > 64 || data.length < 128 + length * 2) return null;
    return text(data.slice(128, 128 + length * 2));
  } catch { return null; }
}

export function chainCheck(results: unknown[]) {
  if (quantity(results[0]) !== BigInt(MAINNET.chainId)) throw new Error("The RPC is not X Layer mainnet (196).");
}

export type TokenFact = { symbol: string; address: string; hasCode: boolean; chainSymbol: string | null; decimals: number | null; matches: boolean };

/** Confirms each pinned address holds a contract with the expected symbol and 18 decimals. */
export async function readTokenFacts(fetcher: typeof fetch = fetch): Promise<TokenFact[]> {
  const calls: Call[] = [{ method: "eth_chainId", params: [] }];
  for (const token of XSTOCK_TOKENS) calls.push({ method: "eth_getCode", params: [token.address, "latest"] }, { method: "eth_call", params: [{ to: token.address, data: SYMBOL }, "latest"] }, { method: "eth_call", params: [{ to: token.address, data: DECIMALS }, "latest"] });
  const results = await batch(calls, fetcher);
  chainCheck(results);
  return XSTOCK_TOKENS.map((token, index) => {
    const code = hex(results[1 + index * 3]);
    const chainSymbol = decodeSymbol(results[2 + index * 3]);
    const decimals = Number(quantity(results[3 + index * 3]));
    const hasCode = code.length > 2;
    return { symbol: token.symbol, address: token.address, hasCode, chainSymbol, decimals, matches: hasCode && chainSymbol === token.symbol && decimals === 18 };
  });
}

export type WalletBalances = { owner: string; blockNumber: number; blockTime: string; balances: { symbol: string; address: string; units: string }[] };

const addressWord = (owner: string) => owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Reads the six balances at one block, so the statement can name exactly what was read. */
export async function readBalances(owner: string, fetcher: typeof fetch = fetch): Promise<WalletBalances> {
  if (!/^0x[0-9a-f]{40}$/i.test(owner)) throw new Error("Enter a valid public EVM address.");
  const head = await batch([{ method: "eth_chainId", params: [] }, { method: "eth_blockNumber", params: [] }], fetcher);
  chainCheck(head);
  const block = `0x${quantity(head[1]).toString(16)}`;
  const calls: Call[] = [{ method: "eth_getBlockByNumber", params: [block, false] }];
  for (const token of XSTOCK_TOKENS) calls.push({ method: "eth_call", params: [{ to: token.address, data: `${BALANCE_OF}${addressWord(owner)}` }, block] });
  const results = await batch(calls, fetcher);
  const header = results[0] as { timestamp?: unknown } | null;
  if (!header || header.timestamp === undefined) throw new Error("X Layer RPC did not return the block.");
  return {
    owner: owner.toLowerCase(),
    blockNumber: Number(quantity(head[1])),
    blockTime: new Date(Number(quantity(header.timestamp)) * 1000).toISOString(),
    balances: XSTOCK_TOKENS.map((token, index) => ({ symbol: token.symbol, address: token.address, units: quantity(results[1 + index]).toString() })),
  };
}
