export type StrategyStyle = "passive" | "active";
export type TradingMode = "paper" | "live";

export type EngineEnv = {
  DB: D1Database;
  TRADING_MODE?: TradingMode;
  UPBIT_ACCESS_KEY?: string;
  UPBIT_SECRET_KEY?: string;
  LIVE_TRADING_CONFIRMATION?: string;
  OPERATOR_TOKEN?: string;
  OPERATIONS_ALLOW_EMAILS?: string;
  IDENTITY_HEADER_TRUSTED?: string;
  /** `xlayer-testnet` (default) or `giwa-sepolia`. See lib/chains.ts. */
  SETTLEMENT_CHAIN?: string;
  SETTLEMENT_RPC_URL?: string;
  SETTLEMENT_RELAYER_URL?: string;
  SETTLEMENT_RELAYER_TOKEN?: string;
  FUND_SHARE_ADDRESS?: string;
  NAV_REGISTRY_ADDRESS?: string;
  /** "AAPLx=0x…,MSFTx=0x…" — xStocks contracts on X Layer mainnet. See lib/xstocks/basket.ts. */
  XSTOCKS_ADDRESSES?: string;
  XSTOCKS_MAX_QUOTE_AGE_MINUTES?: string;
  /** OKX OnchainOS API credentials for live xStocks prices. */
  OKX_API_KEY?: string;
  OKX_API_SECRET?: string;
  OKX_API_PASSPHRASE?: string;
  OKX_PROJECT_ID?: string;
  ONCHAINOS_BASE_URL?: string;
};

export type AssetDefinition = {
  symbol: string;
  market: string;
  name: string;
  assetClass: string;
  stablecoin: boolean;
  custodySupported: boolean;
  circulatingSupplyMicros: string;
  listingDate: string;
  decimals: number;
  referencePriceKrw: number;
  referenceVolume24hKrw: number;
};

export type ProductDefinition = {
  id: string;
  slug: string;
  ticker: string;
  name: string;
  strategyStyle: StrategyStyle;
  category: string;
  benchmark: string;
  expenseRatioBps: number;
  rebalanceCadence: "daily" | "weekly" | "monthly" | "quarterly";
  maxWeightBps: number;
  minWeightBps: number;
  cashBufferBps: number;
  turnoverLimitBps: number;
  minimumVolumeKrw: string;
  minimumHistoryDays: number;
  parameters: {
    topN: number;
    weighting?: "sqrt_market_cap" | "inverse_volatility";
    momentum30Weight?: number;
    momentum90Weight?: number;
    inverseVolatilityWeight?: number;
    liquidityWeight?: number;
    negativeMomentumPenalty?: number;
  };
};

export type MarketTick = {
  symbol: string;
  market: string;
  priceKrw: number;
  bidKrw: number;
  askKrw: number;
  volume24hKrw: number;
  change24hBps: number;
  source: "UPBIT" | "REFERENCE";
  quality: "live" | "reference" | "stale";
  asOf: string;
};

export type DailyCandle = {
  symbol: string;
  candleDate: string;
  openKrw: number;
  highKrw: number;
  lowKrw: number;
  closeKrw: number;
  volumeKrw: number;
  source: "UPBIT" | "REFERENCE";
};

export type StrategyAssetInput = {
  asset: AssetDefinition;
  tick: MarketTick;
  candles: DailyCandle[];
  currentWeightBps: number;
};

export type StrategyTarget = {
  symbol: string;
  weightBps: number;
  rationale: string;
  momentum30: number;
  momentum90: number;
  annualizedVolatility: number;
  liquidityScore: number;
  convictionScore: number;
};

export type StrategyResult = {
  productId: string;
  style: StrategyStyle;
  targets: StrategyTarget[];
  cashWeightBps: number;
  turnoverBps: number;
  blocked: boolean;
  blockReason: string | null;
  asOf: string;
};

export type OrderIntent = {
  id: string;
  productId: string;
  rebalanceRunId: string;
  symbol: string;
  market: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  requestedNotionalKrw: bigint;
  requestedUnitsAtomic?: bigint;
  limitPriceKrw?: bigint;
  idempotencyKey: string;
};

export type ExecutionResult = {
  status: "submitted" | "filled" | "simulated" | "rejected";
  venueOrderId: string | null;
  executedPriceKrw: bigint | null;
  executedUnitsAtomic: bigint | null;
  feeKrw: bigint;
  error: string | null;
};

export type EngineCycleResult = {
  cycleId: string;
  trigger: string;
  mode: TradingMode;
  startedAt: string;
  completedAt: string;
  marketDataQuality: "live" | "reference" | "mixed";
  navsPublished: number;
  strategiesEvaluated: number;
  rebalancesCreated: number;
  ordersCreated: number;
  settlementsQueued: number;
  warnings: string[];
  skipped?: boolean;
};
