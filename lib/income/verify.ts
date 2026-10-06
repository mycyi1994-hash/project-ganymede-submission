/**
 * A browser's check of an income product's record: the product's own record read from X Layer under
 * its pinned product key, the SHA-256 of the document this page has for it, and the NAV recomputed
 * from that document's inputs (Black–Scholes for a covered call; face or payout for the note).
 */
import type { FundDetail } from "../funds/api";
import { incomeFund, universeToken } from "../funds/catalog";
import { sha256Hex } from "../engine/fixed";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { PROOF_DEPLOYMENT } from "../xstocks/proof";
import { NAV_MAX_AGE_MS } from "../funds/verification";
import { autocallNav, couponPayout, maturityPayout, observationDate, subscriptionEnd, type AutocallDocument } from "./autocall";
import { coveredCallNav, type CoveredCallDocument } from "./covered-call";
import { callPrice } from "./options";
import { autocallTerms, coveredCallTerms } from "./terms";

export type IncomeDocument = CoveredCallDocument | AutocallDocument;
export type IncomeVerification =
  | { result: "matched"; detail: string; record: OnchainNav; document: IncomeDocument }
  | { result: "failed" | "unavailable" | "checking"; detail: string; record?: never; document?: never };

/**
 * A call sold on the product's terms: the strike 2% above the ETF price it was sold at, rounded to the
 * cent, and the premium Black–Scholes gives at the stated volatility and rate for the tenor. A call
 * records that price from 6 October 2026; an earlier one is held to its strike's premium within what
 * the cent rounding of the strike leaves open (a price within half a cent of strike / (1 + moneyness)).
 */
function callSoldOnTerms(call: CoveredCallDocument["call"], terms: { moneyness: number; tenorDays: number; volatility: number; rate: number }): boolean {
  if (!(call.strike > 0) || !(call.premium > 0)) return false;
  const years = terms.tenorDays / 365;
  if (typeof call.spot === "number") {
    if (!(call.spot > 0)) return false;
    const strike = Number((call.spot * (1 + terms.moneyness)).toFixed(2));
    return call.strike === strike && call.premium === Number(callPrice(call.spot, strike, years, terms.volatility, terms.rate).toFixed(6));
  }
  if (call.spot !== undefined) return false;
  return Math.abs(call.premium - callPrice(call.strike / (1 + terms.moneyness), call.strike, years, terms.volatility, terms.rate)) <= 0.006;
}

/**
 * The fund's holding within one call: at each sale everything goes back into the ETF, less than a
 * micro-dollar of rounding is left in cash, and the premium is added, so the cash is the premium on
 * the units. At inception the units are US$100 of the ETF at the price the call was sold at (for a
 * call sold before that price was recorded, at strike / (1 + moneyness), within the cent of the strike).
 */
function positionOnTerms(document: CoveredCallDocument, moneyness: number): boolean {
  const { units, cash, call } = document;
  if (!(units > 0) || !Number.isFinite(cash) || Math.abs(cash - units * call.premium) > 2e-6) return false;
  if (document.rolls > 0) return true;
  return typeof call.spot === "number" ? Math.abs(units * call.spot - 100) <= 1e-6 : Math.abs(units * call.strike / (1 + moneyness) - 100) <= 0.001;
}

const anyOf = (items: readonly unknown[]) => items.length > 0;

/** Deep equality of plain JSON values, whatever the order of their keys. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return a === b;
}
const isoPlusDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();

/**
 * Whether a document follows its product's pinned terms (lib/income/terms.ts), so a record cannot
 * pass with other terms whose NAV merely holds together: a covered call's underlying, strike rule
 * inputs, tenor and the call's mark; a note's barriers, coupon, knock-in, observations and payout.
 *
 * One record shows what was decided at it: the fixing, a sale, an observation or a knock-in taken
 * then is held to that record's own prices. What an earlier record decided (a knock-in or an
 * observation before this one, the units after a roll) is held to the terms and to this record's
 * levels, but its own prices are only in that record's document, which a later page may not have.
 */
