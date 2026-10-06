/**
 * A browser's check of an income product's record: the product's own record read from X Layer under
 * its pinned product key, the SHA-256 of the document this page has for it, the NAV recomputed from
 * that document's inputs (Black–Scholes for a covered call; face or payout for the note), and the
 * records it rests on (its call's sale and each roll; the note's fixing, knock-in and observations),
 * each checked against its own transaction on X Layer.
 */
import type { FundDetail } from "../funds/api";
import { incomeFund, universeToken } from "../funds/catalog";
import { sha256Hex } from "../engine/fixed";
import { decodeNavPublished, readLatestNav, readTransactionReceipt, type OnchainNav } from "../xstocks/onchain";
import { PROOF_DEPLOYMENT } from "../xstocks/proof";
import { NAV_MAX_AGE_MS } from "../funds/verification";
import { autocallNav, couponPayout, maturityPayout, observationDate, subscriptionEnd, type AutocallDocument } from "./autocall";
import { cashWithPremium, coveredCallNav, rolledPosition, startingPosition, type CoveredCallDocument } from "./covered-call";
import { callPrice } from "./options";
import { autocallTerms, coveredCallTerms } from "./terms";
import { isIncomeTransition, transitionsAt, type ArchivedRecord, type TransitionArchive } from "./transitions";

export type IncomeDocument = CoveredCallDocument | AutocallDocument;
export type IncomeVerification =
  | { result: "matched"; detail: string; record: OnchainNav; document: IncomeDocument; stale?: true }
  | { result: "failed" | "unavailable" | "checking"; detail: string; record?: never; document?: never; stale?: never };

/**
 * A call sold on the product's terms: the strike 2% above the ETF price it was sold at, rounded to the
 * cent, and the premium Black–Scholes gives at the stated volatility and rate for the tenor. That price
 * is the sale record's own (`salePrice`, when this record sold the call), and a call records it from
 * 6 October 2026; without either, a call is held to its strike's premium within what the cent rounding
 * of the strike leaves open (a price within half a cent of strike / (1 + moneyness)).
 */
function callSoldOnTerms(call: CoveredCallDocument["call"], terms: { moneyness: number; tenorDays: number; volatility: number; rate: number }, salePrice?: number): boolean {
  if (!(call.strike > 0) || !(call.premium > 0)) return false;
  if (call.spot !== undefined && salePrice !== undefined && call.spot !== salePrice) return false;
  const years = terms.tenorDays / 365;
  const spot = call.spot ?? salePrice;
  if (typeof spot === "number") {
    if (!(spot > 0)) return false;
    const strike = Number((spot * (1 + terms.moneyness)).toFixed(2));
    return call.strike === strike && call.premium === Number(callPrice(spot, strike, years, terms.volatility, terms.rate).toFixed(6));
  }
  if (call.spot !== undefined) return false;
  return Math.abs(call.premium - callPrice(call.strike / (1 + terms.moneyness), call.strike, years, terms.volatility, terms.rate)) <= 0.006;
}

/**
 * The fund's holding within one call: at each sale everything goes back into the ETF, less than a
 * micro-dollar of rounding is left in cash, and the premium is added, so the cash is the premium on
 * the units. At inception the units are US$100 of the ETF at the price the call was sold at: exactly
 * the model's at the record that sold it, and otherwise within the rounding of the recorded price (for
 * a call sold before that price was recorded, at strike / (1 + moneyness), within the cent of the
 * strike). After a roll the units come from the call before it, which checkIncomeHistory traces.
 */
function positionOnTerms(document: CoveredCallDocument, moneyness: number): boolean {
  const { units, cash, call } = document;
  if (!(units > 0) || !Number.isFinite(cash) || Math.abs(cash - units * call.premium) > 2e-6) return false;
  if (document.rolls > 0) return true;
  if (call.soldAt === document.asOf) {
    const start = startingPosition(document.underlying.price);
    return units === start.units && cash === cashWithPremium(start, call.premium);
  }
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
 * observation before this one, the units after a roll) is held here to the terms and to this
 * record's levels, and to that record itself by checkIncomeHistory.
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
      && callSoldOnTerms(call, terms, call.soldAt === document.asOf ? document.underlying.price : undefined) && call.value === coveredCallNav(document).callValue
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

