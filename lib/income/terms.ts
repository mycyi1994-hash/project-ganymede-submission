/**
 * The terms of the income products (lib/funds/catalog.ts INCOME_FUNDS). They follow real products on
 * the same indices: covered-call funds such as the Global X S&P 500 and Nasdaq-100 Covered Call ETFs
 * (XYLD, QYLD), and Korean step-down ELS on two indices.
 *
 * What is modelled, and why: there is no options market for xStocks on X Layer, so each month's call
 * is priced by Black–Scholes at a stated volatility and rate, and written by the fund in the demo.
 * The note pays from the recorded prices of SPYx and QQQx; nothing hedges it. Demo dollars only.
 */

export type CoveredCallTerms = {
  kind: "covered-call";
  underlying: "SPYx" | "QQQx";
  /** The strike, above the price when the call is sold. */
  moneyness: number;
  tenorDays: number;
  /** Close to the index's average implied volatility over the last year (VIX for the S&P 500, VXN for the Nasdaq-100). */
  volatility: number;
  /** About the one-month US Treasury bill yield. */
  rate: number;
};

export type AutocallTerms = {
  kind: "autocall";
  underlyings: ["SPYx", "QQQx"];
  face: number;
  /** When the starting levels are fixed: the first record at or after this time. */
  fixingFrom: string;
  /** New money is taken at face value until this many days after the fixing. */
  subscriptionDays: number;
  observationMonths: number;
  /** One barrier per observation, as a share of the starting level of the worse index. */
  barriers: number[];
  knockIn: number;
  /** Paid per year elapsed when the note is called or matures above its barrier. */
  couponPerYear: number;
};

export const INCOME_TERMS: Record<string, CoveredCallTerms | AutocallTerms> = {
  "spy-covered-call": { kind: "covered-call", underlying: "SPYx", moneyness: 0.02, tenorDays: 30, volatility: 0.16, rate: 0.04 },
  "qqq-covered-call": { kind: "covered-call", underlying: "QQQx", moneyness: 0.02, tenorDays: 30, volatility: 0.21, rate: 0.04 },
  "spy-qqq-autocall-1": {
    kind: "autocall", underlyings: ["SPYx", "QQQx"], face: 100, fixingFrom: "2026-10-04T00:00:00.000Z", subscriptionDays: 30,
    observationMonths: 6, barriers: [0.90, 0.90, 0.85, 0.85, 0.80, 0.75], knockIn: 0.50, couponPerYear: 0.07,
  },
};

export const coveredCallTerms = (id: string) => { const terms = INCOME_TERMS[id]; return terms?.kind === "covered-call" ? terms : null; };
export const autocallTerms = (id: string) => { const terms = INCOME_TERMS[id]; return terms?.kind === "autocall" ? terms : null; };

/** A date a whole number of months after another, at the same time of day (UTC). */
export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
