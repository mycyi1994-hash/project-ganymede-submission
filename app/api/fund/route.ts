import { EngineRepository } from "@/lib/engine/repository";
import { engineEnv, jsonError, noStoreJson } from "@/lib/engine/api-helpers";
import { fundFlows, parseActivityIndex } from "@/lib/xstocks/activity";
import { STATE_MARKET_ACTIVITY } from "@/lib/xstocks/activity-index";
import { walletTotals } from "@/lib/xstocks/wallet-totals";

export const dynamic = "force-dynamic";

/**
 * USTX fund totals from X Layer Testnet: the shares the fund contract has issued to wallets, the
 * wallets holding them, and the last 24 hours of orders at the fund, from the market activity index
 * the cron reads from the contracts' events. Reads only.
 */
export async function GET() {
  try {
    const [wallets, stored] = await Promise.all([walletTotals(), new EngineRepository(engineEnv().DB).getState(STATE_MARKET_ACTIVITY)]);
    if (!wallets) return noStoreJson({ error: "The fund could not be read on X Layer Testnet just now.", code: "unavailable" }, { status: 503 });
    const index = parseActivityIndex(stored?.value);
    const flows = index ? fundFlows(index, Date.now()) : null;
    return noStoreJson({
      sharesOutstandingMicros: wallets.sharesMicros,
      investors: wallets.investors,
      block: wallets.block,
      last24h: flows ? { investedMicros: flows.investedMicros.toString(), redeemedMicros: flows.redeemedMicros.toString(), orders: flows.orders, complete: flows.complete, since: flows.since } : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
