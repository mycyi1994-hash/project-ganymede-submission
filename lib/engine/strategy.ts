import { BPS_SCALE, clamp } from "./fixed";
import type { DailyCandle, ProductDefinition, StrategyAssetInput, StrategyResult, StrategyTarget } from "./types";

type Metrics = {
  momentum30: number;
  momentum90: number;
  annualizedVolatility: number;
  liquidityScore: number;
};

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function calculateMetrics(candles: DailyCandle[], volume24hKrw: number): Metrics {
  const ordered = [...candles].sort((a, b) => a.candleDate.localeCompare(b.candleDate));
  const closes = ordered.map((candle) => candle.closeKrw).filter((value) => value > 0);
  const last = closes.at(-1) ?? 1;
  const close30 = closes.at(-31) ?? closes[0] ?? last;
  const close90 = closes.at(-91) ?? closes[0] ?? last;
  const returns = closes.slice(-91).slice(1).map((value, index) => {
    const previous = closes.slice(-91)[index];
    return previous > 0 ? Math.log(value / previous) : 0;
  });
  return {
    momentum30: close30 > 0 ? last / close30 - 1 : 0,
    momentum90: close90 > 0 ? last / close90 - 1 : 0,
    annualizedVolatility: Math.max(0.05, standardDeviation(returns) * Math.sqrt(365)),
    liquidityScore: Math.log10(Math.max(1, volume24hKrw)),
  };
}

function isEligible(product: ProductDefinition, input: StrategyAssetInput, now: Date): boolean {
  if (input.asset.stablecoin || !input.asset.custodySupported) return false;
  if (input.tick.volume24hKrw < Number(product.minimumVolumeKrw)) return false;
  const ageDays = (now.getTime() - new Date(input.asset.listingDate).getTime()) / 86_400_000;
  return ageDays >= product.minimumHistoryDays && input.tick.priceKrw > 0;
}

function allocateWeights(
  rawScores: Array<{ symbol: string; score: number }>,
  investableBps: number,
  minimumBps: number,
  maximumBps: number,
): Map<string, number> {
  const selected = rawScores.filter((item) => item.score > 0);
  const weights = new Map<string, number>();
  if (!selected.length) return weights;

  let active = [...selected];
  let remaining = investableBps;
  for (let pass = 0; pass < 10 && active.length && remaining > 0; pass += 1) {
    const totalScore = active.reduce((sum, item) => sum + item.score, 0) || active.length;
    const nextActive: typeof active = [];
    let assignedThisPass = 0;
    for (const item of active) {
      const proposed = Math.round(remaining * (item.score / totalScore));
      const existing = weights.get(item.symbol) ?? 0;
      const capacity = maximumBps - existing;
      const allocation = Math.max(0, Math.min(proposed, capacity));
      weights.set(item.symbol, existing + allocation);
      assignedThisPass += allocation;
      if (capacity - allocation > 0) nextActive.push(item);
    }
    remaining -= assignedThisPass;
    if (assignedThisPass === 0) break;
    active = nextActive;
  }

  for (const [symbol, weight] of [...weights]) {
    if (weight < minimumBps) {
      remaining += weight;
      weights.delete(symbol);
    }
  }

  const recipients = [...weights.keys()];
  let cursor = 0;
  while (remaining > 0 && recipients.length) {
    const symbol = recipients[cursor % recipients.length];
    const current = weights.get(symbol) ?? 0;
    if (current < maximumBps) {
      weights.set(symbol, current + 1);
      remaining -= 1;
    }
    cursor += 1;
    if (cursor > investableBps * recipients.length) break;
  }
  return weights;
}

function passiveScores(product: ProductDefinition, inputs: StrategyAssetInput[]): Array<{ input: StrategyAssetInput; metrics: Metrics; score: number }> {
  return inputs.map((input) => {
    const metrics = calculateMetrics(input.candles, input.tick.volume24hKrw);
    const supplyUnits = Number(BigInt(input.asset.circulatingSupplyMicros)) / 1_000_000;
    const marketCap = supplyUnits * input.tick.priceKrw;
    const score = product.parameters.weighting === "inverse_volatility"
      ? 1 / Math.max(metrics.annualizedVolatility, 0.05)
      : Math.sqrt(Math.max(marketCap, 1));
    return { input, metrics, score };
  });
}

