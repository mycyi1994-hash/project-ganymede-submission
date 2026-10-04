/**
 * What it costs to build USTX's basket by hand on X Layer mainnet: one swap from USDT into each
 * xStock, quoted by the OKX OnchainOS DEX aggregator (its quote API, which sends nothing). Once an
 * hour the activity cron (lib/xstocks/activity-index.ts) asks for one $1,000 basket, split equally,
 * and keeps the answer for GET /api/v1/ustx/dex-quotes and the issuers page. A failure is kept too,
 * so the page says so instead of showing an old figure as new.
 */
import { EngineRepository } from "../engine/repository";
import type { EngineEnv } from "../engine/types";
import { XSTOCK_TOKENS } from "./mainnet";
import { onchainOsCredentials, signedHeaders, type OnchainOsCredentials } from "./prices";

export const DEX_QUOTE_PATH = "/api/v6/dex/aggregator/quote";
export const STATE_DEX_QUOTES = "xstocks:dex-quotes";
/** USDT on X Layer mainnet (6 decimals). */
export const DEX_FROM_TOKEN = { symbol: "USDT", address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", decimals: 6 } as const;
export const DEX_BASKET_USD = 1_000;
const EVERY_MS = 55 * 60_000;
const SPACING_MS = 1_200;

export type DexLeg = {
  symbol: string;
  /** USDT paid, in micros. */
  paidMicros: string;
  /** The value of the xStock received at the aggregator's own unit price, in micros; null if not given. */
  receivedMicros: string | null;
  priceImpactPercent: string | null;
  /** The aggregator's estimate of the network fee in US dollars. */
  networkFeeUsd: string | null;
  routes: string[];
};
export type DexQuotes = {
  at: string;
  basketUsd: number;
  from: string;
  legs: DexLeg[];
  /** Set when the quotes could not be had; legs is then empty. */
  error?: string;
};

type QuoteRow = {
  toTokenAmount?: string;
  priceImpactPercent?: string;
  priceImpactPercentage?: string;
  tradeFee?: string;
  toToken?: { decimal?: string; tokenUnitPrice?: string };
  dexRouterList?: unknown;
};

const decimal = /^-?\d+(\.\d+)?$/;
const unsigned = /^\d+(\.\d+)?$/;
const micros = (amount: string, decimals: number, unitPrice: string) => {
  // amount / 10^decimals × unitPrice, in micros, with integers only.
  const [whole, fraction = ""] = unitPrice.split(".");
  const scaled = BigInt(whole + fraction.padEnd(18, "0").slice(0, 18));
  return (BigInt(amount) * scaled * 1_000_000n) / (10n ** BigInt(decimals) * 10n ** 18n);
};

function dexNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) dexNames(item, names);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "dexName" && typeof item === "string" && item.length < 60) names.add(item);
      else dexNames(item, names);
    }
  }
  return names;
}

