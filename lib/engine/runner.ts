import { ASSET_UNIVERSE, PRODUCT_DEFINITIONS } from "./seed";
import { asBigInt, krwForShares, newId, notionalToUnitsAtomic, sharesForSubscription, unitsToMarketValueKrw } from "./fixed";
import { SettlementClient, type SettlementRequest, type SettlementResult } from "./settlement";
import { EngineRepository } from "./repository";
import { calculateStrategy, shouldRebalance } from "./strategy";
import { fetchDailyCandles, fetchMarketSnapshot, UpbitExecutionClient } from "./upbit";
import { runXStocksCycle } from "../xstocks/cycle";
import type {
  DailyCandle,
  EngineCycleResult,
  EngineEnv,
  MarketTick,
  OrderIntent,
  ProductDefinition,
  StrategyAssetInput,
} from "./types";

const DEFAULT_CYCLE_INTERVAL_SECONDS = 300;
const LEASE_TTL_SECONDS = 240;

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function loadMarketData(): Promise<{ ticks: MarketTick[]; candles: Map<string, DailyCandle[]>; warnings: string[] }> {
  const market = await fetchMarketSnapshot(ASSET_UNIVERSE);
  const candleResults = await mapWithConcurrency(ASSET_UNIVERSE, 3, async (asset) => ({ asset, result: await fetchDailyCandles(asset, 91) }));
  const candles = new Map<string, DailyCandle[]>();
  const warnings = [...market.warnings];
  for (const { asset, result } of candleResults) {
    candles.set(asset.symbol, result.candles);
    if (result.warning) warnings.push(result.warning);
  }
  return { ticks: market.ticks, candles, warnings };
}

function marketDataQuality(ticks: MarketTick[]): "live" | "reference" | "mixed" {
  const live = ticks.filter((tick) => tick.quality === "live").length;
  if (live === ticks.length) return "live";
  if (live === 0) return "reference";
  return "mixed";
}

/**
 * Sell holdings pro rata until the fund's cash covers a redemption. Paper execution
 * fills immediately; a live venue does not, so live redemptions wait for cash instead.
 */
async function raiseCash(
  repo: EngineRepository,
  execution: UpbitExecutionClient,
  productId: string,
  neededKrw: bigint,
  ticks: Map<string, MarketTick>,
  reference: string,
): Promise<boolean> {
  const product = await repo.getProduct(productId);
  if (!product) return false;
  const cash = asBigInt(product.cash_balance_krw);
  if (cash >= neededKrw) return true;
  if (execution.mode !== "paper") return false;
  const holdings = (await repo.getPositions(productId)).flatMap((position) => {
    const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === position.symbol);
    const tick = ticks.get(position.symbol);
    const units = asBigInt(position.units_atomic);
    if (!asset || !tick || units <= 0n) return [];
    return [{ asset, tick, units, value: unitsToMarketValueKrw(units, BigInt(Math.round(tick.priceKrw)), asset.decimals) }];
  });
  const invested = holdings.reduce((sum, holding) => sum + holding.value, 0n);
  // A 2% cushion covers the paper venue's slippage and fee.
  const shortfall = (neededKrw - cash) * 102n / 100n + 1n;
  if (invested < shortfall) return false;
  for (const holding of holdings) {
    const notional = holding.value * shortfall / invested + 1n;
    const bid = BigInt(Math.max(1, Math.round(holding.tick.bidKrw)));
    const wanted = notionalToUnitsAtomic(notional, bid, holding.asset.decimals) + 1n;
    const units = wanted > holding.units ? holding.units : wanted;
    const intent: OrderIntent = {
      id: newId("order"),
      productId,
      rebalanceRunId: null,
      symbol: holding.asset.symbol,
      market: holding.asset.market,
      side: "sell",
      orderType: "market",
      requestedNotionalKrw: notional,
      requestedUnitsAtomic: units,
      idempotencyKey: `liquidity:${reference}:${holding.asset.symbol}:${newId("attempt")}`,
    };
    const result = await execution.execute(intent, holding.tick, holding.asset.decimals);
    await repo.saveExecution(intent, result, holding.tick, holding.asset.decimals);
  }
  const after = await repo.getProduct(productId);
  return Boolean(after) && asBigInt(after!.cash_balance_krw) >= neededKrw;
}

