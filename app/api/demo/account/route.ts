import { isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, ledger } from "@/lib/demo/api";
import { DEMO_MIN_ORDER_MICROS, DEMO_START_CASH_MICROS } from "@/lib/demo/ledger";

export const dynamic = "force-dynamic";

/** The visitor's demo account. Reads only: a new visitor gets a session cookie and a fresh account view. */
export async function GET(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, true);
    if (!identity) return noStoreJson({ error: "Demo accounts are not available here." }, { status: 401 });
    const demo = ledger();
    const [account, orders] = await Promise.all([demo.account(identity.subject), demo.orders(identity.subject)]);
    const limits = { startCashMicros: DEMO_START_CASH_MICROS.toString(), minOrderMicros: DEMO_MIN_ORDER_MICROS.toString() };
    return noStoreJson({ account, orders, limits }, { headers: identity.cookie ? { "Set-Cookie": identity.cookie } : undefined });
  } catch (error) {
    return demoFailure(error);
  }
}
