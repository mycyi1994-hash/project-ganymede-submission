/**
 * The five funds other than USTX (lib/funds/catalog.ts), recorded every five minutes after the USTX
 * record in the same scheduled run: one OnchainOS request prices every xStock they hold, each fund's
 * NAV and the fingerprint of its document go to GanymedeNavRegistry under the fund's own product
 * key, and the documents are kept so a browser can check each record. A fund that cannot be priced
 * waits; nothing here can hold up or change the USTX record, which has already been sent.
 */
import type { EngineRepository } from "../engine/repository";
import type { SettlementClient, SettlementRequest } from "../engine/settlement";
import type { EngineEnv } from "../engine/types";
import { sha256Hex } from "../engine/fixed";
import { basketDocument, deserializeBasket, evaluateBasket, serializeBasket, type Composition, type Evaluation } from "../xstocks/basket";
import { maxQuoteAgeMinutes, type Publication, type RebalanceEvidence } from "../xstocks/cycle";
import { fetchXStockQuotes, onchainOsCredentials } from "../xstocks/prices";
import { comparePrices, formatDifference, FUND_POOLS, POOL_TOLERANCE, readPoolPrices, type PoolPrices } from "../xstocks/pool-prices";
import { parseFundComposition } from "../xstocks/proof";
import { SERIES_LIMIT, type SeriesPoint } from "../xstocks/series";
import { FUND_INCEPTION_NAV_MICROS, INCOME_FUNDS, OTHER_FUNDS, fundConstituents, universeToken, type FundDefinition } from "./catalog";
import { runIncomeCycle } from "../income/cycle";
import { addTransition, type TransitionArchive } from "../income/transitions";

export const fundStateKey = (fundId: string, part: "basket" | "latest" | "history" | "confirmed" | "rebalance" | "series" | "transitions") => `fund:${fundId}:${part}`;
export const HISTORY_LIMIT = 12;

export type FundLatest = {
  evaluatedAt: string;
  status: Evaluation["status"];
  blockers: string[];
  warnings: string[];
  composition: Composition | null;
  publication: Publication | null;
  /** How the prices compared with the X Layer pools for this record. */
  poolCheck: { state: "agrees" | "not_compared"; detail: string } | null;
};

export type FundsCycleResult = { navsPublished: number; warnings: string[] };

const unresolved = (status: Publication["status"]) => status === "queued" || status === "submitted";

export function navRequest(fundId: string, entry: Pick<Publication, "asOf" | "navPerShareMicros" | "holdingsHash" | "sharesOutstandingMicros">): SettlementRequest {
  return {
    entityType: "nav", entityId: `${fundId}:${entry.asOf}`, action: "publish_nav", productId: fundId,
    navPerShareMicros: entry.navPerShareMicros,
    ...(entry.sharesOutstandingMicros && entry.sharesOutstandingMicros !== "0" ? { sharesOutstandingMicros: entry.sharesOutstandingMicros } : {}),
    holdingsHash: entry.holdingsHash, effectiveAt: entry.asOf,
  };
}

const rebalanceRequest = (fundId: string, evidence: RebalanceEvidence): SettlementRequest =>
  ({ entityType: "rebalance", entityId: `${fundId}:${evidence.fixedAt}`, action: "publish_rebalance", productId: fundId, holdingsHash: evidence.holdingsHash, effectiveAt: evidence.effectiveAt });

export const read = async <T>(repo: EngineRepository, key: string, empty: T): Promise<T> => {
  const value = (await repo.getState(key))?.value;
  return value ? JSON.parse(value) as T : empty;
};

/** Each confirmed record, as [seconds, NAV micros], newest last, at most SERIES_LIMIT. */
export function addSeriesPoint(series: SeriesPoint[], publication: Publication): SeriesPoint[] {
  const seconds = Math.floor(Date.parse(publication.asOf) / 1000);
  if (series.some(([at]) => at === seconds)) return series;
  return [...series, [seconds, publication.navPerShareMicros] as SeriesPoint].sort((a, b) => a[0] - b[0]).slice(-SERIES_LIMIT);
}

