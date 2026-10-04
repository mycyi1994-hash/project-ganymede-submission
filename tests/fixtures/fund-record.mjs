import { otherFund, fundConstituents, universeToken } from "../../lib/funds/catalog.ts";
import { evaluateBasket } from "../../lib/xstocks/basket.ts";

/** A real composition and hash with synthetic prices; no live chain or price source. */
export async function fundFixture(id = "ai-chips", at = "2026-10-04T03:00:00.000Z") {
  const definition = otherFund(id);
  const constituents = fundConstituents(definition);
  const quotes = new Map(constituents.map(row => [row.symbol, { symbol: row.symbol, address: row.address, priceMicros: 100_000_000n, time: at, source: "test fixture" }]));
  const evaluated = await evaluateBasket({ constituents, quotes, previous: null, now: at, maxQuoteAgeMinutes: 10, product: { id, inceptionNavMicros: 100_000_000n } });
  const seconds = Math.floor(Date.parse(at) / 1000);
  const chainAt = new Date(seconds * 1000).toISOString();
  const record = { navPerShareMicros: evaluated.composition.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: evaluated.holdingsHash, effectiveAt: chainAt, publishedAt: chainAt };
  const fund = {
    ...definition,
    holdings: definition.constituents.map(symbol => universeToken(symbol)),
    nav: { perShareMicros: record.navPerShareMicros, asOf: at, txHash: null },
    changePercent: 0, series: [[Date.parse(at) / 1000, record.navPerShareMicros]],
    history: [{ ...record, asOf: at, canonical: evaluated.canonical, status: "confirmed", txHash: null }],
    latest: null, rebalance: null, demo: { sharesMicros: "0", investors: 0 },
  };
  const word = value => BigInt(value).toString(16).padStart(64, "0");
  const encoded = "0x" + word(record.navPerShareMicros) + word(0) + record.holdingsHash.slice(2) + word(seconds) + word(seconds);
  return { fund, record, encoded };
}
