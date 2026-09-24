import type { AssetDefinition, ProductDefinition } from "./types";

const micros = (units: number) => Math.round(units * 1_000_000).toString();

export const ASSET_UNIVERSE: AssetDefinition[] = [
  { symbol: "BTC", market: "KRW-BTC", name: "Bitcoin", assetClass: "Store of Value", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(19_900_000), listingDate: "2017-09-25", decimals: 6, referencePriceKrw: 150_000_000, referenceVolume24hKrw: 420_000_000_000 },
  { symbol: "ETH", market: "KRW-ETH", name: "Ethereum", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(120_700_000), listingDate: "2017-09-25", decimals: 6, referencePriceKrw: 5_200_000, referenceVolume24hKrw: 310_000_000_000 },
  { symbol: "XRP", market: "KRW-XRP", name: "XRP", assetClass: "Payments", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(59_000_000_000), listingDate: "2017-09-25", decimals: 6, referencePriceKrw: 4_100, referenceVolume24hKrw: 260_000_000_000 },
  { symbol: "SOL", market: "KRW-SOL", name: "Solana", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(535_000_000), listingDate: "2021-10-15", decimals: 6, referencePriceKrw: 245_000, referenceVolume24hKrw: 180_000_000_000 },
  { symbol: "DOGE", market: "KRW-DOGE", name: "Dogecoin", assetClass: "Payments", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(151_000_000_000), listingDate: "2021-02-24", decimals: 6, referencePriceKrw: 320, referenceVolume24hKrw: 95_000_000_000 },
  { symbol: "ADA", market: "KRW-ADA", name: "Cardano", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(36_000_000_000), listingDate: "2017-10-01", decimals: 6, referencePriceKrw: 1_150, referenceVolume24hKrw: 74_000_000_000 },
  { symbol: "TRX", market: "KRW-TRX", name: "TRON", assetClass: "Payments", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(86_000_000_000), listingDate: "2018-04-09", decimals: 6, referencePriceKrw: 410, referenceVolume24hKrw: 62_000_000_000 },
  { symbol: "AVAX", market: "KRW-AVAX", name: "Avalanche", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(420_000_000), listingDate: "2021-08-31", decimals: 6, referencePriceKrw: 48_000, referenceVolume24hKrw: 41_000_000_000 },
  { symbol: "LINK", market: "KRW-LINK", name: "Chainlink", assetClass: "Infrastructure", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(680_000_000), listingDate: "2019-09-20", decimals: 6, referencePriceKrw: 31_000, referenceVolume24hKrw: 58_000_000_000 },
  { symbol: "DOT", market: "KRW-DOT", name: "Polkadot", assetClass: "Interoperability", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(1_600_000_000), listingDate: "2020-08-19", decimals: 6, referencePriceKrw: 7_600, referenceVolume24hKrw: 29_000_000_000 },
  { symbol: "SUI", market: "KRW-SUI", name: "Sui", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(3_500_000_000), listingDate: "2023-05-03", decimals: 6, referencePriceKrw: 4_600, referenceVolume24hKrw: 76_000_000_000 },
  { symbol: "NEAR", market: "KRW-NEAR", name: "NEAR Protocol", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(1_250_000_000), listingDate: "2021-12-15", decimals: 6, referencePriceKrw: 4_800, referenceVolume24hKrw: 24_000_000_000 },
  { symbol: "APT", market: "KRW-APT", name: "Aptos", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(680_000_000), listingDate: "2022-10-19", decimals: 6, referencePriceKrw: 6_800, referenceVolume24hKrw: 33_000_000_000 },
  { symbol: "ETC", market: "KRW-ETC", name: "Ethereum Classic", assetClass: "Smart Contract", stablecoin: false, custodySupported: true, circulatingSupplyMicros: micros(153_000_000), listingDate: "2017-09-25", decimals: 6, referencePriceKrw: 31_000, referenceVolume24hKrw: 22_000_000_000 },
  { symbol: "USDT", market: "KRW-USDT", name: "Tether", assetClass: "Cash Equivalent", stablecoin: true, custodySupported: true, circulatingSupplyMicros: micros(150_000_000_000), listingDate: "2024-09-11", decimals: 6, referencePriceKrw: 1_420, referenceVolume24hKrw: 120_000_000_000 },
  { symbol: "USDC", market: "KRW-USDC", name: "USD Coin", assetClass: "Cash Equivalent", stablecoin: true, custodySupported: true, circulatingSupplyMicros: micros(62_000_000_000), listingDate: "2024-11-22", decimals: 6, referencePriceKrw: 1_420, referenceVolume24hKrw: 18_000_000_000 },
];

