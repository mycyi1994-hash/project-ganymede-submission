import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { ACTIVITY_HIGHLIGHTS, ACTIVITY_LIMIT, activityDay, activityDayJson, activityJson, isHighlight, parseActivityIndex } from "@/lib/xstocks/activity";
import { STATE_MARKET_ACTIVITY } from "@/lib/xstocks/activity-index";
import { FUND_DEPLOYMENT, fundExplorer } from "@/lib/xstocks/fund";
import { RANGE_POOL_DEPLOYMENT } from "@/lib/xstocks/range-liquidity";
import { V4_POOL_DEPLOYMENT } from "@/lib/xstocks/v4-liquidity";

export const dynamic = "force-dynamic";

// Any site or app may read this: public chain events, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

const unavailable = () => json({ error: "Market activity is still being read from X Layer Testnet. Try again in a few minutes.", code: "activity_unavailable" }, 503, "no-store");

/** The latest USTX market activity on X Layer Testnet, as the scheduled job last read it. Reads only. */
export async function GET() {
  try {
    const index = parseActivityIndex((await new EngineRepository(engineEnv().DB).getState(STATE_MARKET_ACTIVITY))?.value);
    if (!index) return unavailable();
    return json({
      network: FUND_DEPLOYMENT.name,
      chainId: FUND_DEPLOYMENT.chainId,
      fromBlock: index.fromBlock,
      toBlock: index.toBlock,
      contracts: {
        fund: FUND_DEPLOYMENT.fund, pool: FUND_DEPLOYMENT.pool, arbitrage: FUND_DEPLOYMENT.arbitrage, lending: FUND_DEPLOYMENT.lending,
        ...(V4_POOL_DEPLOYMENT ? { v4Router: V4_POOL_DEPLOYMENT.router, v4Hook: V4_POOL_DEPLOYMENT.hook } : {}),
        ...(RANGE_POOL_DEPLOYMENT ? { rangeArbitrage: RANGE_POOL_DEPLOYMENT.arbitrage } : {}),
      },
      rule: "The latest events of these contracts up to toBlock, newest first, at most 40 rows. An arbitrage is one row: its pool trade and fund order are folded in. rangeArbitrage is the keeper's arbitrage of the range pool, folded the same way from its fund order and its report (dollarsMicros went in, dollarsOutMicros came back, sharesMicros moved through the range pool). v4Buy, v4Sell, v4Deposit and v4Withdraw are the Uniswap v4 pool's trades through its router and its liquidity. day counts the last 24 hours (trades are orders at the fund and in both pools, and arbitrage; poolTrades, poolVolumeMicros and poolFeesMicros count the trades in the constant-product pool, an arbitrage's included, the demo dollars paid in or out and the 0.3% fee left with its liquidity providers); when complete is false it counts from since. highlights are the arbitrages and orders of $1,000 or more among the latest 1,500 events the index keeps, at most 60. Amounts are micros (6 decimals).",
      day: activityDayJson(activityDay(index, Date.now())),
      rows: index.rows.slice(0, ACTIVITY_LIMIT).map(row => ({ ...activityJson(row), explorerUrl: fundExplorer.tx(row.hash) })),
      highlights: index.rows.filter(isHighlight).slice(0, ACTIVITY_HIGHLIGHTS).map(row => ({ ...activityJson(row), explorerUrl: fundExplorer.tx(row.hash) })),
      environment: "X Layer Testnet. Demo dollars and USTX have no value.",
    }, 200, "public, max-age=30");
  } catch (error) {
    console.error("Public market activity read failed", error instanceof Error ? error.message : String(error));
    return unavailable();
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
