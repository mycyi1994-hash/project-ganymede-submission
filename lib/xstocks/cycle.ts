/**
 * One xStocks pricing pass inside the engine cycle: price the basket from X
 * Layer, persist the composition, and publish NAV evidence through the
 * settlement relayer. Never throws into the main cycle; failures become
 * warnings and an unpublished state the proof page shows as-is.
 */
import { sha256Hex } from "../engine/fixed";
import type { EngineRepository } from "../engine/repository";
import type { SettlementClient, SettlementRequest, SettlementResult } from "../engine/settlement";
import type { EngineEnv } from "../engine/types";
import {
  basketDocument,
  constituentsWithAddresses,
  deserializeBasket,
  evaluateBasket,
  serializeBasket,
  XSTOCKS_PRODUCT,
  type Composition,
  type Evaluation,
} from "./basket";
import { fetchXStockQuotes, MAX_COOLDOWN_MS, onchainOsCredentials } from "./prices";
import { comparePrices, formatDifference, POOL_TOLERANCE, readPoolPrices, XSTOCK_POOLS, type PoolPrices } from "./pool-prices";
import { parseComposition } from "./proof";
import { updateNavSeries } from "./series";
import { demoSharesOutstanding } from "../demo/ledger";
import { fundRpc, parseStoredWalletTotals, readFundTotals, STATE_WALLET_SHARES } from "./fund";

export const STATE_BASKET = "xstocks:basket";
export const STATE_LATEST = "xstocks:latest";
export const STATE_HISTORY = "xstocks:history";
export const STATE_CONFIRMED = "xstocks:confirmed";
export const STATE_DOCUMENT_PREFIX = "xstocks:document:";
export const STATE_REBALANCE = "xstocks:rebalance";
const HISTORY_LIMIT = 12;
/** Publications whose outcome was unknown are asked about again, a few per cycle. */
const RECONCILE_LIMIT = 3;
/**
 * OnchainOS stamps each quote with the response time, so a fresh request is seconds old. Ten minutes,
 * two cycles, allows for clock differences; an older quote means the source is stale and blocks the
 * NAV, so a record's time is never more than ten minutes after the prices in it.
 */
const DEFAULT_MAX_QUOTE_AGE_MINUTES = 10;
const COOLDOWN_TOLERANCE_MS = 60_000;

export type Publication = {
  /** The record's time on X Layer: its oldest price, never later than the calculation. */
  asOf: string;
  /** When the NAV was calculated; absent on records from before this field existed. */
  calculatedAt?: string;
  navPerShareMicros: string;
  /** USTX outstanding when the NAV was taken: shares in wallets, issued by the fund contract, plus
   *  shares held with demo balances. Recorded beside the NAV on X Layer. */
  sharesOutstandingMicros?: string;
  holdingsHash: string;
  canonical: string;
  status: SettlementResult["status"];
  txHash: string | null;
  error: string | null;
};

/** The latest quarterly (or address-change) re-fixing and its on-chain evidence. */
export type RebalanceEvidence = {
  fixedAt: string;
  effectiveAt: string;
  canonical: string;
  holdingsHash: string;
  status: SettlementResult["status"];
  txHash: string | null;
  error: string | null;
};

export type LatestState = {
  evaluatedAt: string;
  retryAt?: string | null;
  status: Evaluation["status"];
  blockers: string[];
  warnings: string[];
  composition: Composition | null;
  canonical: string | null;
  holdingsHash: string | null;
  publication: Publication | null;
};

export type XStocksCycleResult = { navsPublished: number; settlementsQueued: number; warnings: string[] };

