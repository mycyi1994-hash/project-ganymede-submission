import { parseComposition } from "./xstocks/proof";
import { XSTOCKS_PRODUCT, type Composition } from "./xstocks/basket";
import type { OnchainNav } from "./xstocks/onchain";

export type MarketPublication = { asOf: string; navPerShareMicros: string; holdingsHash: string; canonical: string; status: string; txHash: string | null; error?: string | null };
export type MarketSnapshot = {
  product: { id: string; ticker: string; name: string };
  pricing: { chainIndex: string; name: string; explorerUrl: string; maxQuoteAgeMinutes?: number; constituents: Array<{ symbol: string; name: string; address: string | null }> };
  registry: { chainId: number; chainName: string; address: string | null; explorerUrl: string };
  latest: { evaluatedAt: string; status: string; canonical: string | null; composition: Composition | null; warnings: string[]; blockers: string[]; publication: MarketPublication | null } | null;
  history: MarketPublication[];
  onchain: OnchainNav | null;
  onchainError: string | null;
  /** Confirmed publications as [seconds, NAV micros], possibly thinned; older responses omit it. */
  series?: [number, string][];
  /** Confirmed publications in the stored series before thinning. */
  seriesCount?: number;
};
const integer = (s: unknown): s is string => typeof s === "string" && /^(0|[1-9]\d{0,77})$/.test(s);
const timestamp = (s: unknown): s is string => typeof s === "string" && Number.isFinite(Date.parse(s));
const hash = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-f]{64}$/i.test(s);
export function decodeMarketSnapshot(value: unknown): MarketSnapshot {
  if (!value || typeof value !== "object") throw new Error("The market response is unavailable.");
  const data = value as MarketSnapshot;
  if (data.product?.id !== "us-tech-x" || !data.pricing || !Array.isArray(data.pricing.constituents)
    || !data.registry || !Array.isArray(data.history)) throw new Error("The market response is incomplete.");
  if (data.onchain && (!integer(data.onchain.navPerShareMicros) || !hash(data.onchain.holdingsHash)
    || (data.onchain.effectiveAt !== null && !timestamp(data.onchain.effectiveAt)))) throw new Error("The published value is invalid.");
  const publication = (entry: MarketPublication | null) => Boolean(entry && timestamp(entry.asOf) && integer(entry.navPerShareMicros) && hash(entry.holdingsHash) && typeof entry.canonical === "string" && typeof entry.status === "string" && (entry.txHash === null || hash(entry.txHash)));
  if (data.history.some(entry => !publication(entry)) || (data.latest?.publication && !publication(data.latest.publication))) throw new Error("The publication history is invalid.");
  if (data.latest && (!timestamp(data.latest.evaluatedAt) || typeof data.latest.status !== "string" || !Array.isArray(data.latest.warnings) || !data.latest.warnings.every(item => typeof item === "string") || !Array.isArray(data.latest.blockers) || !data.latest.blockers.every(item => typeof item === "string"))) throw new Error("The latest market evaluation is invalid.");
  if (data.pricing.maxQuoteAgeMinutes !== undefined && (!Number.isFinite(data.pricing.maxQuoteAgeMinutes) || data.pricing.maxQuoteAgeMinutes < 0)) throw new Error("The pricing policy is invalid.");
  if (data.series !== undefined && (!Array.isArray(data.series) || !data.series.every(point => Array.isArray(point) && point.length === 2 && Number.isSafeInteger(point[0]) && point[0] > 0 && integer(point[1])))) throw new Error("The NAV series is invalid.");
  if (data.seriesCount !== undefined && (!Number.isSafeInteger(data.seriesCount) || data.seriesCount < 0)) throw new Error("The NAV series is invalid.");
  return data;
}

/** Match the displayed record, never fall back to a newer unpublished composition. */
export function compositionForRecord(data: MarketSnapshot, record = data.onchain): Composition | null {
  if (!record?.effectiveAt) return null;
  const publication = [data.latest?.publication, ...data.history].find(entry => entry?.holdingsHash?.toLowerCase() === record.holdingsHash.toLowerCase());
  if (!publication) return null;
  try {
    const doc = parseComposition(publication.canonical);
    if (doc.navPerShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(doc.asOf) / 1000) !== Math.floor(Date.parse(record.effectiveAt) / 1000)) return null;
    return doc;
  } catch { return null; }
}

