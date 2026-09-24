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

/** Validate before rendering or doing arithmetic on a supplied document. */
export function parseComposition(canonical: string): Composition {
  const doc: unknown = JSON.parse(canonical);
  if (!object(doc) || doc.productId !== XSTOCKS_PRODUCT.id || doc.pricingChainIndex !== "196"
    || !date(doc.asOf) || !date(doc.basketFixedAt) || Date.parse(doc.basketFixedAt) > Date.parse(doc.asOf)
    || !integer(doc.navPerShareMicros) || !Array.isArray(doc.holdings) || doc.holdings.length !== XSTOCKS_CONSTITUENTS.length) throw new Error("The composition is incomplete or belongs to another basket.");
  const symbols = new Set<string>();
  const addresses = new Set<string>();
  let weight = 0;
  for (const row of doc.holdings) {
    if (!object(row) || typeof row.symbol !== "string" || !XSTOCKS_CONSTITUENTS.some((item) => item.symbol === row.symbol)
      || symbols.has(row.symbol) || typeof row.address !== "string" || !/^0x[0-9a-f]{40}$/i.test(row.address) || addresses.has(row.address.toLowerCase())
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
  const computedHash = await sha256Hex(canonical);
  const hash: Check = computedHash.toLowerCase() === record.holdingsHash.toLowerCase()
    ? { state: "pass", detail: "SHA-256 of the exact document bytes matches the hash read directly from the registry." }
    : { state: "fail", detail: "The document bytes do not match the registry's holdings hash." };
  let composition: Composition | null = null;
  try {
    composition = parseComposition(canonical);
    let total = 0n;
    for (const holding of composition.holdings) {
      const value = BigInt(holding.unitsWad) * BigInt(holding.priceMicros) / WAD;
      if (value !== BigInt(holding.valueMicros)) throw new Error(`${holding.symbol}: units × price does not match the stated holding value.`);
      total += value;
    }
    if (total !== BigInt(composition.navPerShareMicros) || total !== BigInt(record.navPerShareMicros)) throw new Error("Recalculated holdings do not sum to both the documented and on-chain NAV.");
    if (!record.effectiveAt || Math.floor(Date.parse(composition.asOf) / 1000) !== Math.floor(Date.parse(record.effectiveAt) / 1000)) throw new Error("The composition timestamp differs from the registry record.");
    return { hash, nav: { state: "pass", detail: "All six units × price calculations, truncated to micro-dollars per holding, sum exactly to the document and on-chain NAV. The effective timestamp also matches." }, composition };
  } catch (error) {
    return { hash, nav: { state: "fail", detail: error instanceof Error ? error.message : "The NAV could not be recalculated." }, composition };
  }
}
