import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { SettlementClient } from "@/lib/engine/settlement";
import { ToolInputError, type McpTool } from "@/lib/mcp/server";
import { STATE_CONFIRMED, STATE_DOCUMENT_PREFIX, STATE_HISTORY, type Publication } from "@/lib/xstocks/cycle";
import { FUND_DEPLOYMENT, FUND_MIN_INVESTMENT_MICROS, POOL_FEE_BPS, pricePerShare, routeOrder } from "@/lib/xstocks/fund";
import { readLiquidity } from "@/lib/xstocks/liquidity";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import { verifyComposition } from "@/lib/xstocks/proof";
import { V4_POOL_DEPLOYMENT, formatFeePips, readV4Quote } from "@/lib/xstocks/v4-liquidity";
import { GET as readNavApi } from "../api/v1/ustx/route";
import { GET as readPoolsApi } from "../api/v1/ustx/pools/route";
import { GET as readActivityApi } from "../api/v1/ustx/activity/route";
import { FUNDS, type FundDefinition } from "@/lib/funds/catalog";
import { fundSummaries, fundSummary } from "@/lib/funds/api";
import { fundStateKey } from "@/lib/funds/cycle";
import { sha256Hex } from "@/lib/engine/fixed";
import { coveredCallReturn, premiumYield, type CoveredCallDocument } from "@/lib/income/covered-call";
import { couponPayout, observationDate, type AutocallDocument } from "@/lib/income/autocall";
import { autocallTerms } from "@/lib/income/terms";
import { incomeTermsHold, recomputeIncomeNav, type IncomeDocument } from "@/lib/income/verify";

// The tools Ganymede's MCP server offers (lib/mcp/server.ts): reads of USTX on X Layer for AI
// agents, built on the public APIs and the same checks the Transparency page runs. None signs or
// writes. Demo dollars and USTX on X Layer Testnet have no value.

const ONE = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** "99.754470" from micros, six decimals; "-0.050500" below zero. */
const usd = (micros: bigint | string) => { const value = BigInt(micros); const size = value < 0n ? -value : value; return `${value < 0n ? "-" : ""}${size / ONE}.${(size % ONE).toString().padStart(6, "0")}`; };
const ustx = usd;
const NO_INPUT = { type: "object" as const, properties: {}, additionalProperties: false };
const DEMO = "X Layer Testnet with demo dollars (dUSD) that have no value. Not investment advice or an offer.";

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

/** The latest record on X Layer and the document it fingerprints, checked as the Transparency page checks it. */
async function verifiedRecord(): Promise<{ record: OnchainNav; publication: Publication | null; checks: Awaited<ReturnType<typeof verifyComposition>> | null; registry: string }> {
  const env = engineEnv();
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new Error("registry not configured");
  const settlement = new SettlementClient(env);
  const record = await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId });
  const repo = new EngineRepository(env.DB);
  const [history, confirmed, document] = await Promise.all([
    repo.getState(STATE_HISTORY), repo.getState(STATE_CONFIRMED), repo.getState(`${STATE_DOCUMENT_PREFIX}${record.holdingsHash}`),
  ]);
  const entries = [
    ...(history ? JSON.parse(history.value) as Publication[] : []),
    ...(confirmed ? [JSON.parse(confirmed.value) as Publication] : []),
    ...(document ? [JSON.parse(document.value) as Publication] : []),
  ];
  const publication = entries.find(entry => entry.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof entry.canonical === "string") ?? null;
  return { record, publication, checks: publication ? await verifyComposition(publication.canonical, record) : null, registry };
}

/** An amount argument: a positive number of at most six decimals, as micros. */
function amountMicros(value: unknown, label: string, min: bigint, max: bigint): bigint {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/[,$\s]/g, "") : "";
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new ToolInputError(`${label} must be a positive number with at most six decimals.`);
  const micros = BigInt(match[1]) * ONE + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micros < min || micros > max) throw new ToolInputError(`${label} must be between ${usd(min)} and ${usd(max)}.`);
  return micros;
}

const percent = (ratio: number, digits = 2) => Number((ratio * 100).toFixed(digits));
const DAY_MS = 86_400_000;