export type HistoryPoint = { at: string; micros: string; hash: string };
/** Publication history, not stock-market returns. No interpolation, fabricated range or unconfirmed points. */
export function publicationHistory(data: MarketSnapshot): HistoryPoint[] {
  const unique = new Map<string, HistoryPoint>();
  // The long series has no document hashes; exact recent records below replace its points.
  for (const [seconds, micros] of data.series ?? []) unique.set(String(seconds), { at: new Date(seconds * 1000).toISOString(), micros, hash: "" });
  for (const entry of data.history) {
    if (entry.status !== "confirmed" || !timestamp(entry.asOf) || !integer(entry.navPerShareMicros) || !hash(entry.holdingsHash)) continue;
    unique.set(String(Math.floor(Date.parse(entry.asOf) / 1000)), { at: entry.asOf, micros: entry.navPerShareMicros, hash: entry.holdingsHash });
  }
  const record = data.onchain;
  if (record?.effectiveAt && !data.onchainError && timestamp(record.effectiveAt) && integer(record.navPerShareMicros)) {
    unique.set(String(Math.floor(Date.parse(record.effectiveAt) / 1000)), { at: record.effectiveAt, micros: record.navPerShareMicros, hash: record.holdingsHash });
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Records the chart covers, counting series points that thinning left out of the response. */
export function publishedRecordCount(data: MarketSnapshot, points: HistoryPoint[]): number {
  const last = data.series?.at(-1)?.[0];
  if (data.seriesCount === undefined || last === undefined) return points.length;
  const newer = points.filter(point => Math.floor(Date.parse(point.at) / 1000) > last).length;
  return Math.max(points.length, data.seriesCount + newer);
}

export function currentWeights(composition: Composition | null): Map<string, number> {
  if (!composition) return new Map();
  const total = composition.holdings.reduce((sum, h) => sum + BigInt(h.valueMicros), 0n);
  return new Map(composition.holdings.map(h => [h.symbol, total > 0n ? Number(BigInt(h.valueMicros) * 1_000_000n / total) / 10_000 : 0]));
}

/**
 * The NAV per share when the basket's units were fixed: the record published at that second, or the
 * inception NAV when the basket was fixed at launch, before the first record. Null if neither is known.
 */
export function navAtFixing(composition: Composition, points: HistoryPoint[]): bigint | null {
  const fixed = Math.floor(Date.parse(composition.basketFixedAt) / 1000);
  if (!Number.isFinite(fixed)) return null;
  const record = points.find(point => Math.floor(Date.parse(point.at) / 1000) === fixed);
  if (record) return BigInt(record.micros);
  return points.length && fixed <= Math.floor(Date.parse(points[0].at) / 1000) ? XSTOCKS_PRODUCT.inceptionNavMicros : null;
}

export type ConstituentFigures = {
  symbol: string;
  address: string;
  priceMicros: bigint;
  priceTime: string;
  /** Token units in one USTX share, 1e-18 fixed point. */
  unitsWad: bigint;
  /** What those units are worth at the price: this asset's part of the NAV per share. */
  valueMicros: bigint;
  /** Its share of the NAV now, and the equal-weight target the units were fixed to, in percent. */
  weightPercent: number;
  targetPercent: number;
  /** The price the units were fixed at, and the change since; null without the NAV at the fixing. */
  fixingPriceMicros: bigint | null;
  changePercent: number | null;
};

const WAD = 10n ** 18n;

/**
 * Each holding of the composition as a customer reads it. Units were fixed as
 * navAtFixing × weight / price, so the fixing price is navAtFixing × weight / units.
 */
export function constituentFigures(composition: Composition, fixingNavMicros: bigint | null): ConstituentFigures[] {
  const weights = currentWeights(composition);
  return composition.holdings.map(holding => {
    const unitsWad = BigInt(holding.unitsWad);
    const priceMicros = BigInt(holding.priceMicros);
    const fixingPriceMicros = fixingNavMicros !== null && unitsWad > 0n ? fixingNavMicros * BigInt(holding.weightBps) * WAD / (10_000n * unitsWad) : null;
    const changePercent = fixingPriceMicros !== null && fixingPriceMicros > 0n ? Number((priceMicros - fixingPriceMicros) * 1_000_000n / fixingPriceMicros) / 10_000 : null;
    return {
      symbol: holding.symbol, address: holding.address, priceMicros, priceTime: holding.priceTime, unitsWad, valueMicros: BigInt(holding.valueMicros),
      // Equal weight: basis points round to 1667 or 1666 each, the target is a sixth.
      weightPercent: weights.get(holding.symbol) ?? 0, targetPercent: 100 / composition.holdings.length, fixingPriceMicros, changePercent,
    };
  });
}

/** The next five-minute boundary after `at`, when the scheduled job records the next NAV. */
export function nextRecordAt(at: string, periodMs = 300_000): number {
  const time = Date.parse(at);
  return Number.isFinite(time) ? (Math.floor(time / periodMs) + 1) * periodMs : 0;
}

/** "4:05" for a wait in milliseconds, rounded up to the second; never negative. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function shortTime(value: string | null | undefined): string {
  return value && timestamp(value) ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Time unavailable";
}

/** Change from the first recorded NAV to the latest, as a percentage of the first. */
export function sinceFirstRecord(points: HistoryPoint[]): { first: HistoryPoint; last: HistoryPoint; percent: number } | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const base = BigInt(first.micros);
  if (base <= 0n) return null;
  return { first, last, percent: Number((BigInt(last.micros) - base) * 1_000_000n / base) / 10_000 };
}

/** "+1.23%", "−0.40%" or "0.00%", with a true minus sign. */
export function signedPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? "0.00%" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(2)}%`;
}

/** "just now", "12 min ago", "3 h ago", or the date for anything older than a day. */
export function relativeTime(value: string, now: number): string {
  const elapsed = now - Date.parse(value);
  if (!now || !Number.isFinite(elapsed) || elapsed < 0) return shortTime(value);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h ago`;
  return shortTime(value);
}
