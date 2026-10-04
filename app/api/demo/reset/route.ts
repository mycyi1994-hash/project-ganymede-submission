import { isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, ledger } from "@/lib/demo/api";
import { engineEnv } from "@/lib/engine/api-helpers";
import { FundDemoLedger, type FundDb } from "@/lib/funds/demo";

export const dynamic = "force-dynamic";

/** Starts this browser's demo account again with $10,000 demo dollars and no fund holdings. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, false);
    if (!identity) return noStoreJson({ error: "Open the demo account first. Cookies must be enabled.", code: "no_session" }, { status: 401 });
    const demo = ledger();
    const account = await demo.reset(identity.subject, new Date());
    // The same demo balance holds the other funds; starting again clears them too.
    await new FundDemoLedger(engineEnv().DB as unknown as FundDb).reset(identity.subject);
    return noStoreJson({ account, orders: [] });
  } catch (error) {
    return demoFailure(error);
  }
}
