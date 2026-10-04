/**
 * A covered-call fund, per share: units of the xStock ETF, cash, and one short call. At inception a
 * share is US$100 of the ETF, and the fund sells a call 2% above the price for a month, keeping the
 * premium in cash. At each record the short call is marked by Black–Scholes on the time left, so
 *   NAV = units × price + cash − units × call value.
 * At expiry the call settles (the fund pays units × max(price − strike, 0)), everything goes back into
 * the ETF, and a new call is sold. This is the rule of buy-write indices such as Cboe's BXM, with a
 * modelled premium: there is no options market for xStocks on X Layer.
 *
 * Each record's document holds every input, so lib/income/verify.ts recomputes the NAV from it.
 */
import { callPrice, YEAR_MS } from "./options";
import type { CoveredCallTerms } from "./terms";

export type CallLeg = { strike: number; soldAt: string; expiresAt: string; premium: number };
export type CoveredCallState = { units: number; cash: number; call: CallLeg; startedAt: string; rolls: number };

export type CoveredCallDocument = {
  product: string;
  kind: "covered-call";
  asOf: string;
  underlying: { symbol: string; address: string; price: number };
  terms: { moneyness: number; tenorDays: number; volatility: number; rate: number };
  units: number;
  cash: number;
  call: CallLeg & { value: number };
  startedAt: string;
  rolls: number;
  navPerShareMicros: string;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));
export const coveredCallYears = (asOf: string, expiresAt: string) => Math.max(0, (Date.parse(expiresAt) - Date.parse(asOf)) / YEAR_MS);

/** The NAV per share, in micros, from a document's inputs: what a browser recomputes. */
export function coveredCallNav(document: Pick<CoveredCallDocument, "asOf" | "underlying" | "terms" | "units" | "cash"> & { call: CallLeg }): { navMicros: bigint; callValue: number } {
  const { price } = document.underlying;
  const value = callPrice(price, document.call.strike, coveredCallYears(document.asOf, document.call.expiresAt), document.terms.volatility, document.terms.rate);
  const nav = document.units * price + document.cash - document.units * value;
  return { navMicros: BigInt(Math.round(nav * 1e6)), callValue: round(value, 6) };
}

function sell(terms: CoveredCallTerms, units: number, cash: number, price: number, asOf: string): { cash: number; call: CallLeg } {
  const strike = round(price * (1 + terms.moneyness), 2);
  const expiresAt = new Date(Date.parse(asOf) + terms.tenorDays * 86_400_000).toISOString();
  const premium = round(callPrice(price, strike, terms.tenorDays / 365, terms.volatility, terms.rate), 6);
  return { cash: round(cash + units * premium, 6), call: { strike, soldAt: asOf, expiresAt, premium } };
}

/** The fund at a new price: started, rolled at expiry, or marked. */
export function stepCoveredCall(productId: string, terms: CoveredCallTerms, previous: CoveredCallState | null, quote: { price: number; time: string; address: string }): { state: CoveredCallState; document: CoveredCallDocument; rolled: boolean } {
  const { price, time: asOf } = quote;
  let state: CoveredCallState;
  let rolled = false;
  if (!previous) {
    const units = round(100 / price, 9);
    const sold = sell(terms, units, round(100 - units * price, 6), price, asOf);
    state = { units, cash: sold.cash, call: sold.call, startedAt: asOf, rolls: 0 };
  } else if (Date.parse(asOf) >= Date.parse(previous.call.expiresAt)) {
    // The call settles at this price, the proceeds go back into the ETF, and a new call is sold.
    const settled = previous.cash - previous.units * Math.max(price - previous.call.strike, 0);
    const nav = previous.units * price + settled;
    const units = round(nav / price, 9);
    const sold = sell(terms, units, round(nav - units * price, 6), price, asOf);
    state = { units, cash: sold.cash, call: sold.call, startedAt: previous.startedAt, rolls: previous.rolls + 1 };
    rolled = true;
  } else {
    state = previous;
  }
  const base = { asOf, underlying: { symbol: terms.underlying, address: quote.address, price }, terms: { moneyness: terms.moneyness, tenorDays: terms.tenorDays, volatility: terms.volatility, rate: terms.rate }, units: state.units, cash: state.cash, call: state.call };
  const { navMicros, callValue } = coveredCallNav(base);
  const document: CoveredCallDocument = { product: productId, kind: "covered-call", ...base, call: { ...state.call, value: callValue }, startedAt: state.startedAt, rolls: state.rolls, navPerShareMicros: navMicros.toString() };
  return { state, document, rolled };
}

/** Premium of the current call as a share of the fund, and that a year if every month paid the same. */
export function premiumYield(document: CoveredCallDocument): { month: number; annualized: number } {
  const nav = Number(document.navPerShareMicros) / 1e6;
  const month = nav > 0 ? document.units * document.call.premium / nav : 0;
  return { month, annualized: month * 365 / document.terms.tenorDays };
}