/**
 * Settle subscriptions and redemptions at the first NAV calculated after each request.
 * Only KYC-verified investors with a recorded wallet are minted or burned on chain;
 * a paper session's wallet is unverified metadata and never becomes a settlement target.
 */
async function processFundFlows(
  repo: EngineRepository,
  settlementClient: SettlementClient,
  execution: UpbitExecutionClient,
  ticks: Map<string, MarketTick>,
  paperMode: boolean,
  keepLease: () => Promise<void>,
): Promise<{ settlements: number; warnings: string[] }> {
  let settlements = 0;
  const warnings: string[] = [];
  for (const subscription of await repo.listSubscriptionsForProcessing(paperMode)) {
    await keepLease();
    const nav = await repo.navForSettlement(subscription.product_id, subscription.created_at);
    if (!nav) continue;
    const navPerShareMicros = asBigInt(nav.nav_per_share_micros);
    const shares = sharesForSubscription(asBigInt(subscription.amount_krw), navPerShareMicros);
    let settlement: SettlementResult | null = null;
    if (subscription.kyc_status === "verified" && subscription.wallet_address) {
      const request: SettlementRequest = {
        entityType: "subscription",
        entityId: subscription.id,
        action: "mint_subscription",
        walletAddress: subscription.wallet_address,
        productId: subscription.product_id,
        amount: subscription.amount_krw,
        sharesMicros: shares.toString(),
        effectiveAt: nav.as_of,
      };
      settlement = await settlementClient.settle(request);
      await repo.saveSettlement(request, settlement);
      settlements += 1;
    }
    const outcome = await repo.settleSubscription(subscription, settlement, paperMode, shares, navPerShareMicros);
    if (outcome.status !== "settled" && outcome.reason) warnings.push(`Subscription ${subscription.id} ${outcome.status}: ${outcome.reason}`);
  }

  for (const redemption of await repo.listRedemptionsForProcessing(paperMode)) {
    await keepLease();
    const nav = await repo.navForSettlement(redemption.product_id, redemption.created_at);
    if (!nav) continue;
    const proceeds = krwForShares(asBigInt(redemption.requested_shares_micros), asBigInt(nav.nav_per_share_micros));
    if (!(await raiseCash(repo, execution, redemption.product_id, proceeds, ticks, redemption.id))) {
      warnings.push(`Redemption ${redemption.id} is waiting for fund cash`);
      continue;
    }
    let settlement: SettlementResult | null = null;
    if (redemption.kyc_status === "verified" && redemption.wallet_address) {
      const request: SettlementRequest = {
        entityType: "redemption",
        entityId: redemption.id,
        action: "burn_redemption",
        walletAddress: redemption.wallet_address,
        productId: redemption.product_id,
        sharesMicros: redemption.requested_shares_micros,
        effectiveAt: nav.as_of,
      };
      settlement = await settlementClient.settle(request);
      await repo.saveSettlement(request, settlement);
      settlements += 1;
    }
    const outcome = await repo.settleRedemption(redemption, settlement, paperMode, proceeds);
    if (outcome.status !== "settled" && outcome.reason) warnings.push(`Redemption ${redemption.id} ${outcome.status}: ${outcome.reason}`);
  }
  return { settlements, warnings };
}

function buildStrategyInputs(
  ticks: Map<string, MarketTick>,
  candles: Map<string, DailyCandle[]>,
  weights: Map<string, number>,
): StrategyAssetInput[] {
  return ASSET_UNIVERSE.map((asset) => ({
    asset,
    tick: ticks.get(asset.symbol)!,
    candles: candles.get(asset.symbol) ?? [],
    currentWeightBps: weights.get(asset.symbol) ?? 0,
  })).filter((input) => Boolean(input.tick));
}