export function incomeTermsHold(productId: string, document: IncomeDocument): boolean {
  if (document.product !== productId) return false;
  if (document.kind === "covered-call") {
    const terms = coveredCallTerms(productId);
    if (!terms) return false;
    const token = universeToken(terms.underlying);
    const { call } = document;
    return !!token && document.underlying.symbol === terms.underlying && document.underlying.address.toLowerCase() === token.address.toLowerCase()
      && same(document.terms, { moneyness: terms.moneyness, tenorDays: terms.tenorDays, volatility: terms.volatility, rate: terms.rate })
      && call.expiresAt === isoPlusDays(call.soldAt, terms.tenorDays)
      && Date.parse(document.startedAt) <= Date.parse(call.soldAt) && Date.parse(call.soldAt) <= Date.parse(document.asOf) && Date.parse(document.asOf) < Date.parse(call.expiresAt)
      // The first call is sold at the start, and each roll at least a tenor after the sale before it.
      && Number.isInteger(document.rolls) && document.rolls >= 0 && (document.rolls === 0) === (call.soldAt === document.startedAt)
      && Date.parse(call.soldAt) >= Date.parse(document.startedAt) + document.rolls * terms.tenorDays * 86_400_000
      && callSoldOnTerms(call, terms) && call.value === coveredCallNav(document).callValue
      && positionOnTerms(document, terms.moneyness);
  }
  const terms = autocallTerms(productId);
  if (!terms) return false;
  const { state } = document;
  if (!same(document.terms, { underlyings: terms.underlyings, face: terms.face, subscriptionDays: terms.subscriptionDays, observationMonths: terms.observationMonths, barriers: terms.barriers, knockIn: terms.knockIn, couponPerYear: terms.couponPerYear })) return false;
  const asOf = Date.parse(document.asOf);
  if (Date.parse(state.fixedAt) < Date.parse(terms.fixingFrom) || Date.parse(state.fixedAt) > asOf || document.subscriptionEndsAt !== subscriptionEnd(terms, state.fixedAt)) return false;
  // The lowest level is a minimum over every record up to this one: a note is recorded only while
  // live and once more as it settles, so it is at or below this record's and every observation's.
  // A knock-in follows from it and has its time.
  if (state.lowestWorst > document.worst) return false;
  if (state.observations.some(observation => state.lowestWorst > observation.worst)) return false;
  if (state.knockedIn !== state.lowestWorst < terms.knockIn || state.knockedIn !== (state.knockedInAt !== null)) return false;
  // The fixing record sets the starting levels from its own prices, so nothing is lower yet and nothing observed.
  if (state.fixedAt === document.asOf && (terms.underlyings.some(symbol => document.prices[symbol] !== state.initial[symbol]) || state.lowestWorst !== document.worst || anyOf(state.observations))) return false;
  // A note that knocks in at this record is below the knock-in here, and this is its lowest level: it was above before.
  if (state.knockedInAt === document.asOf && !(document.worst < terms.knockIn && state.lowestWorst === document.worst)) return false;
  if (state.knockedInAt !== null && (Date.parse(state.knockedInAt) < Date.parse(state.fixedAt) || Date.parse(state.knockedInAt) > Date.parse(document.asOf))) return false;
  // Each observation is the next one on the schedule, against its own barrier, and only the last may call the note.
  const count = state.observations.length;
  if (count > terms.barriers.length) return false;
  let previousAt = Date.parse(state.fixedAt);
  for (const [position, observation] of state.observations.entries()) {
    const index = position + 1;
    if (observation.index !== index || observation.barrier !== terms.barriers[index - 1] || observation.date !== observationDate(terms, state.fixedAt, index)
      || observation.called !== observation.worst >= observation.barrier || (observation.called && index !== count)) return false;
    // Taken at a record on or after its date, after the one before, and not after this record.
    const observedAt = Date.parse(observation.observedAt);
    if (!(observedAt >= Date.parse(observation.date) && observedAt > previousAt && observedAt <= asOf)) return false;
    previousAt = observedAt;
  }
  const last = state.observations[count - 1];
  // An observation taken at this record saw this record's levels; a settled note's last record is the one it settled in.
  if (last && last.observedAt === document.asOf && last.worst !== document.worst) return false;
  if (state.status !== "live" && last?.observedAt !== document.asOf) return false;
  const payout = last?.called ? couponPayout(terms, last.index) : count === terms.barriers.length ? maturityPayout(terms, last.worst, state.knockedIn) : null;
  const status = last?.called ? "called" : count === terms.barriers.length ? "matured" : "live";
  if (state.status !== status || state.payout !== payout) return false;
  const next = status === "live" ? count + 1 : null;
  // A live note is observed at its first record on or after the date, so a record past the next date skipped it.
  if (next && Date.parse(observationDate(terms, state.fixedAt, next)) <= asOf) return false;
  return same(document.nextObservation, next ? { index: next, date: observationDate(terms, state.fixedAt, next), barrier: terms.barriers[next - 1], payIfCalled: couponPayout(terms, next) } : null);
}

