/**
 * What USTX shares hold, looked through to the six xStocks. Each model share carries fixed
 * token units, so a holding of N shares carries N times those units, worth N times each
 * row's value per share at the recorded prices. Integer arithmetic throughout: shares and
 * USD in micros, token units in wei (18 decimals).
 */
import type { Composition } from "../xstocks/basket";

const SHARE = 1_000_000n;
const BPS = 10_000n;

export type LookThroughRow = { symbol: string; address: string; units: string; valueMicros: string; weightBps: number };
export type LookThrough = { rows: LookThroughRow[]; totalMicros: string };

export function lookThrough(composition: Composition, sharesMicros: bigint): LookThrough {
  const shares = sharesMicros > 0n ? sharesMicros : 0n;
  const rows = composition.holdings.map(holding => ({
    symbol: holding.symbol,
    address: holding.address,
    units: (shares * BigInt(holding.unitsWad) / SHARE).toString(),
    valueMicros: (shares * BigInt(holding.valueMicros) / SHARE).toString(),
    weightBps: 0,
  }));
  const total = rows.reduce((sum, row) => sum + BigInt(row.valueMicros), 0n);
  for (const row of rows) row.weightBps = total === 0n ? 0 : Number(BigInt(row.valueMicros) * BPS / total);
  return { rows, totalMicros: total.toString() };
}

/** The fund's value: shares outstanding at a NAV per share, both in micros. */
export const fundValueMicros = (sharesMicros: bigint, navMicros: bigint) => sharesMicros * navMicros / SHARE;