export function maxQuoteAgeMinutes(env: EngineEnv): number {
  const parsed = Number(env.XSTOCKS_MAX_QUOTE_AGE_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_QUOTE_AGE_MINUTES;
}

const unresolved = (status: SettlementResult["status"]) => status === "queued" || status === "submitted";

function navRequest(entry: Pick<Publication, "asOf" | "navPerShareMicros" | "holdingsHash" | "sharesOutstandingMicros">): SettlementRequest {
  return {
    entityType: "nav",
    entityId: `${XSTOCKS_PRODUCT.id}:${entry.asOf}`,
    action: "publish_nav",
    productId: XSTOCKS_PRODUCT.id,
    navPerShareMicros: entry.navPerShareMicros,
    // A retry sends the count stored with the publication, never a newer one.
    ...(entry.sharesOutstandingMicros && entry.sharesOutstandingMicros !== "0" ? { sharesOutstandingMicros: entry.sharesOutstandingMicros } : {}),
    holdingsHash: entry.holdingsHash,
    effectiveAt: entry.asOf,
  };
}

function rebalanceRequest(evidence: RebalanceEvidence): SettlementRequest {
  return {
    entityType: "rebalance",
    entityId: `${XSTOCKS_PRODUCT.id}:${evidence.fixedAt}`,
    action: "publish_rebalance",
    productId: XSTOCKS_PRODUCT.id,
    holdingsHash: evidence.holdingsHash,
    effectiveAt: evidence.effectiveAt,
  };
}

/**
 * A publication whose request timed out or hit a transient relayer error may still
 * have reached the chain. Asking again with the same idempotency key returns the
 * relayer's recorded outcome (or reconciles its transaction) without a second broadcast.
 */
async function reconcileUnresolved(repo: EngineRepository, settlementClient: SettlementClient): Promise<number> {
  let asked = 0;
  const history = JSON.parse((await repo.getState(STATE_HISTORY))?.value ?? "[]") as Publication[];
  const pending = history.filter((entry) => unresolved(entry.status)).slice(0, RECONCILE_LIMIT);
  if (pending.length > 0) {
    let confirmed = JSON.parse((await repo.getState(STATE_CONFIRMED))?.value ?? "null") as Publication | null;
    for (const entry of pending) {
      const request = navRequest(entry);
      const settlement = await settlementClient.settle(request);
      await repo.saveSettlement(request, settlement);
      asked += 1;
      entry.status = settlement.status;
      entry.txHash = settlement.txHash ?? entry.txHash;
      entry.error = settlement.error;
      await repo.setState(`${STATE_DOCUMENT_PREFIX}${entry.holdingsHash}`, JSON.stringify(entry));
      if (entry.status === "confirmed" && (!confirmed || Date.parse(entry.asOf) > Date.parse(confirmed.asOf))) {
        confirmed = entry;
        await repo.setState(STATE_CONFIRMED, JSON.stringify(entry));
      }
    }
    await repo.setState(STATE_HISTORY, JSON.stringify(history));
  }

  const rebalance = JSON.parse((await repo.getState(STATE_REBALANCE))?.value ?? "null") as RebalanceEvidence | null;
  if (rebalance && unresolved(rebalance.status)) {
    const request = rebalanceRequest(rebalance);
    const settlement = await settlementClient.settle(request);
    await repo.saveSettlement(request, settlement);
    asked += 1;
    await repo.setState(STATE_REBALANCE, JSON.stringify({ ...rebalance, status: settlement.status, txHash: settlement.txHash ?? rebalance.txHash, error: settlement.error }));
  }
  return asked;
}

/**
 * USTX held in wallets, as issued by the fund contract on X Layer Testnet. When the chain cannot be
 * read, the last value read stands in, with a warning; before any successful read, none.
 */
async function readWalletShares(repo: EngineRepository, now: string, warnings: string[]): Promise<string | null> {
  try {
    // Bounded, so a slow RPC delays the NAV publication by seconds at most.
    const totals = await readFundTotals({ rpc: fundRpc({ signal: AbortSignal.timeout(10_000) }) });
    await repo.setState(STATE_WALLET_SHARES, JSON.stringify({ sharesMicros: totals.sharesMicros.toString(), investors: totals.investors, block: totals.block, readAt: now }));
    return totals.sharesMicros.toString();
  } catch {
    const last = parseStoredWalletTotals((await repo.getState(STATE_WALLET_SHARES))?.value);
    if (last) warnings.push(`${XSTOCKS_PRODUCT.ticker} wallet shares could not be read on X Layer Testnet; this record uses the value read at ${last.readAt}.`);
    return last?.sharesMicros ?? null;
  }
}

/** Bounded, like the wallet-share read: a slow mainnet RPC delays a record by seconds, never a cycle. */
const readPoolsBounded = () => readPoolPrices((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }));

/**
 * The second price source. A NAV of the pinned xStocks is recorded only if, valued at the X Layer
 * pools read now, it is within the tolerance; a document of other tokens has no pools to compare,
 * and an unreadable RPC leaves a warning rather than stopping the record.
 */
