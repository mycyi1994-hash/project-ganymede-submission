/**
 * Black–Scholes for the covered-call funds (lib/income/covered-call.ts). The same code runs in the
 * NAV cron and in the browser that checks a record, so a NAV can be recomputed from its document.
 */

/** The standard normal cumulative distribution, to about 1e-7 (Abramowitz and Stegun 26.2.17). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

/**
 * A European call on one unit: spot, strike, years to expiry, volatility and the risk-free rate,
 * all a year. At or after expiry it is worth what it pays.
 */
export function callPrice(spot: number, strike: number, years: number, volatility: number, rate: number): number {
  if (years <= 0 || volatility <= 0) return Math.max(spot - strike, 0);
  const root = volatility * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / root;
  const d2 = d1 - root;
  return spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2);
}

export const YEAR_MS = 365 * 86_400_000;