async function buildOrders(
  repo: EngineRepository,
  product: ProductDefinition,
  rebalanceRunId: string,
  targetWeights: Map<string, number>,
  ticks: Map<string, MarketTick>,
): Promise<OrderIntent[]> {
  const productRow = await repo.getProduct(product.id);
  if (!productRow) return [];
  const positions = await repo.getPositions(product.id);
  const currentValues = new Map<string, bigint>();
  let investedValue = 0n;
  for (const position of positions) {
    const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === position.symbol);
    const tick = ticks.get(position.symbol);
    if (!asset || !tick) continue;
    const value = unitsToMarketValueKrw(asBigInt(position.units_atomic), BigInt(Math.round(tick.priceKrw)), asset.decimals);
    currentValues.set(position.symbol, value);
    investedValue += value;
  }
  const fundValue = investedValue + asBigInt(productRow.cash_balance_krw);
  const minimumTrade = fundValue / 1_000n > 100_000n ? fundValue / 1_000n : 100_000n;
  const symbols = new Set([...currentValues.keys(), ...targetWeights.keys()]);
  const orders: OrderIntent[] = [];
  for (const symbol of symbols) {
    const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === symbol);
    const tick = ticks.get(symbol);
    if (!asset || !tick) continue;
    const targetValue = fundValue * BigInt(targetWeights.get(symbol) ?? 0) / 10_000n;
    const currentValue = currentValues.get(symbol) ?? 0n;
    const delta = targetValue - currentValue;
    if (delta > -minimumTrade && delta < minimumTrade) continue;
    const side = delta > 0n ? "buy" : "sell";
    const notional = delta > 0n ? delta : -delta;
    const units = notionalToUnitsAtomic(notional, BigInt(Math.round(side === "buy" ? tick.askKrw : tick.bidKrw)), asset.decimals);
    const position = positions.find((candidate) => candidate.symbol === symbol);
    const requestedUnits = side === "sell" ? (units > asBigInt(position?.units_atomic ?? "0") ? asBigInt(position?.units_atomic ?? "0") : units) : undefined;
    if (side === "sell" && (!requestedUnits || requestedUnits <= 0n)) continue;
    orders.push({
      id: newId("order"),
      productId: product.id,
      rebalanceRunId,
      symbol,
      market: asset.market,
      side,
      orderType: "market",
      requestedNotionalKrw: notional,
      requestedUnitsAtomic: requestedUnits,
      idempotencyKey: `${rebalanceRunId}:${symbol}:${side}`,
    });
  }
  return orders.sort((a, b) => a.side === b.side ? a.symbol.localeCompare(b.symbol) : a.side === "sell" ? -1 : 1);
}

