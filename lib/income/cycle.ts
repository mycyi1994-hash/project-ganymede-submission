/**
 * The income products (lib/funds/catalog.ts INCOME_FUNDS), recorded every five minutes in the funds
 * cycle from the same OnchainOS prices: each product steps its model (lib/income/covered-call.ts,
 * lib/income/autocall.ts), and its NAV and the fingerprint of its document go to GanymedeNavRegistry
 * under its own product key, as the basket funds' do. When a note is called or matures, its holders
 * are paid at the recorded NAV once that record is confirmed, and it is recorded no more.
 */
import type { EngineRepository } from "../engine/repository";
import type { SettlementClient } from "../engine/settlement";
import { sha256Hex } from "../engine/fixed";
import type { Quote } from "../xstocks/basket";
import type { Publication } from "../xstocks/cycle";
import { POOL_TOLERANCE, type PoolPrices } from "../xstocks/pool-prices";
import { INCOME_FUNDS, universeToken } from "../funds/catalog";
import { fundStateKey, HISTORY_LIMIT, navRequest, read, recordConfirmed, type FundLatest } from "../funds/cycle";
import type { FundDemoLedger } from "../funds/demo";
import { stepAutocall, type AutocallState } from "./autocall";
import { stepCoveredCall, type CoveredCallState } from "./covered-call";
import { INCOME_TERMS } from "./terms";

export const incomeModelKey = (id: string) => `fund:${id}:model`;

/**
 * SPYx and QQQx both have deep X Layer pools: a price more than 1% from its pool holds a record back,
 * as it does for the US Core Index. Without a pool read, the record goes ahead.
 */
export function poolBlocker(quotes: Quote[], pools: PoolPrices | null): string | null {
  if (!pools) return null;
  for (const quote of quotes) {
    const pool = pools.prices.find((price) => price.symbol === quote.symbol && price.token === quote.address.toLowerCase());
    if (!pool) continue;
    const bps = Number((BigInt(pool.priceMicros) - quote.priceMicros) * 10_000n / quote.priceMicros);
    if (Math.abs(bps) > POOL_TOLERANCE.navBps) return `The ${quote.symbol} pool on X Layer is ${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(2)}% from its OnchainOS price, beyond ${POOL_TOLERANCE.navBps / 100}%`;
  }
  return null;
}

export async function runIncomeCycle(repo: EngineRepository, settlement: SettlementClient, demo: FundDemoLedger, quotes: Map<string, Quote>, now: string, maxQuoteAgeMinutes: number, pools: PoolPrices | null = null): Promise<{ published: number; warnings: string[] }> {
  const warnings: string[] = [];
  let published = 0;
  for (const fund of INCOME_FUNDS) {
    try {
      const terms = INCOME_TERMS[fund.id];
      const blockers: string[] = [];
      const priced = fund.constituents.map((symbol) => quotes.get(symbol));
      if (priced.some((quote) => !quote)) blockers.push(`No OnchainOS price for ${fund.constituents.filter((_, index) => !priced[index]).join(", ")}`);
      const fresh = priced.filter((quote): quote is Quote => Boolean(quote));
      // A record's time is its oldest price, as for the baskets.
      const asOf = fresh.length ? new Date(Math.min(...fresh.map((quote) => Date.parse(quote.time)))).toISOString() : now;
      if (fresh.length && Date.parse(now) - Date.parse(asOf) > maxQuoteAgeMinutes * 60_000) blockers.push(`The OnchainOS price is older than ${maxQuoteAgeMinutes} minutes`);
      const disagrees = poolBlocker(fresh, pools);
      if (disagrees) blockers.push(disagrees);
      const confirmed = await read<Publication | null>(repo, fundStateKey(fund.id, "confirmed"), null);
      if (!blockers.length && confirmed && Math.floor(Date.parse(asOf) / 1000) <= Math.floor(Date.parse(confirmed.asOf) / 1000)) blockers.push("No price is newer than the last NAV record");
      const prices = Object.fromEntries(fresh.map((quote) => [quote.symbol, Number(quote.priceMicros) / 1e6]));

      let document: object | null = null;
      let model: object | null = null;
      let ended = false;
      if (!blockers.length && terms.kind === "covered-call") {
        const previous = await read<CoveredCallState | null>(repo, incomeModelKey(fund.id), null);
        const step = stepCoveredCall(fund.id, terms, previous, { price: prices[terms.underlying], time: asOf, address: universeToken(terms.underlying)!.address });
        document = step.document; model = step.state;
      } else if (!blockers.length && terms.kind === "autocall") {
        const previous = await read<AutocallState | null>(repo, incomeModelKey(fund.id), null);
        if (previous && previous.status !== "live") {
          // Settled: holders are paid once its record is confirmed; nothing more is recorded.
          if (confirmed && BigInt(confirmed.navPerShareMicros) === BigInt(Math.round((previous.payout ?? 0) * 1e6))) {
            await demo.settleAll(fund.id, { navMicros: BigInt(confirmed.navPerShareMicros), effectiveAt: confirmed.asOf, holdingsHash: confirmed.holdingsHash });
          }
          ended = true;
        } else {
          const step = stepAutocall(fund.id, terms, previous, prices, asOf);
          if (!step) blockers.push("The note fixes its starting levels at its first record after the fixing date");
          else { document = step.document; model = step.state; }
        }
      }

      let publication: Publication | null = null;
      if (document && model) {
        const canonical = JSON.stringify(document);
        const holdingsHash = await sha256Hex(canonical);
        const navPerShareMicros = (document as { navPerShareMicros: string }).navPerShareMicros;
        await repo.setState(incomeModelKey(fund.id), JSON.stringify(model));
        const sharesOutstandingMicros = await demo.sharesOutstanding(fund.id).catch(() => "0");
        const pending: Publication = { asOf, calculatedAt: now, navPerShareMicros, sharesOutstandingMicros, holdingsHash, canonical, status: "queued", txHash: null, error: null };
        // The document is stored before the transaction, so an on-chain hash always has its document.
        const history = (await read<Publication[]>(repo, fundStateKey(fund.id, "history"), [])).filter((entry) => entry.holdingsHash !== holdingsHash);
        await repo.setState(fundStateKey(fund.id, "history"), JSON.stringify([pending, ...history].slice(0, HISTORY_LIMIT)));
        const request = navRequest(fund.id, pending);
        const result = await settlement.settle(request);
        await repo.saveSettlement(request, result);
        publication = { ...pending, status: result.status, txHash: result.txHash, error: result.error };
        await repo.setState(fundStateKey(fund.id, "history"), JSON.stringify([publication, ...history].slice(0, HISTORY_LIMIT)));
        if (result.status === "confirmed") {
          await recordConfirmed(repo, fund.id, publication);
          published += 1;
          const state = model as Partial<AutocallState>;
          if (terms.kind === "autocall" && state.status && state.status !== "live") {
            await demo.settleAll(fund.id, { navMicros: BigInt(navPerShareMicros), effectiveAt: asOf, holdingsHash });
          }
        }
        if (result.error) warnings.push(`${fund.ticker} NAV publication: ${result.error}`);
      } else if (!ended) {
        warnings.push(...blockers.map((blocker) => `${fund.ticker} not published: ${blocker}`));
      }
      if (!ended) {
        const latest: FundLatest = { evaluatedAt: now, status: document ? "priced" : "awaiting_prices", blockers, warnings: [], composition: null, publication, poolCheck: null };
        await repo.setState(fundStateKey(fund.id, "latest"), JSON.stringify(latest));
      }
    } catch (error) {
      warnings.push(`${fund.ticker} cycle failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { published, warnings };
}
