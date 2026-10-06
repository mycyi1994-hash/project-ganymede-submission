import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { FUNDS } from "@/lib/funds/catalog";
import { fundDetail, fundSummaries } from "@/lib/funds/api";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";

export const dynamic = "force-dynamic";

// Any site or app may read this: public records, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };
const json = (value: unknown, status: number, cache: string) => new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });

/**
 * The Ganymede funds and their latest NAV records, or with ?id= one fund with its holdings document,
 * recent records and how its prices compared with the X Layer pools. Reads only.
 */
export async function GET(request: Request) {
  try {
    const repo = new EngineRepository(engineEnv().DB);
    const id = new URL(request.url).searchParams.get("id");
    const registry = { chainId: PROOF_DEPLOYMENT.chainId, address: PROOF_DEPLOYMENT.registry, explorerUrl: PROOF_DEPLOYMENT.explorerUrl };
    const environment = "X Layer Testnet. Demo dollars and fund shares have no value.";
    if (id) {
      const fund = FUNDS.find((item) => item.id === id);
      if (!fund) return json({ error: "No fund has that id.", code: "unknown_fund" }, 404, "no-store");
      return json({ fund: await fundDetail(repo, fund), registry, environment }, 200, "public, max-age=30");
    }
    return json({
      funds: await fundSummaries(repo),
      registry,
      rule: "Every product is priced from xStocks on X Layer mainnet through OKX OnchainOS and recorded every five minutes in the NAV registry under productKey = keccak256(id). kind says what it is: basket, a basket of xStocks with fixed units per share, equal weight at each fixing; covered-call, an xStock ETF less a one-month call sold 2% above its price, priced by Black–Scholes at stated terms because there is no options market for xStocks on X Layer; autocall, a step-down note on the worse of SPYx and QQQx that pays from recorded prices. Only USTX (onchainShares) can be bought; the others have no share token yet. nav is the latest confirmed record; series is the last seven days of records, thinned; changePercent is the change over that series. Amounts are micros (6 decimals).",
      environment,
    }, 200, "public, max-age=30");
  } catch (error) {
    console.error("Public funds read failed", error instanceof Error ? error.message : String(error));
    return json({ error: "The funds are unavailable right now.", code: "funds_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
