import { stableJson } from "../engine/fixed";
import type { ReportProfile } from "./proof";

// Synthetic, versioned fixtures. Addresses and prices are illustrative, not market data.
export const EXAMPLE_SCHEMA = "ganymede-report-example/v1";
export const REPORT_EXAMPLES = [
  { id: "example-two", name: "Two-stock model", prices: [100_000_000, 200_000_000], units: [1, 2] },
  { id: "example-three", name: "Three-stock model", prices: [80_000_000, 120_000_000, 50_000_000], units: [2, 1, 3] },
].map(example => {
  const profile: ReportProfile = { productId: example.id, pricingChainIndex: "196", symbols: example.prices.map((_, i) => `DEMO${i + 1}`) };
  const holdings = example.prices.map((price, i) => ({
    symbol: profile.symbols[i], address: "0x" + String(i + 1).repeat(40),
    weightBps: Math.floor(10000 / example.prices.length) + (i < 10000 % example.prices.length ? 1 : 0),
    unitsWad: (BigInt(example.units[i]) * 10n ** 18n).toString(), priceMicros: String(price),
    valueMicros: String(price * example.units[i]), priceTime: "2026-09-24T00:00:00Z", priceSource: "synthetic-example",
  }));
  const document = { productId: example.id, pricingChainIndex: "196", asOf: "2026-09-24T00:00:00Z", basketFixedAt: "2026-09-24T00:00:00Z", navPerShareMicros: holdings.reduce((sum, row) => sum + BigInt(row.valueMicros), 0n).toString(), holdings };
  return { schema: EXAMPLE_SCHEMA, name: example.name, profile, canonical: stableJson(document), document };
});
