/**
 * GMD US TECH x — an equal-weight basket of tokenized US mega-cap tech stocks
 * (xStocks) that trade on X Layer mainnet.
 *
 * The basket works like an ETF's portfolio composition file: a fixed number of
 * token units per fund share. NAV per share is Σ units × live price. Units are
 * fixed from live prices at inception and re-fixed each quarter at the
 * prevailing NAV, so NAV is continuous across rebalances. No reference prices
 * are ever used to fix units or to publish a NAV.
 *
 * Every NAV published on chain carries holdingsHash = sha256(canonical
 * composition JSON). Anyone holding that JSON can recompute the hash and match
 * it against GanymedeNavRegistry.latestNav — see app/proof.
 *
 * All values are fixed-point: USD in micros (1e-6), token units in WAD (1e-18),
 * so rounding never costs more than a micro-dollar per holding.
 */
import { sha256Hex, stableJson } from "../engine/fixed";

export const MICROS = 1_000_000n;
export const WAD = 10n ** 18n;
const BPS = 10_000n;

export const XSTOCKS_PRODUCT = {
  id: "us-tech-x",
  ticker: "GMD USTX",
  name: "GANYMEDE US TECH x",
  benchmark: "Ganymede US Mega-Cap Tech Equal-Weight Index (tokenized)",
  methodology: "Equal weight, fixed units per share, re-fixed quarterly at the prevailing NAV",
  /** NAV per share at inception fixing: US$100.000000. */
  inceptionNavMicros: 100n * MICROS,
} as const;

/** Where the constituents live and are priced. The NAV registry may sit on another chain (SETTLEMENT_CHAIN). */
export const XSTOCKS_CHAIN = {
  chainIndex: "196",
  name: "X Layer",
  rpcUrl: "https://rpc.xlayer.tech",
  explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
} as const;

export type ConstituentDefinition = {
  symbol: string;
  underlying: string;
  name: string;
};

