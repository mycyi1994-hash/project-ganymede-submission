/**
 * A basket defined by one configuration file instead of code: its constituents and fixed units, the
 * registry and product key its records live under, and where its documents are served. The checks
 * that verify USTX verify any basket described this way, with nothing of USTX's code or keys.
 */
import { stableJson } from "../engine/fixed";
import type { Composition } from "./basket";
import { readLatestNav, type OnchainNav } from "./onchain";
import { verifyReport, type Check, type ReportProfile } from "./proof";

export const BASKET_CONFIG_SCHEMA = "ganymede-basket/v1";
const WAD = 10n ** 18n;
/** Baskets start at $100 a share, like USTX. */
export const START_NAV_MICROS = 100_000_000n;

export type BasketConstituent = { symbol: string; address: string; weightBps: number; unitsWad: string };
export type BasketConfig = {
  schema: typeof BASKET_CONFIG_SCHEMA;
  id: string;
  name: string;
  ticker: string;
  issuer: string;
  /** keccak256 of the id, as the relayer computes product keys; the registry stores records under it. */
  productKey: string;
  registry: { network: string; chainId: number; rpcUrl: string; address: string; explorerUrl: string };
  pricing: { chainIndex: string; source: string };
  /** When the units were fixed; each document repeats it. */
  fixedAt: string;
  constituents: BasketConstituent[];
  /** Where a record's document is served: a path on this site or an https URL, with {hash} for its fingerprint. */
  documents: string;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 80): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const https = (value: unknown): value is string => typeof value === "string" && /^https:\/\/[^\s]+$/.test(value) && value.length <= 200;
const address = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);

function fail(what: string): never {
  throw new Error(`Invalid basket configuration: ${what}.`);
}

/** Accepts only a complete configuration: lowercase addresses, weights totalling 100% and fixed units. */
export function parseBasketConfig(value: unknown): BasketConfig {
  if (!object(value) || value.schema !== BASKET_CONFIG_SCHEMA) return fail("unknown schema");
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.id)) fail("id");
  for (const key of ["name", "ticker", "issuer"]) if (!text(value[key])) fail(key);
  if (typeof value.productKey !== "string" || !/^0x[0-9a-f]{64}$/.test(value.productKey)) fail("product key");
  const registry = value.registry;
  if (!object(registry) || !text(registry.network) || !Number.isInteger(registry.chainId) || Number(registry.chainId) <= 0 || !https(registry.rpcUrl) || !address(registry.address) || !https(registry.explorerUrl)) fail("registry");
  const pricing = value.pricing;
  if (!object(pricing) || typeof pricing.chainIndex !== "string" || !/^\d{1,10}$/.test(pricing.chainIndex) || !text(pricing.source, 200)) fail("pricing");
  if (typeof value.fixedAt !== "string" || !Number.isFinite(Date.parse(value.fixedAt))) fail("fixing time");
  if (!Array.isArray(value.constituents) || value.constituents.length < 1 || value.constituents.length > 20) fail("constituents");
  const symbols = new Set<string>();
  const addresses = new Set<string>();
  let weight = 0;
  for (const row of value.constituents as unknown[]) {
    if (!object(row) || typeof row.symbol !== "string" || !/^[A-Za-z0-9.]{1,12}$/.test(row.symbol) || symbols.has(row.symbol)
      || !address(row.address) || addresses.has(row.address) || !Number.isInteger(row.weightBps) || Number(row.weightBps) <= 0 || Number(row.weightBps) > 10_000
      || typeof row.unitsWad !== "string" || !/^[1-9]\d{0,77}$/.test(row.unitsWad)) fail("a constituent is missing, repeated or invalid");
    symbols.add(row.symbol);
    addresses.add(row.address);
    weight += Number(row.weightBps);
  }
  if (weight !== 10_000) fail("weights do not total 100%");
  // A path on this site or an https URL, in plain characters only: no "//", "..", backslash or control
  // character that a browser would resolve to another host.
  const documents = value.documents;
  if (typeof documents !== "string" || documents.length > 200 || documents.split("{hash}").length !== 2 || documents.includes("..") || documents.includes("//", documents.startsWith("https://") ? 8 : 0)
    || !/^(\/|https:\/\/[a-z0-9.-]+(:\d{1,5})?\/)[A-Za-z0-9_./{}-]*$/.test(documents)) fail("document location");
  return value as BasketConfig;
}

/** What each of the basket's documents must describe, token addresses included. */
export function basketProfile(config: BasketConfig): ReportProfile {
  return {
    productId: config.id,
    pricingChainIndex: config.pricing.chainIndex,
    symbols: config.constituents.map((row) => row.symbol),
    addresses: Object.fromEntries(config.constituents.map((row) => [row.symbol, row.address])),
  };
}

