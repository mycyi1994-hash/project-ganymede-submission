export type Filter = "all" | "passive" | "active";
export type ProductCategory = "core" | "growth" | "income";
export type StrategyStyle = "passive" | "active";
export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type CelestialVisual = "core" | "tech" | "income" | "alpha";

export type BasketAsset = {
  rank: number;
  ticker: string;
  name: string;
  weight: number;
  assetClass: string;
  description: string;
  iconKey: string;
};

export type Etf = {
  id: string;
  slug: string;
  ticker: string;
  name: string;
  category: ProductCategory;
  strategyStyle: StrategyStyle;
  tagline: string;
  description: string;
  oneYearReturn: string;
  ytdReturn: string;
  sinceInceptionReturn: string;
  nav: string;
  navChange: string;
  aum: string;
  fee: string;
  risk: Risk;
  volatility: string;
  maxDrawdown: string;
  benchmark: string;
  inceptionDate: string;
  domicile: string;
  minimum: string;
  distribution: string;
  assetCount: number;
  rebalanceFrequency: string;
  strategyType: string;
  lastRebalanced: string;
  factSheetUrl: string;
  visual: CelestialVisual;
  portfolioRole: string;
  roleName: string;
  bestFor: string;
  whyChoose: string;
  notFor: string;
  signature: string;
  monthlyReturns: number[];
  basket: BasketAsset[];
  methodology: {
    selection: string;
    weighting: string;
    rebalance: string;
    eligibility: string;
    limits: string;
    risk: string;
  };
};

const asset = (
  rank: number,
  ticker: string,
  name: string,
  weight: number,
  assetClass: string,
  description: string,
): BasketAsset => ({ rank, ticker, name, weight, assetClass, description, iconKey: ticker.toLowerCase() });

