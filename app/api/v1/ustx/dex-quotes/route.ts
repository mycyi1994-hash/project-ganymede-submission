import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { XSTOCK_TOKENS } from "@/lib/xstocks/mainnet";
import { DEX_FROM_TOKEN, STATE_DEX_QUOTES, compareDex, parseDexQuotes } from "@/lib/xstocks/dex-quotes";

export const dynamic = "force-dynamic";

// Any site or app may read this: public quotes, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

/** The OKX DEX aggregator's quotes for buying USTX's xStocks by hand on X Layer mainnet. Reads only. */
export async function GET() {
  try {
    const quotes = parseDexQuotes((await new EngineRepository(engineEnv().DB).getState(STATE_DEX_QUOTES))?.value);
    if (!quotes) return json({ error: "The quotes have not been read yet. Try again within the hour.", code: "quotes_unavailable" }, 503, "no-store");
    const total = compareDex(quotes);
    return json({
      network: "X Layer mainnet",
      chainIndex: 196,
      source: "OKX OnchainOS DEX aggregator quote API",
      at: quotes.at,
      basketUsd: quotes.basketUsd,
      from: DEX_FROM_TOKEN,
      tokens: XSTOCK_TOKENS,
      ...(quotes.error ? { error: quotes.error } : {}),
      legs: quotes.legs,
      total: {
        swaps: total.legs,
        paidMicros: total.paidMicros.toString(),
        receivedMicros: total.receivedMicros?.toString() ?? null,
        costMicros: total.costMicros?.toString() ?? null,
        networkFeeUsd: total.networkFeeUsd,
        maxPriceImpactPercent: total.maxImpactPercent,
      },
      rule: "Once an hour, a quote for each of the xStocks, paying an equal share of basketUsd in USDT, from the OKX OnchainOS DEX aggregator on X Layer mainnet. Quotes only: nothing is sent. receivedMicros values what each swap returns at the aggregator's own unit price; costMicros is what was paid less that value, before network fees. Token approvals add a transaction per token the first time. Amounts are micros (6 decimals).",
    }, 200, "public, max-age=300");
  } catch (error) {
    console.error("Public DEX quotes read failed", error instanceof Error ? error.message : String(error));
    return json({ error: "The quotes are unavailable right now.", code: "quotes_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
