import { engineEnv, isSameSiteRequest, noStoreJson, readJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, orderId, parseOrder } from "@/lib/demo/api";
import { DemoLedger, DemoOrderError, executableNav } from "@/lib/demo/ledger";
import { otherFund } from "@/lib/funds/catalog";
import { fundLatestRecord } from "@/lib/funds/api";
import { ensureFundDemoTables, FundDemoLedger, type FundDb } from "@/lib/funds/demo";

export const dynamic = "force-dynamic";

/** Fills a demo order in one of the funds at its latest NAV recorded on X Layer. Demo dollars only. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, false);
    if (!identity) return noStoreJson({ error: "Open the demo account first. Cookies must be enabled.", code: "no_session" }, { status: 401 });
    let body: unknown;
    try { body = await readJson<unknown>(request); } catch { throw new DemoOrderError("Send a JSON object with Content-Type: application/json."); }
    const fund = otherFund(typeof (body as { fundId?: unknown })?.fundId === "string" ? (body as { fundId: string }).fundId : "");
    if (!fund) throw new DemoOrderError("Choose one of the funds.", 400, "unknown_fund");
    const input = parseOrder(body);
    const db = engineEnv().DB as unknown as FundDb;
    await ensureFundDemoTables(db);
    const demo = new FundDemoLedger(db);
    // The id covers the fund too, so the same client id in two funds never collides.
    const id = await orderId(identity.subject, `${fund.id}-${input.clientOrderId}`);
    // Recover a committed order even when the NAV/RPC is no longer available on retry.
    const existing = await demo.order(identity.subject, id);
    const result = existing ? { order: existing, replayed: true }
      : await demo.place(identity.subject, fund.id, { id, side: input.side, usdMicros: input.usdMicros, sharesMicros: input.sharesMicros }, executableNav(await fundLatestRecord(fund), Date.now()), new Date());
    const { account, positions } = await new DemoLedger(engineEnv().DB).portfolio(identity.subject);
    return noStoreJson({ ...result, cashMicros: account.cashMicros, positions }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return demoFailure(error);
  }
}