export const etfs: Etf[] = [
  {
    id: "core-20",
    slug: "gmd-core",
    ticker: "GMD CORE",
    name: "GANYMEDE CORE 20",
    category: "core",
    strategyStyle: "passive",
    tagline: "Balanced exposure to leading digital assets.",
    description: "A diversified core strategy designed to capture long-term growth while reducing single-asset concentration.",
    oneYearReturn: "18.4%",
    ytdReturn: "12.8%",
    sinceInceptionReturn: "31.6%",
    nav: "$23.84",
    navChange: "+1.42%",
    aum: "$128.4M",
    fee: "0.35%",
    risk: "MEDIUM",
    volatility: "38.2%",
    maxDrawdown: "-21.4%",
    benchmark: "Ganymede Digital Large Cap Index",
    inceptionDate: "APR 18, 2024",
    domicile: "CAYMAN ISLANDS",
    minimum: "₩100,000",
    distribution: "ACCUMULATING",
    assetCount: 10,
    rebalanceFrequency: "QUARTERLY",
    strategyType: "CORE STRATEGY",
    lastRebalanced: "JUL 2026",
    factSheetUrl: "#methodology",
    visual: "core",
    portfolioRole: "FOUNDATION",
    roleName: "THE FOUNDATION",
    bestFor: "LONG-TERM CORE ALLOCATION",
    whyChoose: "One diversified starting point across established digital assets.",
    notFor: "Principal protection, predictable income or short-term liquidity certainty.",
    signature: "BROAD EXPOSURE / CONTROLLED CONCENTRATION",
    monthlyReturns: [2.8, -1.4, 4.2, 1.9, -2.1, 3.6, 5.1, -0.8, 2.4, 1.2, -1.7, 3.9],
    basket: [
      asset(1, "BTC", "Bitcoin", 30, "Store of Value", "Primary digital reserve asset and liquidity anchor."),
      asset(2, "ETH", "Ethereum", 20, "Smart Contract", "Core programmable settlement and application network."),
      asset(3, "XRP", "XRP", 12, "Payments", "Liquid payment and settlement network exposure."),
      asset(4, "SOL", "Solana", 10, "Smart Contract", "High-throughput network for consumer-scale applications."),
      asset(5, "DOGE", "Dogecoin", 7, "Payments", "Independent high-liquidity payment network."),
      asset(6, "ADA", "Cardano", 6, "Smart Contract", "Established proof-of-stake smart-contract network."),
      asset(7, "TRX", "TRON", 5, "Payments", "High-volume settlement network exposure."),
      asset(8, "AVAX", "Avalanche", 4, "Smart Contract", "Customizable network infrastructure."),
      asset(9, "LINK", "Chainlink", 3, "Infrastructure", "Decentralized oracle and interoperability infrastructure."),
      asset(10, "DOT", "Polkadot", 3, "Interoperability", "Cross-network coordination infrastructure."),
    ],
    methodology: {
      selection: "Select liquid, institutionally accessible digital assets with durable network usage and transparent supply data.",
      weighting: "Float-adjusted market-cap weighting with conviction and liquidity modifiers.",
      rebalance: "Reviewed monthly and reconstituted quarterly using the final business-day reference window.",
      eligibility: "Assets require minimum liquidity, custody support, pricing history and operational resilience.",
      limits: "Single assets are capped at 30%; qualifying positions below 3% are removed at rebalance.",
      risk: "Digital assets can experience significant volatility, liquidity gaps and regulatory change.",
    },
  },
  {
    id: "tech-leaders",
    slug: "gmd-tech",
    ticker: "GMD TECH",
    name: "TECH LEADERS",
    category: "growth",
    strategyStyle: "active",
    tagline: "Growth-focused leaders in blockchain infrastructure.",
    description: "A concentrated technology strategy focused on networks, middleware and protocols enabling the next generation of onchain applications.",
    oneYearReturn: "24.7%",
    ytdReturn: "17.5%",
    sinceInceptionReturn: "44.9%",
    nav: "$31.26",
    navChange: "+2.08%",
    aum: "$94.7M",
    fee: "0.65%",
    risk: "HIGH",
    volatility: "52.7%",
    maxDrawdown: "-29.8%",
    benchmark: "Ganymede Blockchain Infrastructure Index",
    inceptionDate: "JUN 03, 2024",
    domicile: "CAYMAN ISLANDS",
    minimum: "₩100,000",
    distribution: "ACCUMULATING",
    assetCount: 8,
    rebalanceFrequency: "MONTHLY",
    strategyType: "GROWTH STRATEGY",
    lastRebalanced: "JUL 2026",
    factSheetUrl: "#methodology",
    visual: "tech",
    portfolioRole: "BUILDER",
    roleName: "THE BUILDER",
    bestFor: "FOCUSED THEMATIC GROWTH",
    whyChoose: "Focused growth exposure to established blockchain infrastructure.",
    notFor: "Low-volatility allocation or investors avoiding thematic concentration.",
    signature: "INFRASTRUCTURE GROWTH / SYSTEMATIC CONVICTION",
    monthlyReturns: [4.1, -2.8, 6.4, 3.2, -3.6, 5.8, 7.1, -1.9, 3.7, 2.4, -2.2, 4.8],
    basket: [
      asset(1, "ETH", "Ethereum", 24, "Smart Contract", "Programmable settlement layer and application platform."),
      asset(2, "SOL", "Solana", 18, "Smart Contract", "High-performance application and payments network."),
      asset(3, "LINK", "Chainlink", 14, "Infrastructure", "Oracle, data and cross-chain connectivity layer."),
      asset(4, "AVAX", "Avalanche", 12, "Smart Contract", "Customizable execution and institutional subnet infrastructure."),
      asset(5, "SUI", "Sui", 10, "Smart Contract", "Object-centric execution platform for consumer applications."),
      asset(6, "NEAR", "NEAR Protocol", 8, "Smart Contract", "Sharded execution and application infrastructure."),
      asset(7, "APT", "Aptos", 7, "Smart Contract", "Move-based high-throughput application network."),
      asset(8, "DOT", "Polkadot", 7, "Interoperability", "Cross-network coordination infrastructure."),
    ],
    methodology: {
      selection: "Screen for category leadership, developer activity, fee generation, liquidity and infrastructure relevance.",
      weighting: "Fundamental score weighting blended with liquidity-adjusted market capitalization.",
      rebalance: "Signals are reviewed weekly and the basket is rebalanced monthly.",
      eligibility: "Networks require reliable market data, established custody and twelve months of operating history.",
      limits: "Every position is capped at 25% and allocations below 5% are removed at rebalance.",
      risk: "Growth protocols carry elevated technology, governance and competitive displacement risk.",
    },
  },
  {
    id: "digital-income",
    slug: "gmd-yield",
    ticker: "GMD YIELD",
    name: "DIGITAL INCOME",
    category: "income",
    strategyStyle: "passive",
    tagline: "A diversified strategy designed for steady income.",
    description: "A lower-volatility digital allocation combining reserve assets, productive networks and a dedicated liquidity sleeve.",
    oneYearReturn: "11.2%",
    ytdReturn: "7.9%",
    sinceInceptionReturn: "19.8%",
    nav: "$18.72",
    navChange: "+0.36%",
    aum: "$76.2M",
    fee: "0.40%",
    risk: "LOW",
    volatility: "22.9%",
    maxDrawdown: "-12.6%",
    benchmark: "Ganymede Digital Income Index",
    inceptionDate: "AUG 12, 2024",
    domicile: "CAYMAN ISLANDS",
    minimum: "₩100,000",
    distribution: "QUARTERLY",
    assetCount: 6,
    rebalanceFrequency: "MONTHLY",
    strategyType: "INCOME STRATEGY",
    lastRebalanced: "JUL 2026",
    factSheetUrl: "#methodology",
    visual: "income",
    portfolioRole: "STABILIZER",
    roleName: "THE STABILIZER",
    bestFor: "LOWER-VOLATILITY ALLOCATION",
    whyChoose: "A risk-budgeted mandate built for a smoother digital-asset allocation.",
    notFor: "Maximum upside participation or guaranteed cash distributions.",
    signature: "RISK BUDGET / STRATEGIC LIQUIDITY RESERVE",
    monthlyReturns: [1.4, 0.6, 1.8, -0.7, 0.9, 1.2, 2.1, -0.4, 1.1, 0.8, -0.5, 1.6],
    basket: [
      asset(1, "ETH", "Ethereum", 20, "Smart Contract", "Productive network exposure with staking economics."),
      asset(2, "BTC", "Bitcoin", 18, "Store of Value", "Core reserve exposure and portfolio ballast."),
      asset(3, "XRP", "XRP", 17, "Payments", "High-liquidity payment network exposure."),
      asset(4, "TRX", "TRON", 16, "Payments", "High-volume settlement network exposure."),
      asset(5, "DOGE", "Dogecoin", 15, "Payments", "Liquid payment asset with independent network economics."),
      asset(6, "ADA", "Cardano", 14, "Smart Contract", "Lower-volatility smart-contract network allocation."),
    ],
    methodology: {
      selection: "Prioritize liquidity, sustainable network economics and observable cash-flow proxies.",
      weighting: "Risk-budgeted weights balance expected income with realized volatility.",
      rebalance: "Income and volatility signals are reviewed and rebalanced monthly.",
      eligibility: "Assets require transparent economics, deep liquidity and supported institutional custody.",
      limits: "Any constituent is capped at 24%; a 20% operating cash buffer is held outside the constituent basket.",
      risk: "Income targets are not guaranteed and staking, protocol, liquidity and market risks remain.",
    },
  },
  {
    id: "next-frontier",
    slug: "gmd-alpha",
    ticker: "GMD ALPHA",
    name: "NEXT FRONTIER",
    category: "growth",
    strategyStyle: "active",
    tagline: "Emerging networks selected for long-term growth.",
    description: "A high-conviction basket of rapidly developing networks selected for adoption, capital efficiency and category expansion.",
    oneYearReturn: "29.1%",
    ytdReturn: "21.3%",
    sinceInceptionReturn: "53.7%",
    nav: "$36.41",
    navChange: "+2.64%",
    aum: "$61.8M",
    fee: "0.85%",
    risk: "HIGH",
    volatility: "61.4%",
    maxDrawdown: "-34.5%",
    benchmark: "Ganymede Emerging Networks Index",
    inceptionDate: "SEP 09, 2024",
    domicile: "CAYMAN ISLANDS",
    minimum: "₩100,000",
    distribution: "ACCUMULATING",
    assetCount: 10,
    rebalanceFrequency: "MONTHLY",
    strategyType: "ALPHA STRATEGY",
    lastRebalanced: "JUL 2026",
    factSheetUrl: "#methodology",
    visual: "alpha",
    portfolioRole: "EXPLORER",
    roleName: "THE EXPLORER",
    bestFor: "HIGH-RISK FRONTIER GROWTH",
    whyChoose: "Emerging-network exposure within strict position and liquidity limits.",
    notFor: "Capital preservation, low turnover or short investment horizons.",
    signature: "FRONTIER SIGNALS / STRICT POSITION CAPS",
    monthlyReturns: [5.3, -3.9, 7.8, 4.6, -5.1, 6.9, 8.2, -2.6, 4.5, 3.1, -3.4, 5.7],
    basket: [
      asset(1, "SOL", "Solana", 18, "Smart Contract", "High-throughput consumer and financial application network."),
      asset(2, "SUI", "Sui", 14, "Smart Contract", "Object-centric execution platform for consumer applications."),
      asset(3, "LINK", "Chainlink", 12, "Infrastructure", "Data, automation and interoperability infrastructure."),
      asset(4, "AVAX", "Avalanche", 11, "Smart Contract", "Customizable network infrastructure for institutional use."),
      asset(5, "NEAR", "NEAR Protocol", 10, "Smart Contract", "Sharded application and chain-abstraction infrastructure."),
      asset(6, "APT", "Aptos", 9, "Smart Contract", "Move-based high-throughput application network."),
      asset(7, "DOT", "Polkadot", 8, "Interoperability", "Cross-network coordination infrastructure."),
      asset(8, "ADA", "Cardano", 7, "Smart Contract", "Established proof-of-stake application network."),
      asset(9, "TRX", "TRON", 6, "Payments", "High-volume settlement network exposure."),
      asset(10, "XRP", "XRP", 5, "Payments", "Liquid payment and settlement network exposure."),
    ],
    methodology: {
      selection: "Rank emerging networks by adoption velocity, capital efficiency, developer momentum and liquidity.",
      weighting: "Conviction scores are volatility adjusted and constrained by tradable liquidity.",
      rebalance: "The opportunity set is reviewed weekly and rebalanced monthly.",
      eligibility: "Assets require reliable custody, reference pricing, active development and minimum liquidity.",
      limits: "No constituent may exceed 18%; sub-4% positions are removed at the rebalance threshold.",
      risk: "Frontier networks carry high volatility, execution, governance and adoption risk.",
    },
  },
];

for (const etf of etfs) {
  const total = etf.basket.reduce((sum, holding) => sum + holding.weight, 0);
  if (total !== 100) throw new Error(`${etf.ticker} basket must total 100%, received ${total}%`);
}

export function getEtfBySlug(slug: string) {
  return etfs.find((etf) => etf.slug === slug);
}