/** A record whose outcome was unknown is asked about again with the same idempotency key. */
async function reconcile(repo: EngineRepository, settlement: SettlementClient, fund: FundDefinition): Promise<void> {
  const history = await read<Publication[]>(repo, fundStateKey(fund.id, "history"), []);
  const pending = history.find((entry) => unresolved(entry.status));
  if (pending) {
    const request = navRequest(fund.id, pending);
    const result = await settlement.settle(request);
    await repo.saveSettlement(request, result);
    Object.assign(pending, { status: result.status, txHash: result.txHash ?? pending.txHash, error: result.error });
    await repo.setState(fundStateKey(fund.id, "history"), JSON.stringify(history));
    if (pending.status === "confirmed") await recordConfirmed(repo, fund.id, pending);
  }
  const rebalance = await read<RebalanceEvidence | null>(repo, fundStateKey(fund.id, "rebalance"), null);
  if (rebalance && unresolved(rebalance.status)) {
    const request = rebalanceRequest(fund.id, rebalance);
    const result = await settlement.settle(request);
    await repo.saveSettlement(request, result);
    await repo.setState(fundStateKey(fund.id, "rebalance"), JSON.stringify({ ...rebalance, status: result.status, txHash: result.txHash ?? rebalance.txHash, error: result.error }));
  }
}

export async function recordConfirmed(repo: EngineRepository, fundId: string, publication: Publication): Promise<void> {
  const confirmed = await read<Publication | null>(repo, fundStateKey(fundId, "confirmed"), null);
  if (!confirmed || Date.parse(publication.asOf) > Date.parse(confirmed.asOf)) await repo.setState(fundStateKey(fundId, "confirmed"), JSON.stringify(publication));
  const series = await read<SeriesPoint[]>(repo, fundStateKey(fundId, "series"), []);
  await repo.setState(fundStateKey(fundId, "series"), JSON.stringify(addSeriesPoint(series, publication)));
  // An income product's sales, fixing, knock-in and observations are kept for the browser to trace
  // later records to (lib/income/transitions.ts). This never holds up a record: one not kept shows
  // in that check as missing.
  if (INCOME_FUNDS.some((fund) => fund.id === fundId)) {
    try {
      const archive = await read<TransitionArchive | null>(repo, fundStateKey(fundId, "transitions"), null);
      const next = addTransition(archive, publication);
      if (next !== archive) await repo.setState(fundStateKey(fundId, "transitions"), JSON.stringify(next));
    } catch (error) {
      console.error(`${fundId}: the record at ${publication.asOf} was not archived`, error);
    }
  }
}

/** Compared only when every holding has a deep pool pinned; a thin pool would only add noise. */
export function fundPoolCheck(composition: Composition, pools: PoolPrices | null): { blocker: string | null; check: FundLatest["poolCheck"] } {
  const missing = composition.holdings.filter((holding) => !FUND_POOLS.some((pool) => pool.symbol === holding.symbol && pool.token === holding.address.toLowerCase())).map((holding) => holding.symbol);
  if (missing.length) return { blocker: null, check: { state: "not_compared", detail: `${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no X Layer pool deep enough to check a price against.` } };
  if (!pools) return { blocker: null, check: { state: "not_compared", detail: "The X Layer pools could not be read for this record." } };
  const comparison = comparePrices(composition, pools);
  if (!comparison) return { blocker: null, check: { state: "not_compared", detail: "The pools returned no price for a holding." } };
  if (comparison.agrees) return { blocker: null, check: { state: "agrees", detail: `Valued at the X Layer pools, this NAV is ${formatDifference(comparison.navDifferenceBps)} from the NAV at OnchainOS prices.` } };
  const widest = comparison.rows.reduce((a, b) => (Math.abs(b.differenceBps) > Math.abs(a.differenceBps) ? b : a));
  return { blocker: `The NAV at the X Layer pools is ${formatDifference(comparison.navDifferenceBps)} from the NAV at OnchainOS prices, beyond ${POOL_TOLERANCE.navBps / 100}% (widest: ${widest.symbol} pool ${formatDifference(widest.differenceBps)})`, check: null };
}

