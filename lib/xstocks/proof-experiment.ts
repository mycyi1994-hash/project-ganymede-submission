import { sha256Hex, stableJson } from "../engine/fixed";
import { parseComposition, type Check } from "./proof";
import type { OnchainNav } from "./onchain";

const WAD = 10n ** 18n;
const ONE_DOLLAR = 1_000_000n;
const holdingValue = (unitsWad: string, priceMicros: string | bigint) => BigInt(unitsWad) * BigInt(priceMicros) / WAD;

/** Local copy only: preserve all other values so the real verifier detects the change. */
export function changedPriceCopy(canonical: string) {
  const document = parseComposition(canonical);
  const holding = document.holdings[0];
  const originalPrice = holding.priceMicros;
  holding.priceMicros = (BigInt(originalPrice) + ONE_DOLLAR).toString();
  return { canonical: stableJson(document), symbol: holding.symbol, originalPrice, changedPrice: holding.priceMicros };
}

export type EditKind = "price" | "consistent" | "compensated";
export type EditedCopy = { kind: EditKind; canonical: string; changes: { symbol: string; from: string; to: string }[] };

/** Raises the first price by $1 and leaves every other field, so the row no longer adds up. */
export function priceEditCopy(canonical: string): EditedCopy {
  const copy = changedPriceCopy(canonical);
  return { kind: "price", canonical: copy.canonical, changes: [{ symbol: copy.symbol, from: copy.originalPrice, to: copy.changedPrice }] };
}

/** Raises the first price by $1 and rewrites its value and the document NAV, so every row adds up. */
export function consistentEditCopy(canonical: string): EditedCopy {
  const document = parseComposition(canonical);
  const holding = document.holdings[0];
  const from = holding.priceMicros;
  holding.priceMicros = (BigInt(from) + ONE_DOLLAR).toString();
  holding.valueMicros = holdingValue(holding.unitsWad, holding.priceMicros).toString();
  document.navPerShareMicros = document.holdings.reduce((sum, row) => sum + BigInt(row.valueMicros), 0n).toString();
  return { kind: "consistent", canonical: stableJson(document), changes: [{ symbol: holding.symbol, from, to: holding.priceMicros }] };
}

/**
 * Raises the first price by $1 and lowers the second until its value falls by exactly the
 * same amount. Every row adds up and the NAV is unchanged; only the document bytes differ.
 * Returns null when the second holding's units are too large for an exact integer match.
 */
export function compensatedEditCopy(canonical: string): EditedCopy | null {
  const document = parseComposition(canonical);
  const [first, second] = document.holdings;
  const units = BigInt(second.unitsWad);
  const firstFrom = first.priceMicros;
  const secondFrom = second.priceMicros;
  const raised = BigInt(firstFrom) + ONE_DOLLAR;
  const raisedValue = holdingValue(first.unitsWad, raised);
  const target = BigInt(second.valueMicros) - (raisedValue - BigInt(first.valueMicros));
  // With fewer than one whole token, each price micro moves the value by under one micro.
  if (target <= 0n || units === 0n || units >= WAD) return null;
  const price = (target * WAD + units - 1n) / units;
  if (price <= 0n || holdingValue(second.unitsWad, price) !== target) return null;
  first.priceMicros = raised.toString();
  first.valueMicros = raisedValue.toString();
  second.priceMicros = price.toString();
  second.valueMicros = target.toString();
  return { kind: "compensated", canonical: stableJson(document), changes: [{ symbol: first.symbol, from: firstFrom, to: first.priceMicros }, { symbol: second.symbol, from: secondFrom, to: second.priceMicros }] };
}

export type LayeredChecks = { fingerprint: Check; arithmetic: Check; record: Check };

/**
 * Splits verification into the three things an edit can break, for the experiment only.
 * The live verdict still comes from verifyComposition.
 */
export async function layeredChecks(canonical: string, record: OnchainNav): Promise<LayeredChecks> {
  const fingerprint: Check = (await sha256Hex(canonical)).toLowerCase() === record.holdingsHash.toLowerCase()
    ? { state: "pass", detail: "The SHA-256 of these bytes equals the fingerprint recorded on X Layer." }
    : { state: "fail", detail: "These bytes give a different fingerprint from the one recorded on X Layer." };
  let document;
  try { document = parseComposition(canonical); } catch (error) {
    const detail = error instanceof Error ? error.message : "The document could not be read.";
    return { fingerprint, arithmetic: { state: "fail", detail }, record: { state: "fail", detail } };
  }
  let arithmetic: Check = { state: "pass", detail: "Each row's units × price equals its stated value, and the rows sum to the document NAV." };
  let total = 0n;
  for (const row of document.holdings) {
    total += BigInt(row.valueMicros);
    if (arithmetic.state === "pass" && holdingValue(row.unitsWad, row.priceMicros) !== BigInt(row.valueMicros)) arithmetic = { state: "fail", detail: `${row.symbol}: units × price no longer equals the stated value.` };
  }
  if (arithmetic.state === "pass" && total !== BigInt(document.navPerShareMicros)) arithmetic = { state: "fail", detail: "The rows do not sum to the document NAV." };
  const sameTime = Boolean(record.effectiveAt) && Math.floor(Date.parse(document.asOf) / 1000) === Math.floor(Date.parse(record.effectiveAt ?? "") / 1000);
  const recordCheck: Check = BigInt(document.navPerShareMicros) === BigInt(record.navPerShareMicros) && sameTime
    ? { state: "pass", detail: "The document NAV and time equal the X Layer record." }
    : { state: "fail", detail: sameTime ? "The document NAV differs from the NAV recorded on X Layer." : "The document time differs from the X Layer record." };
  return { fingerprint, arithmetic, record: recordCheck };
}
