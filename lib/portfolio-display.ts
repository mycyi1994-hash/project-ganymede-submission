export type PortfolioPosition = {
  productId: string;
  slug: string;
  ticker: string;
  name: string;
  strategyStyle: "passive" | "active";
  sharesMicros: string;
  costBasisKrw: string;
  currentValueKrw: string;
  unrealizedPnlKrw: string;
  returnBps: number;
  navPerShareMicros: string;
  navAsOf: string | null;
};

export type PortfolioData = {
  investor: null | { id: string; kycStatus: string; walletAddress: string | null };
  positions: PortfolioPosition[];
  subscriptions: Array<Record<string, unknown>>;
  redemptions: Array<Record<string, unknown>>;
};

export function hasValuation(position: PortfolioPosition): boolean {
  return Boolean(position.navAsOf && Number.isFinite(Date.parse(position.navAsOf)))
    && Number.isFinite(Number(position.navPerShareMicros)) && Number(position.navPerShareMicros) > 0
    && Number.isFinite(Number(position.currentValueKrw));
}

export function isPendingRequest(request: Record<string, unknown>): boolean {
  return ["requested", "approved", "locked", "executing"].includes(String(request.status));
}

export function portfolioSummary(positions: PortfolioPosition[]) {
  const invested = positions.reduce((sum, position) => sum + Number(position.costBasisKrw), 0);
  const valued = positions.length > 0 && positions.every(hasValuation);
  const value = valued ? positions.reduce((sum, position) => sum + Number(position.currentValueKrw), 0) : null;
  const gain = value === null ? null : value - invested;
  return { invested, value, gain, returnPct: gain !== null && invested > 0 ? gain / invested * 100 : null };
}
