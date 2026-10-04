/**
 * A step-down autocallable note (an ELS) on the worse of SPYx and QQQx. The starting levels are fixed
 * at the first record after `fixingFrom`. Every record checks the knock-in: if either index closes a
 * record below half its starting level, the capital is at risk at maturity. Every six months, the
 * first record at or after the observation date compares the worse index with that observation's
 * barrier: at or above it, the note is called and pays face plus 3.5% per half-year elapsed. At the
 * last observation, a note not called pays the full coupon unless it knocked in and the worse index
 * is below the barrier; then it pays face times the worse index's performance.
 *
 * While the note is live, its recorded NAV is its face value: it is held to an event, not marked to
 * a model. Once called or matured, the NAV is what it pays, and holders are paid at it.
 */
import { addMonths, type AutocallTerms } from "./terms";

export type Observation = { index: number; date: string; observedAt: string; worst: number; barrier: number; called: boolean };
export type AutocallState = {
  fixedAt: string;
  initial: Record<string, number>;
  knockedIn: boolean;
  knockedInAt: string | null;
  lowestWorst: number;
  observations: Observation[];
  status: "live" | "called" | "matured";
  payout: number | null;
};

export type AutocallDocument = {
  product: string;
  kind: "autocall";
  asOf: string;
  terms: Omit<AutocallTerms, "kind" | "fixingFrom">;
  prices: Record<string, number>;
  performance: Record<string, number>;
  worst: number;
  state: AutocallState;
  nextObservation: { index: number; date: string; barrier: number; payIfCalled: number } | null;
  subscriptionEndsAt: string;
  navPerShareMicros: string;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));
export const observationDate = (terms: AutocallTerms, fixedAt: string, index: number) => addMonths(fixedAt, terms.observationMonths * index);
export const couponPayout = (terms: AutocallTerms, index: number) => round(terms.face * (1 + terms.couponPerYear * terms.observationMonths / 12 * index), 6);
export const subscriptionEnd = (terms: AutocallTerms, fixedAt: string) => new Date(Date.parse(fixedAt) + terms.subscriptionDays * 86_400_000).toISOString();

/** What a note pays at its last observation, by the worse index's performance and the knock-in. */
export function maturityPayout(terms: AutocallTerms, worst: number, knockedIn: boolean): number {
  const last = terms.barriers.length;
  return !knockedIn || worst >= terms.barriers[last - 1] ? couponPayout(terms, last) : round(terms.face * worst, 6);
}

/** The NAV a document's state implies: face while live, the payout once settled. */
export function autocallNav(terms: Pick<AutocallTerms, "face">, state: AutocallState): bigint {
  return BigInt(Math.round((state.status === "live" ? terms.face : state.payout ?? terms.face) * 1e6));
}

/** The note at new prices; null before the fixing. A called or matured note stays as it settled. */
export function stepAutocall(productId: string, terms: AutocallTerms, previous: AutocallState | null, prices: Record<string, number>, asOf: string): { state: AutocallState; document: AutocallDocument; settled: boolean } | null {
  if (!previous && Date.parse(asOf) < Date.parse(terms.fixingFrom)) return null;
  const initial = previous?.initial ?? Object.fromEntries(terms.underlyings.map((symbol) => [symbol, prices[symbol]]));
  const performance = Object.fromEntries(terms.underlyings.map((symbol) => [symbol, round(prices[symbol] / initial[symbol], 6)]));
  const worst = Math.min(...Object.values(performance));
  let state: AutocallState = previous ?? { fixedAt: asOf, initial, knockedIn: false, knockedInAt: null, lowestWorst: 1, observations: [], status: "live", payout: null };
  let settled = false;
  if (state.status === "live") {
    state = { ...state, lowestWorst: Math.min(state.lowestWorst, worst) };
    if (!state.knockedIn && worst < terms.knockIn) state = { ...state, knockedIn: true, knockedInAt: asOf };
    const index = state.observations.length + 1;
    const date = observationDate(terms, state.fixedAt, index);
    if (index <= terms.barriers.length && Date.parse(asOf) >= Date.parse(date)) {
      const barrier = terms.barriers[index - 1];
      const called = worst >= barrier;
      state = { ...state, observations: [...state.observations, { index, date, observedAt: asOf, worst, barrier, called }] };
      if (called) { state = { ...state, status: "called", payout: couponPayout(terms, index) }; settled = true; }
      else if (index === terms.barriers.length) { state = { ...state, status: "matured", payout: maturityPayout(terms, worst, state.knockedIn) }; settled = true; }
    }
  }
  const next = state.status === "live" && state.observations.length < terms.barriers.length ? state.observations.length + 1 : null;
  const rest = { underlyings: terms.underlyings, face: terms.face, subscriptionDays: terms.subscriptionDays, observationMonths: terms.observationMonths, barriers: terms.barriers, knockIn: terms.knockIn, couponPerYear: terms.couponPerYear };
  const document: AutocallDocument = {
    product: productId, kind: "autocall", asOf, terms: rest, prices, performance, worst, state,
    nextObservation: next ? { index: next, date: observationDate(terms, state.fixedAt, next), barrier: terms.barriers[next - 1], payIfCalled: couponPayout(terms, next) } : null,
    subscriptionEndsAt: subscriptionEnd(terms, state.fixedAt),
    navPerShareMicros: autocallNav(terms, state).toString(),
  };
  return { state, document, settled };
}