async function evaluateAndRebalance(
  repo: EngineRepository,
  execution: UpbitExecutionClient,
  settlementClient: SettlementClient,
  product: ProductDefinition,
  ticks: Map<string, MarketTick>,
  candles: Map<string, DailyCandle[]>,
  trigger: string,
  force: boolean,
  liveDataReady: boolean,
  dataQuality: "live" | "reference" | "mixed",
): Promise<{ rebalances: number; orders: number; settlements: number; warnings: string[] }> {
  const warnings: string[] = [];
  // A live venue fills asynchronously and nothing here polls fills, so a new rebalance
  // must not start while an earlier one still has orders out.
  if (execution.mode === "live" && await repo.hasOpenRebalance(product.id)) {
    warnings.push(`${product.ticker} rebalance skipped: an earlier live rebalance is still executing`);
    return { rebalances: 0, orders: 0, settlements: 0, warnings };
  }
  const currentWeights = await repo.currentWeights(product.id, ticks);
  const strategy = calculateStrategy(product, buildStrategyInputs(ticks, candles, currentWeights));
  const lastCompleted = await repo.latestCompletedRebalance(product.id);
  const due = force || shouldRebalance(product, lastCompleted);
  if (!due) return { rebalances: 0, orders: 0, settlements: 0, warnings };
  await repo.saveStrategy(strategy);
  if (strategy.blocked) {
    await repo.createRebalance(product, strategy, trigger);
    warnings.push(`${product.ticker} rebalance blocked: ${strategy.blockReason}`);
    return { rebalances: 1, orders: 0, settlements: 0, warnings };
  }
  if (execution.mode === "live" && !liveDataReady) {
    warnings.push(`${product.ticker} live rebalance blocked because one or more market feeds are not live`);
    return { rebalances: 0, orders: 0, settlements: 0, warnings };
  }

  const rebalanceId = await repo.createRebalance(product, strategy, trigger);
  await repo.markRebalance(rebalanceId, "executing");
  const targets = new Map(strategy.targets.map((target) => [target.symbol, target.weightBps]));
  const orders = await buildOrders(repo, product, rebalanceId, targets, ticks);
  let allCompleted = true;
  for (const intent of orders) {
    const tick = ticks.get(intent.symbol)!;
    const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === intent.symbol)!;
    const result = await execution.execute(intent, tick, asset.decimals);
    await repo.saveExecution(intent, result, tick, asset.decimals);
    if (!(result.status === "simulated" || result.status === "filled")) allCompleted = false;
    if (result.error) warnings.push(`${product.ticker} ${intent.symbol} ${intent.side}: ${result.error}`);
  }
  await repo.markRebalance(rebalanceId, allCompleted ? "completed" : "executing");
  const request: SettlementRequest = {
    entityType: "rebalance",
    entityId: rebalanceId,
    action: "publish_rebalance",
    productId: product.id,
    holdingsHash: await (async () => {
      const nav = await repo.calculateAndSaveNav(product.id, ticks, dataQuality !== "live" ? "stale" : allCompleted ? "indicative" : "blocked");
      return nav.holdingsHash;
    })(),
    effectiveAt: new Date().toISOString(),
  };
  const settlement = await settlementClient.settle(request);
  await repo.saveSettlement(request, settlement);
  return { rebalances: 1, orders: orders.length, settlements: 1, warnings };
}

