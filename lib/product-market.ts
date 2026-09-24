import { parseComposition } from "./xstocks/proof";
import type { Composition } from "./xstocks/basket";
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

export function currentWeights(composition: Composition | null): Map<string, number> {
  if (!composition) return new Map();
  const total = composition.holdings.reduce((sum, h) => sum + BigInt(h.valueMicros), 0n);
  return new Map(composition.holdings.map(h => [h.symbol, total > 0n ? Number(BigInt(h.valueMicros) * 1_000_000n / total) / 10_000 : 0]));
}

export function shortTime(value: string | null | undefined): string {
  return value && timestamp(value) ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Time unavailable";
}
