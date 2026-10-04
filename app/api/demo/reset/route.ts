import { isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, ledger } from "@/lib/demo/api";

export const dynamic = "force-dynamic";

/** Starts this browser's demo account again with $10,000 demo dollars and no fund holdings. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, false);
    if (!identity) return noStoreJson({ error: "Open the demo account first. Cookies must be enabled.", code: "no_session" }, { status: 401 });
    const demo = ledger();
    await demo.reset(identity.subject, new Date());
    return noStoreJson({ ...await demo.portfolio(identity.subject), orders: await demo.orders(identity.subject) });
  } catch (error) {
    return demoFailure(error);
  }
}