const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const DAY_MS = 86_400_000;
const gap = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

export type HistoryCheck = { result: "matched" | "failed" | "unavailable"; detail: string };
/** null when an archived record is this product's record on X Layer; otherwise why it is not shown to be. */
export type RecordProof = (record: ArchivedRecord) => Promise<HistoryCheck | null>;

const failed = (detail: string): HistoryCheck => ({ result: "failed", detail });
const unavailable = (detail: string): HistoryCheck => ({ result: "unavailable", detail });

/** The call as it was sold; its value is marked again at every record. */
const soldCall = (call: CoveredCallDocument["call"]) => ({ strike: call.strike, soldAt: call.soldAt, expiresAt: call.expiresAt, premium: call.premium, spot: call.spot ?? null });

/** Nothing in a covered call's position changes between sales: units, cash, the call, its start and its rolls. */
const samePosition = (a: CoveredCallDocument, b: CoveredCallDocument) =>
  a.units === b.units && a.cash === b.cash && a.startedAt === b.startedAt && a.rolls === b.rolls && same(soldCall(a.call), soldCall(b.call));

/** An earlier record of the note leads to this one: the same fixing and levels, its observations first, its knock-in kept, and its lowest level no lower. */
function noteLeadsTo(earlier: AutocallDocument, current: AutocallDocument): boolean {
  const a = earlier.state;
  const b = current.state;
  if (a.fixedAt !== b.fixedAt || !same(a.initial, b.initial) || a.lowestWorst < b.lowestWorst) return false;
  if (a.observations.length > b.observations.length || !a.observations.every((observation, index) => same(observation, b.observations[index]))) return false;
  // A knock-in stays at its time; before it, the note had not knocked in.
  if (a.knockedIn ? a.knockedInAt !== b.knockedInAt : b.knockedInAt !== null && Date.parse(b.knockedInAt) <= Date.parse(earlier.asOf)) return false;
  // Nothing is recorded after a note settles.
  return a.status === "live" || earlier.asOf === current.asOf;
}

/**
 * Traces a record to the records it rests on (lib/income/transitions.ts): a covered call's position to
 * the sale of its call and each roll back to the start, and a note's state to its fixing, knock-in and
 * observations. Each archived record up to this one must follow the product's terms, be one this record
 * rests on, and be this product's record on X Layer (`prove`). One from before the archive starts is
 * held to the terms only, and said so; one missing after it leaves the check unavailable.
 */
