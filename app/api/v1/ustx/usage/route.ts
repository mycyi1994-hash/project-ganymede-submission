import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
import { TEAM_WALLETS } from "@/lib/xstocks/team-wallets";
import { STATE_USAGE, parseUsage, summarizeUsage } from "@/lib/xstocks/usage";
import { ASK_COUNT_KEY } from "@/lib/assistant/ask";

export const dynamic = "force-dynamic";

// Any site or app may read this: public chain events, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

/** USTX usage since launch on X Layer Testnet, the team's and tests' wallets apart. Reads only. */
export async function GET() {
  try {
    const repo = new EngineRepository(engineEnv().DB);
    const [state, asked] = await Promise.all([repo.getState(STATE_USAGE), repo.getState(ASK_COUNT_KEY)]);
    const usage = parseUsage(state?.value);
    if (!usage) return json({ error: "Usage is still being read from X Layer Testnet. Try again in a few minutes.", code: "usage_unavailable" }, 503, "no-store");
    return json({
      network: FUND_DEPLOYMENT.name,
      chainId: FUND_DEPLOYMENT.chainId,
      ...summarizeUsage(usage, Date.now()),
      askUstx: { questions: Number(asked?.value ?? 0), since: "2026-10-03" },
      rule: "Every event of the USTX fund, both USTX/dUSD pools and the lending market from fromBlock to toBlock, as GET /api/v1/ustx/activity reads them, one action per row. outside counts wallets that are not in teamWallets: how many, how many acted in the last 7 days, their actions and the demo dollars their trades moved (orders at the fund and in both pools, and arbitrage). team counts the wallets in teamWallets: the administrator, the relayer, the arbitrage keeper, the test OKB faucet and the test wallets. Wallets we do not know of may still be ours from earlier manual testing. askUstx counts the questions asked of the site's assistant since its since date. Amounts are micros (6 decimals).",
      teamWallets: TEAM_WALLETS,
      environment: "X Layer Testnet. Demo dollars and USTX have no value.",
    }, 200, "public, max-age=60");
  } catch (error) {
    console.error("Public usage read failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Usage is unavailable right now.", code: "usage_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