function activeScores(product: ProductDefinition, inputs: StrategyAssetInput[]): Array<{ input: StrategyAssetInput; metrics: Metrics; score: number }> {
  const metricsByAsset = inputs.map((input) => ({ input, metrics: calculateMetrics(input.candles, input.tick.volume24hKrw) }));
  const liquidityValues = metricsByAsset.map(({ metrics }) => metrics.liquidityScore);
  const minLiquidity = Math.min(...liquidityValues);
  const maxLiquidity = Math.max(...liquidityValues);
  const p = product.parameters;
  return metricsByAsset.map(({ input, metrics }) => {
    const liquidity = maxLiquidity === minLiquidity ? 0.5 : (metrics.liquidityScore - minLiquidity) / (maxLiquidity - minLiquidity);
    const momentum30 = clamp(metrics.momentum30, -0.8, 1.5);
    const momentum90 = clamp(metrics.momentum90, -0.8, 2.5);
    const inverseVolatility = 1 / Math.max(metrics.annualizedVolatility, 0.08);
    let score =
      (p.momentum30Weight ?? 0.3) * (momentum30 + 0.8) +
      (p.momentum90Weight ?? 0.3) * (momentum90 + 0.8) +
      (p.inverseVolatilityWeight ?? 0.2) * inverseVolatility +
      (p.liquidityWeight ?? 0.2) * liquidity;
    if (momentum30 < 0 && momentum90 < 0) score *= p.negativeMomentumPenalty ?? 0.5;
    return { input, metrics, score: Math.max(0.000001, score) };
  });
}

export function calculateStrategy(product: ProductDefinition, allInputs: StrategyAssetInput[], asOf = new Date()): StrategyResult {
  const eligible = allInputs.filter((input) => isEligible(product, input, asOf));
  if (eligible.length < Math.min(3, product.parameters.topN)) {
    return {
      productId: product.id,
      style: product.strategyStyle,
      targets: [],
      cashWeightBps: BPS_SCALE,
      turnoverBps: 0,
      blocked: true,
      blockReason: `Only ${eligible.length} eligible assets passed liquidity and history controls`,
      asOf: asOf.toISOString(),
    };
  }

  const scored = (product.strategyStyle === "passive" ? passiveScores(product, eligible) : activeScores(product, eligible))
    .sort((a, b) => b.score - a.score)
    .slice(0, product.parameters.topN);
  const investableBps = BPS_SCALE - product.cashBufferBps;
  const weights = allocateWeights(
    scored.map(({ input, score }) => ({ symbol: input.asset.symbol, score })),
    investableBps,
    product.minWeightBps,
    product.maxWeightBps,
  );

  const targets: StrategyTarget[] = scored
    .filter(({ input }) => weights.has(input.asset.symbol))
    .map(({ input, metrics, score }) => ({
      symbol: input.asset.symbol,
      weightBps: weights.get(input.asset.symbol) ?? 0,
      rationale: product.strategyStyle === "passive"
        ? product.parameters.weighting === "inverse_volatility" ? "Liquidity-screened inverse-volatility allocation" : "Float market-cap selection with square-root concentration control"
        : "Momentum, liquidity and volatility composite selected by the active mandate",
      momentum30: metrics.momentum30,
      momentum90: metrics.momentum90,
      annualizedVolatility: metrics.annualizedVolatility,
      liquidityScore: metrics.liquidityScore,
      convictionScore: score,
    }))
    .sort((a, b) => b.weightBps - a.weightBps);

  const currentWeights = new Map(allInputs.map((input) => [input.asset.symbol, input.currentWeightBps]));
  const symbols = new Set([...currentWeights.keys(), ...targets.map((target) => target.symbol)]);
  const turnoverBps = Math.round([...symbols].reduce((sum, symbol) => {
    const target = targets.find((item) => item.symbol === symbol)?.weightBps ?? 0;
    return sum + Math.abs(target - (currentWeights.get(symbol) ?? 0));
  }, 0) / 2);

  const totalWeight = targets.reduce((sum, target) => sum + target.weightBps, 0);
  const currentInvestedBps = [...currentWeights.values()].reduce((sum, weight) => sum + weight, 0);
  const initialConstitution = currentInvestedBps === 0;
  const blocked = totalWeight !== investableBps || (!initialConstitution && turnoverBps > product.turnoverLimitBps);
  return {
    productId: product.id,
    style: product.strategyStyle,
    targets,
    cashWeightBps: BPS_SCALE - totalWeight,
    turnoverBps,
    blocked,
    blockReason: totalWeight !== investableBps
      ? `Weight validation failed: ${totalWeight} of ${investableBps} bps allocated`
      : !initialConstitution && turnoverBps > product.turnoverLimitBps
        ? `Turnover ${turnoverBps} bps exceeds limit ${product.turnoverLimitBps} bps`
        : null,
    asOf: asOf.toISOString(),
  };
}

export function shouldRebalance(product: ProductDefinition, lastCompletedAt: string | null, now = new Date()): boolean {
  if (!lastCompletedAt) return true;
  const elapsedDays = (now.getTime() - new Date(lastCompletedAt).getTime()) / 86_400_000;
  const threshold = product.rebalanceCadence === "daily" ? 1 : product.rebalanceCadence === "weekly" ? 7 : product.rebalanceCadence === "monthly" ? 28 : 84;
  return elapsedDays >= threshold;
}