export async function checkIncomeHistory(productId: string, document: IncomeDocument, archive: TransitionArchive | null, prove: RecordProof): Promise<HistoryCheck> {
  if (!archive || !Array.isArray(archive.records) || !Number.isFinite(Date.parse(archive.since))) return { result: "matched", detail: "Its earlier records are not archived here, so what they decided is held to the product's terms only." };
  const since = Date.parse(archive.since);
  const asOf = Date.parse(document.asOf);
  const entries: { record: ArchivedRecord; document: IncomeDocument }[] = [];
  for (const record of archive.records) {
    const time = Date.parse(record?.asOf);
    if (!Number.isFinite(time)) return failed("The archive holds a record without a time.");
    if (time > asOf) continue;
    let earlier: IncomeDocument;
    try {
      earlier = JSON.parse(record.canonical) as IncomeDocument;
      const nav = earlier.product === productId && earlier.kind === document.kind && earlier.asOf === record.asOf && earlier.navPerShareMicros === record.navPerShareMicros && isIncomeTransition(earlier) ? recomputeIncomeNav(productId, earlier) : null;
      if (nav === null || gap(nav, BigInt(record.navPerShareMicros)) > 1n) return failed(`The archived record at ${when(record.asOf)} is not a sale, fixing, knock-in or observation on this product's terms.`);
    } catch {
      return failed(`The archived record at ${when(record.asOf)} could not be read.`);
    }
    entries.push({ record, document: earlier });
  }
  const at = new Map(entries.map((entry) => [entry.record.asOf, entry]));
  if (at.size !== entries.length) return failed("The archive holds two records at one time.");
  const current = at.get(document.asOf);
  if (current && !same(current.document, document)) return failed("The archive holds another record at this record's time.");

  const used = new Set<string>();
  const restsOn: string[] = [];
  let before: string | null = null;
  if (document.kind === "covered-call") {
    const terms = coveredCallTerms(productId);
    if (!terms) return failed("This product has no published terms.");
    // This record's position is the one its call was sold with.
    let sale: CoveredCallDocument = document;
    if (document.call.soldAt !== document.asOf) {
      const entry = at.get(document.call.soldAt);
      if (!entry) {
        if (Date.parse(document.call.soldAt) >= since) return unavailable(`The record of the call sold at ${when(document.call.soldAt)} is not in this page's archive yet.`);
        before = `the call sold at ${when(document.call.soldAt)}`;
      } else {
        sale = entry.document as CoveredCallDocument;
        if (!samePosition(document, sale)) return failed(`This record's position differs from the one its call was sold with at ${when(sale.asOf)}.`);
        used.add(sale.asOf);
        restsOn.push(`the sale of its call at ${when(sale.asOf)}`);
      }
    }
    // Back through each roll to the start: each roll's units are what the call before it left, at the roll's price.
    while (!before && sale.rolls > 0) {
      const latest = Date.parse(sale.asOf) - terms.tenorDays * DAY_MS;
      const roll = sale;
      const previous = entries.filter(({ document: item }) => (item as CoveredCallDocument).call.soldAt === item.asOf && (item as CoveredCallDocument).rolls === roll.rolls - 1 && Date.parse(item.asOf) <= latest);
      if (previous.length > 1) return failed(`The archive holds two sales before the roll at ${when(roll.asOf)}.`);
      if (!previous.length) {
        if (latest >= since) return unavailable(`The record of the call before the roll at ${when(roll.asOf)} is not in this page's archive yet.`);
        before = `the call before the roll at ${when(roll.asOf)}`;
        break;
      }
      const prior = previous[0].document as CoveredCallDocument;
      const position = rolledPosition(prior, roll.underlying.price);
      if (roll.startedAt !== prior.startedAt || Date.parse(prior.call.expiresAt) > Date.parse(roll.asOf) || roll.units !== position.units || roll.cash !== cashWithPremium(position, roll.call.premium)) {
        return failed(`The roll at ${when(roll.asOf)} does not follow from the call sold at ${when(prior.asOf)}.`);
      }
      used.add(prior.asOf);
      restsOn.push(prior.rolls === 0 ? `the first call's sale at ${when(prior.asOf)}` : `the roll at ${when(prior.asOf)}`);
      sale = prior;
    }
  } else {
    // Each time the note's state names: its fixing, its knock-in and each observation.
    const { state } = document;
    const named: { time: string; what: string; role: "fixing" | "knock-in" | "observation" }[] = [
      { time: state.fixedAt, what: "fixing", role: "fixing" },
      ...(state.knockedInAt ? [{ time: state.knockedInAt, what: "knock-in", role: "knock-in" as const }] : []),
      ...state.observations.map((observation) => ({ time: observation.observedAt, what: `observation ${observation.index}`, role: "observation" as const })),
    ];
    for (const { time, what, role } of named) {
      if (time === document.asOf) continue;
      const entry = at.get(time);
      if (!entry) {
        if (Date.parse(time) >= since) return unavailable(`The record of the note's ${what} at ${when(time)} is not in this page's archive yet.`);
        before ??= `the note's ${what} at ${when(time)}`;
        continue;
      }
      if (!transitionsAt(entry.document).includes(role) || !noteLeadsTo(entry.document as AutocallDocument, document)) return failed(`The note's ${what} at ${when(time)} differs from its own record.`);
      if (!used.has(time)) restsOn.push(`its ${what} at ${when(time)}`);
      used.add(time);
    }
  }
  // Every archived record up to this one is one it rests on: a knock-in or a sale it leaves out is a fault.
  const stray = entries.find((entry) => entry.record.asOf !== document.asOf && !used.has(entry.record.asOf));
  if (stray) return failed(`The archive holds a record at ${when(stray.record.asOf)} that this record does not rest on.`);
  // This record's own archived copy is checked too, for the records after it to rest on.
  if (current) used.add(document.asOf);

  const proofs = await Promise.all([...used].map((time) => prove(at.get(time)!.record)));
  const fault = proofs.find((proof) => proof?.result === "failed") ?? proofs.find((proof) => proof !== null);
  if (fault) return fault;
  const list = restsOn.length > 1 ? `${restsOn.slice(0, -1).join(", ")} and ${restsOn[restsOn.length - 1]}` : restsOn[0];
  const traced = restsOn.length ? `It rests on ${list}, ${restsOn.length > 1 ? "each checked" : "checked"} against its own transaction on X Layer.` : "";
  const untraced = before ? ` Records before ${when(archive.since)} are not archived, so ${before} is held to the product's terms only.` : "";
  return { result: "matched", detail: `${traced}${untraced}`.trim() };
}