export function parseQuote(symbol: string, paidMicros: bigint, payload: unknown): DexLeg {
  const body = payload as { code?: string | number; msg?: string; data?: QuoteRow[] };
  if (String(body?.code) !== "0" || !Array.isArray(body.data) || !body.data[0]) throw new Error(`OKX DEX quote for ${symbol}: ${typeof body?.msg === "string" && body.msg ? body.msg.slice(0, 120) : `code ${String(body?.code)}`}`);
  const row = body.data[0];
  const impact = row.priceImpactPercent ?? row.priceImpactPercentage;
  const decimals = Number(row.toToken?.decimal ?? 18);
  const price = row.toToken?.tokenUnitPrice;
  return {
    symbol,
    paidMicros: paidMicros.toString(),
    receivedMicros: row.toTokenAmount && /^\d+$/.test(row.toTokenAmount) && price && unsigned.test(price) && Number.isInteger(decimals) ? micros(row.toTokenAmount, decimals, price).toString() : null,
    priceImpactPercent: impact && decimal.test(impact) ? impact : null,
    networkFeeUsd: row.tradeFee && decimal.test(row.tradeFee) ? row.tradeFee : null,
    routes: [...dexNames(row.dexRouterList)].slice(0, 4),
  };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function quoteBasket(credentials: OnchainOsCredentials, options: { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; now?: Date } = {}): Promise<DexQuotes> {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? sleep;
  const each = BigInt(DEX_BASKET_USD) * 1_000_000n / BigInt(XSTOCK_TOKENS.length);
  const legs: DexLeg[] = [];
  for (const [index, token] of XSTOCK_TOKENS.entries()) {
    if (index > 0) await wait(SPACING_MS);
    const query = new URLSearchParams({ chainIndex: "196", amount: each.toString(), swapMode: "exactIn", fromTokenAddress: DEX_FROM_TOKEN.address, toTokenAddress: token.address });
    const path = `${DEX_QUOTE_PATH}?${query}`;
    const response = await fetcher(`${credentials.baseUrl}${path}`, { headers: await signedHeaders(credentials, "GET", path), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OKX DEX quote for ${token.symbol}: HTTP ${response.status}`);
    }
    legs.push(parseQuote(token.symbol, each, await response.json()));
  }
  return { at: (options.now ?? new Date()).toISOString(), basketUsd: DEX_BASKET_USD, from: DEX_FROM_TOKEN.symbol, legs };
}

export function parseDexQuotes(value: unknown): DexQuotes | null {
  if (typeof value !== "string") return null;
  try {
    const quotes = JSON.parse(value) as DexQuotes;
    return typeof quotes.at === "string" && Array.isArray(quotes.legs) ? quotes : null;
  } catch {
    return null;
  }
}

/** Asks again once the kept quotes are about an hour old; otherwise does nothing. */
export async function runDexQuotes(env: Pick<EngineEnv, "DB" | "OKX_API_KEY" | "OKX_API_SECRET" | "OKX_API_PASSPHRASE" | "OKX_PROJECT_ID" | "ONCHAINOS_BASE_URL">, options: { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; now?: Date } = {}): Promise<DexQuotes | null> {
  const credentials = onchainOsCredentials(env);
  if (!credentials) return null;
  const now = options.now ?? new Date();
  const repo = new EngineRepository(env.DB);
  const kept = parseDexQuotes((await repo.getState(STATE_DEX_QUOTES))?.value);
  if (kept && now.getTime() - Date.parse(kept.at) < EVERY_MS) return null;
  let quotes: DexQuotes;
  try {
    quotes = await quoteBasket(credentials, { ...options, now });
  } catch (error) {
    quotes = { at: now.toISOString(), basketUsd: DEX_BASKET_USD, from: DEX_FROM_TOKEN.symbol, legs: [], error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 200) : "The quotes could not be read." };
  }
  await repo.setState(STATE_DEX_QUOTES, JSON.stringify(quotes));
  return quotes;
}

export type DexComparison = { legs: number; paidMicros: bigint; receivedMicros: bigint | null; costMicros: bigint | null; networkFeeUsd: number | null; maxImpactPercent: number | null };

/** The swaps added up: what was paid, what it bought at the aggregator's prices, and the gap. */
export function compareDex(quotes: DexQuotes): DexComparison {
  const paid = quotes.legs.reduce((sum, leg) => sum + BigInt(leg.paidMicros), 0n);
  const received = quotes.legs.every(leg => leg.receivedMicros !== null) && quotes.legs.length ? quotes.legs.reduce((sum, leg) => sum + BigInt(leg.receivedMicros as string), 0n) : null;
  const fees = quotes.legs.every(leg => leg.networkFeeUsd !== null) && quotes.legs.length ? quotes.legs.reduce((sum, leg) => sum + Number(leg.networkFeeUsd), 0) : null;
  const impacts = quotes.legs.map(leg => leg.priceImpactPercent).filter((value): value is string => value !== null).map(value => Math.abs(Number(value)));
  return { legs: quotes.legs.length, paidMicros: paid, receivedMicros: received, costMicros: received === null ? null : paid - received, networkFeeUsd: fees, maxImpactPercent: impacts.length ? Math.max(...impacts) : null };
}