/** The NAV a document implies, or null if its inputs do not hold together or it leaves its product's terms. */
export function recomputeIncomeNav(productId: string, document: IncomeDocument): bigint | null {
  if (!incomeTermsHold(productId, document)) return null;
  if (document.kind === "covered-call") return coveredCallNav(document).navMicros;
  const terms = autocallTerms(productId);
  if (!terms) return null;
  // Each performance is its price over the starting level, and the worse is the lower.
  const performance = terms.underlyings.map((symbol) => Number((document.prices[symbol] / document.state.initial[symbol]).toFixed(6)));
  if (performance.some((value, index) => value !== document.performance[terms.underlyings[index]]) || Math.min(...performance) !== document.worst) return null;
  return autocallNav(terms, document.state);
}

export async function verifyIncomeSnapshot(fund: FundDetail, productId: string, options: { fetcher?: typeof fetch; now?: number } = {}): Promise<IncomeVerification> {
  const definition = incomeFund(productId);
  if (!definition || fund.id !== definition.id || fund.productKey.toLowerCase() !== definition.productKey.toLowerCase()) return { result: "failed", detail: "This response belongs to a different product." };
  const record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId, productKey: definition.productKey, fetcher: options.fetcher });
  if (!record.effectiveAt) return { result: "unavailable", detail: "No record of this product is on X Layer yet." };
  const entry = fund.history.find((item) => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase());
  if (!entry) return { result: "unavailable", detail: "A newer record is on X Layer than this page has. Waiting for the page to refresh." };
  if ((await sha256Hex(entry.canonical)).toLowerCase() !== record.holdingsHash.toLowerCase()) return { result: "failed", detail: "The document's fingerprint differs from the record on X Layer." };
  let document: IncomeDocument;
  try { document = JSON.parse(entry.canonical) as IncomeDocument; } catch { return { result: "failed", detail: "The document could not be read." }; }
  try { if (!incomeTermsHold(definition.id, document)) return { result: "failed", detail: "The document's terms differ from this product's published terms." }; } catch { return { result: "failed", detail: "The document could not be read." }; }
  const nav = recomputeIncomeNav(definition.id, document);
  const recorded = BigInt(record.navPerShareMicros);
  if (nav === null || (nav > recorded ? nav - recorded : recorded - nav) > 1n || document.navPerShareMicros !== record.navPerShareMicros) return { result: "failed", detail: "The NAV recomputed from the document differs from the record on X Layer." };
  if (fund.nav?.perShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(fund.nav.asOf) / 1_000) !== Math.floor(Date.parse(record.effectiveAt) / 1_000)) return { result: "failed", detail: "The page's NAV or timestamp differs from the record on X Layer. Waiting for a matching update." };
  if (document.kind === "covered-call" && (options.now ?? Date.now()) - Date.parse(record.effectiveAt) > NAV_MAX_AGE_MS) return { result: "unavailable", detail: "The latest NAV is over an hour old. Orders are paused until a fresh record is available." };
  return { result: "matched", detail: "Your browser read this product's record on X Layer, hashed its document and recomputed the NAV from it: they match.", record, document };
}