/** A product by its id or ticker, as list_funds names it. */
function fundByName(value: unknown): FundDefinition {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  const fund = FUNDS.find(item => item.id === name || item.ticker.toLowerCase() === name);
  if (!fund) throw new ToolInputError(`id must be one of ${FUNDS.map(item => `${item.id} (${item.ticker})`).join(", ")}.`);
  return fund;
}

/**
 * The product's latest confirmed record, read once so its NAV, time, transaction and document belong
 * together, whatever the records after it did; null if there is none or its document does not hash to it.
 */
async function confirmedRecord(repo: EngineRepository, fund: FundDefinition): Promise<{ record: Publication; document: unknown } | null> {
  const stored = await repo.getState(fundStateKey(fund.id, "confirmed"));
  try {
    const record = stored ? JSON.parse(stored.value) as Publication : null;
    if (!record?.canonical || (await sha256Hex(record.canonical)).toLowerCase() !== record.holdingsHash.toLowerCase()) return null;
    return { record, document: JSON.parse(record.canonical) };
  } catch {
    return null;
  }
}

/** What a product's latest document says, in a customer's terms: holdings, the month's call, or the note's levels. */
function describeDocument(fund: FundDefinition, document: unknown, nowMs: number): Record<string, unknown> {
  if (!document || typeof document !== "object") return { document: null };
  if (fund.kind === "covered-call") {
    const call = document as CoveredCallDocument;
    const yields = premiumYield(call);
    const consistent = incomeTermsHold(fund.id, call as IncomeDocument) && recomputeIncomeNav(fund.id, call as IncomeDocument)?.toString() === call.navPerShareMicros;
    return {
      etf: { symbol: call.underlying.symbol, priceUsd: call.underlying.price },
      call: {
        strikeUsd: call.call.strike, strikeAbovePricePercent: percent(call.call.strike / call.underlying.price - 1), soldAt: call.call.soldAt, expiresAt: call.call.expiresAt,
        daysLeft: Number(Math.max(0, (Date.parse(call.call.expiresAt) - nowMs) / DAY_MS).toFixed(1)),
        premiumThisMonthPercent: percent(yields.month), premiumAnnualizedPercent: percent(yields.annualized), callValueNowPercentOfFund: percent(call.units * call.call.value / (Number(call.navPerShareMicros) / 1e6)),
      },
      returnFromTodayToExpiryPercent: { etfDown10: percent(coveredCallReturn(call, -0.1)), etfFlat: percent(coveredCallReturn(call, 0)), etfUp10: percent(coveredCallReturn(call, 0.1)) },
      terms: { volatilityPercent: percent(call.terms.volatility, 1), ratePercent: percent(call.terms.rate, 1), strikeAbovePriceWhenSoldPercent: percent(call.terms.moneyness, 1), tenorDays: call.terms.tenorDays },
      howPriced: "The call is priced by Black–Scholes at the stated volatility and rate, as there is no options market for xStocks on X Layer. Above the strike the fund gives up the ETF's rise; below it, it keeps the premium.",
      documentConsistent: consistent,
    };
  }
  if (fund.kind === "autocall") {
    const note = document as AutocallDocument;
    const terms = autocallTerms(fund.id);
    if (!terms) return { document: null };
    const state = note.state;
    const consistent = incomeTermsHold(fund.id, note as IncomeDocument) && recomputeIncomeNav(fund.id, note as IncomeDocument)?.toString() === note.navPerShareMicros;
    return {
      status: state.status, fixedAt: state.fixedAt, subscriptionEndsAt: note.subscriptionEndsAt,
      indices: terms.underlyings.map(symbol => ({ symbol, startUsd: state.initial[symbol], nowUsd: note.prices[symbol], levelPercent: percent(note.performance[symbol]) })),
      worseIndexLevelPercent: percent(note.worst),
      knockIn: {
        levelPercent: percent(terms.knockIn, 0), hit: state.knockedIn, hitAt: state.knockedInAt, lowestWorseIndexPercent: percent(state.lowestWorst),
        furtherFallToKnockInPercent: state.knockedIn ? 0 : percent(Math.max(0, 1 - terms.knockIn / note.worst)),
      },
      nextObservation: note.nextObservation && {
        date: note.nextObservation.date, barrierPercent: percent(note.nextObservation.barrier, 0), paysPer100IfCalled: note.nextObservation.payIfCalled,
        worseIndexVsBarrierPoints: percent(note.worst - note.nextObservation.barrier),
      },
      schedule: terms.barriers.map((barrier, index) => ({
        observation: index + 1, date: observationDate(terms, state.fixedAt, index + 1), barrierPercent: percent(barrier, 0), paysPer100IfCalled: couponPayout(terms, index + 1),
        observed: state.observations[index] ? { worseIndexPercent: percent(state.observations[index].worst), called: state.observations[index].called } : null,
      })),
      atMaturityIfNeverCalled: `Pays $${couponPayout(terms, terms.barriers.length)} per $100 unless the note knocked in and the worse index ends below ${percent(terms.barriers[terms.barriers.length - 1], 0)}%; then it pays $100 times the worse index's level.`,
      payoutPer100: state.payout,
      documentConsistent: consistent,
    };
  }
  const basket = document as { asOf?: string; navPerShareMicros?: string; holdings?: Array<{ symbol: string; priceMicros: string; valueMicros: string; priceTime: string }> };
  const nav = basket.navPerShareMicros ? BigInt(basket.navPerShareMicros) : 0n;
  return {
    holdings: (basket.holdings ?? []).map(holding => ({
      symbol: holding.symbol, priceUsd: usd(holding.priceMicros), valuePerShareUsd: usd(holding.valueMicros),
      weightPercent: nav > 0n ? Number(BigInt(holding.valueMicros) * 10_000n / nav) / 100 : null, priceTime: holding.priceTime,
    })),
    rule: "Fixed units per share, equal weight when the basket was fixed; weights drift with prices.",
  };
}

