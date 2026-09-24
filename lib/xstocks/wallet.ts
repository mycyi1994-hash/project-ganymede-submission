/**
 * Values a wallet's xStocks with the prices of a published, verified USTX document, and
 * sizes a USTX-weighted basket for a given amount. Integer arithmetic throughout: token
 * units in wei (18 decimals), USD in micros.
 */
import type { Composition } from "./basket";
import type { WalletBalances } from "./mainnet";

const WAD = 10n ** 18n;
const BPS = 10_000n;

export type PriceRecord = { effectiveAt: string; holdingsHash: string; transactionHash: string | null };
export type WalletRow = { symbol: string; address: string; units: string; priceMicros: string; valueMicros: string; weightBps: number; modelWeightBps: number };
export type WalletValuation = { rows: WalletRow[]; totalMicros: string };

const modelWeight = (composition: Composition, valueMicros: string) => BigInt(composition.navPerShareMicros) === 0n ? 0 : Number(BigInt(valueMicros) * BPS / BigInt(composition.navPerShareMicros));

/** Values each balance at the price the verified document used for the same token address. */
export function valueWallet(balances: WalletBalances, composition: Composition): WalletValuation {
  const rows = balances.balances.map(balance => {
    const holding = composition.holdings.find(item => item.address.toLowerCase() === balance.address.toLowerCase());
    if (!holding) throw new Error(`${balance.symbol} is not in the verified document.`);
    const value = BigInt(balance.units) * BigInt(holding.priceMicros) / WAD;
    return { symbol: balance.symbol, address: balance.address, units: balance.units, priceMicros: holding.priceMicros, valueMicros: value.toString(), weightBps: 0, modelWeightBps: modelWeight(composition, holding.valueMicros) };
  });
  const total = rows.reduce((sum, row) => sum + BigInt(row.valueMicros), 0n);
  for (const row of rows) row.weightBps = total === 0n ? 0 : Number(BigInt(row.valueMicros) * BPS / total);
  return { rows, totalMicros: total.toString() };
}

export type PlanRow = { symbol: string; address: string; priceMicros: string; modelWeightBps: number; usdMicros: string; units: string };

/** Splits an amount across the six tokens in the document's current value weights. */
export function planBasket(amountMicros: bigint, composition: Composition): PlanRow[] {
  if (amountMicros <= 0n) return [];
  const nav = BigInt(composition.navPerShareMicros);
  return composition.holdings.map(holding => {
    const usd = nav === 0n ? 0n : amountMicros * BigInt(holding.valueMicros) / nav;
    return { symbol: holding.symbol, address: holding.address, priceMicros: holding.priceMicros, modelWeightBps: modelWeight(composition, holding.valueMicros), usdMicros: usd.toString(), units: (usd * WAD / BigInt(holding.priceMicros)).toString() };
  });
}

/** Parses a dollar amount such as "1,000.50" into micros; returns null for anything else. */
export function parseUsd(input: string): bigint | null {
  const clean = input.replace(/[\s,$]/g, "");
  if (!/^\d{1,12}(\.\d{0,6})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function formatUnits(units: string, digits = 6): string {
  const value = BigInt(units);
  const whole = value / WAD;
  const fraction = (value % WAD).toString().padStart(18, "0").slice(0, digits);
  return `${whole.toLocaleString("en-US")}.${fraction}`;
}

export const STATEMENT_KIND = "ganymede-xstocks-valuation";

export function buildStatement(balances: WalletBalances, valuation: WalletValuation, record: PriceRecord, now: Date) {
  return {
    kind: STATEMENT_KIND,
    version: 1,
    generatedAt: now.toISOString(),
    owner: balances.owner,
    balances: { network: "X Layer mainnet", chainId: 196, blockNumber: balances.blockNumber, blockTime: balances.blockTime },
    prices: { source: "Published USTX composition document, verified in the browser against X Layer Testnet", registry: "0xf320d2a7f280b7ab61e24374986869d7be34289c", ...record },
    holdings: valuation.rows.map(row => ({ symbol: row.symbol, token: row.address, unitsWei: row.units, priceMicros: row.priceMicros, valueMicros: row.valueMicros })),
    totalValueMicros: valuation.totalMicros,
    method: "valueMicros = floor(unitsWei × priceMicros / 10^18) per token; the total is their sum. Re-read each balanceOf at blockNumber on X Layer mainnet and each price from the document with this holdingsHash.",
    scope: "A valuation of the six xStocks at the recorded prices. It is not an executable quote and does not cover other assets or prove ownership.",
  };
}
