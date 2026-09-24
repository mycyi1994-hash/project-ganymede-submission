import { isSameSiteRequest, noStoreJson, readJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, latestRecord, ledger, orderId, parseOrder } from "@/lib/demo/api";
import { DemoOrderError, executableNav } from "@/lib/demo/ledger";

export const dynamic = "force-dynamic";

/** Fills a demo order at the latest NAV recorded on X Layer. Demo dollars only. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, false);
    if (!identity) return noStoreJson({ error: "Open the demo account first. Cookies must be enabled.", code: "no_session" }, { status: 401 });
    let body: unknown;
    try { body = await readJson<unknown>(request); } catch { throw new DemoOrderError("Send a JSON object with Content-Type: application/json."); }
    const input = parseOrder(body);
    const nav = executableNav(await latestRecord(), Date.now());
    const demo = ledger();
    const id = await orderId(identity.subject, input.clientOrderId);
    const result = await demo.place(identity.subject, { id, side: input.side, usdMicros: input.usdMicros, sharesMicros: input.sharesMicros }, nav, new Date());
    return noStoreJson({ ...result, orders: await demo.orders(identity.subject) }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return demoFailure(error);
  }
}
