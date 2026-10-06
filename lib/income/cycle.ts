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
import { stepAutocall, type AutocallState } from "./autocall";
import { stepCoveredCall, type CoveredCallState } from "./covered-call";
import { INCOME_TERMS } from "./terms";
import { isIncomeTransition, transitionLabel } from "./transitions";

export const incomeModelKey = (id: string) => `fund:${id}:model`;

/**
 * SPYx and QQQx both have deep X Layer pools: a price more than 1% from its pool holds a record back,
 * as it does for the US Core Index. Without a pool read, the record goes ahead.
 */
export function poolBlocker(quotes: Quote[], pools: PoolPrices | null): string | null {
  if (!pools) return null;
  for (const quote of quotes) {
    const pool = pools.prices.find((price) => price.symbol === quote.symbol && price.token === quote.address.toLowerCase());
    // A price of zero or less is refused before this (quoteBlockers).
    if (!pool || quote.priceMicros <= 0n) continue;
    const bps = Number((BigInt(pool.priceMicros) - quote.priceMicros) * 10_000n / quote.priceMicros);
    if (Math.abs(bps) > POOL_TOLERANCE.navBps) return `The ${quote.symbol} pool on X Layer is ${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(2)}% from its OnchainOS price, beyond ${POOL_TOLERANCE.navBps / 100}%`;
  }
  return null;
}

/**
 * The prices the baskets refuse (lib/xstocks/basket.ts) are refused here too: zero or less, quoted
 * for another token, or stamped more than a minute after the cycle. A model steps on every record,
 * so one such price would change it for good: a knock-in, an early observation or a roll.
 */
export function quoteBlockers(quotes: Quote[], now: string): string[] {
  return quotes.flatMap((quote) => {
    if (quote.priceMicros <= 0n) return [`Non-positive price for ${quote.symbol}`];
    if (quote.address.toLowerCase() !== universeToken(quote.symbol)?.address.toLowerCase()) return [`Price address mismatch for ${quote.symbol}`];
    if (!Number.isFinite(Date.parse(quote.time)) || Date.parse(quote.time) > Date.parse(now) + 60_000) return [`Invalid price timestamp for ${quote.symbol}`];
    return [];
  });
}

/**
 * The newest record that decided something (a sale, the fixing, a knock-in or an observation) when
 * it is not confirmed and nothing after it is. The model has already moved past it, so it goes on
 * chain before any later record: every record then rests on records on X Layer. One at or before the
 * confirmed record can no longer be sent (the registry takes only later times), and is left; so is a
 * simulated one, where no relayer is configured and nothing goes on chain.
 */
export function unconfirmedTransition(history: Publication[], confirmed: Publication | null): Publication | null {
  for (const entry of history) {
    if (confirmed && Date.parse(entry.asOf) <= Date.parse(confirmed.asOf)) return null;
    let document: unknown = null;
    try { document = JSON.parse(entry.canonical); } catch { continue; }
    if (isIncomeTransition(document)) return entry.status === "confirmed" || entry.status === "simulated" ? null : entry;
  }
  return null;
}

/**
 * That record sent again when the relayer refused it, and kept as confirmed once it is. One still
 * queued or submitted is asked about again by the funds cycle's reconcile, under its own key.
 */
async function resendTransition(repo: EngineRepository, settlement: SettlementClient, fundId: string, history: Publication[], entry: Publication): Promise<{ confirmed: boolean; error: string | null }> {
  if (entry.status !== "failed") return { confirmed: false, error: null };
  const request = navRequest(fundId, entry);
  const result = await settlement.settle(request);
  await repo.saveSettlement(request, result);
  Object.assign(entry, { status: result.status, txHash: result.txHash ?? entry.txHash, error: result.error });
  await repo.setState(fundStateKey(fundId, "history"), JSON.stringify(history));
  if (result.status !== "confirmed") return { confirmed: false, error: result.error };
  await recordConfirmed(repo, fundId, entry);
  return { confirmed: true, error: null };
}

export async function runIncomeCycle(repo: EngineRepository, settlement: SettlementClient, quotes: Map<string, Quote>, now: string, maxQuoteAgeMinutes: number, pools: PoolPrices | null = null): Promise<{ published: number; warnings: string[] }> {
  const warnings: string[] = [];
  let published = 0;
  for (const fund of INCOME_FUNDS) {
    try {
      const terms = INCOME_TERMS[fund.id];
      const blockers: string[] = [];
      const priced = fund.constituents.map((symbol) => quotes.get(symbol));
      if (priced.some((quote) => !quote)) blockers.push(`No OnchainOS price for ${fund.constituents.filter((_, index) => !priced[index]).join(", ")}`);
      const fresh = priced.filter((quote): quote is Quote => Boolean(quote));
      const refused = quoteBlockers(fresh, now);
      blockers.push(...refused);
      // A record's time is its oldest price, as for the baskets, and never later than the cycle.
      const asOf = fresh.length && !refused.length ? new Date(Math.min(Date.parse(now), ...fresh.map((quote) => Date.parse(quote.time)))).toISOString() : now;
      if (fresh.length && Date.parse(now) - Date.parse(asOf) > maxQuoteAgeMinutes * 60_000) blockers.push(`The OnchainOS price is older than ${maxQuoteAgeMinutes} minutes`);
      const disagrees = poolBlocker(fresh, pools);
      if (disagrees) blockers.push(disagrees);
      let confirmed = await read<Publication | null>(repo, fundStateKey(fund.id, "confirmed"), null);
      // A sale, fixing, knock-in or observation not yet on chain goes first (lib/income/transitions.ts).
      const recorded = await read<Publication[]>(repo, fundStateKey(fund.id, "history"), []);
      const waiting = unconfirmedTransition(recorded, confirmed);
      if (waiting) {
        const label = transitionLabel(JSON.parse(waiting.canonical));
        const sent = await resendTransition(repo, settlement, fund.id, recorded, waiting);
        if (sent.confirmed) { confirmed = waiting; published += 1; }
        else {
          if (sent.error) warnings.push(`${fund.ticker} ${label}: ${sent.error}`);
          blockers.unshift(`The ${label} at ${waiting.asOf} is not confirmed yet, and no later record is sent before it`);
        }
      }
      if (!blockers.length && confirmed && Math.floor(Date.parse(asOf) / 1000) <= Math.floor(Date.parse(confirmed.asOf) / 1000)) blockers.push("No price is newer than the last NAV record");
      const prices = Object.fromEntries(fresh.map((quote) => [quote.symbol, Number(quote.priceMicros) / 1e6]));

      let document: object | null = null;
      let model: object | null = null;
      let ended = false;
      if (!blockers.length && terms.kind === "covered-call") {
        const previous = await read<CoveredCallState | null>(repo, incomeModelKey(fund.id), null);
        const step = stepCoveredCall(fund.id, terms, previous, { price: prices[terms.underlying], time: asOf, address: universeToken(terms.underlying)!.address });
        document = step.document; model = step.state;
      } else if (terms.kind === "autocall") {
        const previous = await read<AutocallState | null>(repo, incomeModelKey(fund.id), null);
        if (previous && previous.status !== "live") {
          // Settled, whatever the prices now: nothing more is recorded. Its final record, if the
          // relayer refused it, was sent again above until it is confirmed.
          ended = true;
        } else if (!blockers.length) {
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
        // No shares are issued: the product's NAV is recorded, and investing in it is not open.
        const pending: Publication = { asOf, calculatedAt: now, navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash, canonical, status: "queued", txHash: null, error: null };
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