async function poolDisagreement(composition: Composition, warnings: string[], read: () => Promise<PoolPrices>): Promise<string | null> {
  if (!composition.holdings.every((holding) => XSTOCK_POOLS.some((pool) => pool.symbol === holding.symbol && pool.token === holding.address.toLowerCase()))) {
    warnings.push(`${XSTOCKS_PRODUCT.ticker} prices were not compared with the X Layer pools: a holding has no pinned pool.`);
    return null;
  }
  let pools: PoolPrices;
  try {
    pools = await read();
  } catch (error) {
    warnings.push(`${XSTOCKS_PRODUCT.ticker} prices were not compared with the X Layer pools: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }
  const comparison = comparePrices(composition, pools);
  if (!comparison) {
    warnings.push(`${XSTOCKS_PRODUCT.ticker} prices were not compared with the X Layer pools: the pools returned no price for a holding.`);
    return null;
  }
  if (comparison.agrees) return null;
  const widest = comparison.rows.reduce((a, b) => (Math.abs(b.differenceBps) > Math.abs(a.differenceBps) ? b : a));
  return `The NAV at the X Layer pools (block ${pools.blockNumber}) is ${formatDifference(comparison.navDifferenceBps)} from the NAV at OnchainOS prices, beyond ${POOL_TOLERANCE.navBps / 100}% (widest: ${widest.symbol} pool ${formatDifference(widest.differenceBps)})`;
}

export async function runXStocksCycle(env: EngineEnv, repo: EngineRepository, settlementClient: SettlementClient, now = new Date().toISOString(), sources: { poolPrices?: () => Promise<PoolPrices>; wait?: (ms: number) => Promise<void>; renewLease?: () => Promise<boolean> } = {}): Promise<XStocksCycleResult> {
  const cycleStarted = Date.now();
  // Reconciling earlier attempts needs no prices, so it runs even during a provider cooldown.
  let settlementsQueued = await reconcileUnresolved(repo, settlementClient);
  const previousLatest = JSON.parse((await repo.getState(STATE_LATEST))?.value ?? "null") as LatestState | null;
  const cooldownMs = previousLatest?.retryAt ? Date.parse(previousLatest.retryAt) - Date.parse(now) : 0;
  // A stored wait longer than the maximum can only come from an older, unbounded record; ignore it.
  // Cycles start a few seconds either side of each five-minute mark, so a wait that ends within the
  // next minute counts as over: a ten-minute cooldown then skips one cycle, not two.
  if (cooldownMs > COOLDOWN_TOLERANCE_MS && cooldownMs <= MAX_COOLDOWN_MS) {
    return { navsPublished: 0, settlementsQueued, warnings: [`GMD USTX price provider cooldown until ${previousLatest!.retryAt}`] };
  }
  const constituents = constituentsWithAddresses(env.XSTOCKS_ADDRESSES);
  const { quotes, warnings, retryAt } = await fetchXStockQuotes(onchainOsCredentials(env), constituents, undefined, sources.wait);
  // Reconciling earlier attempts and a rate-limited request can take a minute or two, and quotes are
  // stamped when they arrive. The calculation happens then, so its time moves on by the whole seconds
  // the cycle has run.
  const calculatedAt = new Date(Date.parse(now) + Math.floor((Date.now() - cycleStarted) / 1000) * 1000).toISOString();
  // Waiting for prices can outlast the job lease; renew it before any write so cycles never overlap.
  if (sources.renewLease && !(await sources.renewLease())) {
    return { navsPublished: 0, settlementsQueued, warnings: [...warnings, `${XSTOCKS_PRODUCT.ticker} lease lost while waiting for prices; stopped before writing`] };
  }
  const previous = deserializeBasket((await repo.getState(STATE_BASKET))?.value);
  const evaluation = await evaluateBasket({ constituents, quotes, previous, now: calculatedAt, maxQuoteAgeMinutes: maxQuoteAgeMinutes(env) });

  // Publish only what the browser verifier will accept: the same parser runs here first.
  if (evaluation.publishable && evaluation.canonical) {
    try {
      parseComposition(evaluation.canonical);
    } catch (error) {
      evaluation.publishable = false;
      evaluation.blockers.push(`The composition would not pass verification: ${error instanceof Error ? error.message : "invalid document"}`);
    }
  }

  // The registry accepts only a later time than its latest record; prices no newer than that record
  // would be refused on chain, so they are not sent.
  if (evaluation.publishable && evaluation.composition) {
    const lastConfirmed = JSON.parse((await repo.getState(STATE_CONFIRMED))?.value ?? "null") as Publication | null;
    if (lastConfirmed && Math.floor(Date.parse(evaluation.composition.asOf) / 1000) <= Math.floor(Date.parse(lastConfirmed.asOf) / 1000)) {
      evaluation.publishable = false;
      evaluation.blockers.push("No price is newer than the last NAV record");
    }
  }

  if (evaluation.publishable && evaluation.composition) {
    const disagreement = await poolDisagreement(evaluation.composition, warnings, sources.poolPrices ?? readPoolsBounded);
    if (disagreement) {
      evaluation.publishable = false;
      evaluation.blockers.push(disagreement);
    }
  }

  let navsPublished = 0;
  let publication: Publication | null = null;

  if (evaluation.publishable && evaluation.basket && evaluation.composition && evaluation.canonical && evaluation.holdingsHash) {
    await repo.setState(STATE_BASKET, serializeBasket(evaluation.basket));

    if (evaluation.rebalanced) {
      const canonical = basketDocument(evaluation.basket);
      const evidence: RebalanceEvidence = { fixedAt: evaluation.basket.fixedAt, effectiveAt: calculatedAt, canonical, holdingsHash: await sha256Hex(canonical), status: "queued", txHash: null, error: null };
      await repo.setState(STATE_REBALANCE, JSON.stringify(evidence));
      const request = rebalanceRequest(evidence);
      const settlement = await settlementClient.settle(request);
      await repo.saveSettlement(request, settlement);
      await repo.setState(STATE_REBALANCE, JSON.stringify({ ...evidence, status: settlement.status, txHash: settlement.txHash, error: settlement.error }));
      settlementsQueued += 1;
    }

    const [demoShares, walletShares] = await Promise.all([demoSharesOutstanding((repo as Partial<EngineRepository>).db), readWalletShares(repo, calculatedAt, warnings)]);
    if (demoShares === null) warnings.push(`${XSTOCKS_PRODUCT.ticker} demo-balance shares could not be read; this record carries wallet shares only.`);
    const sharesOutstandingMicros = (BigInt(demoShares ?? "0") + BigInt(walletShares ?? "0")).toString();
    const asOf = evaluation.composition.asOf;
    const request = navRequest({ asOf, navPerShareMicros: evaluation.composition.navPerShareMicros, holdingsHash: evaluation.holdingsHash, sharesOutstandingMicros });
    // Save the exact document before sending the transaction. Even if storage
    // fails after broadcast, the on-chain hash still has a recoverable document.
    const history = JSON.parse((await repo.getState(STATE_HISTORY))?.value ?? "[]") as Publication[];
    const confirmed = history.find((entry) => entry.status === "confirmed");
    if (confirmed && !(await repo.getState(STATE_CONFIRMED))) await repo.setState(STATE_CONFIRMED, JSON.stringify(confirmed));
    const pending: Publication = { asOf, calculatedAt, navPerShareMicros: evaluation.composition.navPerShareMicros, sharesOutstandingMicros, holdingsHash: evaluation.holdingsHash, canonical: evaluation.canonical, status: "queued", txHash: null, error: null };
    // Content-addressed evidence survives a lost receipt. Documents are pruned with the
    // rolling history below, except for the latest confirmed one.
    await repo.setState(`${STATE_DOCUMENT_PREFIX}${pending.holdingsHash}`, JSON.stringify(pending));
    const previousHistory = history.filter((entry) => entry.holdingsHash !== pending.holdingsHash);
    await repo.setState(STATE_HISTORY, JSON.stringify([pending, ...previousHistory].slice(0, HISTORY_LIMIT)));
    const settlement = await settlementClient.settle(request);
    await repo.saveSettlement(request, settlement);
    settlementsQueued += 1;
    if (settlement.status === "confirmed") navsPublished += 1;
    publication = { ...pending, status: settlement.status, txHash: settlement.txHash, error: settlement.error };
    if (settlement.error) warnings.push(`${XSTOCKS_PRODUCT.ticker} NAV publication: ${settlement.error}`);

    // The stored document carries the final outcome, so a recovered record is not shown as queued.
    await repo.setState(`${STATE_DOCUMENT_PREFIX}${publication.holdingsHash}`, JSON.stringify(publication));
    if (settlement.status === "confirmed") await repo.setState(STATE_CONFIRMED, JSON.stringify(publication));
    const nextHistory = [publication, ...previousHistory].slice(0, HISTORY_LIMIT);
    await repo.setState(STATE_HISTORY, JSON.stringify(nextHistory));
    // Keep documents for every listed publication and the confirmed one; drop the rest.
    const confirmedNow = JSON.parse((await repo.getState(STATE_CONFIRMED))?.value ?? "null") as Publication | null;
    const keep = new Set([...nextHistory.map((entry) => entry.holdingsHash), ...(confirmedNow ? [confirmedNow.holdingsHash] : [])]);
    await repo.deleteStatesWithPrefix(STATE_DOCUMENT_PREFIX, [...keep].map((hash) => `${STATE_DOCUMENT_PREFIX}${hash}`));
  } else {
    warnings.push(...evaluation.blockers.map((blocker) => `${XSTOCKS_PRODUCT.ticker} not published: ${blocker}`));
  }

  const latest: LatestState = {
    evaluatedAt: now,
    retryAt: retryAt ?? null,
    status: evaluation.status,
    blockers: evaluation.blockers,
    warnings,
    composition: evaluation.composition,
    canonical: evaluation.canonical,
    holdingsHash: evaluation.holdingsHash,
    publication,
  };
  await repo.setState(STATE_LATEST, JSON.stringify(latest));
  // The chart series is kept apart from publication: its failure never changes a NAV result.
  try {
    await updateNavSeries(repo, { rpcUrl: settlementClient.rpcUrl, registry: env.NAV_REGISTRY_ADDRESS, historyKey: STATE_HISTORY });
  } catch (error) {
    warnings.push(`NAV series not updated: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return { navsPublished, settlementsQueued, warnings };
}
