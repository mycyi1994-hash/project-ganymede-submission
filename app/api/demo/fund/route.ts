import { noStoreJson } from "@/lib/engine/api-helpers";
import { demoFailure, ledger } from "@/lib/demo/api";

export const dynamic = "force-dynamic";

/** Public totals of the demo fund: shares outstanding, investors and 24-hour flows. Reads only. */
export async function GET() {
  try {
    return noStoreJson(await ledger().fund(new Date()));
  } catch (error) {
    return demoFailure(error);
  }
}
