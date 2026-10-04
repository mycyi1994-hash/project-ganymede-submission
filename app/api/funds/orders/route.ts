import { engineEnv, isSameSiteRequest, noStoreJson, readJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, orderId, parseOrder } from "@/lib/demo/api";
import { DemoOrderError, executableNav } from "@/lib/demo/ledger";
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
    const nav = executableNav(await fundLatestRecord(fund), Date.now());
    const db = engineEnv().DB as unknown as FundDb;
    await ensureFundDemoTables(db);
    const demo = new FundDemoLedger(db);
    // The id covers the fund too, so the same client id in two funds never collides.
    const id = await orderId(identity.subject, `${fund.id}-${input.clientOrderId}`);
    const result = await demo.place(identity.subject, fund.id, { id, side: input.side, usdMicros: input.usdMicros, sharesMicros: input.sharesMicros }, nav, new Date());
    const [cash, positions] = await Promise.all([demo.cash(identity.subject), demo.positions(identity.subject)]);
    return noStoreJson({ ...result, cashMicros: cash.toString(), positions }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return demoFailure(error);
  }
}