export function ustxTools(origin: string): McpTool[] {
  const page = (path: string) => `${origin}${path}`;
  return [
    {
      name: "get_ustx_nav",
      title: "USTX NAV on X Layer",
      description: "The latest net asset value per USTX share, read from the NAV registry on X Layer at call time: the price per share, when its prices were taken, until when the fund accepts it, the shares outstanding, and the recording transaction. Prices come from OKX OnchainOS every five minutes.",
      inputSchema: NO_INPUT,
      run: async () => {
        const body = await json(await readNavApi(new Request(page("/api/v1/ustx"))));
        const nav = body.nav as Record<string, string>;
        const validUntil = Date.parse(nav.validUntil);
        return {
          ticker: "USTX", name: "US Tech Basket", constituents: (body.product as { constituents: string[] }).constituents,
          navUsd: nav.perShareUsd, effectiveAt: nav.effectiveAt, recordedAt: nav.recordedAt, validUntil: nav.validUntil,
          usableForOrders: Number.isFinite(validUntil) && Date.now() < validUntil, ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(nav.effectiveAt)) / 1000)),
          sharesOutstanding: ustx(nav.sharesOutstandingMicros), holdingsHash: nav.holdingsHash,
          record: body.record, pricedBy: "OKX OnchainOS", feed: body.feed,
          verifyYourself: page("/products/ustx/transparency"), environment: DEMO,
        };
      },
    },
    {
      name: "verify_ustx_nav",
      title: "Verify the USTX NAV record",
      description: "Checks the latest USTX record on X Layer against its document: the SHA-256 of the document's exact bytes must equal the fingerprint in the registry, every holding's units × price must add up exactly to the recorded NAV, and no price may be older than the record's time. Returns each check with its detail and the record it checked.",
      inputSchema: NO_INPUT,
      run: async () => {
        const { record, publication, checks, registry } = await verifiedRecord();
        const verified = checks?.hash.state === "pass" && checks.nav.state === "pass";
        return {
          verified,
          checks: checks ? { fingerprint: checks.hash, arithmetic: checks.nav } : { fingerprint: { state: "pending", detail: "This server no longer keeps the document of this record; the record on X Layer still stands." } },
          record: {
            navUsd: usd(record.navPerShareMicros), effectiveAt: record.effectiveAt, recordedAt: record.publishedAt, holdingsHash: record.holdingsHash,
            registry, chainId: FUND_DEPLOYMENT.chainId, transactionHash: publication?.txHash ?? null,
            explorerUrl: publication?.txHash ? `${FUND_DEPLOYMENT.explorerUrl}/tx/${publication.txHash}` : null,
          },
          note: "Ganymede's server ran these checks against a direct read of X Layer. Anyone can run the same checks in a browser at the Transparency page, or on a downloaded evidence file with `npm run verify:evidence`. They show the record is consistent with its document; they cannot show the prices themselves are right, which the publisher compares with the xStocks' X Layer pools before recording.",
          verifyYourself: page("/products/ustx/transparency"), environment: DEMO,
        };
      },
    },
    {
      name: "get_ustx_holdings",
      title: "What one USTX share holds",
      description: "The xStocks behind one USTX share in the latest verified record: each token's X Layer mainnet address, units per share, OKX OnchainOS price, value per share and weight.",
      inputSchema: NO_INPUT,
      run: async () => {
        const { record, checks } = await verifiedRecord();
        const composition = checks?.composition;
        if (!composition) throw new Error("composition unavailable");
        return {
          navUsd: usd(composition.navPerShareMicros), asOf: composition.asOf, basketFixedAt: composition.basketFixedAt, verified: checks.hash.state === "pass" && checks.nav.state === "pass",
          holdings: composition.holdings.map(holding => ({
            symbol: holding.symbol, tokenAddress: holding.address, chain: "X Layer mainnet (196)",
            unitsPerShare: (Number(BigInt(holding.unitsWad)) / 1e18).toString(), priceUsd: usd(holding.priceMicros), valuePerShareUsd: usd(holding.valueMicros),
            weightPercent: (Number(BigInt(holding.valueMicros) * 10_000n / BigInt(composition.navPerShareMicros)) / 100).toFixed(2), priceTime: holding.priceTime, priceSource: holding.priceSource,
          })),
          holdingsHash: record.holdingsHash,
          note: "The testnet fund issues USTX at this NAV but holds no xStocks; the units say what a share tracks.",
          environment: DEMO,
        };
      },
    },
    {
      name: "quote_ustx_order",
      title: "Quote a USTX order",
      description: "What an order of USTX would get right now at each venue on X Layer Testnet: the fund at the recorded NAV (no fee), the USTX/dUSD constant-product pool (0.3% fee) and the Uniswap v4 pool held at the NAV (a fee from 0.30% to 1.00% as the record ages), and which gives the most. Buying, amount is in demo dollars; selling, in USTX. Quotes only: the user places the order with their own wallet.",
      inputSchema: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["buy", "sell"], description: "buy USTX with demo dollars, or sell USTX for them" },
          amount: { type: "number", description: "buy: demo dollars to spend (10 to 1,000,000); sell: USTX to sell (0.000001 to 100,000)" },
        },
        required: ["side", "amount"],
        additionalProperties: false,
      },
      run: async (args) => {
        const side = args.side;
        if (side !== "buy" && side !== "sell") throw new ToolInputError("side must be \"buy\" or \"sell\".");
        const amount = side === "buy" ? amountMicros(args.amount, "amount (demo dollars)", FUND_MIN_INVESTMENT_MICROS, 1_000_000n * ONE) : amountMicros(args.amount, "amount (USTX)", 1n, 100_000n * ONE);
        const [{ pool }, v4] = await Promise.all([
          readLiquidity(null),
          V4_POOL_DEPLOYMENT ? readV4Quote(V4_POOL_DEPLOYMENT, side, amount, ZERO_ADDRESS).catch(() => null) : Promise.resolve(null),
        ]);
        const nav = pool.nav.navMicros;
        const route = routeOrder(side, amount, nav, pool);
        const out = (micros: bigint | null) => micros === null ? null : side === "buy" ? `${ustx(micros)} USTX` : `${usd(micros)} dUSD`;
        const price = (micros: bigint | null) => micros === null ? null : usd(side === "buy" ? pricePerShare(amount, micros) : pricePerShare(micros, amount));
        const venues = {
          fund: { name: side === "buy" ? "Invest at the fund at the NAV" : "Redeem at the fund at the NAV", receive: out(route.fund), pricePerShareUsd: route.fund === null ? null : nav === null ? null : usd(nav), fee: "none",
            unavailable: route.fund === null ? (nav === null ? "The fund waits for the next NAV record." : "The fund takes buys of at least $10.") : null },
          pool: { name: "USTX/dUSD constant-product pool", receive: out(route.pool), pricePerShareUsd: price(route.pool), fee: `${Number(POOL_FEE_BPS) / 100}%`, unavailable: route.pool === null ? "No liquidity for this order." : null },
          v4: V4_POOL_DEPLOYMENT ? { name: "Uniswap v4 pool held at the NAV", receive: out(v4?.amountOut ?? null), pricePerShareUsd: price(v4?.amountOut ?? null),
            fee: v4?.feePips != null ? formatFeePips(v4.feePips) : null, unavailable: v4 === null ? "The v4 pool could not be quoted right now." : v4.reason } : null,
        };
        const candidates: Array<[string, bigint | null]> = [["fund", route.fund], ["pool", route.pool], ["v4", v4?.amountOut ?? null]];
        const best = candidates.reduce<[string, bigint] | null>((top, [name, value]) => value !== null && (top === null || value > top[1]) ? [name, value] : top, null);
        return {
          side, amount: side === "buy" ? `${usd(amount)} dUSD` : `${ustx(amount)} USTX`, navUsd: nav === null ? null : usd(nav), venues, best: best?.[0] ?? null,
          howToExecute: `Open ${page("/products/ustx")}, connect OKX Wallet on X Layer Testnet, and the order panel routes to the best venue; every order needs the user's own signature.`,
          environment: DEMO,
        };
      },
    },
    {
      name: "get_ustx_pools",
      title: "USTX liquidity pools",
      description: "Both USTX/dUSD pools on X Layer Testnet: value at the NAV, price, fee, and what each pool's trades made or lost for its liquidity providers at the NAV over the same NAV records (the constant-product pool loses to arbitrage after each record; the Uniswap v4 pool moves to the NAV first).",
      inputSchema: NO_INPUT,
      run: async () => {
        const body = await json(await readPoolsApi());
        const pools = (body.pools as Array<Record<string, unknown>>).map(pool => ({
          id: pool.id, type: pool.type, valueUsd: pool.valueMicros ? usd(pool.valueMicros as string) : null, priceUsd: pool.priceMicros ? usd(pool.priceMicros as string) : null, navUsd: pool.navMicros ? usd(pool.navMicros as string) : null,
          fee: pool.feeBps !== undefined ? `${Number(pool.feeBps) / 100}%` : pool.feePips != null ? formatFeePips(Number(pool.feePips)) : null,
          lpResult: pool.lpResult && {
            trades: (pool.lpResult as Record<string, unknown>).trades, resultUsd: usd((pool.lpResult as Record<string, string>).resultMicros),
            lostToArbitrageUsd: usd((pool.lpResult as Record<string, string>).arbitrageResultMicros), arbitrages: (pool.lpResult as Record<string, unknown>).arbitrages,
            per10kPerYearUsd: (pool.lpResult as Record<string, string | null>).per10kYearMicros ? usd((pool.lpResult as Record<string, string>).per10kYearMicros) : null,
            repegs: (pool.lpResult as Record<string, unknown>).repegs ?? null,
          },
          explorerUrl: pool.explorerUrl,
        }));
        return { pools, lpResultsWindow: body.lpResults, page: page("/pools"), environment: DEMO };
      },
    },
    {
      name: "get_ustx_market_activity",
      title: "USTX market activity",
      description: "The latest events of the USTX market on X Layer Testnet, newest first: investments and redemptions at the NAV, trades in both pools, the keeper's arbitrage, liquidity and lending, each with its transaction; and the last 24 hours' trades and volume.",
      inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 40, description: "rows to return, 10 if not given" } }, additionalProperties: false },
      run: async (args) => {
        const limit = args.limit === undefined ? 10 : Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new ToolInputError("limit must be a whole number from 1 to 40.");
        const body = await json(await readActivityApi());
        const rows = (body.rows as Array<Record<string, unknown>>).slice(0, limit).map(row => ({
          kind: row.kind, at: row.at, dollars: row.dollarsMicros ? usd(row.dollarsMicros as string) : null, ustx: row.sharesMicros ? ustx(row.sharesMicros as string) : null,
          navUsd: row.navMicros ? usd(row.navMicros as string) : null, account: row.account, explorerUrl: row.explorerUrl,
        }));
        const day = body.day as Record<string, unknown>;
        return {
          last24h: { trades: day.trades, volumeUsd: usd(day.volumeMicros as string), arbitrages: day.arbitrages, arbitrageEarnedUsd: usd(day.earnedMicros as string), loanActions: day.loans, complete: day.complete },
          rows, environment: DEMO,
        };
      },
    },
    {
      name: "list_funds",
      title: "Every Ganymede product",
      description: "Every product on Markets with its latest NAV record on X Layer: six baskets of xStocks (USTX and M7X, AIX, CRYX, CORX, RTLX), two covered-call funds (SPYC on SPYx, QQQC on QQQx) and a step-down autocallable note (ELS1 on the worse of SPYx and QQQx). Each with the id for get_fund, its kind, NAV, when it was recorded and its change over seven days. Only USTX can be bought; the others are recorded every five minutes but have no share token yet.",
      inputSchema: NO_INPUT,
      run: async () => {
        const funds = await fundSummaries(new EngineRepository(engineEnv().DB));
        return {
          funds: funds.map(fund => ({
            id: fund.id, ticker: fund.ticker, name: fund.name, kind: fund.kind, holds: fund.holdings.map(holding => holding.symbol),
            navUsd: fund.nav ? usd(fund.nav.perShareMicros) : null, asOf: fund.nav?.asOf ?? null, change7dPercent: fund.changePercent === null ? null : Number(fund.changePercent.toFixed(2)),
            investable: fund.onchainShares, page: page(fund.href),
          })),
          environment: DEMO,
        };
      },
    },
    {
      name: "get_fund",
      title: "One Ganymede product in detail",
      description: "One product by its id or ticker, from its latest confirmed record on X Layer: a basket's holdings and weights; a covered-call fund's ETF price, this month's call (strike, expiry, premium, what it is worth now) and its return from today to expiry if the ETF falls 10%, stays flat or rises 10%; or the note's index levels against their start, the knock-in and how far the worse index would have to fall to reach it, the next observation's barrier and payment, and the whole schedule.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "a product's id or ticker from list_funds, such as spy-qqq-autocall-1 or ELS1" } }, required: ["id"], additionalProperties: false },
      run: async (args) => {
        const fund = fundByName(args.id);
        const repo = new EngineRepository(engineEnv().DB);
        const [summary, confirmed] = await Promise.all([fundSummary(repo, fund), fund.onchainShares ? Promise.resolve(null) : confirmedRecord(repo, fund)]);
        const nav = fund.onchainShares ? summary.nav : confirmed && { perShareMicros: confirmed.record.navPerShareMicros, asOf: confirmed.record.asOf, txHash: confirmed.record.txHash };
        const base = {
          id: fund.id, ticker: fund.ticker, name: fund.name, kind: fund.kind ?? "basket", description: fund.description,
          navUsd: nav ? usd(nav.perShareMicros) : null, asOf: nav?.asOf ?? null,
          transactionHash: nav?.txHash ?? null, explorerUrl: nav?.txHash ? `${FUND_DEPLOYMENT.explorerUrl}/tx/${nav.txHash}` : null,
          change7dPercent: summary.changePercent === null ? null : Number(summary.changePercent.toFixed(2)),
          investable: fund.onchainShares, page: page(fund.href),
        };
        if (fund.onchainShares) return { ...base, seeAlso: "get_ustx_nav, get_ustx_holdings and quote_ustx_order give USTX's record, holdings and quotes.", environment: DEMO };
        return { ...base, ...describeDocument(fund, confirmed?.document ?? null, Date.now()), notOpen: "Investing in this product is not open yet: it has no share token. Its value is recorded on X Layer every five minutes.", environment: DEMO };
      },
    },
  ];
}
