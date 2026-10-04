import { engineEnv, isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity } from "@/lib/demo/api";
import { DEMO_MIN_ORDER_MICROS, DemoLedger } from "@/lib/demo/ledger";
import { FundDemoLedger, type FundDb } from "@/lib/funds/demo";

export const dynamic = "force-dynamic";

/** The visitor's demo cash and fund holdings. Reads only: a new visitor gets a session cookie. */
export async function GET(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, true);
    if (!identity) return noStoreJson({ error: "Demo accounts are not available here." }, { status: 401 });
    const demo = new FundDemoLedger(engineEnv().DB as unknown as FundDb);
    const fundId = new URL(request.url).searchParams.get("fund") ?? undefined;
    const [{ account, positions }, orders] = await Promise.all([new DemoLedger(engineEnv().DB).portfolio(identity.subject), demo.orders(identity.subject, fundId)]);
    return noStoreJson({ cashMicros: account.cashMicros, positions, orders, minOrderMicros: DEMO_MIN_ORDER_MICROS.toString() }, { headers: identity.cookie ? { "Set-Cookie": identity.cookie } : undefined });
  } catch (error) {
    return demoFailure(error);
  }
}
