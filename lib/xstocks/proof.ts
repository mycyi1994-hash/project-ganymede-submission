import { DEFAULT_SETTLEMENT_CHAIN } from "../chains";
import { sha256Hex } from "../engine/fixed";
import { XSTOCKS_PRODUCT, XSTOCKS_CONSTITUENTS, type Composition } from "./basket";
import type { OnchainNav } from "./onchain";

// Public deployment pinned in the browser bundle; never accepted from an API response.
export const PROOF_DEPLOYMENT = {
  ...DEFAULT_SETTLEMENT_CHAIN,
  registry: "0xf320d2a7f280b7ab61e24374986869d7be34289c",
};
export type Check = { state: "pass" | "fail" | "pending"; detail: string };
const WAD = 10n ** 18n;
const integer = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Clock difference allowed between the price source and the publisher, both ways. */
export const PRICE_CLOCK_TOLERANCE_MS = 60_000;
/** What a document must describe. `addresses`, when given, pins each symbol's token (lowercase). */
export type ReportProfile = { productId: string; pricingChainIndex: string; symbols: readonly string[]; addresses?: Readonly<Record<string, string>> };
const USTX_PROFILE: ReportProfile = { productId: XSTOCKS_PRODUCT.id, pricingChainIndex: "196", symbols: XSTOCKS_CONSTITUENTS.map(item => item.symbol) };

/** The live path always uses the pinned USTX profile. */
export function parseComposition(canonical: string): Composition { return parseReport(canonical, USTX_PROFILE); }

/** Explicit profile for offline examples; it never changes the live deployment. */
export function parseReport(canonical: string, profile: ReportProfile): Composition {
  if (canonical.length > 100_000) throw new Error("Report exceeds the supported size.");
  const doc: unknown = JSON.parse(canonical);
  if (!object(doc) || doc.productId !== profile.productId || doc.pricingChainIndex !== profile.pricingChainIndex
    || !date(doc.asOf) || !date(doc.basketFixedAt) || Date.parse(doc.basketFixedAt) > Date.parse(doc.asOf)
    || !integer(doc.navPerShareMicros) || !Array.isArray(doc.holdings) || doc.holdings.length !== profile.symbols.length) throw new Error("The composition is incomplete or belongs to another basket.");
  const symbols = new Set<string>();
  const addresses = new Set<string>();
  let weight = 0;
  for (const row of doc.holdings) {
    if (!object(row) || typeof row.symbol !== "string" || !profile.symbols.includes(row.symbol)
      || symbols.has(row.symbol) || typeof row.address !== "string" || !/^0x[0-9a-f]{40}$/i.test(row.address) || addresses.has(row.address.toLowerCase())
      || (profile.addresses && profile.addresses[row.symbol] !== row.address.toLowerCase())
      || !integer(row.unitsWad) || BigInt(row.unitsWad) === 0n || !integer(row.priceMicros) || BigInt(row.priceMicros) === 0n
      || !integer(row.valueMicros) || !Number.isInteger(row.weightBps) || Number(row.weightBps) < 0 || Number(row.weightBps) > 10_000
      || !date(row.priceTime) || Date.parse(row.priceTime) > Date.parse(doc.asOf) + 60_000 || typeof row.priceSource !== "string" || !row.priceSource) throw new Error("A holding has missing, duplicate or invalid fields.");
    symbols.add(row.symbol);
    addresses.add(row.address.toLowerCase());
    weight += Number(row.weightBps);
  }
  if (weight !== 10_000) throw new Error("Holding weights do not total 100%.");
  return doc as Composition;
}

export async function verifyComposition(canonical: string, record: OnchainNav): Promise<{ hash: Check; nav: Check; composition: Composition | null }> {
  return verifyReport(canonical, record, USTX_PROFILE, "chain");
}

/** Shared arithmetic and byte checks. Offline records are explicitly not chain evidence. */
export async function verifyReport(canonical: string, record: OnchainNav, profile: ReportProfile, source: "chain" | "example" = "example"): Promise<{ hash: Check; nav: Check; composition: Composition | null }> {
  const computedHash = await sha256Hex(canonical);
  const hash: Check = computedHash.toLowerCase() === record.holdingsHash.toLowerCase()
    ? { state: "pass", detail: source === "chain" ? "SHA-256 of the exact document bytes matches the hash read directly from the registry." : "The exact document bytes match the bundled example fingerprint; no chain read was performed." }
    : { state: "fail", detail: "The document bytes do not match the reference fingerprint." };
  let composition: Composition | null = null;
  try {
    composition = parseReport(canonical, profile);
    let total = 0n;
    for (const holding of composition.holdings) {
      const value = BigInt(holding.unitsWad) * BigInt(holding.priceMicros) / WAD;
      if (value !== BigInt(holding.valueMicros)) throw new Error(`${holding.symbol}: units × price does not match the stated holding value.`);
      total += value;
    }
    if (total !== BigInt(composition.navPerShareMicros) || total !== BigInt(record.navPerShareMicros)) throw new Error("Recalculated holdings do not sum to both the documented and reference NAV.");
    if (!record.effectiveAt || Math.floor(Date.parse(composition.asOf) / 1000) !== Math.floor(Date.parse(record.effectiveAt) / 1000)) throw new Error("The composition timestamp differs from the reference record.");
    // The record's time stands for its prices: none may be older than it, beyond a minute of clock difference.
    const oldest = Math.min(...composition.holdings.map((holding) => Date.parse(holding.priceTime)));
    if (oldest < Date.parse(composition.asOf) - PRICE_CLOCK_TOLERANCE_MS) throw new Error("A price in the document is older than the record's time.");
    // The registry only requires each record's time to be later than the last, so a record could claim
    // a future time that the fund and lending market would then treat as fresh; its block time bounds it.
    if (source === "chain" && record.publishedAt && Date.parse(record.effectiveAt) > Date.parse(record.publishedAt) + PRICE_CLOCK_TOLERANCE_MS) throw new Error("The record claims a time later than the block it was written in.");
    return { hash, nav: { state: "pass", detail: `All ${composition.holdings.length} units × price calculations, truncated to micro-dollars per holding, sum exactly to the document and ${source === "chain" ? "on-chain" : "example"} NAV. The effective timestamp also matches, and no price is older than it.` }, composition };
  } catch (error) {
    return { hash, nav: { state: "fail", detail: error instanceof Error ? error.message : "The NAV could not be recalculated." }, composition };
  }
}