/** Units that give each constituent its weight of `startMicros` at the fixing prices, rounded down. */
export function fixUnits(constituents: { symbol: string; weightBps: number }[], prices: ReadonlyMap<string, bigint>, startMicros = START_NAV_MICROS): string[] {
  return constituents.map((row) => {
    const price = prices.get(row.symbol);
    if (!price || price <= 0n) throw new Error(`No fixing price for ${row.symbol}.`);
    return ((startMicros * BigInt(row.weightBps) * WAD) / (10_000n * price)).toString();
  });
}

/** The composition document for one set of prices, in the format USTX publishes. */
export function basketDocument(config: BasketConfig, prices: ReadonlyMap<string, { priceMicros: bigint; source: string }>, asOf: string): { composition: Composition; canonical: string } {
  let nav = 0n;
  const holdings = config.constituents.map((row) => {
    const price = prices.get(row.symbol);
    if (!price || price.priceMicros <= 0n) throw new Error(`No price for ${row.symbol}.`);
    const value = (BigInt(row.unitsWad) * price.priceMicros) / WAD;
    nav += value;
    return { symbol: row.symbol, address: row.address, weightBps: row.weightBps, unitsWad: row.unitsWad, priceMicros: price.priceMicros.toString(), valueMicros: value.toString(), priceTime: asOf, priceSource: price.source };
  });
  const composition: Composition = { productId: config.id, asOf, pricingChainIndex: config.pricing.chainIndex, basketFixedAt: config.fixedAt, navPerShareMicros: nav.toString(), holdings };
  return { composition, canonical: stableJson(composition) };
}

export type BasketCheck = {
  record: OnchainNav | null;
  documentUrl: string | null;
  chain: Check;
  hash: Check;
  nav: Check;
  /** The document values exactly the units, weights and fixing the configuration names. */
  definition: Check;
  composition: Composition | null;
};

const pending = (detail: string): Check => ({ state: "pending", detail });

/**
 * Reads the basket's latest record from the registry its configuration names, fetches the document
 * for that record's fingerprint and runs USTX's checks on it, plus one more: the document must hold
 * the configured units. `base` resolves a document path on this site.
 */
export async function verifyBasket(config: BasketConfig, options: { base: string; fetcher?: typeof fetch }): Promise<BasketCheck> {
  const fetcher = options.fetcher ?? fetch;
  const result: BasketCheck = { record: null, documentUrl: null, chain: pending("Waiting for a direct chain read."), hash: pending("Waiting for the document."), nav: pending("Waiting for the document."), definition: pending("Waiting for the document."), composition: null };
  try {
    result.record = await readLatestNav(config.registry.rpcUrl, config.registry.address, { chainId: config.registry.chainId, productKey: config.productKey, fetcher });
  } catch (error) {
    result.chain = pending(error instanceof Error ? error.message : "The registry could not be read.");
    return result;
  }
  if (!result.record.effectiveAt) {
    result.chain = pending("The registry has no record for this basket yet.");
    return result;
  }
  result.chain = { state: "pass", detail: `Read directly from ${config.registry.address} on ${config.registry.network} (${config.registry.chainId}).` };
  result.documentUrl = new URL(config.documents.replace("{hash}", result.record.holdingsHash.toLowerCase()), options.base).href;
  let canonical: string;
  try {
    const response = await fetcher(result.documentUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(response.status === 404 ? "The document for this record is not served." : `Document request ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 100_000) throw new Error("The document exceeds the supported size.");
    // Decoded without dropping a byte-order mark or replacing invalid bytes, so the hash covers the bytes served.
    canonical = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    result.hash = pending(error instanceof Error ? error.message : "The document could not be fetched.");
    return result;
  }
  const verified = await verifyReport(canonical, result.record, basketProfile(config), "chain");
  result.hash = verified.hash;
  result.nav = verified.nav;
  result.composition = verified.composition;
  // One reading only: sorted keys, no spaces and no repeated key another parser could read differently.
  if (verified.composition && stableJson(JSON.parse(canonical)) !== canonical) {
    result.nav = { state: "fail", detail: "The document is not in canonical form: sorted keys, no spaces, no repeated keys." };
  }
  const document = verified.composition;
  if (!document) {
    result.definition = { state: "fail", detail: "The document does not describe this basket." };
    return result;
  }
  const same = document.basketFixedAt === config.fixedAt && config.constituents.every((row) => {
    const holding = document.holdings.find((entry) => entry.symbol === row.symbol);
    return holding && holding.unitsWad === row.unitsWad && holding.weightBps === row.weightBps;
  });
  result.definition = same
    ? { state: "pass", detail: `The document values exactly the ${config.constituents.length} units and weights fixed on ${config.fixedAt.slice(0, 10)}.` }
    : { state: "fail", detail: "The document's units, weights or fixing differ from the basket's configuration." };
  return result;
}

/** Only configuration files served from this site's /baskets/ folder are loaded by the badge. */
export function basketConfigPath(value: string | null | undefined): string | null {
  return value && /^\/baskets\/[a-z0-9-]{1,40}\/basket\.json$/.test(value) ? value : null;
}