export const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  {
    id: "core-20", slug: "gmd-core", ticker: "GMD CORE", name: "GANYMEDE CORE 20", strategyStyle: "passive", category: "core",
    benchmark: "Ganymede Digital Large Cap Index", expenseRatioBps: 35, rebalanceCadence: "quarterly", maxWeightBps: 3000, minWeightBps: 300,
    cashBufferBps: 100, turnoverLimitBps: 1800, minimumVolumeKrw: "5000000000", minimumHistoryDays: 180,
    parameters: { topN: 10, weighting: "sqrt_market_cap" },
  },
  {
    id: "digital-income", slug: "gmd-yield", ticker: "GMD YIELD", name: "DIGITAL INCOME", strategyStyle: "passive", category: "income",
    benchmark: "Ganymede Minimum Variance Digital Index", expenseRatioBps: 40, rebalanceCadence: "monthly", maxWeightBps: 2400, minWeightBps: 500,
    cashBufferBps: 2000, turnoverLimitBps: 1500, minimumVolumeKrw: "10000000000", minimumHistoryDays: 365,
    parameters: { topN: 6, weighting: "inverse_volatility" },
  },
  {
    id: "tech-leaders", slug: "gmd-tech", ticker: "GMD TECH", name: "TECH LEADERS", strategyStyle: "active", category: "growth",
    benchmark: "Ganymede Blockchain Infrastructure Index", expenseRatioBps: 65, rebalanceCadence: "monthly", maxWeightBps: 2500, minWeightBps: 500,
    cashBufferBps: 300, turnoverLimitBps: 2800, minimumVolumeKrw: "8000000000", minimumHistoryDays: 180,
    parameters: { topN: 8, momentum30Weight: 0.25, momentum90Weight: 0.35, inverseVolatilityWeight: 0.2, liquidityWeight: 0.2, negativeMomentumPenalty: 0.55 },
  },
  {
    id: "next-frontier", slug: "gmd-alpha", ticker: "GMD ALPHA", name: "NEXT FRONTIER", strategyStyle: "active", category: "growth",
    benchmark: "Ganymede Emerging Networks Index", expenseRatioBps: 85, rebalanceCadence: "weekly", maxWeightBps: 1800, minWeightBps: 400,
    cashBufferBps: 500, turnoverLimitBps: 3500, minimumVolumeKrw: "5000000000", minimumHistoryDays: 120,
    parameters: { topN: 10, momentum30Weight: 0.35, momentum90Weight: 0.25, inverseVolatilityWeight: 0.15, liquidityWeight: 0.25, negativeMomentumPenalty: 0.4 },
  },
];

export const REFERENCE_HISTORY_MULTIPLIERS = [
  0.82, 0.84, 0.81, 0.86, 0.88, 0.87, 0.9, 0.92, 0.89, 0.94, 0.96, 0.93, 0.98,
  1.01, 0.99, 1.03, 1.05, 1.02, 1.08, 1.11, 1.07, 1.13, 1.16, 1.12, 1.18,
  1.21, 1.17, 1.23, 1.26, 1.22, 1.29, 1.31, 1.28, 1.34, 1.38, 1.33, 1.41,
  1.44, 1.39, 1.47, 1.51, 1.46, 1.54, 1.58, 1.52, 1.61, 1.65, 1.59, 1.68,
  1.72, 1.66, 1.75, 1.79, 1.73, 1.82, 1.86, 1.8, 1.89, 1.94, 1.87, 1.97,
  2.01, 1.95, 2.04, 2.08, 2.02, 2.12, 2.16, 2.09, 2.2, 2.24, 2.17, 2.28,
  2.33, 2.25, 2.37, 2.41, 2.34, 2.46, 2.5, 2.43, 2.55, 2.6, 2.52, 2.65,
  2.7, 2.61, 2.75, 2.8, 2.72, 2.87, 2.93,
];