export async function runEngineCycle(
  env: EngineEnv,
  trigger: "scheduled" | "request" | "operator" | "deployment",
  options: { force?: boolean; minimumIntervalSeconds?: number } = {},
): Promise<EngineCycleResult> {
  const repo = new EngineRepository(env.DB);
  const cycleId = newId("cycle");
  const owner = `${cycleId}:${trigger}`;
  const startedAt = new Date().toISOString();
  const mode = env.TRADING_MODE === "live" ? "live" : "paper";
  const due = options.force || await repo.cycleIsDue(options.minimumIntervalSeconds ?? DEFAULT_CYCLE_INTERVAL_SECONDS);
  if (!due) {
    return {
      cycleId, trigger, mode, startedAt, completedAt: new Date().toISOString(), marketDataQuality: "reference",
      navsPublished: 0, strategiesEvaluated: 0, rebalancesCreated: 0, ordersCreated: 0, settlementsQueued: 0,
      warnings: ["Cycle skipped because the minimum interval has not elapsed"], skipped: true,
    };
  }
  if (!(await repo.acquireLease("portfolio-engine", owner, LEASE_TTL_SECONDS))) {
    return {
      cycleId, trigger, mode, startedAt, completedAt: new Date().toISOString(), marketDataQuality: "reference",
      navsPublished: 0, strategiesEvaluated: 0, rebalancesCreated: 0, ordersCreated: 0, settlementsQueued: 0,
      warnings: ["Cycle skipped because another engine worker owns the lease"], skipped: true,
    };
  }

  try {
    // Re-check after taking the lease: a previous worker may have just finished.
    if (!options.force && !(await repo.cycleIsDue(options.minimumIntervalSeconds ?? DEFAULT_CYCLE_INTERVAL_SECONDS))) {
      return { cycleId, trigger, mode, startedAt, completedAt: new Date().toISOString(), marketDataQuality: "reference", navsPublished: 0, strategiesEvaluated: 0, rebalancesCreated: 0, ordersCreated: 0, settlementsQueued: 0, warnings: ["Cycle skipped after lease acquisition"], skipped: true };
    }
    await repo.seed();
    const execution = new UpbitExecutionClient(env);
    const settlementClient = new SettlementClient(env);
    // Run the X Layer basket before the independent legacy venue feed. A venue
    // failure must not prevent a tokenized-stock pricing attempt.
    const xstocks = await runXStocksCycle(env, repo, settlementClient).catch((error) => ({
      navsPublished: 0, settlementsQueued: 0,
      warnings: [`xStocks cycle failed: ${error instanceof Error ? error.message : "unknown error"}`],
    }));
    const market = await loadMarketData();
    await repo.saveMarketSnapshot(market.ticks);
    await repo.saveCandles(market.candles);
    const ticks = new Map(market.ticks.map((tick) => [tick.symbol, tick]));
    const quality = marketDataQuality(market.ticks);
    const warnings = [...xstocks.warnings, ...market.warnings];
    const executionHealth = await execution.health();
    if (mode === "live" && !executionHealth.configured) warnings.push("Live Upbit execution is disabled because credentials or the explicit live-trading confirmation are missing");

    // Renewing the lease before each write keeps an overrunning cycle from overlapping the next one.
    const keepLease = async () => {
      if (!(await repo.acquireLease("portfolio-engine", owner, LEASE_TTL_SECONDS))) throw new Error("Engine lease lost; stopping before further writes");
    };
    await keepLease();
    const fundFlows = await processFundFlows(repo, settlementClient, execution, ticks, mode === "paper", keepLease);
    warnings.push(...fundFlows.warnings);
    let settlementsQueued = xstocks.settlementsQueued + fundFlows.settlements;
    let rebalancesCreated = 0;
    let ordersCreated = 0;
    for (const product of PRODUCT_DEFINITIONS) {
      await keepLease();
      const outcome = await evaluateAndRebalance(repo, execution, settlementClient, product, ticks, market.candles, trigger, trigger === "operator" && options.force === true, quality === "live" && executionHealth.configured, quality);
      rebalancesCreated += outcome.rebalances;
      ordersCreated += outcome.orders;
      settlementsQueued += outcome.settlements;
      warnings.push(...outcome.warnings);
    }

    let navsPublished = xstocks.navsPublished;
    for (const product of PRODUCT_DEFINITIONS) {
      await keepLease();
      const nav = await repo.calculateAndSaveNav(product.id, ticks, quality === "live" ? "indicative" : "stale");
      // A NAV built from reference or partly stale prices stays in the ledger, labelled
      // stale, but is not published on chain as if it were a market valuation.
      if (quality !== "live") continue;
      const request: SettlementRequest = {
        entityType: "nav", entityId: `${product.id}:${nav.asOf}`, action: "publish_nav", productId: product.id,
        navPerShareMicros: nav.navPerShareMicros.toString(), sharesOutstandingMicros: nav.sharesOutstandingMicros.toString(),
        holdingsHash: nav.holdingsHash, effectiveAt: nav.asOf,
      };
      const settlement = await settlementClient.settle(request);
      await repo.saveSettlement(request, settlement);
      if (settlement.status === "confirmed") navsPublished += 1;
      settlementsQueued += 1;
    }

    const result: EngineCycleResult = {
      cycleId,
      trigger,
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      marketDataQuality: quality,
      navsPublished,
      strategiesEvaluated: PRODUCT_DEFINITIONS.length,
      rebalancesCreated,
      ordersCreated,
      settlementsQueued,
      warnings: warnings.slice(0, 50),
    };
    await repo.saveCycle(result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown engine failure";
    const failed: EngineCycleResult = {
      cycleId, trigger, mode, startedAt, completedAt: new Date().toISOString(), marketDataQuality: "reference",
      navsPublished: 0, strategiesEvaluated: 0, rebalancesCreated: 0, ordersCreated: 0, settlementsQueued: 0,
      warnings: [message],
    };
    await repo.saveCycle(failed).catch(() => undefined);
    throw error;
  } finally {
    await repo.releaseLease("portfolio-engine", owner).catch(() => undefined);
  }
}
