import { noStoreJson } from "@/lib/engine/api-helpers";
import { combineFund, demoFailure, ledger, walletTotals } from "@/lib/demo/api";

export const dynamic = "force-dynamic";

/** Public fund totals: shares outstanding and investors across wallets and demo balances, and 24-hour flows. Reads only. */
export async function GET() {
  try {
    const [demo, wallets] = await Promise.all([ledger().fund(new Date()), walletTotals()]);
    return noStoreJson(combineFund(demo, wallets));
  } catch (error) {
    return demoFailure(error);
  }
}