export const XSTOCKS_CONSTITUENTS: ConstituentDefinition[] = [
  { symbol: "AAPLx", underlying: "AAPL", name: "Apple" },
  { symbol: "MSFTx", underlying: "MSFT", name: "Microsoft" },
  { symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA" },
  { symbol: "AMZNx", underlying: "AMZN", name: "Amazon" },
  { symbol: "METAx", underlying: "META", name: "Meta Platforms" },
  { symbol: "TSLAx", underlying: "TSLA", name: "Tesla" },
];

export type Quote = {
  symbol: string;
  address: string;
  priceMicros: bigint;
  /** ISO-8601 time the price source attached to the quote. */
  time: string;
  source: string;
};

export type BasketHolding = {
  symbol: string;
  address: string;
  weightBps: number;
  /** Token units per fund share, 1e-18 fixed point. */
  unitsWad: bigint;
};

export type Basket = {
  productId: string;
  fixedAt: string;
  navAtFixingMicros: bigint;
  holdings: BasketHolding[];
};

/** Equal weights in basis points that sum to exactly 10,000; any remainder goes to the first constituents. */
export function equalWeightsBps(count: number): number[] {
  if (count <= 0) throw new Error("A basket needs at least one constituent");
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** "187.4312" -> 187431200n. Plain decimal strings only; extra precision is truncated, never rounded up. */
export function parseDecimalMicros(value: string): bigint {
  const trimmed = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Not a plain decimal price: "${value}"`);
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * MICROS + BigInt((fraction + "000000").slice(0, 6));
}

export function formatMicros(value: bigint, digits = 2): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICROS;
  const fraction = (absolute % MICROS).toString().padStart(6, "0").slice(0, digits);
  return `${negative ? "-" : ""}${whole.toString()}${digits > 0 ? `.${fraction}` : ""}`;
}

/** Fixes units per share so each holding carries its weight of `navMicros` at the given prices. */
export function fixBasket(
  constituents: Array<{ symbol: string; address: string }>,
  prices: Map<string, bigint>,
  navMicros: bigint,
  fixedAt: string,
): Basket {
  const weights = equalWeightsBps(constituents.length);
  const holdings = constituents.map((constituent, index) => {
    const price = prices.get(constituent.symbol);
    if (!price || price <= 0n) throw new Error(`Cannot fix ${constituent.symbol} without a positive live price`);
    const weightBps = weights[index];
    return {
      symbol: constituent.symbol,
      address: constituent.address,
      weightBps,
      unitsWad: (navMicros * BigInt(weightBps) * WAD) / (BPS * price),
    };
  });
  return { productId: XSTOCKS_PRODUCT.id, fixedAt, navAtFixingMicros: navMicros, holdings };
}

export function basketNavMicros(basket: Basket, prices: Map<string, bigint>): bigint {
  let nav = 0n;
  for (const holding of basket.holdings) {
    const price = prices.get(holding.symbol);
    if (!price || price <= 0n) throw new Error(`Missing live price for ${holding.symbol}`);
    nav += (holding.unitsWad * price) / WAD;
  }
  return nav;
}

function quarterOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Quarterly re-fixing: due once the calendar quarter of `now` differs from the fixing's. */
export function rebalanceDue(basket: Basket, now: string): boolean {
  return quarterOf(basket.fixedAt) !== quarterOf(now);
}

export function quoteAgeMinutes(quote: Quote, now: string): number {
  return Math.max(0, (new Date(now).getTime() - new Date(quote.time).getTime()) / 60_000);
}

export type CompositionHolding = {
  symbol: string;
  address: string;
  weightBps: number;
  unitsWad: string;
  priceMicros: string;
  valueMicros: string;
  priceTime: string;
  priceSource: string;
};

/** The document whose sha256 is published on chain as holdingsHash. */
export type Composition = {
  productId: string;
  asOf: string;
  pricingChainIndex: string;
  basketFixedAt: string;
  navPerShareMicros: string;
  holdings: CompositionHolding[];
};

export type Evaluation = {
  status: "awaiting_configuration" | "awaiting_prices" | "priced";
  basket: Basket | null;
  rebalanced: boolean;
  composition: Composition | null;
  canonical: string | null;
  holdingsHash: string | null;
  /** True only when every constituent has a fresh live price. */
  publishable: boolean;
  blockers: string[];
};

export type EvaluateInput = {
  constituents: Array<ConstituentDefinition & { address: string | null }>;
  quotes: Map<string, Quote>;
  previous: Basket | null;
  now: string;
  maxQuoteAgeMinutes: number;
};

/**
 * One pricing pass. Pure: the caller persists the returned basket and decides
 * whether to publish. A pass with any missing or stale price never produces a
 * publishable NAV.
 */
export async function evaluateBasket(input: EvaluateInput): Promise<Evaluation> {
  const blockers: string[] = [];
  const unconfigured = input.constituents.filter((constituent) => !constituent.address);
  if (unconfigured.length > 0) {
    blockers.push(`No X Layer address configured for ${unconfigured.map((constituent) => constituent.symbol).join(", ")}`);
    return { status: "awaiting_configuration", basket: input.previous, rebalanced: false, composition: null, canonical: null, holdingsHash: null, publishable: false, blockers };
  }

  const constituents = input.constituents as Array<ConstituentDefinition & { address: string }>;
  // Two symbols on one token would publish a document the browser verifier rejects.
  const owners = new Map<string, string>();
  for (const constituent of constituents) {
    const owner = owners.get(constituent.address.toLowerCase());
    if (owner) blockers.push(`${owner} and ${constituent.symbol} are configured with the same address`);
    owners.set(constituent.address.toLowerCase(), constituent.symbol);
  }
  for (const constituent of constituents) {
    const quote = input.quotes.get(constituent.symbol);
    if (!quote) blockers.push(`No live price for ${constituent.symbol}`);
    else if (quote.priceMicros <= 0n) blockers.push(`Non-positive price for ${constituent.symbol}`);
    else if (quote.address.toLowerCase() !== constituent.address.toLowerCase()) blockers.push(`Price address mismatch for ${constituent.symbol}`);
    else if (!Number.isFinite(Date.parse(quote.time)) || Date.parse(quote.time) > Date.parse(input.now) + 60_000) blockers.push(`Invalid price timestamp for ${constituent.symbol}`);
    else if (quoteAgeMinutes(quote, input.now) > input.maxQuoteAgeMinutes) {
      blockers.push(`${constituent.symbol} price is ${Math.round(quoteAgeMinutes(quote, input.now))} minutes old`);
    }
  }
  // The record carries its oldest price's time and the verifier accepts prices up to a minute newer
  // than that, so prices quoted further apart would publish a document the browser rejects.
  if (blockers.length === 0) {
    const times = constituents.map((constituent) => Date.parse(input.quotes.get(constituent.symbol)!.time));
    if (Math.max(...times) - Math.min(...times) > 60_000) blockers.push("Prices were quoted more than a minute apart");
  }
  if (blockers.length > 0) {
    return { status: "awaiting_prices", basket: input.previous, rebalanced: false, composition: null, canonical: null, holdingsHash: null, publishable: false, blockers };
  }

  const prices = new Map(constituents.map((constituent) => [constituent.symbol, input.quotes.get(constituent.symbol)!.priceMicros]));
  // A record carries the time of its oldest price, never later than the calculation, so the fund and
  // the lending market count their one-hour limit from the prices rather than from the arithmetic.
  const asOf = new Date(Math.min(Date.parse(input.now), ...constituents.map((constituent) => Date.parse(input.quotes.get(constituent.symbol)!.time)))).toISOString();
  const addressesChanged = input.previous !== null && input.previous.holdings.some((holding) => {
    const current = constituents.find((constituent) => constituent.symbol === holding.symbol);
    return !current || current.address.toLowerCase() !== holding.address.toLowerCase();
  });

  let basket = input.previous;
  let rebalanced = false;
  const sameConstituents = basket !== null && basket.holdings.length === constituents.length
    && basket.holdings.every((holding) => constituents.some((constituent) => constituent.symbol === holding.symbol));
  if (!basket || !sameConstituents) {
    basket = fixBasket(constituents, prices, XSTOCKS_PRODUCT.inceptionNavMicros, asOf);
  } else if (addressesChanged || rebalanceDue(basket, input.now)) {
    // A corrected or migrated token address re-fixes at the prevailing value, like the
    // quarterly re-fix, so the published NAV stays continuous and the change is evidenced.
    basket = fixBasket(constituents, prices, basketNavMicros(basket, prices), asOf);
    rebalanced = true;
  }

  const holdings: CompositionHolding[] = basket.holdings.map((holding) => {
    const quote = input.quotes.get(holding.symbol)!;
    return {
      symbol: holding.symbol,
      address: holding.address.toLowerCase(),
      weightBps: holding.weightBps,
      unitsWad: holding.unitsWad.toString(),
      priceMicros: quote.priceMicros.toString(),
      valueMicros: ((holding.unitsWad * quote.priceMicros) / WAD).toString(),
      priceTime: quote.time,
      priceSource: quote.source,
    };
  });
  const composition: Composition = {
    productId: XSTOCKS_PRODUCT.id,
    asOf,
    pricingChainIndex: XSTOCKS_CHAIN.chainIndex,
    basketFixedAt: basket.fixedAt,
    navPerShareMicros: basketNavMicros(basket, prices).toString(),
    holdings,
  };
  const canonical = stableJson(composition);
  return {
    status: "priced",
    basket,
    rebalanced,
    composition,
    canonical,
    holdingsHash: await sha256Hex(canonical),
    publishable: true,
    blockers,
  };
}

/**
 * The re-fixing record whose sha256 is published as rebalance evidence: canonical JSON
 * with lowercase addresses, served by /api/xstocks so anyone can recompute the hash.
 */
export function basketDocument(basket: Basket): string {
  return stableJson({
    productId: basket.productId,
    fixedAt: basket.fixedAt,
    navAtFixingMicros: basket.navAtFixingMicros.toString(),
    holdings: basket.holdings.map((holding) => ({ symbol: holding.symbol, address: holding.address.toLowerCase(), weightBps: holding.weightBps, unitsWad: holding.unitsWad.toString() })),
  });
}

export function serializeBasket(basket: Basket): string {
  return JSON.stringify({
    ...basket,
    navAtFixingMicros: basket.navAtFixingMicros.toString(),
    holdings: basket.holdings.map((holding) => ({ ...holding, unitsWad: holding.unitsWad.toString() })),
  });
}

export function deserializeBasket(raw: string | null | undefined): Basket | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Omit<Basket, "navAtFixingMicros" | "holdings"> & {
    navAtFixingMicros: string;
    holdings: Array<Omit<BasketHolding, "unitsWad"> & { unitsWad: string }>;
  };
  return {
    ...parsed,
    navAtFixingMicros: BigInt(parsed.navAtFixingMicros),
    holdings: parsed.holdings.map((holding) => ({ ...holding, unitsWad: BigInt(holding.unitsWad) })),
  };
}

/**
 * Constituent addresses on X Layer mainnet. None are hardcoded: set
 * XSTOCKS_ADDRESSES="AAPLx=0x…,MSFTx=0x…" after confirming each with
 * `npm run xstocks:check -- verify`.
 */
export function constituentsWithAddresses(raw: string | undefined): Array<ConstituentDefinition & { address: string | null }> {
  const configured = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const [symbol, address] = entry.split("=").map((part) => part?.trim());
    if (symbol && address && /^0x[a-fA-F0-9]{40}$/.test(address)) configured.set(symbol.toLowerCase(), address);
  }
  return XSTOCKS_CONSTITUENTS.map((constituent) => ({ ...constituent, address: configured.get(constituent.symbol.toLowerCase()) ?? null }));
}