export async function runFundsCycle(env: EngineEnv, repo: EngineRepository, settlement: SettlementClient, now = new Date().toISOString(), sources: { fetcher?: typeof fetch; poolPrices?: () => Promise<PoolPrices>; wait?: (ms: number) => Promise<void> } = {}): Promise<FundsCycleResult> {
  const warnings: string[] = [];
  let navsPublished = 0;
  for (const fund of [...OTHER_FUNDS, ...INCOME_FUNDS]) {
    try { await reconcile(repo, settlement, fund); } catch (error) { warnings.push(`${fund.ticker} reconcile: ${error instanceof Error ? error.message : "unknown error"}`); }
  }

  const symbols = [...new Set([...OTHER_FUNDS, ...INCOME_FUNDS].flatMap((fund) => fund.constituents))];
  const { quotes, warnings: priceWarnings } = await fetchXStockQuotes(onchainOsCredentials(env), symbols.map((symbol) => ({ symbol, address: universeToken(symbol)!.address })), sources.fetcher, sources.wait ?? (async () => undefined));
  warnings.push(...priceWarnings);
  let pools: PoolPrices | null = null;
  try {
    pools = await (sources.poolPrices ?? (() => readPoolPrices((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }), FUND_POOLS)))();
  } catch (error) {
    warnings.push(`Fund prices not compared with the X Layer pools: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  for (const fund of OTHER_FUNDS) {
    try {
      const previous = deserializeBasket((await repo.getState(fundStateKey(fund.id, "basket")))?.value);
      const evaluation = await evaluateBasket({ constituents: fundConstituents(fund), quotes, previous, now, maxQuoteAgeMinutes: maxQuoteAgeMinutes(env), product: { id: fund.id, inceptionNavMicros: FUND_INCEPTION_NAV_MICROS } });
      let poolCheck: FundLatest["poolCheck"] = null;
      if (evaluation.publishable && evaluation.canonical) {
        try { parseFundComposition(evaluation.canonical, fund.id); } catch (error) {
          evaluation.publishable = false;
          evaluation.blockers.push(`The composition would not pass verification: ${error instanceof Error ? error.message : "invalid document"}`);
        }
      }
      const confirmed = await read<Publication | null>(repo, fundStateKey(fund.id, "confirmed"), null);
      if (evaluation.publishable && evaluation.composition && confirmed && Math.floor(Date.parse(evaluation.composition.asOf) / 1000) <= Math.floor(Date.parse(confirmed.asOf) / 1000)) {
        evaluation.publishable = false;
        evaluation.blockers.push("No price is newer than the last NAV record");
      }
      if (evaluation.publishable && evaluation.composition) {
        const result = fundPoolCheck(evaluation.composition, pools);
        poolCheck = result.check;
        if (result.blocker) { evaluation.publishable = false; evaluation.blockers.push(result.blocker); }
      }

      let publication: Publication | null = null;
      if (evaluation.publishable && evaluation.basket && evaluation.composition && evaluation.canonical && evaluation.holdingsHash) {
        await repo.setState(fundStateKey(fund.id, "basket"), serializeBasket(evaluation.basket));
        if (evaluation.rebalanced) {
          const canonical = basketDocument(evaluation.basket);
          const evidence: RebalanceEvidence = { fixedAt: evaluation.basket.fixedAt, effectiveAt: evaluation.composition.asOf, canonical, holdingsHash: await sha256Hex(canonical), status: "queued", txHash: null, error: null };
          const request = rebalanceRequest(fund.id, evidence);
          const result = await settlement.settle(request);
          await repo.saveSettlement(request, result);
          await repo.setState(fundStateKey(fund.id, "rebalance"), JSON.stringify({ ...evidence, status: result.status, txHash: result.txHash, error: result.error }));
        }
        // No shares are issued: the fund's NAV is recorded, and investing in it is not open.
        const pending: Publication = { asOf: evaluation.composition.asOf, calculatedAt: now, navPerShareMicros: evaluation.composition.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: evaluation.holdingsHash, canonical: evaluation.canonical, status: "queued", txHash: null, error: null };
        // The document is stored before the transaction, so an on-chain hash always has its document.
        const history = (await read<Publication[]>(repo, fundStateKey(fund.id, "history"), [])).filter((entry) => entry.holdingsHash !== pending.holdingsHash);
        await repo.setState(fundStateKey(fund.id, "history"), JSON.stringify([pending, ...history].slice(0, HISTORY_LIMIT)));
        const request = navRequest(fund.id, pending);
        const result = await settlement.settle(request);
        await repo.saveSettlement(request, result);
        publication = { ...pending, status: result.status, txHash: result.txHash, error: result.error };
        await repo.setState(fundStateKey(fund.id, "history"), JSON.stringify([publication, ...history].slice(0, HISTORY_LIMIT)));
        if (result.status === "confirmed") { await recordConfirmed(repo, fund.id, publication); navsPublished += 1; }
        if (result.error) warnings.push(`${fund.ticker} NAV publication: ${result.error}`);
      } else {
        warnings.push(...evaluation.blockers.map((blocker) => `${fund.ticker} not published: ${blocker}`));
      }
      const latest: FundLatest = { evaluatedAt: now, status: evaluation.status, blockers: evaluation.blockers, warnings: [], composition: evaluation.composition, publication, poolCheck };
      await repo.setState(fundStateKey(fund.id, "latest"), JSON.stringify(latest));
    } catch (error) {
      warnings.push(`${fund.ticker} cycle failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  // The income products, from the same prices (lib/income/cycle.ts).
  const income = await runIncomeCycle(repo, settlement, quotes, now, maxQuoteAgeMinutes(env), pools);
  navsPublished += income.published;
  warnings.push(...income.warnings);
  return { navsPublished, warnings };
}
