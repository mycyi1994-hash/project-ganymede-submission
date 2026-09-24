import { stableJson } from "../engine/fixed";
import { parseComposition } from "./proof";

/** Local copy only: preserve all other values so the real verifier detects the change. */
export function changedPriceCopy(canonical: string) {
  const document = parseComposition(canonical);
  const holding = document.holdings[0];
  const originalPrice = holding.priceMicros;
  holding.priceMicros = (BigInt(originalPrice) + 1_000_000n).toString();
  return { canonical: stableJson(document), symbol: holding.symbol, originalPrice, changedPrice: holding.priceMicros };
}
