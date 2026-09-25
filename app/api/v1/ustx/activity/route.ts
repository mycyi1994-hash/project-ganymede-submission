import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { ACTIVITY_LIMIT, activityDay, activityDayJson, activityJson, parseActivityIndex } from "@/lib/xstocks/activity";
import { STATE_MARKET_ACTIVITY } from "@/lib/xstocks/activity-index";
import { FUND_DEPLOYMENT, fundExplorer } from "@/lib/xstocks/fund";

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
      contracts: { fund: FUND_DEPLOYMENT.fund, pool: FUND_DEPLOYMENT.pool, arbitrage: FUND_DEPLOYMENT.arbitrage, lending: FUND_DEPLOYMENT.lending },
      rule: "The latest events of these contracts up to toBlock, newest first, at most 40 rows. An arbitrage is one row: its pool trade and fund order are folded in. day counts the last 24 hours (trades are orders at the fund and in the pool, and arbitrage); when complete is false it counts from since. Amounts are micros (6 decimals).",
      day: activityDayJson(activityDay(index, Date.now())),
      rows: index.rows.slice(0, ACTIVITY_LIMIT).map(row => ({ ...activityJson(row), explorerUrl: fundExplorer.tx(row.hash) })),
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