/** Records already shown on X Layer in this page, by product, transaction, fingerprint, NAV and time: a receipt does not change. */
const PROVEN = new Set<string>();

/** An archived record checked as the browser does: its document hashes to its fingerprint, and its transaction emitted that record for this product from the pinned registry. */
export function receiptProof(productKey: string, fetcher?: typeof fetch): RecordProof {
  return async (record) => {
    const time = when(record.asOf);
    const digest = (await sha256Hex(record.canonical)).toLowerCase();
    if (digest !== record.holdingsHash.toLowerCase()) return failed(`The archived record at ${time} does not hash to its fingerprint.`);
    const key = [productKey, record.txHash, digest, record.navPerShareMicros, record.asOf].join("|").toLowerCase();
    if (PROVEN.has(key)) return null;
    if (!record.txHash || !/^0x[0-9a-f]{64}$/i.test(record.txHash)) return unavailable(`The archived record at ${time} names no transaction to check it against.`);
    const receipt = await readTransactionReceipt(PROOF_DEPLOYMENT.rpcUrl, record.txHash, { fetcher });
    if (!receipt) return unavailable(`X Layer did not return the transaction of the record at ${time}.`);
    const event = receipt.status === "0x1"
      ? (receipt.logs ?? []).filter((log) => log.address?.toLowerCase() === PROOF_DEPLOYMENT.registry).map(decodeNavPublished).find((item) => item?.productKey === productKey.toLowerCase() && item.holdingsHash === record.holdingsHash.toLowerCase())
      : undefined;
    if (!event || event.navPerShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(event.effectiveAt) / 1000) !== Math.floor(Date.parse(record.asOf) / 1000)) return failed(`The transaction of the archived record at ${time} did not record it for this product.`);
    PROVEN.add(key);
    return null;
  };
}

/** An archived record checked by its fingerprint alone, where its transaction is not read (the MCP tools). */
export const fingerprintProof: RecordProof = async (record) =>
  (await sha256Hex(record.canonical)).toLowerCase() === record.holdingsHash.toLowerCase() ? null : failed(`The archived record at ${when(record.asOf)} does not hash to its fingerprint.`);

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
  const history = await checkIncomeHistory(definition.id, document, fund.transitions ?? null, receiptProof(definition.productKey, options.fetcher));
  if (history.result !== "matched") return { result: history.result, detail: history.detail };
  const detail = `Your browser read this product's record on X Layer, hashed its document and recomputed the NAV from it: they match.${history.detail ? ` ${history.detail}` : ""}`;
  // A covered call is valued every five minutes, so an old record still checks out but is marked as the last known value.
  if (document.kind === "covered-call" && (options.now ?? Date.now()) - Date.parse(record.effectiveAt) > NAV_MAX_AGE_MS) return { result: "matched", stale: true, detail: `${detail} It is the latest record but over an hour old: new records are delayed, so this is the last known value.`, record, document };
  return { result: "matched", detail, record, document };
}
